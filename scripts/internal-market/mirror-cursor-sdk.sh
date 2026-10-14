#!/usr/bin/env bash
# 把 @cursor/sdk（及平台包）镜像到公司私服，避免桌面「更新」卡在 npmjs 大包下载。
# 用法: ./scripts/internal-market/mirror-cursor-sdk.sh [version]
# 默认 1.0.31；完成后需 ./scripts/internal-market/upload.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REG="$ROOT/company-registry/npm"
NPM_BASE="${COMPANY_NPM_REGISTRY:-http://175.178.238.31/dsh-plugins/npm}"
NPM_BASE="${NPM_BASE%/}"
VER="${1:-1.0.31}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/mirror-cursor.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

mirror_one() {
  local name="$1"
  local ver="$2"
  local scope short
  scope="$(echo "$name" | cut -d/ -f1 | tr -d '@')"
  short="$(echo "$name" | cut -d/ -f2)"
  echo "==> mirror $name@$ver"
  curl -fsS -m 60 "https://registry.npmjs.org/$name/$ver" -o meta.json
  local tarball
  tarball="$(python3 -c "import json; print(json.load(open('meta.json'))['dist']['tarball'])")"
  local tgz="${short}-${ver}.tgz"
  curl -fsS -m 300 -o "$tgz" "$tarball"
  local dest_dir="$REG/@${scope}/${short}/-"
  mkdir -p "$dest_dir"
  cp -f "$tgz" "$dest_dir/$tgz"
  SCOPE="$scope" SHORT="$short" NAME="$name" VER="$ver" DEST="$dest_dir" REG="$REG" NPM_BASE="$NPM_BASE" python3 <<'PY'
import base64, hashlib, json, os, time
from pathlib import Path

name, ver = os.environ["NAME"], os.environ["VER"]
scope, short = os.environ["SCOPE"], os.environ["SHORT"]
reg, npm_base = Path(os.environ["REG"]), os.environ["NPM_BASE"]
tgz = Path(os.environ["DEST"]) / f"{short}-{ver}.tgz"
blob = tgz.read_bytes()
pkg = dict(json.loads(Path("meta.json").read_text(encoding="utf-8")))
pkg["dist"] = {
    "tarball": f"{npm_base}/@{scope}/{short}/-/{short}-{ver}.tgz",
    "shasum": hashlib.sha1(blob).hexdigest(),
    "integrity": "sha512-" + base64.b64encode(hashlib.sha512(blob).digest()).decode(),
}
pkg.pop("scripts", None)
pkg_dir = reg / f"@{scope}" / short
pkg_dir.mkdir(parents=True, exist_ok=True)
idx_path = pkg_dir / "index.json"
prev = {}
if idx_path.is_file():
    try:
        prev = json.loads(idx_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        prev = {}
def ver_key(value: str):
    parts = []
    for piece in str(value).split("."):
        try:
            parts.append(int(piece))
        except ValueError:
            parts.append(0)
    return tuple(parts)

versions = dict(prev.get("versions") or {})
versions[ver] = pkg
latest = max(versions, key=ver_key)
now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
time_map = dict(prev.get("time") or {})
time_map.setdefault("created", now)
time_map["modified"] = now
time_map[ver] = now
packument = {
    "name": name,
    "dist-tags": {"latest": latest},
    "versions": versions,
    "time": time_map,
}
idx_path.write_text(json.dumps(packument, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(pkg_dir / ver).write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(pkg_dir / "latest").write_text(json.dumps(versions[latest], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"  published {name}@{ver} ({len(blob)} bytes)")
PY
}

mirror_one "@cursor/sdk" "$VER"
for p in sdk-darwin-x64 sdk-darwin-arm64 sdk-linux-x64 sdk-linux-arm64 sdk-win32-x64; do
  mirror_one "@cursor/$p" "$VER"
done

echo "完成。请执行: ./scripts/internal-market/upload.sh"
echo "Profile .npmrc 需含: @cursor:registry=${NPM_BASE}/"
