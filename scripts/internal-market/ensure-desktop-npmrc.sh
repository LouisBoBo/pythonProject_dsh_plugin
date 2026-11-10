#!/usr/bin/env bash
# 补齐桌面 Profile 的 .npmrc，避免市场里点安装 / 更新 / 卸载失败：
#   ERR_PNPM_FETCH_404 … registry.npmjs.org/@zhongruan%2F…
#   当天刚上架的公司包被 pnpm 默认 minimumReleaseAge=24h 拦住
#
# 已有的源地址、token、其它 scope 一律保留。不要整文件覆盖，
# 否则会把正在用的 https://…:8443 私服改成另一套地址。
#
# 用法:
#   ./scripts/internal-market/ensure-desktop-npmrc.sh
#   DSH_PROFILE_DIR=/path/to/profiles/desktop ./scripts/internal-market/ensure-desktop-npmrc.sh
set -euo pipefail

NPM_REG="${COMPANY_NPM_REGISTRY:-http://175.178.238.31/dsh-plugins/npm/}"
NPM_REG="${NPM_REG%/}/"

pick_profile_dir() {
  if [[ -n "${DSH_PROFILE_DIR:-}" ]]; then
    printf '%s\n' "$DSH_PROFILE_DIR"
    return
  fi
  local c
  for c in \
    "$HOME/AppData/Local/ZR_DSH/dsh-home/profiles/desktop" \
    "$HOME/Library/Application Support/ZR_DSH/dsh-home/profiles/desktop" \
    "$HOME/Library/Application Support/zr-workbuddy-desktop/dsh-home/profiles/desktop" \
    "$HOME/.dsh/profiles/desktop"
  do
    if [[ -d "$c" ]]; then
      printf '%s\n' "$c"
      return
    fi
  done
  return 1
}

PROFILE_DIR="$(pick_profile_dir)" || {
  echo "错误: 找不到桌面 Profile（可设 DSH_PROFILE_DIR）" >&2
  exit 1
}

NPMRC="$PROFILE_DIR/.npmrc"
# 只补缺的键。已写上的 registry / token 保持原样。
append_npmrc_line() {
  local key="$1" line="$2"
  if [[ -f "$NPMRC" ]] && grep -qE "^${key}=" "$NPMRC" 2>/dev/null; then
    echo "==> 已有 ${key}，保持不动"
    return 0
  fi
  if [[ -s "$NPMRC" ]] && [[ -n "$(tail -c 1 "$NPMRC" || true)" ]]; then
    printf '\n' >>"$NPMRC"
  fi
  printf '%s\n' "$line" >>"$NPMRC"
  echo "==> 已补 ${key}"
}
append_npmrc_line "registry" "registry=https://registry.npmmirror.com/"
append_npmrc_line "@zhongruan:registry" "@zhongruan:registry=${NPM_REG}"
append_npmrc_line "@cursor:registry" "@cursor:registry=${NPM_REG}"
append_npmrc_line "strict-ssl" "strict-ssl=false"
# 桌面自带 pnpm 默认拒绝 24 小时内发布的包。公司插件经常当天上架，
# 不写 0 的话，安装、更新、卸载都会卡在供应链校验。
append_npmrc_line "minimum-release-age" "minimum-release-age=0"

echo "==> 核对完成 $NPMRC"
cat "$NPMRC"
echo ""
echo "若仍报 TARBALL_URL_MISMATCH（lock 钉着私服已下架的旧版），可："
echo "  rm -rf \"$PROFILE_DIR/node_modules\" \"$PROFILE_DIR/pnpm-lock.yaml\""
echo "  然后 PREFER_LOCAL=1 DSH_PROFILE_DIR=\"$PROFILE_DIR\" ./scripts/internal-market/install-latest.sh"
echo "或在本机用 DSH 自带 pnpm 于该目录重新 pnpm install。"
