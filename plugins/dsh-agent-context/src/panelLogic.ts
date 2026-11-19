/**
 * 面板纯函数：合并改动路径、格式化摘要、对端降级文案。
 * 禁止用正文猜取消/终态。
 */

export type ChangeRow = {
  path: string
  source: 'git' | 'job' | 'both'
}

export function mergeChangePaths(
  gitRels: string[],
  jobSynced: string[],
  jobDeleted: string[] = [],
): ChangeRow[] {
  const map = new Map<string, ChangeRow>()
  const push = (raw: string, source: ChangeRow['source']) => {
    const path = String(raw || '')
      .trim()
      .replace(/\\/g, '/')
    if (!path) return
    const prev = map.get(path)
    if (!prev) {
      map.set(path, { path, source })
      return
    }
    if (prev.source !== source) prev.source = 'both'
  }
  for (const p of gitRels) push(p, 'git')
  for (const p of jobSynced) push(p, 'job')
  for (const p of jobDeleted) push(p, 'job')
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'))
}

export function formatShortstatLabel(stat: { add?: number; del?: number } | null | undefined): string {
  const add = Math.max(0, Number(stat?.add || 0) || 0)
  const del = Math.max(0, Number(stat?.del || 0) || 0)
  if (!add && !del) return '+0 -0'
  return `+${add} -${del}`
}

export function truncatePath(path: string, max = 48): string {
  const s = String(path || '').trim()
  if (s.length <= max) return s
  return '…' + s.slice(-(max - 1))
}

/** 宿主 file address：绝对路径 → file/absolute（不依赖 session workspaceFileScope） */
export function buildAbsoluteFileResourceUri(absPath: string): string {
  const normalized = String(absPath || '').replace(/\\/g, '/').trim()
  if (!normalized) return ''
  const unc = normalized.startsWith('//')
  const body = normalized.replace(/^\/+/, '')
  const enc = body
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/%3A/gi, ':'))
    .join('/')
  return 'dsh-resource://file/absolute/' + (unc ? '/' : '') + enc
}

