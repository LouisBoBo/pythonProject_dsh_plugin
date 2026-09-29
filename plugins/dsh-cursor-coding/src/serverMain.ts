/**
 * 写码 HTTP 独立进程入口：崩溃不拖垮宿主 Node。
 * 由 startServer(auto/child) 拉起；CURSOR_CODING_SERVER_ROLE=child。
 */
import { startServerInProcess, stopServerInProcess } from './server.js'

async function main(): Promise<void> {
  process.env.CURSOR_CODING_SERVER_ROLE = 'child'
  const out = await startServerInProcess()
  if (!out.ok) {
    console.error('[cursor-coding:child] 启动失败', out.detail)
    process.exit(1)
  }
  console.log('[cursor-coding:child]', out.detail, 'pid=' + process.pid)
  // 显式保活：避免极端环境下 listen handle 未挂住事件循环
  const keepAlive = setInterval(() => {}, 60_000)
  if (typeof keepAlive.unref === 'function') {
    /* 不要 unref：就是要挂住进程 */
  }

  const shutdown = async () => {
    clearInterval(keepAlive)
    try {
      await stopServerInProcess()
    } catch {
      /* ignore */
    }
    process.exit(0)
  }
  process.on('SIGTERM', () => {
    void shutdown()
  })
  process.on('SIGINT', () => {
    void shutdown()
  })
}

main().catch((err) => {
  console.error('[cursor-coding:child]', err)
  process.exit(1)
})
