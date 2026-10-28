import type { Context } from '@deepseek-ai/cordis'
import { archiveTurn, describeArchive, sessionIdFromExec } from './archive.js'
import { Config, resolveConfig, type TranscriptConfig } from './config.js'
import type { SessionEvent } from './events.js'

export { Config }
export type { TranscriptConfig }

/** 与 cordis.patch.yml 的 id 一致。 */
export const name = 'transcript'

export const inject = ['tools'] as const

/** 归档写盘最多占用轮次收尾这么久；超时后写盘继续，但不再卡住本轮结束。 */
const WRITE_BUDGET_MS = 2_000

type Host = {
  logger?: { warn?: (message: string) => void; info?: (message: string) => void }
  on?: (name: string, listener: (payload: unknown) => void | Promise<void>) => void
  tools?: { register?: (tool: unknown) => void }
}

type WarnLog = (sessionId: string, turn: string, category: string) => void

interface SessionLike {
  id?: unknown
  header?: { cwd?: unknown }
  snapshotEvents?: () => readonly SessionEvent[]
}

export function apply(ctx: Context, config?: TranscriptConfig): void {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) return
  const host = ctx as unknown as Host
  const once = { warned: false }
  const logger = makeLogger(host)
  try {
    host.logger?.info?.(`transcript: archive → ${resolved.archiveRoot}`)
  } catch {
    // 启动日志失败不影响聊天
  }
  if (typeof host.on !== 'function') {
    warnOnce(once, logger, 'host_unsupported')
  } else {
    host.on('agent/turn-stopping', (payload) => archiveSafely(resolved.archiveRoot, payload, logger, once))
  }
  registerTool(host, resolved.archiveRoot, logger, once)
}

function archiveSafely(root: string, payload: unknown, logger: WarnLog, once: { warned: boolean }): Promise<void> {
  const run = async () => {
    const parsed = parsePayload(payload)
    if (!parsed) {
      logger('-', '-', 'bad_payload')
      return
    }
    const turnLabel = typeof parsed.turn === 'number' ? String(parsed.turn) : '-'
    if (typeof parsed.session.snapshotEvents !== 'function') {
      warnOnce(once, logger, 'host_unsupported')
      return
    }
    let events: readonly SessionEvent[]
    try {
      const snapshot = parsed.session.snapshotEvents()
      if (!Array.isArray(snapshot)) {
        logger(parsed.sessionId, turnLabel, 'snapshot_failed')
        return
      }
      // 先切出当前数组。宿主事件对象在落盘前不再改写。
      events = snapshot.slice()
    } catch {
      logger(parsed.sessionId, turnLabel, 'snapshot_failed')
      return
    }
    const result = await archiveTurn({
      archiveRoot: root,
      sessionId: parsed.sessionId,
      turn: parsed.turn,
      events,
      workspace: workspaceOf(parsed.session),
    })
    if (!result.ok) logger(parsed.sessionId, turnLabel, result.category)
  }
  let timedOut = false
  const timed = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true
      logger('-', '-', 'write_slow')
      resolve()
    }, WRITE_BUDGET_MS)
    timer.unref?.()
    run().then(() => {
      clearTimeout(timer)
      resolve()
    }, () => {
      clearTimeout(timer)
      if (!timedOut) logger('-', '-', 'write_failed')
      resolve()
    })
  })
  return timed
}

function parsePayload(payload: unknown): { sessionId: string; turn: unknown; session: SessionLike } | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const body = payload as { agent?: { session?: SessionLike }; turn?: unknown }
  const session = body.agent?.session
  if (!session || !('turn' in body)) return undefined
  const sessionId = typeof session.id === 'string' ? session.id : ''
  return { sessionId, turn: body.turn, session }
}

function workspaceOf(session: SessionLike): string | undefined {
  const cwd = session.header?.cwd
  return typeof cwd === 'string' && cwd.trim() ? cwd : undefined
}

function registerTool(host: Host, root: string, logger: WarnLog, once: { warned: boolean }): void {
  if (typeof host.tools?.register !== 'function') {
    warnOnce(once, logger, 'host_unsupported')
    return
  }
  try {
    host.tools.register({
      name: 'zr_transcript_where',
      description:
        '只读。返回当前会话的本机归档目录绝对路径。该会话还没有目录时返回归档根目录，并说明尚未写入。不保存、不改写任何文件。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value ?? '') }],
      },
      isConcurrencySafe: () => true,
      async execute(_args: unknown, exec: unknown): Promise<string> {
        try {
          const where = await describeArchive(root, sessionIdFromExec(exec))
          if (where.pending) return `尚未写入。归档根目录：${where.path}`
          return `本会话归档目录：${where.path}`
        } catch {
          return `尚未写入。归档根目录：${root}`
        }
      },
    })
  } catch {
    logger('-', '-', 'tool_register_failed')
  }
}

function makeLogger(host: Host): WarnLog {
  return (sessionId, turn, category) => {
    try {
      host.logger?.warn?.(`transcript: session=${logToken(sessionId)} turn=${logToken(turn)} ${logToken(category)}`)
    } catch {
      // 归档日志失败不得向外抛
    }
  }
}

function warnOnce(once: { warned: boolean }, logger: WarnLog, category: string): void {
  if (once.warned) return
  once.warned = true
  logger('-', '-', category)
}

function logToken(value: string): string {
  const cleaned = value.replace(/[^\w.:-]+/g, '').slice(0, 80)
  return cleaned || '-'
}
