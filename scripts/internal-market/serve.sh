#!/usr/bin/env bash
# 本地启动插件目录 HTTP 服务（供 DSHM_REGISTRY_URL 联调）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REG_DIR="$ROOT/company-registry"
CONFIG="${REGISTRY_CONFIG:-$REG_DIR/config.env}"

# shellcheck disable=SC1090
source "$CONFIG"
PORT="${REGISTRY_PORT:-8790}"

if [[ ! -f "$REG_DIR/plugins.json" ]]; then
  echo "错误: 缺少 $REG_DIR/plugins.json，请先运行 pack.sh" >&2
  exit 1
fi

if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  if curl -sf "${BASE_URL%/}/plugins.json" >/dev/null 2>&1; then
    echo "端口 ${PORT} 已有目录服务在运行，且 plugins.json 可访问。"
    echo "无需重复启动。直接使用:"
    echo "  export DSHM_REGISTRY_URL=${BASE_URL%/}/plugins.json"
    echo "  ./scripts/internal-market/start-dsh-web.sh"
    exit 0
  fi
  echo "错误: 端口 ${PORT} 被其它进程占用，请执行:" >&2
  echo "  kill \$(lsof -tiTCP:${PORT} -sTCP:LISTEN)" >&2
  exit 1
fi

echo "插件目录: $REG_DIR"
echo "plugins.json: ${BASE_URL%/}/plugins.json"
echo "监听: http://127.0.0.1:${PORT}/"
echo ""
echo "WorkBuddy / DSH 启动前设置:"
echo "  export DSHM_REGISTRY_URL=http://127.0.0.1:${PORT}/plugins.json"
echo ""
echo "按 Ctrl+C 停止"
exec python3 -m http.server "$PORT" --directory "$REG_DIR"
