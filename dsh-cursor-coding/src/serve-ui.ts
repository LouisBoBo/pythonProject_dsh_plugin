/**
 * 启动过程查看台：本机 HTTP + /ui 完整前端。
 * 优先读 CURSOR_API_KEY；否则从 WorkBuddy config.yaml 取 key（不打印）。
 *
 * 用法：pnpm ui
 * 浏览器打开终端打印的 /ui 地址。
 */
import { existsSync, readFileSync } from 'node:fs'
import { loadConfig, saveConfig } from './config.js'
import { startServer, getListenAddr } from './server.js'

const KEY_CANDIDATES = [
  '/Users/hebo/ai_projects/DSH-ZR-WorkBuddy/apps/zr-workbuddy/engine/config/config.yaml',
  '/Users/hebo/Library/Application Support/zr-workbuddy-desktop/runtime-app/apps/zr-workbuddy/engine/config/config.yaml',
  '/Users/hebo/Library/Application Support/zr-workbuddy-desktop/persist/config.yaml',
]

function loadKey(): string {
  const fromEnv = String(process.env.CURSOR_API_KEY || '').trim()
  if (fromEnv && !fromEnv.startsWith('test-')) return fromEnv
  for (const p of KEY_CANDIDATES) {
    if (!existsSync(p)) continue
    const text = readFileSync(p, 'utf8')
    const m = text.match(/cursor_api_key\s*:\s*["']?([^"'\s#]+)/)
    const key = m?.[1]?.trim() || ''
    if (key && !key.startsWith('test-') && key.length > 8) return key
  }
  return ''
}

async function main() {
  const port = Number(process.env.CURSOR_CODING_PORT || 18788)
  process.env.CURSOR_CODING_PORT = String(port)
  // 正式查看台写入默认 ~/.zhongruan/cursor-coding，方便你找 jobs
  delete process.env.CURSOR_CODING_HOME
  delete process.env.CURSOR_CODING_MOCK

  const key = loadKey()
  if (!key) {
    console.error('[ui] 未找到 Cursor API Key：请设 CURSOR_API_KEY 或配置 WorkBuddy cursor_api_key')
    process.exit(1)
  }

  saveConfig({
    listen: '127.0.0.1',
    port,
    cursorApiKey: key,
    writeScope: [],
    model: 'composer-2.5',
  })
  const cfg = loadConfig()
  console.log('[ui] dataRoot =', cfg.dataRoot)
  console.log('[ui] key_ok len=', key.length, 'prefix=', key.slice(0, 4) + '…')

  const boot = await startServer()
  if (!boot.ok) {
    console.error('[ui] 启动失败', boot.detail)
    process.exit(1)
  }
  const base = getListenAddr() || `http://127.0.0.1:${port}`
  console.log('')
  console.log('========================================')
  console.log(' 过程查看台已启动')
  console.log(' 打开浏览器：' + base + '/ui')
  console.log(' API 健康检查：' + base + '/health')
  console.log(' Job 目录：' + cfg.dataRoot + '/jobs')
  console.log('========================================')
  console.log('')
  console.log('[ui] 保持此进程运行；Ctrl+C 结束')
}

main().catch((err) => {
  console.error('[ui] FAIL', err)
  process.exit(1)
})
