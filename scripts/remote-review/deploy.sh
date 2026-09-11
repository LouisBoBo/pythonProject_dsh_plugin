#!/usr/bin/env bash
# 部署远端审码 Webhook 到 175.178.238.31
# - 目录独立: /www/wwwroot/dsh-remote-review （不影响 /www/wwwroot/dsh-plugins）
# - nginx 独立 extension: remote-review.conf （不改 dsh-plugins.conf）
# - 本机只监听 127.0.0.1:18787，公网入口: http://175.178.238.31/remote-review/webhook
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PLUGIN="$ROOT/dsh-remote-review"
KEY="${SSH_KEY:-$HOME/.ssh/tc_staging_deploy}"
HOST="${SSH_HOST:-root@175.178.238.31}"
REMOTE_APP="${REMOTE_APP:-/www/wwwroot/dsh-remote-review}"
NGINX_EXT="${NGINX_EXT:-/www/server/panel/vhost/nginx/extension/175.178.238.31}"
UNIT_SRC="$ROOT/scripts/remote-review/dsh-remote-review.service"
NGINX_SRC="$ROOT/company-registry/nginx-remote-review.conf"
ENV_EXAMPLE="$ROOT/scripts/remote-review/server.env.example"

[[ -d "$PLUGIN" ]] || { echo "找不到插件目录 $PLUGIN" >&2; exit 1; }
[[ -f "$KEY" ]] || { echo "找不到 SSH 密钥 $KEY" >&2; exit 1; }
[[ -f "$NGINX_SRC" ]] || { echo "找不到 $NGINX_SRC" >&2; exit 1; }

echo "==> 本地构建"
cd "$PLUGIN"
pnpm install
pnpm build

echo "==> 同步代码到 $HOST:$REMOTE_APP （排除 node_modules）"
ssh -i "$KEY" "$HOST" "mkdir -p '$REMOTE_APP'"
rsync -az -e "ssh -i $KEY" \
  --exclude node_modules \
  --exclude .git \
  --exclude '*.tsbuildinfo' \
  "$PLUGIN/" "$HOST:$REMOTE_APP/"

echo "==> 服务器安装生产依赖"
ssh -i "$KEY" "$HOST" "cd '$REMOTE_APP' && pnpm install --prod"

echo "==> 环境文件（已存在则不覆盖）"
scp -i "$KEY" "$ENV_EXAMPLE" "$HOST:$REMOTE_APP/server.env.example"
ssh -i "$KEY" "$HOST" "
  if [[ ! -f '$REMOTE_APP/server.env' ]]; then
    cp '$REMOTE_APP/server.env.example' '$REMOTE_APP/server.env'
    echo '已生成 server.env，请尽快修改 REMOTE_REVIEW_SECRET / 飞书变量'
  else
    echo '保留已有 server.env'
  fi
"

echo "==> 安装 systemd（不影响其它 unit）"
scp -i "$KEY" "$UNIT_SRC" "$HOST:/etc/systemd/system/dsh-remote-review.service"
ssh -i "$KEY" "$HOST" "systemctl daemon-reload && systemctl enable dsh-remote-review && systemctl restart dsh-remote-review && systemctl --no-pager --full status dsh-remote-review | head -20"

echo "==> 写入 nginx extension（仅 remote-review.conf，不改 dsh-plugins.conf）"
scp -i "$KEY" "$NGINX_SRC" "$HOST:$NGINX_EXT/remote-review.conf"
ssh -i "$KEY" "$HOST" "nginx -t && nginx -s reload"

echo "==> 健康检查"
sleep 1
ssh -i "$KEY" "$HOST" "curl -sS -m 5 http://127.0.0.1:18787/health | head -c 400; echo"
curl -sS -m 8 "http://175.178.238.31/remote-review/health" | head -c 400 || true
echo
echo
echo "部署完成。GitHub Payload URL 填:"
echo "  http://175.178.238.31/remote-review/webhook"
echo "Content type: application/json"
echo "Secret: 与服务器 $REMOTE_APP/server.env 里 REMOTE_REVIEW_SECRET 一致"
echo
echo "未改动: /www/wwwroot/dsh-plugins 、dsh-plugins.conf 、:8000 引擎"
