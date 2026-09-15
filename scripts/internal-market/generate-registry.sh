#!/usr/bin/env bash
# 根据 config.env 生成：plugins.json（市场目录）+ 私有 npm packument（供「安装」按钮）
#
# dshmarket 安全策略：install 只认 GitHub URL + npm 包名 / GitHub Release tarball，
# 不接受任意 http://...tgz。因此公司内方案 = 私有 npm 作用域 + 占位 GitHub url。
#
# 扫描仓库根 dsh-*（package.json 含 dsh.bundle）。市场文案优先读各包 dshMarket。
# 只打其中一个插件时：其它已有 artifacts/*.tgz 仍会写入目录，避免把线上包冲掉。
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
import base64, hashlib, json, os, re, tarfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.environ["ROOT"])
REG_DIR = Path(os.environ["REG_DIR"])
BASE_URL = os.environ["BASE_URL"].rstrip("/")
OWNER = os.environ["OWNER"]
REGISTRY_NAME = os.environ["REGISTRY_NAME"]
TODAY = os.environ["TODAY"]
NPM_BASE = f"{BASE_URL}/npm"
ARTIFACTS = REG_DIR / "artifacts"

def tarball_name(name: str, version: str) -> str:
    return name.replace("@", "").replace("/", "-") + f"-{version}.tgz"

def semver_key(v: str):
    parts = []
    for p in str(v).split("."):
        try:
            parts.append(int(p))
        except ValueError:
            parts.append(0)
    return tuple(parts)

def is_artifact_version(ver: str) -> bool:
    s = str(ver or "")
    if ".." in s or "/" in s or "\\" in s:
        return False
    return bool(re.fullmatch(r"[0-9][0-9A-Za-z._+-]*", s))

def find_artifact(name, prefer_version):
    if prefer_version:
        exact = ARTIFACTS / tarball_name(name, prefer_version)
        if exact.is_file():
            return exact
    prefix = name.replace("@", "").replace("/", "-") + "-"
    candidates = []
    if ARTIFACTS.is_dir():
        for p in ARTIFACTS.glob("*.tgz"):
            if p.name.startswith(prefix) and p.name.endswith(".tgz"):
                ver = p.name[len(prefix) : -4]
                candidates.append((ver, p))
    if not candidates:
        return None
    if prefer_version:
        for ver, p in candidates:
            if ver == prefer_version:
                return p
    candidates.sort(key=lambda x: semver_key(x[0]))
    return candidates[-1][1]

def read_pkg_from_tgz(tgz: Path) -> dict:
    with tarfile.open(tgz) as tar:
        member = None
        for name in ("package/package.json", "./package/package.json"):
            try:
                member = tar.getmember(name)
                break
            except KeyError:
                continue
        if member is None or member.issym() or member.islnk() or not member.isfile():
            raise RuntimeError(f"{tgz.name} 缺少正规 package/package.json")
        if ".." in Path(member.name).parts:
            raise RuntimeError(f"{tgz.name} package.json 路径非法")
        f = tar.extractfile(member)
        if f is None:
            raise RuntimeError(f"{tgz} 无法读取 package/package.json")
        return json.loads(f.read().decode("utf-8"))

def discover_plugin_dirs():
    out = []
    for p in sorted(ROOT.glob("dsh-*")):
        pkg_path = p / "package.json"
        if not pkg_path.is_file():
            continue
        meta = json.loads(pkg_path.read_text(encoding="utf-8"))
        if (meta.get("dsh") or {}).get("bundle"):
            out.append((p, meta))
    return out

