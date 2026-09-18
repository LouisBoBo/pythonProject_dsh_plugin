import { loadConfig } from './config.js'
import { formatWecomPush } from './run_summary_text.js'
import type { DeliveryStatus } from './types.js'
import { readWorkbuddyCreds } from './workbuddy_config.js'

const HOST = 'qyapi.weixin.qq.com'
const PATH = '/cgi-bin/webhook/send'

export function normalizeWebhookKey(raw: string): string {
  const text = (raw || '').trim()
  if (!text) return ''
  if (text.includes('://') || text.toLowerCase().startsWith(HOST)) {
    const url = text.includes('://') ? text : `https://${text}`
    const parsed = new URL(url)
    if (parsed.hostname.toLowerCase() !== HOST) {
      throw new Error(`Webhook 须为 ${HOST}`)
    }
    const key = parsed.searchParams.get('key')?.trim() || ''
    if (!key) throw new Error('Webhook URL 中缺少 key 参数')
    return key
  }
  return text
}

export function buildWebhookUrl(key: string): string {
  const safe = (key || '').trim()
  if (!safe) throw new Error('未配置企业微信 Webhook Key')
  return `https://${HOST}${PATH}?key=${encodeURIComponent(safe)}`
}

export function resolveWecomSettings(): {
  enabled: boolean
  key: string
  dryRun: boolean
  fromWorkbuddy: boolean
} {
  const cfg = loadConfig()
  const wb = readWorkbuddyCreds()
  const pluginKey = cfg.wecomWebhookKey.trim()
  const key = pluginKey || wb.wecomWebhookKey
  const fromWorkbuddy = !pluginKey && Boolean(wb.wecomWebhookKey)
  const enabled = pluginKey ? cfg.wecomPushEnabled : Boolean(cfg.wecomPushEnabled || wb.wecomPushEnabled)
  const dryRun = pluginKey ? cfg.wecomDryRun : wb.wecomDryRun
  return { enabled, key, dryRun, fromWorkbuddy }
}

export async function deliverWecom(opts: {
  pushToWecom: boolean
  name: string
  summary: string
  startedAt?: number | null
}): Promise<{ delivery_status: DeliveryStatus; delivery_error?: string }> {
  if (!opts.pushToWecom) return { delivery_status: 'skipped' }
  const resolved = resolveWecomSettings()
  if (!resolved.enabled) {
    return { delivery_status: 'skipped', delivery_error: '全局未开启企微推送（请到 WorkBuddy 系统配置 → 自动化推送 开启）' }
  }
  let key = ''
  try {
    key = normalizeWebhookKey(resolved.key)
  } catch (e) {
    return { delivery_status: 'failed', delivery_error: e instanceof Error ? e.message : String(e) }
  }
  if (!key) return { delivery_status: 'skipped', delivery_error: '未配置 Webhook（请到 WorkBuddy 系统配置 → 自动化推送 填写群机器人 Key）' }
  const { msgtype, content } = formatWecomPush(opts.summary, opts.name, opts.startedAt)
  if (!msgtype || !content.trim()) {
    return { delivery_status: 'failed', delivery_error: '摘要为空，未推送' }
  }
  const payload =
    msgtype === 'markdown'
      ? { msgtype: 'markdown' as const, markdown: { content } }
      : { msgtype: 'text' as const, text: { content } }
  if (resolved.dryRun) {
    console.log(`[automations] wecom dry-run ${msgtype} ${Buffer.byteLength(content, 'utf8')} bytes`)
    return { delivery_status: 'dry_run' }
  }
  const url = buildWebhookUrl(key)
  const send = async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    })
    const text = await res.text()
    let errcode = 0
    try {
      errcode = Number((JSON.parse(text) as { errcode?: number }).errcode || 0)
    } catch {
      errcode = res.ok ? 0 : -1
    }
    if (!res.ok || errcode !== 0) throw new Error(text.slice(0, 200) || `HTTP ${res.status}`)
  }
  try {
    await send()
    return { delivery_status: 'sent' }
  } catch (e1) {
    try {
      await send()
      return { delivery_status: 'sent' }
    } catch (e2) {
      return {
        delivery_status: 'failed',
        delivery_error: e2 instanceof Error ? e2.message.slice(0, 500) : String(e2).slice(0, 500),
      }
    }
  }
}
