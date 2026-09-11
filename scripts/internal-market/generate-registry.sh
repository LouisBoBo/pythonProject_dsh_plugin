#!/usr/bin/env bash
# 根据 config.env 生成：plugins.json（市场目录）+ 私有 npm packument（供「安装」按钮）
#
# dshmarket 安全策略：install 只认 GitHub URL + npm 包名 / GitHub Release tarball，
# 不接受任意 http://...tgz。因此公司内方案 = 私有 npm 作用域 + 占位 GitHub url。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REG_DIR="$ROOT/company-registry"
CONFIG="${REGISTRY_CONFIG:-$REG_DIR/config.env}"

if [[ ! -f "$CONFIG" ]]; then
  echo "错误: 找不到配置 $CONFIG" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$CONFIG"

: "${BASE_URL:?config.env 缺少 BASE_URL}"
: "${OWNER:?config.env 缺少 OWNER}"
: "${REGISTRY_NAME:?config.env 缺少 REGISTRY_NAME}"

export ROOT REG_DIR BASE_URL OWNER REGISTRY_NAME
export TODAY
TODAY="$(date +%Y-%m-%d)"

python3 <<'PY'
import base64, hashlib, json, os
from pathlib import Path

ROOT = Path(os.environ["ROOT"])
REG_DIR = Path(os.environ["REG_DIR"])
BASE_URL = os.environ["BASE_URL"].rstrip("/")
OWNER = os.environ["OWNER"]
REGISTRY_NAME = os.environ["REGISTRY_NAME"]
TODAY = os.environ["TODAY"]
NPM_BASE = f"{BASE_URL}/npm"

# 目录名 → 市场文案（与 pack.sh ALL_PLUGINS 对齐）
CATALOG = [
    {
        "dir": "dsh-pcb-helper",
        "zh": "PCB 尺寸解析、BOM 清单统计",
        "en": "PCB dimension parsing and BOM counting",
    },
    {
        "dir": "dsh-weather",
        "zh": "城市天气实况与未来几天预报",
        "en": "City weather nowcast and short-term forecast",
    },
    {
        "dir": "dsh-pcb-8d",
        "zh": "PCB 8D 报告：对话建稿、按步补全、导出 Markdown",
        "en": "PCB 8D report: draft, fill steps, export Markdown",
    },
    {
        "dir": "dsh-remote-review",
        "zh": "远端/本地 Webhook 审码：提交触发、共用现有审码 API、报告写入飞书文档",
        "en": "Webhook code review: commit trigger, existing review API, Feishu Docs",
    },
]

(REG_DIR / "artifacts").mkdir(parents=True, exist_ok=True)
(REG_DIR / "npm").mkdir(parents=True, exist_ok=True)

plugins = []
for item in CATALOG:
    plugin_dir = ROOT / item["dir"]
    pkg_path = plugin_dir / "package.json"
    if not pkg_path.is_file():
        continue
    meta = json.loads(pkg_path.read_text(encoding="utf-8"))
    name = meta["name"]
    version = meta["version"]
    pack_file = name.replace("@", "").replace("/", "-") + f"-{version}.tgz"
    artifact = REG_DIR / "artifacts" / pack_file
    if not artifact.is_file():
        print(f"跳过 {item['dir']}: 缺少制品 {artifact}", flush=True)
        continue

    if name.startswith("@"):
        scope, short = name[1:].split("/", 1)
    else:
        scope, short = "", name

    npm_pkg_dir = REG_DIR / "npm" / f"@{scope}" / short / "-"
    npm_pkg_dir.mkdir(parents=True, exist_ok=True)
    tgz_name = f"{short}-{version}.tgz"
    dest = npm_pkg_dir / tgz_name
    dest.write_bytes(artifact.read_bytes())

    tgz = dest.read_bytes()
    sha1 = hashlib.sha1(tgz).hexdigest()
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(tgz).digest()).decode()
    tarball_url = f"{NPM_BASE}/@{scope}/{short}/-/{tgz_name}"

    ver_meta = dict(meta)
    ver_meta["dist"] = {
        "tarball": tarball_url,
        "shasum": sha1,
        "integrity": integrity,
    }
    ver_meta.pop("scripts", None)
    ver_meta.pop("devDependencies", None)

    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    packument = {
        "name": name,
        "dist-tags": {"latest": version},
        "versions": {version: ver_meta},
        # pnpm minimumReleaseAge 需要 time；缺失会警告，极端策略下可能拒装
        "time": {"created": now_iso, "modified": now_iso, version: now_iso},
    }
    (REG_DIR / "npm" / f"@{scope}" / short / "index.json").write_text(
        json.dumps(packument, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    entry = {
        "name": name,
        "owner": OWNER,
        "url": f"https://github.com/zhongruan/{item['dir']}",
        "category": "tools",
        "description": {"zh": item["zh"], "en": item["en"]},
        "npm": name,
        "version": version,
        "install": f"dsh plugin --profile web add {name}",
        "added": TODAY,
    }
    plugins.append(entry)
    print(f"  npm: {name}")
    print(f"  tarball: {tarball_url}")

if not plugins:
    raise SystemExit("错误: 没有任何插件制品可写入市场目录")

doc = {
    "name": REGISTRY_NAME,
    "url": BASE_URL,
    "updated": TODAY,
    "count": len(plugins),
    "categories": {
        "tools": {"en": "Tools & Capabilities", "zh": "工具与能力"}
    },
    "plugins": plugins,
}
(REG_DIR / "plugins.json").write_text(
    json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print(f"已生成 plugins.json，共 {len(plugins)} 个插件")
PY
