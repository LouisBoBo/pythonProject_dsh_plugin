#!/usr/bin/env bash
# 构建插件并复制 tgz 到 company-registry/artifacts/
# 用法:
#   ./pack.sh              # 打包全部公司插件
#   ./pack.sh dsh-weather  # 只打包指定目录名
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REG_DIR="$ROOT/company-registry"
DIST="$ROOT/dist"

# 公司市场插件目录列表（与仓库根下文件夹名一致）
ALL_PLUGINS=(dsh-pcb-helper dsh-weather dsh-pcb-8d dsh-remote-review)

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
  TARGET="$ROOT/$1"
  [[ -d "$TARGET" ]] || { echo "错误: 找不到插件目录 $TARGET" >&2; exit 1; }
  pack_one "$TARGET"
else
  for name in "${ALL_PLUGINS[@]}"; do
    pack_one "$ROOT/$name"
  done
fi

"$ROOT/scripts/internal-market/generate-registry.sh"

echo ""
echo "下一步:"
echo "  1) 上传市场: ./scripts/internal-market/upload.sh"
echo "  2) 本机强制装最新（避免 Profile 锁旧版）:"
echo "       ./scripts/internal-market/install-latest.sh ${1:-}"
echo "  3) 完全退出并重启 WorkBuddy"
