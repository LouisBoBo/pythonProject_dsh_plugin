#!/usr/bin/env bash
# 修复桌面 Profile 缺 .npmrc 导致的装/卸失败：
#   ERR_PNPM_FETCH_404 … registry.npmjs.org/@zhongruan%2F…
#   ERR_PNPM_LOCKFILE_RESOLUTION_VERIFICATION（mom 旧版已下架 / minimumReleaseAge）
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
# 只改这几项。已有的 token、其它 scope 保留，避免整文件覆盖把凭据冲掉。
upsert_npmrc() {
  local key="$1" line="$2" tmp
  tmp="$(mktemp)"
  if [[ -f "$NPMRC" ]]; then
    grep -vE "^${key}=" "$NPMRC" >"$tmp" || true
  else
    : >"$tmp"
  fi
  if [[ -s "$tmp" ]] && [[ -n "$(tail -c 1 "$tmp" || true)" ]]; then
    printf '\n' >>"$tmp"
  fi
  printf '%s\n' "$line" >>"$tmp"
  mv "$tmp" "$NPMRC"
}
upsert_npmrc "registry" "registry=https://registry.npmmirror.com/"
upsert_npmrc "@zhongruan:registry" "@zhongruan:registry=${NPM_REG}"
upsert_npmrc "@cursor:registry" "@cursor:registry=${NPM_REG}"
upsert_npmrc "strict-ssl" "strict-ssl=false"
upsert_npmrc "minimum-release-age" "minimum-release-age=0"

echo "==> 已写入 $NPMRC"
cat "$NPMRC"
echo ""
echo "若仍报 TARBALL_URL_MISMATCH（lock 钉着私服已下架的旧版），可："
echo "  rm -rf \"$PROFILE_DIR/node_modules\" \"$PROFILE_DIR/pnpm-lock.yaml\""
echo "  然后 PREFER_LOCAL=1 DSH_PROFILE_DIR=\"$PROFILE_DIR\" ./scripts/internal-market/install-latest.sh"
echo "或在本机用 DSH 自带 pnpm 于该目录重新 pnpm install。"
