#!/usr/bin/env bash
# 使用公司本地插件目录启动 DSH Web（需另开终端先运行 serve.sh）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$ROOT/company-registry/config.env"
# shellcheck disable=SC1090
source "$CONFIG"
PORT="${REGISTRY_PORT:-8790}"
REGISTRY_URL="${BASE_URL%/}/plugins.json"

if ! curl -sf "$REGISTRY_URL" >/dev/null 2>&1; then
  echo "错误: 无法访问 $REGISTRY_URL" >&2
  echo "请先在另一个终端运行: $ROOT/scripts/internal-market/serve.sh" >&2
  exit 1
fi

echo "DSHM_REGISTRY_URL=$REGISTRY_URL"
echo "启动 dsh web …（插件市场应显示 count=1，而不是 3.4k）"
echo ""

export DSHM_REGISTRY_URL="$REGISTRY_URL"
exec dsh web "$@"
