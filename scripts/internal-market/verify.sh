#!/usr/bin/env bash
# 校验 plugins.json 与 tgz 是否可访问（需 serve.sh 已在运行，或传入 BASE_URL）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REG_DIR="$ROOT/company-registry"
CONFIG="${REGISTRY_CONFIG:-$REG_DIR/config.env}"

# shellcheck disable=SC1090
source "$CONFIG"
PORT="${REGISTRY_PORT:-8790}"
BASE="${VERIFY_BASE_URL:-http://127.0.0.1:${PORT}}"

echo "==> 检查本地文件"
test -f "$REG_DIR/plugins.json" || { echo "缺少 plugins.json"; exit 1; }
python3 -m json.tool "$REG_DIR/plugins.json" >/dev/null
echo "  plugins.json 格式 OK"

TARBALL="$(python3 -c "import json; p=json.load(open('$REG_DIR/plugins.json')); print(p['plugins'][0]['tarball'].split('/')[-1])")"
test -f "$REG_DIR/artifacts/$TARBALL" || { echo "缺少 artifacts/$TARBALL"; exit 1; }
echo "  artifacts/$TARBALL 存在"

echo "==> 检查 HTTP 可访问性 ($BASE)"
CODE="$(curl -sS -o /tmp/plugins-json-verify.json -w '%{http_code}' "${BASE}/plugins.json" || echo 000)"
if [[ "$CODE" != "200" ]]; then
  echo "  plugins.json HTTP $CODE — 请先运行: scripts/internal-market/serve.sh" >&2
  exit 1
fi
echo "  GET /plugins.json → 200"

TURL="$(python3 -c "import json; print(json.load(open('/tmp/plugins-json-verify.json'))['plugins'][0]['tarball'])")"
TCODE="$(curl -sS -o /dev/null -w '%{http_code}' "$TURL" || echo 000)"
if [[ "$TCODE" != "200" ]]; then
  echo "  tarball HTTP $TCODE — $TURL" >&2
  exit 1
fi
echo "  GET tarball → 200"

echo ""
echo "==> verify OK"
echo "下一步（手动，不修改 WorkBuddy 仓库）："
echo "  1. 保持 serve.sh 运行"
echo "  2. export DSHM_REGISTRY_URL=${BASE}/plugins.json"
echo "  3. 启动 dsh web，打开 设置 → 插件市场，搜索 pcb 并安装"
