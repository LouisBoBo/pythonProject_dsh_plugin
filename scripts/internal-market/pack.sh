#!/usr/bin/env bash
# 构建插件并复制 tgz 到 company-registry/artifacts/
# 用法:
#   ./pack.sh              # 打包仓库内全部 DSH Bundle（dsh-* 且含 dsh.bundle）
#   ./pack.sh dsh-weather  # 只打包指定目录名
#
# 新插件要进「发现」：仓库根下 dsh-* / package.json 含 dsh.bundle + dshMarket，
# 然后 pack.sh → upload.sh。不要只靠 `dsh plugin add ./`。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REG_DIR="$ROOT/company-registry"
DIST="$ROOT/dist"

discover_plugin_dirs() {
  python3 - "$ROOT" <<'PY'
import json, sys
from pathlib import Path

root = Path(sys.argv[1])
for p in sorted(root.glob("dsh-*")):
    pkg = p / "package.json"
    if not pkg.is_file():
        continue
    meta = json.loads(pkg.read_text(encoding="utf-8"))
    if (meta.get("dsh") or {}).get("bundle"):
        print(p.name)
PY
}

pack_one() {
  local PLUGIN_DIR="$1"
  local name
  name="$(basename "$PLUGIN_DIR")"
  echo "==> 构建 $name"
  cd "$PLUGIN_DIR"
  pnpm install
  pnpm build

  local PKG_NAME TARBALL
  PKG_NAME="$(node -p "require('./package.json').name")"
  TARBALL="$(node -p "require('./package.json').name.replace('@','').replace('/','-') + '-' + require('./package.json').version + '.tgz'")"

  mkdir -p "$DIST" "$REG_DIR/artifacts"
  rm -f "$DIST/${TARBALL}"
  pnpm pack --pack-destination "$DIST"

  cp "$DIST/${TARBALL}" "$REG_DIR/artifacts/${TARBALL}"
  echo "==> 制品已就绪: $REG_DIR/artifacts/${TARBALL} (包名 $PKG_NAME)"
}

if [[ "${1:-}" != "" ]]; then
  case "$1" in
    *..*|*/*|*\\*)
      echo "错误: 插件目录名非法（只允许仓库根下短名，如 dsh-weather）" >&2
      exit 1
      ;;
  esac
  TARGET="$ROOT/$1"
  [[ -d "$TARGET" ]] || { echo "错误: 找不到插件目录 $TARGET" >&2; exit 1; }
  python3 - "$TARGET" <<'PY' || { echo "错误: $1 不是含 dsh.bundle 的 DSH 插件" >&2; exit 1; }
import json, sys
from pathlib import Path
p = Path(sys.argv[1]) / "package.json"
meta = json.loads(p.read_text(encoding="utf-8"))
raise SystemExit(0 if (meta.get("dsh") or {}).get("bundle") else 1)
PY
  pack_one "$TARGET"
else
  found=0
  while IFS= read -r name; do
    found=1
    pack_one "$ROOT/$name"
  done < <(discover_plugin_dirs)
  if [[ "$found" -eq 0 ]]; then
    echo "错误: 未发现任何含 dsh.bundle 的 dsh-* 插件" >&2
    exit 1
  fi
fi

"$ROOT/scripts/internal-market/generate-registry.sh"

echo ""
echo "下一步:"
echo "  1) 上传市场: ./scripts/internal-market/upload.sh"
echo "  2) 本机强制装最新（避免 Profile 锁旧版）:"
echo "       ./scripts/internal-market/install-latest.sh ${1:-}"
echo "  3) 完全退出并重启 WorkBuddy"
echo "  开发联调可用 dsh plugin add ./，上架必须走 pack + upload，否则「发现」没有。"
