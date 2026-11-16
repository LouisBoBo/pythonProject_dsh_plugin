"""审码 system 提示：优先读 WorkBuddy Skill；缺失则用与 WB 同源的机器块约定。"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

# 与 WorkBuddy skill_prompt._MACHINE_BLOCK 对齐（解析契约）
_MACHINE_BLOCK = """
## 本批机器输出约定（引擎解析用，必须遵守）

你正在审查**本批已提供的源码正文**（系统已分批读取，无需再调工具）。

1. 严格按正确性→安全→性能→可维护性/风格做审查。
2. 用户可见文字用中文；不要输出报告大标题（系统汇总时套壳）。
3. severity：critical/high→高危；medium→中危；low→低危。
4. **禁止把命名/注释/风格标成 critical 或 high**。
5. 每条 finding 尽量含：触发条件、问题代码片段、修复建议。
6. **必须**在摘要后输出机器块（不要用 markdown 代码围栏包住 JSON）：

:::code_review_findings
[{"file":"相对路径","line":12,"severity":"medium","title":"简短标题","description":"错在哪","code_snippet":"原文片段","fix_suggestion":"怎么改","fix_code":"可粘贴修复示例"}]
:::

7. 本批无问题则 findings 为 []，仍必须输出该机器块。
""".strip()


def _skill_candidates() -> list[Path]:
    here = Path(__file__).resolve()
    # .../plugins/dsh-batch-review/src/dsh_batch_review/prompt.py → AICodes
    aicodes = here.parents[6] if len(here.parents) > 6 else here.parents[-1]
    roots = [
        aicodes / "DSH_WorkBuddy" / ".dsh" / "skills" / "zr-workbuddy-code-review",
        Path(r"D:\AICodes\DSH_WorkBuddy") / ".dsh" / "skills" / "zr-workbuddy-code-review",
    ]
    return roots


@lru_cache(maxsize=1)
def build_review_system_prompt() -> str:
    for root in _skill_candidates():
        vip = root / "references" / "viprasol-skill.md"
        gate = root / "references" / "workbuddy-gate-90.md"
        skill = root / "SKILL.md"
        if not vip.is_file():
            continue
        parts = [
            "你是 ZR-WorkBuddy 本机代码审查员。方法论来自官方 Skill，**不得自行发明另一套检查清单**。",
            "",
            "=== SKILL.md ===",
            skill.read_text(encoding="utf-8") if skill.is_file() else "",
            "",
            "=== viprasol-skill.md ===",
            vip.read_text(encoding="utf-8"),
            "",
            "=== workbuddy-gate-90.md ===",
            gate.read_text(encoding="utf-8") if gate.is_file() else "",
            "",
            "源码已在用户消息中提供；请审阅 FILE 正文。",
            "",
            _MACHINE_BLOCK,
        ]
        return "\n".join(parts)
    return (
        "你是专业代码审查员。优先正确性与安全，再性能与可维护性。"
        "输出中文摘要，并附 :::code_review_findings JSON 数组。\n"
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
    return "\n".join(lines)
