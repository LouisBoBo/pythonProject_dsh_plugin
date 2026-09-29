/**
 * 企微群机器人 Webhook。官方免费接口，凭证只读系统配置。不另起 MCP 进程。
 * 对话里用户明确要求发送时用；定时推送仍走自动化插件。
 */
import type { ConnectorConfig, QueryResult } from '../types.js'
import { readWorkbuddyIm } from '../workbuddy_im.js'

const HOST = 'qyapi.weixin.qq.com'

export function normalizeWecomKey(raw: string): string {
  const text = String(raw || '').trim()
  if (!text) return ''
  if (text.includes('://') || text.toLowerCase().startsWith(HOST)) {
    const url = text.includes('://') ? text : `https://${text}`
    const parsed = new URL(url)
    if (parsed.hostname.toLowerCase() !== HOST) throw new Error(`Webhook 须为 ${HOST}`)
    const key = parsed.searchParams.get('key')?.trim() || ''
    if (!key) throw new Error('Webhook URL 中缺少 key')
    return key
  }
  return text
}

function webhookUrl(key: string): string {
  return `https://${HOST}/cgi-bin/webhook/send?key=${encodeURIComponent(key)}`
}

export function resolveWecom(_cfg: ConnectorConfig | undefined): { key: string; dryRun: boolean } {
  const wb = readWorkbuddyIm()
  return {
    key: wb.wecomWebhookKey,
    dryRun: wb.wecomDryRun,
  }
}

export async function probeWecom(cfg: ConnectorConfig): Promise<QueryResult> {
  if (cfg.mode === 'mock') {
    return { ok: true, source: 'mock', detail: 'mock：不发到群。启用 http 后按系统配置 Webhook 发送' }
  }
  try {
    const key = normalizeWecomKey(resolveWecom(cfg).key)
    if (!key) {
      return {
        ok: false,
        source: 'none',
        code: 'connector_unconfigured',
        detail: '未配置企微群机器人。请到 WorkBuddy「系统配置 → 自动化推送」填写 Webhook。',
      }
    }
    return { ok: true, source: 'http', detail: '已读到系统配置企微 Webhook（测通不往群里发消息）' }
  } catch (e) {
    return { ok: false, source: 'none', code: 'connector_unconfigured', detail: e instanceof Error ? e.message : String(e) }
  }
}

export async function sendWecom(cfg: ConnectorConfig | undefined, markdown: string): Promise<QueryResult> {
  if (!cfg?.enabled) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_disabled',
      detail: '企微连接器未启用。请到「专家·技能·连接器」打开，或用自动化任务做定时推送。',
    }
  }
  const body = String(markdown || '').trim()
  if (!body) return { ok: false, source: 'none', code: 'invalid_kind', detail: '发送内容不能为空' }
  if (cfg.mode === 'mock') {
    return { ok: true, source: 'mock', detail: 'mock：未实际发到企微群', data: { bytes: Buffer.byteLength(body, 'utf8') } }
  }
  if (!cfg.outboundArmed) {
    return {
      ok: false,
      source: 'none',
      code: 'outbound_not_armed',
      detail: '未获本机面板授权外发。请在「专家·技能·连接器」启用企微，或在输入框旁选用含企微的场景卡。禁止把用户原话当授权。',
    }
  }
  let key = ''
  try {
    key = normalizeWecomKey(resolveWecom(cfg).key)
  } catch (e) {
    return { ok: false, source: 'none', code: 'connector_unconfigured', detail: e instanceof Error ? e.message : String(e) }
  }
  if (!key) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_unconfigured',
      detail: '未配置企微群机器人。请到 WorkBuddy「系统配置 → 自动化推送」填写 Webhook。',
    }
  }
  const content = body.slice(0, 4000)
  if (resolveWecom(cfg).dryRun) {
    return { ok: true, source: 'http', detail: '系统配置为干跑，未实际发到群', data: { dryRun: true, bytes: Buffer.byteLength(content, 'utf8') } }
  }
  try {
    const res = await fetch(webhookUrl(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    let errcode = 0
    try {
      errcode = Number((JSON.parse(text) as { errcode?: number }).errcode || 0)
    } catch {
      errcode = res.ok ? 0 : -1
    }
    if (!res.ok || errcode !== 0) {
      return { ok: false, source: 'http', code: 'connect_failed', detail: text.slice(0, 180) || `HTTP ${res.status}` }
    }
    return { ok: true, source: 'http', detail: '已发到企微群' }
  } catch (e) {
    return { ok: false, source: 'http', code: 'connect_failed', detail: e instanceof Error ? e.message : String(e) }
  }
}
