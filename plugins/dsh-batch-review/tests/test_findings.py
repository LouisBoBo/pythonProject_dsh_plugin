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
