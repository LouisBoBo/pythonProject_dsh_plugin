"""本批审码跑批：读文件 → 网关 LLM → findings。不碰写码主路径。"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from .findings import count_findings_bands, parse_findings_ex, prose_claims_issues
from .llm_bridge import chat_completions
from .prompt import build_review_system_prompt, build_user_payload
from .wb_config import llm_ready_detail, load_workbuddy_config, resolve_review_llm

ChatFn = Callable[..., str | None]

_MAX_FILE_BYTES = 120_000
_MAX_TOTAL_BYTES = 800_000
_MAX_FILES = 40


def _normalize_rel(raw: str) -> str:
    return str(raw or "").replace("\\", "/").strip().lstrip("/")


def _read_batch_files(workspace: str, rels: list[str]) -> tuple[list[tuple[str, str]], list[str]]:
    """返回 (成功读取的文件, 未能纳入审码的相对路径)。"""
    root = Path(workspace).resolve()
    out: list[tuple[str, str]] = []
    skipped: list[str] = []
    total = 0
    for raw in rels:
        rel = _normalize_rel(raw)
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
        if not path.is_file():
            skipped.append(rel)
            continue
        if len(out) >= _MAX_FILES:
            skipped.append(rel)
            continue
        try:
            data = path.read_bytes()
        except OSError:
            skipped.append(rel)
            continue
        if len(data) > _MAX_FILE_BYTES:
            text = data[:_MAX_FILE_BYTES].decode("utf-8", errors="replace") + "\n…(截断)"
        else:
            text = data.decode("utf-8", errors="replace")
        piece = len(text.encode("utf-8"))
        # 已有文件时再超总上限 → 本文件与后续均跳过（闭门，禁止只审子集）
        if out and total + piece > _MAX_TOTAL_BYTES:
            skipped.append(rel)
            continue
        out.append((rel, text))
        total += piece
    return out, skipped


def run_batch_review(
    *,
    workspace: str,
    files: list[str],
    focus: str = "",
    chat_fn: ChatFn | None = None,
) -> dict[str, Any]:
    """
    返回可被 dsh-cursor-chat evaluateBatchReviewPayload 消费的结构。
    unavailable：配置/网关未就绪、LLM 无响应、缺机器块、或勾选文件未全纳入审码。
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
    if skipped:
        return {
            **empty,
            "detail": f"有 {len(skipped)} 个勾选文件未能纳入审码，未放行",
            "reviewed_files": [p for p, _ in batch],
            "skipped_files": skipped[:40],
        }
    if not batch:
        return {**empty, "detail": "本批文件均不可读或不在工作区内"}

    # focus 仅允许短说明，禁止把整段 commit message / 指令注入进审码 prompt
    focus_safe = str(focus or "").strip().replace("\x00", "")
    if len(focus_safe) > 120:
        focus_safe = focus_safe[:120].rstrip() + "…"
    if any(x in focus_safe.lower() for x in ("ignore previous", "system prompt", "跳过审码", "忽略以上")):
        focus_safe = ""

    system = build_review_system_prompt()
    user = build_user_payload(workspace=ws, files=batch, focus=focus_safe)
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    fn = chat_fn or (
        lambda llm_cfg, msgs, **kw: chat_completions(llm_cfg, msgs, **kw)
    )
    raw = fn(llm, messages, max_tokens=4096, temperature=0.2, timeout=300.0)
    if raw is None or not str(raw).strip():
        # 不回显完整 base_url，避免内网地址进进度卡
        return {
            **empty,
            "detail": f"审码 LLM 无响应（provider={llm.get('provider')} model={llm.get('model')}）",
            "reviewed_files": [p for p, _ in batch],
        }

    prose, findings, has_block = parse_findings_ex(str(raw))
    if not has_block:
        # 缺结构化块：闭门，禁止「空 findings 当通过」
        return {
            **empty,
            "detail": "审码输出缺少结构化 findings，未放行",
            "reply": (prose or str(raw))[:2000],
            "reviewed_files": [p for p, _ in batch],
        }
    if not findings and prose_claims_issues(prose):
        # 摘要声称有问题但机器块为空：按不通过处理（非 unavailable，便于人审看到摘要）
        return {
            "ok": False,
            "unavailable": False,
            "ran": True,
            "passed": False,
            "high_count": 1,
            "medium_count": 0,
            "low_count": 0,
            "findings": [
                {
                    "file": batch[0][0],
                    "line": 1,
                    "severity": "high",
                    "title": "审码摘要声称有问题但缺少结构化条目",
                    "description": (prose or "")[:800] or "模型未给出 findings 条目",
                }
            ],
            "reply": prose or str(raw)[:2000],
            "summary": (prose or "").splitlines()[0][:200] if prose else "",
            "report_id": "",
            "detail": "审码摘要与结构化 findings 不一致，按高危未通过处理",
            "engine": "embedded",
            "config_path": str(cfg.get("_config_path") or ""),
            "llm_provider": llm.get("provider") or "",
            "llm_model": llm.get("model") or "",
            "reviewed_files": [p for p, _ in batch],
            "skipped_files": [],
        }

    n0, n1, n2 = count_findings_bands(findings)
    high = sum(1 for f in findings if f.severity in ("critical", "high"))
    high_count = n0
    medium_count = n1
    low_count = n2
    passed = high_count <= 0
    return {
        "ok": passed,
        "unavailable": False,
        "ran": True,
        "passed": passed,
        "high_count": high_count,
        "medium_count": medium_count,
        "low_count": low_count,
        "findings": [f.to_dict() for f in findings],
        "reply": prose or str(raw)[:2000],
        "summary": (prose or "").splitlines()[0][:200] if prose else "",
        "report_id": "",
        "detail": (
            f"本批审码通过（高危 0 · 中危 {medium_count} · 低危 {low_count}）"
            if passed
            else f"存在 {high_count} 处高危，审核不通过"
        ),
        "engine": "embedded",
        "config_path": str(cfg.get("_config_path") or ""),
        "llm_provider": llm.get("provider") or "",
        "llm_model": llm.get("model") or "",
        "reviewed_files": [p for p, _ in batch],
        "skipped_files": [],
        "_high_severity_rows": high,
    }
