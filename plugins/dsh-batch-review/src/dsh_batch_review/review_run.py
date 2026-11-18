"""本批审码跑批：读文件 → 网关 LLM → findings。不碰写码主路径。"""
from __future__ import annotations

import re
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .enrich import merge_findings, seed_findings_from_files
from .findings import (
    ReviewFinding,
    count_findings_bands,
    format_findings_report,
    parse_findings_ex,
    prose_claims_issues,
)
from .llm_bridge import chat_completions
from .prompt import (
    build_compact_gateway_system_prompt,
    build_repair_user_message,
    build_review_system_prompt,
    build_user_payload,
)
from .wb_config import llm_ready_detail, load_workbuddy_config, resolve_review_llm

ChatFn = Callable[..., str | None]
ProgressFn = Callable[[int, int], None]


def _emit_review_progress(fn: ProgressFn | None, done: int, total: int) -> None:
    """已审文件数 / 本批文件数。回调失败不得打断审码。"""
    if fn is None or total <= 0:
        return
    done_n = max(0, min(int(done), int(total)))
    try:
        fn(done_n, int(total))
    except Exception:
        return

_MAX_FILE_BYTES = 120_000
_MAX_TOTAL_BYTES = 800_000
_MAX_FILES = 40
# 单次 LLM 调用体积：公司网关 standard 对大包常写长文截断、漏机器块
_CHUNK_MAX_FILES = 3
_CHUNK_MAX_BYTES = 28_000
# 单文件喂给网关的上限（过大时模型只写分析、机器块被挤掉）
_GATEWAY_FILE_CAP = 18_000
# 非源码：纳入「已处理」但不喂 LLM，避免报告/jsonl 占满上下文
_NON_CODE_SUFFIXES = (
    ".md",
    ".markdown",
    ".txt",
    ".csv",
    ".jsonl",
    ".log",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".pdf",
    ".xlsx",
    ".xls",
    ".doc",
    ".docx",
)


def _normalize_rel(raw: str) -> str:
    # 去掉首尾空白与斜杠：git porcelain 的 ``MOM/`` → ``MOM``
    return str(raw or "").replace("\\", "/").strip().strip("/")


def _list_files_under_dir(root: Path, dir_path: Path, *, limit: int) -> list[str]:
    """目录展开为工作区内相对路径；空目录 / 不可读 → 空列表（不视为引擎故障）。"""
    if limit <= 0:
        return []
    out: list[str] = []
    try:
        for p in sorted(dir_path.rglob("*")):
            if not p.is_file():
                continue
            try:
                rel = p.resolve().relative_to(root).as_posix()
            except ValueError:
                continue
            if not rel or ".." in rel.split("/"):
                continue
            out.append(rel)
            if len(out) >= limit:
                break
    except OSError:
        return out
    return out


def _text_from_bytes(data: bytes) -> str:
    if len(data) > _MAX_FILE_BYTES:
        return data[:_MAX_FILE_BYTES].decode("utf-8", errors="replace") + "\n…(截断)"
    return data.decode("utf-8", errors="replace")