prev_doc = {}
prev_path = REG_DIR / "plugins.json"
if prev_path.is_file():
    try:
        prev_doc = json.loads(prev_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        prev_doc = {}
prev_by_name = {p["name"]: p for p in (prev_doc.get("plugins") or []) if p.get("name")}
prev_order = [p["name"] for p in (prev_doc.get("plugins") or []) if p.get("name")]

(REG_DIR / "artifacts").mkdir(parents=True, exist_ok=True)
(REG_DIR / "npm").mkdir(parents=True, exist_ok=True)

now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
built = {}

for plugin_dir, src_meta in discover_plugin_dirs():
    name = src_meta["name"]
    want_ver = str(src_meta.get("version") or "")
    artifact = find_artifact(name, want_ver) or find_artifact(
        name, str((prev_by_name.get(name) or {}).get("version") or "") or None
    )
    if artifact is None:
        print(f"跳过 {plugin_dir.name}: 缺少制品（先 pack.sh {plugin_dir.name}）", flush=True)
        continue

    meta = read_pkg_from_tgz(artifact)
    name = meta["name"]
    version = meta["version"]
    market = src_meta.get("dshMarket") if isinstance(src_meta.get("dshMarket"), dict) else {}
    zh = (market.get("zh") or "").strip() or str(src_meta.get("description") or meta.get("description") or name)
    en = (market.get("en") or "").strip() or zh

    if name.startswith("@"):
        scope, short = name[1:].split("/", 1)
    else:
        scope, short = "", name

    def publish_one(tgz_path, ver):
        npm_pkg_dir = REG_DIR / "npm" / f"@{scope}" / short / "-"
        npm_pkg_dir.mkdir(parents=True, exist_ok=True)
        tgz_name = f"{short}-{ver}.tgz"
        dest = (npm_pkg_dir / tgz_name).resolve()
        if dest.parent != npm_pkg_dir.resolve():
            raise RuntimeError(f"非法版本写入路径: {ver}")
        dest.write_bytes(tgz_path.read_bytes())
        blob = dest.read_bytes()
        pkg = read_pkg_from_tgz(dest)
        if str(pkg.get("name")) != name or str(pkg.get("version")) != ver:
            raise RuntimeError(f"{dest.name} 内包名/版本与文件名不一致")
        tarball_url = f"{NPM_BASE}/@{scope}/{short}/-/{tgz_name}"
        ver_meta = dict(pkg)
        ver_meta["dist"] = {
            "tarball": tarball_url,
            "shasum": hashlib.sha1(blob).hexdigest(),
            "integrity": "sha512-"
            + base64.b64encode(hashlib.sha512(blob).digest()).decode(),
        }
        ver_meta.pop("scripts", None)
        ver_meta.pop("devDependencies", None)
        return ver_meta, tarball_url

    # Profile 常钉死旧版；packument 只留 latest 会 ERR_PNPM_NO_MATCHING_VERSION
    by_ver = {version: artifact}
    art_prefix = name.replace("@", "").replace("/", "-") + "-"
    if ARTIFACTS.is_dir():
        for p in ARTIFACTS.glob("*.tgz"):
            if p.name.startswith(art_prefix) and p.name.endswith(".tgz"):
                ver = p.name[len(art_prefix) : -4]
                if is_artifact_version(ver):
                    by_ver.setdefault(ver, p)
    npm_hist = REG_DIR / "npm" / f"@{scope}" / short / "-"
    if npm_hist.is_dir():
        for p in npm_hist.glob(f"{short}-*.tgz"):
            hist_ver = p.name[len(short) + 1 : -4]
            if is_artifact_version(hist_ver):
                by_ver.setdefault(hist_ver, p)

    idx_path = REG_DIR / "npm" / f"@{scope}" / short / "index.json"
    prev_pack = {}
    if idx_path.is_file():
        try:
            prev_pack = json.loads(idx_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            prev_pack = {}
    prev_time = prev_pack.get("time") if isinstance(prev_pack.get("time"), dict) else {}

    versions = {}
    time_map = {
        "created": prev_time.get("created") or now_iso,
        "modified": now_iso,
    }
    tarball_url = ""
    for ver in sorted(by_ver, key=semver_key):
        try:
            meta_v, url_v = publish_one(by_ver[ver], ver)
        except Exception as e:
            if ver == version:
                raise
            print(f"  跳过损坏历史包 {short}@{ver}: {e}", flush=True)
            continue
        versions[ver] = meta_v
        time_map[ver] = prev_time.get(ver) or now_iso
        if ver == version:
            tarball_url = url_v

    packument = {
        "name": name,
        "dist-tags": {"latest": version},
        "versions": versions,
        "time": time_map,
    }
    idx_path.write_text(
        json.dumps(packument, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if len(versions) > 1:
        print(f"  保留历史版本: {', '.join(versions)}", flush=True)

    prev = prev_by_name.get(name) or {}
    entry = {
        "name": name,
        "owner": OWNER,
        "url": f"https://github.com/zhongruan/{plugin_dir.name}",
        "category": "tools",
        "description": {"zh": zh, "en": en},
        "npm": name,
        "version": version,
        "install": f"dsh plugin --profile web add {name}@{version}",
        "added": prev.get("added") or TODAY,
    }
    built[name] = entry
    if want_ver and version != want_ver:
        print(f"  注意: {plugin_dir.name} 源码 {want_ver}，市场仍用制品 {version}（未 pack 新版本）", flush=True)
    print(f"  npm: {name}@{version}")
    print(f"  tarball: {tarball_url}")

if not built:
    raise SystemExit("错误: 没有任何插件制品可写入市场目录")

ordered = []
seen = set()
for name in prev_order:
    if name in built:
        ordered.append(built[name])
        seen.add(name)
for name in sorted(built):
    if name not in seen:
        ordered.append(built[name])

doc = {
    "name": REGISTRY_NAME,
    "url": BASE_URL,
    "updated": TODAY,
    "count": len(ordered),
    "categories": {
        "tools": {"en": "Tools & Capabilities", "zh": "工具与能力"}
    },
    "plugins": ordered,
}
(REG_DIR / "plugins.json").write_text(
    json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print(f"已生成 plugins.json，共 {len(ordered)} 个插件")
PY
