#!/usr/bin/env bash
# 上传公司插件目录到服务器
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REG_DIR="$ROOT/company-registry"
KEY="${SSH_KEY:-$HOME/.ssh/tc_staging_deploy}"
HOST="${SSH_HOST:-root@175.178.238.31}"
REMOTE_ROOT="${REMOTE_ROOT:-/www/wwwroot/dsh-plugins}"

[[ -f "$REG_DIR/plugins.json" ]] || { echo "请先运行 pack.sh" >&2; exit 1; }
[[ -d "$REG_DIR/npm" ]] || { echo "请先运行 pack.sh（需生成 npm/）" >&2; exit 1; }

ssh -i "$KEY" "$HOST" "mkdir -p '$REMOTE_ROOT/artifacts' '$REMOTE_ROOT/npm'"
scp -i "$KEY" "$REG_DIR/plugins.json" "$HOST:$REMOTE_ROOT/plugins.json"
rsync -az -e "ssh -i $KEY" --delete "$REG_DIR/artifacts/" "$HOST:$REMOTE_ROOT/artifacts/"
rsync -az -e "ssh -i $KEY" --delete "$REG_DIR/npm/" "$HOST:$REMOTE_ROOT/npm/"

echo "上传完成。验证:"
echo "  curl -sS http://175.178.238.31/dsh-plugins/plugins.json | head"
echo "  curl -sS http://175.178.238.31/dsh-plugins/npm/@zhongruan/dsh-pcb-helper/ | head"
echo "  curl -sS http://175.178.238.31/dsh-plugins/npm/@zhongruan/dsh-weather/ | head"
echo "  curl -sS http://175.178.238.31/dsh-plugins/npm/@zhongruan/dsh-pcb-8d/ | head"
echo "  curl -sS http://175.178.238.31/dsh-plugins/npm/@zhongruan/dsh-remote-review/ | head"
echo "  # 若 npm 目录 URL 仍 500：检查服务器 extension 里 dsh-plugins.conf 是否用 rewrite→index.json"
echo ""
echo "本机要立刻用上新包（覆盖旧缓存）:"
echo "  ./scripts/internal-market/install-latest.sh"
