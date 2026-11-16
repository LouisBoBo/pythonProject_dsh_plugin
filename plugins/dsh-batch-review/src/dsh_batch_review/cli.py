"""CLI：findings 解析 + 本批审码（经 WorkBuddy config 网关）。"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .findings import count_findings_bands, parse_findings
from .review_run import run_batch_review
from .wb_config import llm_ready_detail, load_workbuddy_config


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="dsh-batch-review",
        description="Git 交付本批审码旁路（LLM：公司网关 ZR_GATEWAY_TOKEN，或 WorkBuddy 非官网 base_url）",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    parse_p = sub.add_parser("parse-findings", help="从文件或 stdin 解析 :::code_review_findings")
    parse_p.add_argument("path", nargs="?", help="文本文件；省略则读 stdin")

    rev = sub.add_parser("review", help="对本批文件跑审码（读系统配置网关）")
    rev.add_argument("--workspace", required=True, help="工作区绝对路径")
    rev.add_argument(
        "--files",
        required=True,
        help="逗号分隔相对路径，或 @list.txt（每行一个）",
    )
    rev.add_argument("--focus", default="", help="审码焦点说明")

    sub.add_parser("llm-status", help="检查公司网关 / WorkBuddy LLM 是否就绪")
    sub.add_parser("version", help="打印版本")

    args = p.parse_args(argv)
    if args.cmd == "version":
        from . import __version__

        print(__version__)
        return 0

    if args.cmd == "llm-status":
        from .dsh_gateway import as_public_status
        from .wb_config import resolve_review_llm

        cfg = load_workbuddy_config()
        llm = resolve_review_llm(cfg)
        out = as_public_status(llm, config_path=str(cfg.get("_config_path") or ""))
        # 兼容旧字段
        out["ok"] = bool(llm)
        _ok, detail = llm_ready_detail(cfg)
        out["detail"] = detail
        json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 0 if llm else 1

    if args.cmd == "parse-findings":
        text = Path(args.path).read_text(encoding="utf-8") if args.path else sys.stdin.read()
        prose, findings = parse_findings(text)
        n0, n1, n2 = count_findings_bands(findings)
        high = sum(1 for f in findings if f.severity in ("critical", "high"))
        out = {
            "ok": True,
            "high_count": high,
            "medium_count": n1,
            "low_count": n2,
            "p0": n0,
            "findings": [f.to_dict() for f in findings],
            "prose_len": len(prose or ""),
        }
        json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 0

    if args.cmd == "review":
        files_arg = str(args.files or "").strip()
        if files_arg.startswith("@"):
            list_path = Path(files_arg[1:])
            files = [
                ln.strip()
                for ln in list_path.read_text(encoding="utf-8").splitlines()
                if ln.strip() and not ln.strip().startswith("#")
            ]
        else:
            files = [x.strip() for x in files_arg.split(",") if x.strip()]
        result = run_batch_review(
            workspace=str(args.workspace),
            files=files,
            focus=str(args.focus or ""),
        )
        # 对外去掉内部调试字段
        result.pop("_high_severity_rows", None)
        json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        if result.get("unavailable"):
            return 2
        return 0 if result.get("passed") else 1

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
