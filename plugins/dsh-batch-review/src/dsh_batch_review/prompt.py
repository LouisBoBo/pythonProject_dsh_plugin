"""审码 system 提示：优先读 WorkBuddy Skill；缺失则用与 WB 同源的机器块约定。"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

# 与 WorkBuddy skill_prompt._MACHINE_BLOCK 对齐（解析契约）
# 硬要求：机器块必须最先输出——公司网关 standard 等模型爱写长文，后置机器块常被截断。
_MACHINE_BLOCK = """
## 本批机器输出约定（引擎解析用，必须遵守）

你正在审查**本批已提供的源码正文**（系统已分批读取，无需再调工具）。

1. **先输出机器块，再写中文摘要**（顺序不可颠倒；摘要可极短）。
2. 严格按正确性→安全→性能→可维护性/风格做审查。
3. 用户可见文字用中文；不要输出报告大标题（系统汇总时套壳）。
4. severity：critical/high→高危；medium→中危；low→低危。
5. **禁止把命名/注释/风格标成 critical 或 high**。
6. 每条 finding 尽量含：触发条件、问题代码片段、修复建议。
7. **必须**按下述格式输出机器块（不要用 markdown 代码围栏包住 JSON）；无问题则数组为 []：

:::code_review_findings
[{"file":"相对路径","line":12,"severity":"medium","title":"简短标题","description":"错在哪","code_snippet":"原文片段","fix_suggestion":"怎么改","fix_code":"可粘贴修复示例"}]
:::

8. 禁止只写分析不写机器块；禁止把机器块放在长文末尾。
""".strip()

_REPAIR_USER = """你上次的回复缺少可解析的机器块 :::code_review_findings（或 JSON 被截断）。

请【只】按下面格式重新输出。无问题则数组为 []。不要英文长文，不要 markdown 围栏包 JSON：

:::code_review_findings
[]
:::

若有问题，每项至少含 file、title（或 message）、severity、description。
""".strip()

# 公司网关 standard 等：短 system 命中率远高于长 Skill；机器块必须最先输出
_COMPACT_GATEWAY_SYSTEM = """你是代码审查员。必须严格按下列顺序回复，禁止在机器块之前写任何分析：

:::code_review_findings
[{"file":"相对路径","line":1,"severity":"medium","title":"短标题","description":"说明"}]
:::

然后最多两句中文摘要。
规则：无问题则 findings 为 []；critical/high 仅用于正确性/安全；不要用 markdown 代码围栏包住 JSON。
""".strip()


def _skill_candidates() -> list[Path]:
    """包内 skills/ 优先；再沿父目录找 WorkBuddy 仓库里的官方 Skill。"""
    here = Path(__file__).resolve()
    roots: list[Path] = [
        here.parents[2] / "skills" / "zr-workbuddy-code-review",
    ]
    for parent in here.parents:
        roots.append(parent / ".dsh" / "skills" / "zr-workbuddy-code-review")
    home = Path.home()
    roots.append(
        home / ".dsh" / "link" / "DSH-ZR-WorkBuddy" / ".dsh" / "skills" / "zr-workbuddy-code-review"
    )
    roots.append(Path(r"D:\AICodes\DSH_WorkBuddy") / ".dsh" / "skills" / "zr-workbuddy-code-review")
    # 去重且保序
    seen: set[str] = set()
    out: list[Path] = []
    for p in roots:
        key = str(p)
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def _load_skill_texts() -> tuple[str, str, str]:
    for root in _skill_candidates():
        vip = root / "references" / "viprasol-skill.md"
        if not vip.is_file():
            continue
        gate = root / "references" / "workbuddy-gate-90.md"
        skill = root / "SKILL.md"

        def _read(p: Path) -> str:
            try:
                return p.read_text(encoding="utf-8") if p.is_file() else ""
            except OSError:
                return ""

        return _read(skill), _read(vip), _read(gate)
    return "", "", ""


def _skill_methodology_block() -> str:
    skill_md, vip_md, gate_md = _load_skill_texts()
    if not vip_md.strip():
        return ""
    return "\n".join(
        [
            "=== SKILL.md ===",
            skill_md.strip(),
            "",
            "=== viprasol-skill.md ===",
            vip_md.strip(),
            "",
            "=== workbuddy-gate-90.md ===",
            gate_md.strip(),
        ]
    )


def build_compact_gateway_system_prompt() -> str:
    """机器块约定放最前（网关模型易截断）；其后附官方 Skill，禁止另造清单。"""
    method = _skill_methodology_block()
    if not method:
        return _COMPACT_GATEWAY_SYSTEM
    return (
        _COMPACT_GATEWAY_SYSTEM
        + "\n\n审查方法论来自官方 Skill（Viprasol + workbuddy-gate-90），必须执行。"
        + "机器块仍必须最先输出，禁止在机器块之前写分析。\n\n"
        + method
    )


@lru_cache(maxsize=1)
def build_review_system_prompt() -> str:
    method = _skill_methodology_block()
    if method:
        parts = [
            "你是 ZR-WorkBuddy 本机代码审查员。方法论来自官方 Skill，**不得自行发明另一套检查清单**。",
            "",
            method,
            "",
            "源码已在用户消息中提供；请审阅 FILE 正文。",
            "",
            _MACHINE_BLOCK,
        ]
        return "\n".join(parts)
    return (
        "你是专业代码审查员。优先正确性与安全，再性能与可维护性。"
        "必须先输出 :::code_review_findings 机器块，再写极短中文摘要。\n"
        + _MACHINE_BLOCK
    )


def build_user_payload(
    *,
    workspace: str,
    files: list[tuple[str, str]],
    focus: str = "",
) -> str:
    lines = [
        f"工作区：{workspace}",
        f"焦点：{focus or 'Git 交付本批审码闸'}",
        f"本批文件数：{len(files)}",
        "",
    ]
    for rel, body in files:
        lines.append(f"===== FILE: {rel} =====")
        lines.append(body)
        lines.append(f"===== END FILE: {rel} =====")
        lines.append("")
    # 文末再钉一次：大模型常把指令顶掉；后置提醒提高机器块命中率
    lines.append("——")
    lines.append("回复顺序强制：① :::code_review_findings JSON 数组 ::: ② 一两句中文摘要。")
    lines.append("无问题也要输出空数组机器块。不要把机器块放在长文后面。")
    return "\n".join(lines)


def build_repair_user_message(*, prior_reply: str = "") -> str:
    """缺机器块时的二次催收；附带上次回复摘要供模型填 findings，禁止再长篇发散。"""
    prior = str(prior_reply or "").strip().replace("\x00", "")
    if len(prior) > 2500:
        prior = prior[:1200].rstrip() + "\n…\n" + prior[-1200:].lstrip()
    if prior:
        return _REPAIR_USER + "\n\n【上次回复摘录，仅供提取 findings】\n" + prior
    return _REPAIR_USER
