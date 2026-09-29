#!/usr/bin/env node
import { startServer } from './server.js'
import { loadConfig, publicConfigView } from './config.js'

const cfg = loadConfig()
console.log('[remote-review] 本地审码 Webhook 服务启动中…')
console.log(JSON.stringify(publicConfigView(cfg), null, 2))

const out = await startServer()
if (!out.ok) {
  console.error('[remote-review] 启动失败', out.detail)
  process.exit(1)
}
console.log(`[remote-review] ${out.detail}`)
console.log('[remote-review] 健康检查: GET ' + out.addr + '/health')
console.log('[remote-review] 模拟提交: POST ' + out.addr + '/simulate  {"local_path":"/abs/repo","focus":"local test"}')
