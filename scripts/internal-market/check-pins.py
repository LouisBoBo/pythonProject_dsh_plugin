#!/usr/bin/env python3
"""Refuse a market upload when a local profile pins a missing company tarball.

WorkBuddy pins each company plugin to an exact version in the profile
package.json. Update and uninstall reinstall that whole list. One missing
tarball becomes ERR_PNPM_NO_MATCHING_VERSION for the entire profile.

A source package.json that is ahead of its tarball is only a warning.
The market keeps the last packed artifact and does not publish that drift.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

EXACT_VERSION = re.compile(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?")


def tarball_name(package_name: str, version: str) -> str:
    return package_name.replace("@", "").replace("/", "-") + f"-{version}.tgz"


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def source_versions(plugins_dir: Path) -> list[tuple[str, str, Path]]:
    found = []
    if not plugins_dir.is_dir():
        return found
    for plugin_dir in sorted(plugins_dir.glob("dsh-*")):
        pkg_path = plugin_dir / "package.json"
        meta = read_json(pkg_path)
        if not (meta.get("dsh") or {}).get("bundle"):
            continue
        name = str(meta.get("name") or "")
        version = str(meta.get("version") or "")
        if name.startswith("@zhongruan/") and EXACT_VERSION.fullmatch(version):
            found.append((name, version, pkg_path))
    return found


def profile_roots(home: Path) -> list[Path]:
    return [
        home / "AppData/Local/ZR_DSH/dsh-home/profiles",
        home / "Library/Application Support/ZR_DSH/dsh-home/profiles",
        home / "Library/Application Support/zr-workbuddy-desktop/dsh-home/profiles",
        home / ".dsh/profiles",
    ]


def profile_pins(home: Path, company_names: set[str]) -> list[tuple[str, str, Path]]:
    pins = []
    seen: set[tuple[str, str, str]] = set()
    for root in profile_roots(home):
        if not root.is_dir():
            continue
        for pkg_path in sorted(root.glob("*/package.json")):
            deps = read_json(pkg_path).get("dependencies") or {}
            if not isinstance(deps, dict):
                continue
            for name, spec in deps.items():
                version = str(spec or "")
                if name not in company_names or not EXACT_VERSION.fullmatch(version):
                    continue
                key = (name, version, str(pkg_path))
                if key in seen:
                    continue
                seen.add(key)
                pins.append((name, version, pkg_path))
    return pins


def missing(pins: list[tuple[str, str, Path]], artifacts: Path) -> list[tuple[str, str, Path]]:
    return [
        item
        for item in pins
        if not (artifacts / tarball_name(item[0], item[1])).is_file()
    ]


def main() -> int:
    root = Path(os.environ.get("ROOT") or Path(__file__).resolve().parents[2])
    plugins_dir = Path(os.environ.get("PLUGINS_DIR") or (root / "plugins"))
    artifacts = Path(os.environ.get("REG_DIR") or (root / "company-registry")) / "artifacts"
    home = Path(os.environ.get("PIN_HOME") or Path.home())

    sources = source_versions(plugins_dir)
    company_names = {name for name, _version, _path in sources}
    unpublished = missing(sources, artifacts)
    pinned = missing(profile_pins(home, company_names), artifacts)

    if unpublished:
        print("注意: 下列源码版本还没有 tgz，市场继续用已有制品，不会带上这些未打包改动。", flush=True)
        for name, version, path in unpublished:
            short = name.split("/", 1)[1]
            print(f"  - {name}@{version}  ← {path}", flush=True)
            print(f"    要上架这个版本再执行 ./scripts/internal-market/pack.sh {short}", flush=True)
    if pinned:
        print("错误: 本机 Profile 钉了私服上没有的版本。市场里点「更新」或「卸载」会整份重装，缺一个就全部失败。", file=sys.stderr)
        for name, version, path in pinned:
            short = name.split("/", 1)[1]
            print(f"  - {name}@{version}  ← {path}", file=sys.stderr)
            print(f"    ./scripts/internal-market/pack.sh {short}", file=sys.stderr)
        print("pack 出缺失版本后再 upload。不要把未上架版本写进 Profile。", file=sys.stderr)
        return 2
    if not unpublished:
        print("版本钉死核对通过：本机 Profile 依赖都有对应制品。", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
