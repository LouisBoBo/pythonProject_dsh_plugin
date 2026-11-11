#!/usr/bin/env bash
# 本机 Windows（Git Bash）跑 pack/upload 前 source 本文件。
# 依赖：SSH_KEY（默认 %USERPROFILE%/.ssh/tc_staging_deploy）、LOCALAPPDATA/dsh-tools/bin 内 rsync。
set -euo pipefail

win_to_msys() {
  # C:\Users\.. 或 C:/Users/.. → /c/Users/..
  local p="${1:-}"
  p="${p//\\//}"
  if [[ "$p" =~ ^([A-Za-z]):/(.*)$ ]]; then
    echo "/$(echo "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')/${BASH_REMATCH[2]}"
  else
    echo "$p"
  fi
}

USER_HOME_WIN="${USERPROFILE:-${HOME:-}}"
if [[ -z "$USER_HOME_WIN" ]]; then
  echo "错误: 未设置 USERPROFILE/HOME" >&2
  exit 2
fi

LOCAL_APPDATA_WIN="${LOCALAPPDATA:-${USER_HOME_WIN}/AppData/Local}"
TOOLS_BIN_UNIX="$(win_to_msys "$LOCAL_APPDATA_WIN")/dsh-tools/bin"
export PATH="$TOOLS_BIN_UNIX:/usr/bin:$PATH"

# MSYS2/OpenSSH 认 Windows 盘符路径；可用 SSH_KEY / SSH_HOST 覆盖
if [[ -z "${SSH_KEY:-}" ]]; then
  export SSH_KEY="${USER_HOME_WIN}/.ssh/tc_staging_deploy"
fi
export SSH_HOST="${SSH_HOST:-root@175.178.238.31}"

KEY_UNIX="$(win_to_msys "$SSH_KEY")"
if [[ ! -f "$KEY_UNIX" && ! -f "$SSH_KEY" ]]; then
  echo "错误: 找不到部署密钥（SSH_KEY=$SSH_KEY）" >&2
  exit 2
fi
if [[ ! -f "$TOOLS_BIN_UNIX/rsync-real.exe" ]]; then
  echo "错误: 找不到 rsync-real.exe（$TOOLS_BIN_UNIX）" >&2
  exit 2
fi
command -v rsync >/dev/null
command -v python3 >/dev/null || {
  echo "错误: 需要 python3（可把 Windows Python 做成 PATH 里的 python3 包装）" >&2
  exit 2
}