def _deleted_file_text(workspace: Path, rel: str) -> str | None:
    """工作区已删、但 HEAD 仍有的文件：用 HEAD 原文审「删除是否安全」。

    不在 HEAD 的缺失路径返回 None，仍按未能纳入处理（禁止把打错的路径当删除放行）。
    """
    try:
        proc = subprocess.run(
            ["git", "-C", str(workspace), "show", f"HEAD:{rel}"],
            capture_output=True,
            timeout=8,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    body = _text_from_bytes(proc.stdout)
    return (
        "【本路径已从工作区删除。以下是 HEAD 中的原文。"
        "请只审这次删除是否安全、是否还有引用残留，不要把「文件不存在」当成引擎故障。】\n"
        + body
    )


def _read_batch_files(workspace: str, rels: list[str]) -> tuple[list[tuple[str, str]], list[str]]:
    """返回 (成功读取的文件, 未能纳入审码的相对路径)。

    未跟踪目录（如 git status 的 ``MOM/``）会展开为内部文件再审。
    已删除文件读 HEAD 原文纳入审码，禁止因磁盘上不存在就整批报引擎不可用。
    越界、打错路径、不可读的文件记入 skipped，不因此拦截整批提交。
    """
    root = Path(workspace).resolve()
    out: list[tuple[str, str]] = []
    skipped: list[str] = []
    total = 0
    # 展开目录后可能变长；用队列保序处理
    queue: list[str] = []
    seen_q: set[str] = set()
    for raw in rels:
        rel = _normalize_rel(raw)
        if not rel or rel in seen_q:
            continue
        seen_q.add(rel)
        queue.append(rel)

    i = 0
    while i < len(queue):
        rel = queue[i]
        i += 1
        if not rel or ".." in rel.split("/"):
            if rel:
                skipped.append(rel)
            continue
        path = (root / rel).resolve()
        try:
            path.relative_to(root)
        except ValueError:
            skipped.append(rel)
            continue
        if path.is_dir():
            # 展开目录；空目录直接跳过（不阻塞本批其它文件）
            for child in _list_files_under_dir(root, path, limit=max(0, _MAX_FILES * 2)):
                if child not in seen_q:
                    seen_q.add(child)
                    queue.append(child)
            continue
        if path.is_file():
            try:
                text = _text_from_bytes(path.read_bytes())
            except OSError:
                skipped.append(rel)
                continue
        else:
            text = _deleted_file_text(root, rel)
            if text is None:
                skipped.append(rel)
                continue
        if len(out) >= _MAX_FILES:
            skipped.append(rel)
            continue
        piece = len(text.encode("utf-8"))
        # 已有文件时再超总上限 → 本文件与后续均跳过（闭门，禁止只审子集）
        if out and total + piece > _MAX_TOTAL_BYTES:
            skipped.append(rel)
            continue
        out.append((rel, text))
        total += piece
    return out, skipped


def _is_non_code_rel(rel: str) -> bool:
    lower = str(rel or "").lower()
    return any(lower.endswith(suf) for suf in _NON_CODE_SUFFIXES)


def _cap_text_for_llm(text: str, cap: int = _GATEWAY_FILE_CAP) -> str:
    raw = (text or "").encode("utf-8")
    if len(raw) <= cap:
        return text or ""
    return raw[:cap].decode("utf-8", errors="replace") + "\n…(截断)"


def _split_llm_chunks(batch: list[tuple[str, str]]) -> list[list[tuple[str, str]]]:
    """把源码文件切成小包，降低网关模型漏机器块概率。"""
    capped = [(rel, _cap_text_for_llm(text)) for rel, text in batch]
    chunks: list[list[tuple[str, str]]] = []
    cur: list[tuple[str, str]] = []
    cur_bytes = 0
    for rel, text in capped:
        piece = len(text.encode("utf-8"))
        overflow = cur and (
            len(cur) >= _CHUNK_MAX_FILES or cur_bytes + piece > _CHUNK_MAX_BYTES
        )
        if overflow:
            chunks.append(cur)
            cur = []
            cur_bytes = 0
        cur.append((rel, text))
        cur_bytes += piece
    if cur:
        chunks.append(cur)
    return chunks


def _checkout_meta(workspace: str) -> dict[str, str]:
    """页眉用的仓库/分支/提交。git 不可用时留空，不阻断审码。"""

    def _git(*args: str) -> str:
        try:
            proc = subprocess.run(
                ["git", "-C", workspace, *args],
                capture_output=True,
                timeout=5,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return ""
        if proc.returncode != 0:
            return ""
        return proc.stdout.decode("utf-8", errors="replace").strip()

    remote = _git("remote", "get-url", "origin")
    branch = _git("rev-parse", "--abbrev-ref", "HEAD") or "—"
    sha = _git("rev-parse", "HEAD") or "—"
    low = remote.lower()
    if "github.com" in low:
        source = "github"
    elif "gitee.com" in low:
        source = "gitee"
    elif "gitlab" in low:
        source = "gitlab"
    else:
        source = "git"
    repo = remote or workspace
    matched = re.search(r"[:/]([^/\s]+/[^/\s]+?)(?:\.git)?$", remote)
    if matched and source in {"github", "gitee", "gitlab"}:
        repo = matched.group(1)
    return {
        "repo": repo,
        "branch": branch,
        "commit": sha,
        "source": source,
        "workspace": workspace,
    }


def _compose_official_report(
    *,
    workspace: str,
    files_reviewed: list[str],
    code_batch: list[tuple[str, str]],
    llm_findings: list[ReviewFinding],
    chunk_count: int,
    passthrough: list[str],
) -> tuple[str, str, str, list[ReviewFinding]]:
    """对齐 WorkBuddy：规则补种 + format_findings_report + 远程审码页眉。"""
    seeded = seed_findings_from_files(
        [{"path": rel, "content": text} for rel, text in code_batch]
    )
    llm_count = len(llm_findings)
    merged = merge_findings(llm_findings, seeded)
    report_id = "cr-" + uuid.uuid4().hex[:16]
    fresh_id = (
        "cr-run-"
        + uuid.uuid4().hex[:12]
        + "-"
        + datetime.now(timezone.utc).strftime("%H%M%S")
    )
    summary = (
        f"已按 Viprasol + workbuddy-gate-90 **全量重审** {len(code_batch)} 个功能源码文件"
        f"（{chunk_count} 批，审码 ID `{fresh_id}`，无结果缓存）。"
        f"LLM 产出 {llm_count} 条；规则补种 {len(seeded)} 条；合并去重后 {len(merged)} 条。"
    )
    body = format_findings_report(
        merged,
        summary=summary,
        files_reviewed=files_reviewed,
        local_path=workspace,
    )
    warnings: list[str] = []
    if passthrough:
        warnings.append(
            f"另有 {len(passthrough)} 个非源码文件已列入审核文件，未送入 LLM"
        )
    if warnings:
        body = (
            body.rstrip()
            + "\n\n---\n⚠️ 审查告警：\n"
            + "\n".join(f"- {w}" for w in warnings)
            + "\n"
        )
    meta = _checkout_meta(workspace)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    header = "\n".join(
        [
            "代码审核汇总报告",
            "",
            f"- 仓库：{meta['repo']}",
            f"- 分支：{meta['branch']}",
            f"- 提交：{meta['commit']}",
            f"- 来源：{meta['source']}",
            f"- 报告 ID：{report_id}",
            f"- 检出路径：{meta['workspace']}",
            f"- 生成时间：{now}",
            "",
            "---",
            "",
        ]
    )
    reply = header + body.rstrip() + f"\n\n报告 ID：`{report_id}`\n"
    return report_id, reply, summary, merged


def _select_system_prompt(llm: dict[str, str]) -> str:
    """公司网关用短 system；其它（含 WorkBuddy 非官网槽）用完整 Skill 提示。"""
    if str(llm.get("provider") or "").strip().lower() == "zr-gateway":
        return build_compact_gateway_system_prompt()
    return build_review_system_prompt()


def _call_chunk_with_repair(
    *,
    fn: ChatFn,
    llm: dict[str, str],
    system: str,
    workspace: str,
    chunk: list[tuple[str, str]],
    focus: str,
) -> tuple[str, list[ReviewFinding], bool, str | None]:
    """
    单包审码：主调用 → 缺机器块则独立短催收一次（不复述整包源码，避免再截断）。
    返回 (prose, findings, has_block, raw_for_debug)。
    """
    user = build_user_payload(workspace=workspace, files=chunk, focus=focus)
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    raw = fn(llm, messages, max_tokens=1536, temperature=0.1, timeout=300.0)
    if raw is None or not str(raw).strip():
        return "", [], False, None
    prose, findings, has_block = parse_findings_ex(str(raw))
    if has_block:
        return prose, findings, True, str(raw)
    # 独立短催收：强制空块也可；禁止再让模型自由发挥长文
    files_hint = ", ".join(r for r, _ in chunk[:12])
    repair_msgs = [
        {"role": "system", "content": build_compact_gateway_system_prompt()},
        {
            "role": "user",
            "content": (
                "Output ONLY this (no analysis before the fence). "
                "If unsure, use empty array.\n\n"
                ":::code_review_findings\n[]\n:::\n\n"
                f"files: {files_hint}\n"
                + build_repair_user_message(prior_reply=str(raw))
            ),
        },
    ]
    raw2 = fn(llm, repair_msgs, max_tokens=768, temperature=0.0, timeout=90.0)
    if raw2 is None or not str(raw2).strip():
        # 催收无响应：本包记低危格式异常，禁止整批因网关偶发空响应当成引擎不可用
        return (
            prose,
            [
                ReviewFinding(
                    file=chunk[0][0],
                    line=1,
                    severity="low",
                    title="审码催收无响应（本包结构化条目缺失）",
                    description="二次催收未返回内容；本包未提取到 findings，请人工留意。",
                )
            ],
            True,
            str(raw),
        )
    prose2, findings2, has2 = parse_findings_ex(str(raw2))
    if has2:
        return prose2 or prose, findings2, True, str(raw2)
    # 催收仍无合法机器块：记低危提示并放行本包（不阻塞整批 commit 闸）
    return (
        prose2 or prose,
        [
            ReviewFinding(
                file=chunk[0][0],
                line=1,
                severity="low",
                title="审码机器块格式异常（本包结构化条目缺失）",
                description="模型未返回可解析的 :::code_review_findings；本包未提取到条目，请人工留意。",
            )
        ],
        True,
        str(raw2),
    )


def run_batch_review(
    *,
    workspace: str,
    files: list[str],
    focus: str = "",
    chat_fn: ChatFn | None = None,
    on_progress: ProgressFn | None = None,
) -> dict[str, Any]:
    """
    返回可被 dsh-cursor-chat evaluateBatchReviewPayload 消费的结构。
    unavailable：配置/网关未就绪、LLM 无响应、缺机器块。
    勾选文件读取失败不进入 unavailable，读得到的继续审，读不到的放行。
    """
    ws = str(workspace or "").strip()
    # 保序去重，避免同路径重复占配额
    seen: set[str] = set()
    rels: list[str] = []
    for f in files or []:
        rel = _normalize_rel(str(f or ""))
        if not rel or rel in seen:
            continue
        seen.add(rel)
        rels.append(rel)
    empty = {
        "ok": False,
        "unavailable": True,
        "ran": False,
        "passed": False,
        "high_count": 0,
        "medium_count": 0,
        "low_count": 0,
        "findings": [],
        "reply": "",
        "summary": "",
        "report_id": "",
        "detail": "",
        "engine": "embedded",
        "reviewed_files": [],
        "skipped_files": [],
    }
    if not ws:
        return {**empty, "detail": "缺少工作区路径"}
    if not rels:
        return {**empty, "detail": "本批无可审文件"}

    cfg = load_workbuddy_config()
    ready, ready_detail = llm_ready_detail(cfg)
    llm = resolve_review_llm(cfg)
    if not ready or not llm:
        return {**empty, "detail": ready_detail}

    batch, skipped = _read_batch_files(ws, rels)
    # 一个都读不到：直接放行，不拦 commit / push
    if not batch:
        if skipped:
            return {
                "ok": True,
                "unavailable": False,
                "ran": True,
                "passed": True,
                "high_count": 0,
                "medium_count": 0,
                "low_count": 0,
                "findings": [],
                "reply": "",
                "summary": "读取失败的文件已放行",
                "report_id": "",
                "detail": f"有 {len(skipped)} 个勾选文件读取失败，已放行，不拦截提交",
                "engine": "embedded",
                "config_path": str(cfg.get("_config_path") or ""),
                "llm_provider": llm.get("provider") or "",
                "llm_model": llm.get("model") or "",
                "reviewed_files": [],
                "skipped_files": skipped[:40],
            }
        return {**empty, "detail": "本批文件均不可读或不在工作区内"}

    # focus 仅允许短说明，禁止把整段 commit message / 指令注入进审码 prompt
    focus_safe = str(focus or "").strip().replace("\x00", "")
    if len(focus_safe) > 120:
        focus_safe = focus_safe[:120].rstrip() + "…"
    if any(x in focus_safe.lower() for x in ("ignore previous", "system prompt", "跳过审码", "忽略以上")):
        focus_safe = ""

    code_batch = [(r, t) for r, t in batch if not _is_non_code_rel(r)]
    passthrough = [r for r, _ in batch if _is_non_code_rel(r)]
    reviewed_all = [p for p, _ in batch]
    # 分母用本批勾选数（含已放行的读失败、不送模型的非源码），和界面「N 个文件」对齐
    progress_total = len(code_batch) + len(passthrough) + len(skipped)
    progress_done = len(passthrough) + len(skipped)

    # 本批全是报告/资源：无源码可审，直接放行（仍算 ran，避免误报引擎不可用）
    if not code_batch:
        _emit_review_progress(on_progress, progress_total, progress_total)
        return {
            "ok": True,
            "unavailable": False,
            "ran": True,
            "passed": True,
            "high_count": 0,
            "medium_count": 0,
            "low_count": 0,
            "findings": [],
            "reply": "",
            "summary": "本批无源码文件，跳过 LLM 审码",
            "report_id": "",
            "detail": (
                f"本批审码通过（无源码 · 透传 {len(passthrough)} 个非源码）"
                + (f"；{len(skipped)} 个文件读取失败，已放行" if skipped else "")
            ),
            "engine": "embedded",
            "config_path": str(cfg.get("_config_path") or ""),
            "llm_provider": llm.get("provider") or "",
            "llm_model": llm.get("model") or "",
            "reviewed_files": reviewed_all,
            "skipped_files": skipped[:40],
        }

    system = _select_system_prompt(llm)
    fn = chat_fn or (
        lambda llm_cfg, msgs, **kw: chat_completions(llm_cfg, msgs, **kw)
    )
    chunks = _split_llm_chunks(code_batch)
    all_findings: list[ReviewFinding] = []
    prose_parts: list[str] = []
    last_raw = ""
    done = progress_done

    for idx, chunk in enumerate(chunks):
        # 本片开始先报「当前第几份」，模型返回后再报本片已完成数
        _emit_review_progress(on_progress, done + 1, progress_total)
        focus_chunk = focus_safe or f"Git 交付本批审码闸（分片 {idx + 1}/{len(chunks)}）"
        prose, findings, has_block, raw = _call_chunk_with_repair(
            fn=fn,
            llm=llm,
            system=system,
            workspace=ws,
            chunk=chunk,
            focus=focus_chunk,
        )
        if raw:
            last_raw = raw
        if not has_block:
            return {
                **empty,
                "detail": "审码输出缺少结构化 findings，未放行",
                "reply": (prose or last_raw or "")[:2000],
                "reviewed_files": reviewed_all,
            }
        all_findings.extend(findings)
        if prose.strip():
            prose_parts.append(prose.strip())
        done += len(chunk)
        _emit_review_progress(on_progress, done, progress_total)

    prose = "\n".join(prose_parts).strip()
    findings = list(all_findings)
    claimed = not findings and prose_claims_issues(prose)
    if claimed:
        findings.append(
            ReviewFinding(
                file=code_batch[0][0],
                line=1,
                severity="high",
                title="审码摘要声称有问题但缺少结构化条目",
                description=(prose or "")[:800] or "模型未给出 findings 条目",
            )
        )

    report_id, reply, summary, merged = _compose_official_report(
        workspace=ws,
        files_reviewed=reviewed_all,
        code_batch=code_batch,
        llm_findings=findings,
        chunk_count=len(chunks),
        passthrough=passthrough,
    )
    n0, n1, n2 = count_findings_bands(merged)
    high = sum(1 for f in merged if f.severity in ("critical", "high"))
    passed = n0 <= 0 and not claimed
    if claimed:
        detail = "审码摘要与结构化 findings 不一致，按高危未通过处理"
    elif passed:
        detail = f"本批审码通过（高危 0 · 中危 {n1} · 低危 {n2}）"
        if skipped:
            detail += f"；{len(skipped)} 个文件读取失败，已放行"
    else:
        detail = f"存在 {n0} 处高危，审核不通过"
    return {
        "ok": passed,
        "unavailable": False,
        "ran": True,
        "passed": passed,
        "high_count": n0,
        "medium_count": n1,
        "low_count": n2,
        "findings": [f.to_dict() for f in merged],
        "reply": reply,
        "summary": summary,
        "report_id": report_id,
        "detail": detail,
        "engine": "embedded",
        "config_path": str(cfg.get("_config_path") or ""),
        "llm_provider": llm.get("provider") or "",
        "llm_model": llm.get("model") or "",
        "reviewed_files": reviewed_all,
        "skipped_files": skipped[:40],
        "_high_severity_rows": high,
        "_chunk_count": len(chunks),
        "_passthrough_non_code": passthrough,
    }
