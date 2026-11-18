"""阶段 1：findings 解析自测（无 LLM、无网络）。"""
from __future__ import annotations

from pathlib import Path

from dsh_batch_review.findings import count_findings_bands, parse_findings

FIX = Path(__file__).parent / "fixtures" / "sample_findings.txt"


def test_parse_sample_findings_high_and_low():
    text = FIX.read_text(encoding="utf-8")
    prose, findings = parse_findings(text)
    assert "高危" in prose or "摘要" in prose
    assert len(findings) == 2
    high = [f for f in findings if f.severity in ("critical", "high")]
    assert len(high) == 1
    assert high[0].file.endswith("demo.js")
    n0, n1, n2 = count_findings_bands(findings)
    assert n0 == 1
    assert n2 == 1


def test_empty_has_no_high():
    prose, findings = parse_findings("无机器块")
    assert findings == []
    assert count_findings_bands(findings) == (0, 0, 0)


def test_parse_findings_ex_reports_missing_block():
    from dsh_batch_review.findings import parse_findings_ex

    prose, findings, has_block = parse_findings_ex("看起来有风险")
    assert has_block is False
    assert findings == []
    assert "风险" in prose

    _, rows, has2 = parse_findings_ex(
        ":::code_review_findings\n[]\n:::\n",
    )
    assert has2 is True
    assert rows == []


def test_parse_message_alias_and_truncated_array():
    from dsh_batch_review.findings import parse_findings_ex

    # 网关常用 message；line 为区间字符串
    text = """:::code_review_findings
[
  {"file":"a.py","line":"1-10","severity":"medium","message":"噪音注释"}
,
  {"file":"b.py","line":2,"severity":"low","title":"半截"
"""
    prose, findings, has_block = parse_findings_ex(text)
    assert has_block is True
    assert len(findings) >= 1
    assert findings[0].title == "噪音注释"
    assert findings[0].line == 1


def test_report_layout_is_paragraphs_not_one_line():
    from dsh_batch_review.findings import ReviewFinding, format_findings_report

    finding = ReviewFinding(
        file="frontend/src/views/warehouse/MaterialOutboundView.vue",
        line=92,
        severity="medium",
        title="数量单元格未做空值保护",
        description="表格列直接调用 row.quantity.toLocaleString()。",
        code_snippet="row.quantity.toLocaleString()",
        fix_suggestion="改为 Number(row.quantity ?? 0).toLocaleString()。",
        fix_code="Number(row.quantity ?? 0).toLocaleString()",
    )
    report = format_findings_report(
        [finding],
        files_reviewed=[finding.file, "backend/app/routers/work_orders.py"],
        local_path="/tmp/proj",
        summary="已按清单重审。",
    )
    assert report.startswith("#### 代码审核汇总报告\n")
    assert "\n# " not in report
    assert "\n## " not in report
    assert "\n### " not in report
    assert "\n\n**审核文件**\n" in report
    assert "- `frontend/src/views/warehouse/MaterialOutboundView.vue`" in report
    assert "- `backend/app/routers/work_orders.py`" in report
    assert "审核文件：" + finding.file not in report
    assert "#### 🟡 中危 P1 — 问题 1 — 数量单元格未做空值保护" in report
    assert "**位置：** `frontend/src/views/warehouse/MaterialOutboundView.vue` 文件，约第 92 行" in report
    assert "**问题描述：**" in report
    assert "**当前代码**" in report
    assert "// ❌ 当前代码" in report
    assert "**修改建议：**" in report
    assert "**正确做法**" in report
    assert "// ✅ 正确做法" in report
    # 标题和文件清单不能粘在同一行，否则预览会挤成一段
    assert "代码审核汇总报告 审核文件" not in report.replace("\n", " ")
    head, _, _rest = report.partition("#### 一、总体评价")
    assert "\n\n" in head