/** 拼工作区绝对路径；rel 已是绝对则原样返回 */
export function resolveWorkspaceAbsPath(workspace: string, relOrAbs: string): string {
  const ws = String(workspace || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
  const raw = String(relOrAbs || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
  if (!raw) return ''
  if (raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw)) return raw
  if (!ws) return ''
  return ws + '/' + raw.replace(/^\//, '')
}

export function peerMissingMessage(kind: 'cursor-chat' | 'esc'): string {
  if (kind === 'cursor-chat') return '写码插件未就绪'
  return '专家技能插件未安装'
}

export type SkillMcpRow = {
  id: string
  kind: 'coding' | 'skill' | 'connector'
  label: string
  /** used=本任务实际用过；enabled=仅启用未调用（兜底，通常不展示） */
  source: 'used' | 'enabled'
}

/** 本会话是否走过写码插件（有 Job 即算用过，含 git_deliver） */
export function sessionUsedCoding(
  jobs: Array<{ work_kind?: string } | null | undefined> | null | undefined,
): boolean {
  return (jobs || []).some((j) => j != null && typeof j === 'object')
}

/**
 * 技能与 MCP 行：写码实际使用 + ESC 实际调用合并；
 * 都没有时才空（由 UI 显示空态）。不把「仅启用未调用」当完成任务用过。
 */
export type SourceRow = {
  id: string
  name: string
  kind: 'image' | 'file'
  path?: string
  /** 仅用户输入：job 附图 / 宿主消息附件 */
  origin: 'user'
}

function basenameOf(path: string): string {
  const s = String(path || '').replace(/\\/g, '/').trim()
  if (!s) return ''
  const parts = s.split('/')
  return parts[parts.length - 1] || s
}

/**
 * 来源区：只认用户发给智能体的输入（附图 / 附件）。
 * 禁止用工作区改动、同步文件、审码报告、结论 URL 冒充来源。
 */
export function buildSourceRows(opts: {
  /** 写码 Job 上落盘的用户附图 */
  jobImages?: Array<{ name?: string; path?: string; mimeType?: string } | null | undefined> | null
  /** 从宿主 user/message content 抽出的附件块 */
  messageAttachments?: Array<{ name?: string; path?: string; kind?: string } | null | undefined> | null
}): SourceRow[] {
  const rows: SourceRow[] = []
  const seen = new Set<string>()
  const push = (row: SourceRow) => {
    const key = (row.path || '') + '|' + row.name
    if (!row.name || seen.has(key)) return
    seen.add(key)
    rows.push(row)
  }

  for (const raw of opts.jobImages || []) {
    if (!raw || typeof raw !== 'object') continue
    const path = String(raw.path || '').trim()
    const name = String(raw.name || '').trim() || basenameOf(path)
    if (!name) continue
    if (isNonUserSourcePath(path) || isNonUserSourcePath(name)) continue
    push({
      id: 'job-img:' + (path || name),
      name,
      kind: 'image',
      path: path || undefined,
      origin: 'user',
    })
  }

  for (const raw of opts.messageAttachments || []) {
    if (!raw || typeof raw !== 'object') continue
    const path = String(raw.path || '').trim()
    const name = String(raw.name || '').trim() || basenameOf(path)
    if (!name) continue
    if (isNonUserSourcePath(path) || isNonUserSourcePath(name)) continue
    const k = String(raw.kind || '').toLowerCase()
    const kind: 'image' | 'file' =
      k === 'image' || k === 'image_url' || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name) ? 'image' : 'file'
    push({
      id: 'msg:' + (path || name),
      name,
      kind,
      path: path || undefined,
      origin: 'user',
    })
  }
  return rows
}

/** 审码报告 / 插件落盘 / 工作区改动不得进「来源」 */
export function isNonUserSourcePath(pathOrName: string): boolean {
  const s = String(pathOrName || '').replace(/\\/g, '/').toLowerCase()
  if (!s) return false
  if (s.includes('/.dsh-cursor-chat/') || s.startsWith('.dsh-cursor-chat/')) return true
  if (/审码报告/.test(String(pathOrName || ''))) return true
  if (/\/uploads\//.test(s) && /cursor-chat/.test(s)) return false
  return false
}

/**
 * 从宿主 session 事件里抽出用户消息中的附件块（只认明确 type，禁止扫正文猜路径）。
 * 须像「用户上传/附图」：有 attachment 对象、mime、或 attachments/uploads 路径；
 * 禁止把工作区 @ 文件、审码报告、产出路径当成来源。
 */
export function extractUserAttachmentsFromEvents(events: unknown): Array<{
  name: string
  path?: string
  kind: string
}> {
  if (!Array.isArray(events)) return []
  const out: Array<{ name: string; path?: string; kind: string }> = []
  const seen = new Set<string>()

  const takeBlock = (block: unknown) => {
    if (!block || typeof block !== 'object') return
    const row = block as Record<string, unknown>
    const type = String(row.type || row.kind || '').toLowerCase()
    // 只认宿主明确附件类型；text / tool-* 一律忽略
    const isImage = type === 'image' || type === 'image_url' || type === 'input_image'
    const isFile =
      type === 'file' ||
      type === 'attachment' ||
      type === 'file_attachment' ||
      type === 'input_file'
    if (!isImage && !isFile) return

    const att =
      row.attachment && typeof row.attachment === 'object'
        ? (row.attachment as Record<string, unknown>)
        : null
    const path = String(
      row.path || row.filePath || row.localPath || row.uri || att?.path || att?.uri || '',
    ).trim()
    const name = String(
      row.name || row.filename || row.fileName || att?.name || att?.filename || '',
    ).trim() || basenameOf(path)
    if (!name) return
    if (isNonUserSourcePath(path) || isNonUserSourcePath(name)) return

    const mime = String(row.mimeType || row.media_type || row.mime || att?.mimeType || att?.mediaType || '')
      .trim()
      .toLowerCase()
    const id = String(row.id || att?.id || row.attachmentId || '').trim()
    const pathLower = path.replace(/\\/g, '/').toLowerCase()
    const looksUploaded =
      Boolean(att) ||
      Boolean(id) ||
      Boolean(mime) ||
      /\/attachments\//.test(pathLower) ||
      /\/uploads\//.test(pathLower) ||
      /^data:image\//.test(pathLower) ||
      isImage
    // 裸工作区相对路径（如 src/foo.vue）没有上传特征 → 不是用户来源
    if (!looksUploaded) return

    const key = path + '|' + name
    if (seen.has(key)) return
    seen.add(key)
    out.push({ name, path: path || undefined, kind: isImage ? 'image' : 'file' })
  }

  const walkContent = (content: unknown) => {
    if (!Array.isArray(content)) return
    for (const block of content) takeBlock(block)
  }

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue
    const e = ev as { type?: unknown; data?: unknown }
    if (String(e.type || '') !== 'user/message') continue
    const data = e.data && typeof e.data === 'object' ? (e.data as Record<string, unknown>) : null
    if (!data) continue
    const message =
      data.message && typeof data.message === 'object'
        ? (data.message as Record<string, unknown>)
        : data
    const source = message.source && typeof message.source === 'object'
      ? (message.source as Record<string, unknown>)
      : null
    // 必须明确 source.kind=user；缺省/插件注入一律不算
    if (!source || String(source.kind) !== 'user') continue
    walkContent(message.content)
  }
  return out
}

export function buildSkillMcpRows(opts: {
  jobs?: Array<{ work_kind?: string } | null | undefined> | null
  usedSkillIds?: string[] | null
  usedConnectorIds?: string[] | null
  skillTitles?: Record<string, string> | null
  connectorTitles?: Record<string, string> | null
}): SkillMcpRow[] {
  const rows: SkillMcpRow[] = []
  const seen = new Set<string>()
  const skillTitles = opts.skillTitles || {}
  const connectorTitles = opts.connectorTitles || {}

  const push = (row: SkillMcpRow) => {
    const key = row.kind + ':' + row.id
    if (seen.has(key)) return
    seen.add(key)
    rows.push(row)
  }

  if (sessionUsedCoding(opts.jobs)) {
    push({
      id: 'cursor-chat',
      kind: 'coding',
      label: '写码（Cursor）',
      source: 'used',
    })
  }

  for (const raw of opts.usedSkillIds || []) {
    const id = String(raw || '').trim()
    if (!id) continue
    push({
      id,
      kind: 'skill',
      label: String(skillTitles[id] || id),
      source: 'used',
    })
  }
  for (const raw of opts.usedConnectorIds || []) {
    const id = String(raw || '').trim()
    if (!id) continue
    push({
      id,
      kind: 'connector',
      label: String(connectorTitles[id] || id),
      source: 'used',
    })
  }
  return rows
}

/** 从 Job 状态权威字段判断是否进行中（禁止扫正文） */
export function jobLooksActive(status: string): boolean {
  const s = String(status || '').trim()
  return (
    s === 'running' ||
    s === 'queued' ||
    s === 'pending_review' ||
    s === 'awaiting_user' ||
    s === 'steering'
  )
}

export type SessionJobLite = {
  status?: string
  work_kind?: string
  chat_conclusion?: string
  detail?: string
  requirement?: string
  synced_files?: string[]
  deleted_files?: string[]
}

export type SessionSummaryLite = {
  is_git?: boolean
  dirty?: boolean
  detail?: string
} | null

/** 空壳结果：仅同步/删除计数，不能当会话概括 */
export function isHollowHighlight(text: string): boolean {
  let t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return true
  t = t
    .replace(/^结果[：:]\s*/, '')
    .replace(/^[✅❌⚠ℹ⏹⏸]\s*/u, '')
    .replace(/已完成[。．]?/g, '')
    .replace(/^[,，。．、:\s]+/u, '')
    .trim()
  if (!t) return true
  if (/^已同步\s*\d+\s*个文件/.test(t)) return true
  if (/^已删除\s*\d+\s*个文件/.test(t)) return true
  if (/^已改动并同步相关文件/.test(t)) return true
  if (/^写码流程已结束/.test(t)) return true
  if (/^见上方结果说明/.test(t)) return true
  if (/^本轮未改代码/.test(t)) return true
  if (/^开发操作已结束/.test(t)) return true
  return false
}

function tidyHighlight(raw: string, max = 72): string {
  let hit = String(raw || '')
    .replace(/^结果[：:]\s*/, '')
    .replace(/^[✅❌⚠ℹ⏹⏸]\s*/u, '')
    .replace(/已完成[。．]?/g, '')
    .replace(/^[,，。．、:\s]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!hit) return ''
  const first = hit.split(/[；;]/)[0].trim()
  hit = first || hit
  if (/^[。．]/.test(hit)) hit = hit.replace(/^[。．]+/, '').trim()
  if (isHollowHighlight(hit)) return ''
  if (hit.length > max) hit = hit.slice(0, max - 2) + '…'
  return hit
}

/** 从 Job 本轮结论抽出一句有信息量的进展（优先改动要点，跳过空壳同步计数） */
export function extractJobHighlight(raw: string): string {
  const clean = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/#+\s*/g, '')
    .replace(/[*_`]+/g, '')
    .replace(/\u2022/g, '·')
  const lines = clean
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)

  const changeHits: string[] = []
  let inChange = false
  for (const line of lines) {
    if (/^改动[：:]/.test(line) || line === '改动') {
      inChange = true
      const inline = line.replace(/^改动[：:]\s*/, '').trim()
      if (inline && !/^[·•]/.test(inline)) {
        const t = tidyHighlight(inline)
        if (t) changeHits.push(t)
      }
      continue
    }
    if (/^(结果|需求|接口|落盘|审计|完成度|说明|请你验收|范围外|安全拦截)[：:]?/.test(line)) {
      inChange = false
      continue
    }
    if (inChange && /^[·•]/.test(line)) {
      const t = tidyHighlight(line.replace(/^[·•]\s*/, ''))
      if (t) changeHits.push(t)
    }
  }
  if (changeHits.length) return changeHits[0]

  for (const line of lines) {
    if (/^需求[：:]/.test(line)) {
      const t = tidyHighlight(line.replace(/^需求[：:]\s*/, ''))
      if (t) return t
    }
  }

  for (const line of lines) {
    if (/^结果[：:]/.test(line)) {
      const t = tidyHighlight(line.replace(/^结果[：:]\s*/, ''))
      if (t) return t
    }
  }

  for (const line of lines) {
    if (line === '本轮结论' || line === 'Git 交付结论') continue
    if (/^(需求|改动|结果|接口|落盘|审计|完成度|说明|请你验收)/.test(line)) continue
    if (/^[·•]/.test(line)) {
      const t = tidyHighlight(line.replace(/^[·•]\s*/, ''))
      if (t) return t
      continue
    }
    const t = tidyHighlight(line)
    if (t) return t
  }
  return ''
}

/**
 * 对标 Qode：整段会话自然语言概括（主题 + 跨轮进展）。
 * 禁止「本轮结论」字段表，禁止「本会话共 N 轮」统计口吻，禁止只写「已同步 N 个文件」。
 */
export function buildSessionBubbleSummary(opts: {
  jobs: SessionJobLite[]
  summary?: SessionSummaryLite
  sessionTitle?: string
  ccReady?: boolean | null
  msg?: string
  err?: string
}): string {
  const err = String(opts.err || '').trim()
  if (err) return err.length > 80 ? err.slice(0, 78) + '…' : err
  const msg = String(opts.msg || '').trim()
  if (opts.ccReady === false) return '写码插件未就绪，环境信息暂不可用。'

  const jobs = (opts.jobs || []).filter((j) => j && String(j.work_kind || '') !== 'git_deliver')
  const ordered = [...jobs].reverse()
  const highlights: string[] = []
  const seenHi: Record<string, true> = {}
  let active = 0

  const pushHi = (raw: string) => {
    const hi = tidyHighlight(raw, 72)
    if (!hi || seenHi[hi] || /本轮结论|落盘[：:]/.test(hi)) return
    seenHi[hi] = true
    highlights.push(hi)
  }

  for (const j of ordered) {
    const st = String(j.status || '').trim()
    if (jobLooksActive(st)) active += 1
    const req = String(j.requirement || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (req) pushHi(req)
    const fromConc = extractJobHighlight(String(j.chat_conclusion || ''))
    if (fromConc) pushHi(fromConc)
    else {
      const det = String(j.detail || '')
        .replace(/\s+/g, ' ')
        .trim()
      if (det && !isHollowHighlight(det)) pushHi(det)
    }
  }

  const title = String(opts.sessionTitle || '').trim()
  let text = ''
  if (title && highlights.length) {
    text = '围绕「' + title + '」已推进：' + highlights.slice(0, 4).join('；') + '。'
  } else if (highlights.length) {
    text = highlights.slice(0, 4).join('；') + '。'
  } else if (title) {
    text = '围绕「' + title + '」继续，等待可展示的任务进展。'
  } else if (msg) {
    text = msg.length > 72 ? msg.slice(0, 70) + '…' : msg
  } else {
    text = '等待本会话任务摘要…'
  }
  if (active) text += '另有任务进行中。'
  if (opts.summary && opts.summary.is_git && opts.summary.dirty) {
    text += '工作区仍有未提交改动。'
  }
  text = text.replace(/\s+/g, ' ').replace(/。{2,}/g, '。').trim()
  if (text.length > 320) text = text.slice(0, 318) + '…'
  return text
}
