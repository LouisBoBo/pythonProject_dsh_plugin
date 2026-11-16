"""
Git 交付本批审码旁路核（方案 B）。

从 WorkBuddy code_review 裁剪；LLM 经公司网关或 WorkBuddy 非官网 base_url。
**不**接 Cursor；**不**改写码 begin/continue。写码插件默认 `gitDeliverReviewBackend=embedded`。
"""

from .findings import ReviewFinding, count_findings_bands, parse_findings
from .review_run import run_batch_review

__all__ = [
    "ReviewFinding",
    "count_findings_bands",
    "parse_findings",
    "run_batch_review",
]

__version__ = "0.1.3"
