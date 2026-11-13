/**
 * 写码 HTTP 独立进程入口：崩溃不拖垮宿主 Node。
 * 由 startServer(auto/child) 拉起；CURSOR_CHAT_SERVER_ROLE=child。
 */
import { stripAccidentalMockEnv } from './config.js'
import { startServerInProcess, stopServerInProcess } from './server.js'

async function main(): Promise<void> {
  process.env.CURSOR_CHAT_SERVER_ROLE = 'child'
  // 禁止从带 MOCK=1 的 shell 启客户端后继承假写码（真需求会写成 .cursor-chat-mock.md）
  if (stripAccidentalMockEnv()) {
    console.warn(
      '[cursor-chat:child] 已忽略误继承的 CURSOR_CHAT_MOCK（正式写码禁止 Mock；自检请设 CURSOR_CHAT_SELFTEST=1）',
    )
  }
  const out = await startServerInProcess()
  if (!out.ok) {
    console.error('[cursor-chat:child] 启动失败', out.detail)
    process.exit(1)
  }
  console.log('[cursor-chat:child]', out.detail, 'pid=' + process.pid)
  // 显式保活：避免极端环境下 listen handle 未挂住事件循环
  const keepAlive = setInterval(() => {}, 60_000)
  if (typeof keepAlive.unref === 'function') {
    /* 不要 unref：就是要挂住进程 */
  }

  // 宿主被强杀时不会走 dispose：父进程消失后自杀，避免残留占端口
  const parentPid = Number(process.env.CURSOR_CHAT_PARENT_PID) || 0
  let parentWatch: NodeJS.Timeout | undefined
  const shutdown = async () => {
    clearInterval(keepAlive)
    clearInterval(parentWatch)
    try {
      await stopServerInProcess()
    } catch {
      /* ignore */
    }
    process.exit(0)
  }
  if (parentPid > 0) {
    parentWatch = setInterval(() => {
      if (process.ppid !== parentPid) {
        console.warn('[cursor-chat:child] 父进程已退出，停止服务')
        void shutdown()
      }
    }, 2_000)
  }
  process.on('SIGTERM', () => {
    void shutdown()
  })
  process.on('SIGINT', () => {
    void shutdown()
  })
}

main().catch((err) => {
  console.error('[cursor-chat:child]', err)
  process.exit(1)
})
