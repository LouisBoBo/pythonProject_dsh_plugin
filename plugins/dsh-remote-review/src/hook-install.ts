import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOOK_MARKER, loadConfig } from './config.js'

function hookScript(webhookUrl: string): string {
  let url = webhookUrl.trim()
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') url = 'http://127.0.0.1:18787/webhook'
  } catch {
    url = 'http://127.0.0.1:18787/webhook'
  }
  return `#!/usr/bin/env bash
# ${HOOK_MARKER}
# 只负责把 commit 事件 POST 到 Webhook，不直接调审码引擎。
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
REPO="$(basename "$ROOT")"
URL="\${REMOTE_REVIEW_WEBHOOK:-${url}}"
SECRET="\${REMOTE_REVIEW_SECRET:-}"
export ROOT COMMIT BRANCH REPO
PAYLOAD="$(python3 -c 'import json,os; print(json.dumps({"event":"git-commit","local_path":os.environ["ROOT"],"commit":os.environ.get("COMMIT",""),"branch":os.environ.get("BRANCH","HEAD"),"repo":os.environ.get("REPO","local")}))')"
{
  curl -sS -m 5 -X POST "$URL" \\
    -H 'Content-Type: application/json' \\
    -H "X-Remote-Review-Secret: $SECRET" \\
    -d "$PAYLOAD" \\
    || true
} >/dev/null 2>&1 &
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$HOOK_DIR/post-commit.dsh-prev" ]; then
  "$HOOK_DIR/post-commit.dsh-prev" "$@" || true
fi
`
}

export function installCommitWebhookHook(repoPath: string): {
  ok: boolean
  hookPath: string
  chainedPrev: boolean
  webhook: string
  detail: string
} {
  const cfg = loadConfig()
  const webhook = `http://${cfg.listen}:${cfg.port}/webhook`
  if (!existsSync(join(repoPath, '.git'))) {
    return {
      ok: false,
      hookPath: '',
      chainedPrev: false,
      webhook,
      detail: `不是 git 仓库：${repoPath}`,
    }
  }
  const hooksDir = join(repoPath, '.git', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  const hookPath = join(hooksDir, 'post-commit')
  const prevPath = join(hooksDir, 'post-commit.dsh-prev')
  let chainedPrev = false
  if (existsSync(hookPath)) {
    const current = readFileSync(hookPath, 'utf8')
    if (!current.includes(HOOK_MARKER)) {
      copyFileSync(hookPath, prevPath)
      chmodSync(prevPath, 0o755)
      chainedPrev = true
    } else if (existsSync(prevPath)) {
      chainedPrev = true
    }
  }
  writeFileSync(hookPath, hookScript(webhook), { encoding: 'utf8', mode: 0o755 })
  chmodSync(hookPath, 0o755)
  return {
    ok: true,
    hookPath,
    chainedPrev,
    webhook,
    detail: chainedPrev
      ? `已安装 Webhook Hook，并保留原 post-commit（链式调用）：${prevPath}`
      : `已安装 Webhook Hook：${hookPath}`,
  }
}
