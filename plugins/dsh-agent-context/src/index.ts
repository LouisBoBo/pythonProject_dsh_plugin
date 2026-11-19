import type { Context } from '@deepseek-ai/cordis'

/** 与 cordis.patch.yml 的 id 一致。 */
export const name = 'agent-context'

/**
 * 薄面板：业务 UI 在 client；服务端无 HTTP、无工具。
 * 不注册对话工具，避免抢写码 / ESC 车道。
 */
export function apply(ctx: Context): void {
  try {
    const host = ctx as unknown as { logger?: { info?: (m: string) => void } }
    host.logger?.info?.('agent-context: 任务上下文侧栏已加载（UI 见 client）')
  } catch {
    // 启动日志失败不影响宿主
  }
}
