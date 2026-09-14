#!/usr/bin/env bash
# 上传公司插件目录到服务器
#
# 默认拒绝「本地目录比线上少插件」的上传，避免 rsync --delete 把已上架包删掉。
# 确认要收缩目录时：FORCE=1 ./scripts/internal-market/upload.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REG_DIR="$ROOT/company-registry"
KEY="${SSH_KEY:-$HOME/.ssh/tc_staging_deploy}"
HOST="${SSH_HOST:-root@175.178.238.31}"
REMOTE_ROOT="${REMOTE_ROOT:-/www/wwwroot/dsh-plugins}"
MARKET_URL="${DSHM_REGISTRY_URL:-http://175.178.238.31/dsh-plugins/plugins.json}"
FORCE="${FORCE:-0}"

[[ -f "$REG_DIR/plugins.json" ]] || { echo "请先运行 pack.sh" >&2; exit 1; }
[[ -d "$REG_DIR/npm" ]] || { echo "请先运行 pack.sh（需生成 npm/）" >&2; exit 1; }

export REG_DIR MARKET_URL FORCE
python3 <<'PY'
import json, os, sys, urllib.request
from pathlib import Path
from urllib.parse import urlparse

reg = Path(os.environ["REG_DIR"])
market_url = os.environ["MARKET_URL"]
force = os.environ.get("FORCE", "0") == "1"
u = urlparse(market_url)
if u.scheme not in ("http", "https") or not u.netloc:
    print("错误: MARKET_URL 只允许 http/https", file=sys.stderr)
    sys.exit(2)
local = json.loads((reg / "plugins.json").read_text(encoding="utf-8"))
local_names = {p.get("name") for p in (local.get("plugins") or []) if p.get("name")}
print(f"本地目录 {len(local_names)} 个: " + ", ".join(sorted(local_names)), flush=True)

try:
    with urllib.request.urlopen(market_url, timeout=15) as r:
        remote = json.loads(r.read().decode())
    remote_names = {p.get("name") for p in (remote.get("plugins") or []) if p.get("name")}
    print(f"线上目录 {len(remote_names)} 个: " + ", ".join(sorted(remote_names)), flush=True)
    dropped = sorted(remote_names - local_names)
    if dropped and not force:
        print("错误: 本地 plugins.json 缺少线上已有插件，上传会把它们从「发现」删掉:", file=sys.stderr)
        for n in dropped:
            print(f"  - {n}", file=sys.stderr)
        print("先 pack 齐，或确认要下架时 FORCE=1 再上传。", file=sys.stderr)
        sys.exit(2)
    if dropped and force:
        print("FORCE=1：将从线上移除: " + ", ".join(dropped), flush=True)
except Exception as e:
    if not force:
        print(f"错误: 无法读取线上目录以做安全核对: {e}", file=sys.stderr)
        print("网络可用后再传，或 FORCE=1 跳过核对。", file=sys.stderr)
        sys.exit(2)
    print(f"FORCE=1：跳过线上核对（{e}）", flush=True)
PY

ssh -i "$KEY" "$HOST" "mkdir -p '$REMOTE_ROOT/artifacts' '$REMOTE_ROOT/npm'"
scp -i "$KEY" "$REG_DIR/plugins.json" "$HOST:$REMOTE_ROOT/plugins.json"
rsync -az -e "ssh -i $KEY" --delete "$REG_DIR/artifacts/" "$HOST:$REMOTE_ROOT/artifacts/"
rsync -az -e "ssh -i $KEY" --delete "$REG_DIR/npm/" "$HOST:$REMOTE_ROOT/npm/"

echo "上传完成。验证:"
echo "  curl -sS http://175.178.238.31/dsh-plugins/plugins.json"
echo "  # 若 npm 目录 URL 仍 500：检查服务器 extension 里 dsh-plugins.conf 是否用 rewrite→index.json"
echo ""
echo "本机要立刻用上新包（覆盖旧缓存 / 本地 link）:"
echo "  ./scripts/internal-market/install-latest.sh"
