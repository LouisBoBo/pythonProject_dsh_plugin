#!/usr/bin/env bash
# 在当前 git 仓安装 post-commit → 后台触发审码
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
HOOK="$ROOT/.git/hooks/post-commit"
TRIGGER="${HOOK_REVIEW_TRIGGER:-$(cd "$(dirname "$0")" && pwd)/trigger-code-review.sh}"
chmod +x "$TRIGGER"

cat > "$HOOK" <<HOOK
#!/usr/bin/env bash
ROOT="\$(git rev-parse --show-toplevel)"
TRIGGER="$TRIGGER"
LOG_DIR="\${HOOK_REVIEW_LOG:-\$HOME/.zhongruan/hook-review-logs}"
mkdir -p "\$LOG_DIR"
nohup "\$TRIGGER" "\$ROOT" "commit \$(git rev-parse --short HEAD)" \\
  >>"\$LOG_DIR/hook.out" 2>&1 &
HOOK
chmod +x "$HOOK"
echo "已安装: $HOOK"
echo "触发器: $TRIGGER"
echo "试一次: git commit --allow-empty -m 'hook-review smoke' （需引擎审码就绪）"
