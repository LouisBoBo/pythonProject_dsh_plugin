import { loadConfig } from './config.js'
import type { DeliveryStatus } from './types.js'

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

function clipMarkdown(text: string): string {
  const s = String(text || '').trim()
  if (s.length <= 4000) return s
  return s.slice(0, 3990) + '\n…'
}

export async function deliverWecom(opts: {
  pushToWecom: boolean
  name: string
  summary: string
}): Promise<{ delivery_status: DeliveryStatus; delivery_error?: string }> {
  if (!opts.pushToWecom) return { delivery_status: 'skipped' }
  const cfg = loadConfig()
  if (!cfg.wecomPushEnabled) return { delivery_status: 'skipped', delivery_error: '全局未开启企微推送' }
  let key = ''
  try {
    key = normalizeWebhookKey(cfg.wecomWebhookKey)
  } catch (e) {
    return { delivery_status: 'failed', delivery_error: e instanceof Error ? e.message : String(e) }
  }
  if (!key) return { delivery_status: 'skipped', delivery_error: '未配置 Webhook' }
  const content = clipMarkdown(`【${opts.name}】\n${opts.summary}`)
  if (cfg.wecomDryRun) {
    console.log(`[automations] wecom dry-run ${content.length} bytes`)
    return { delivery_status: 'dry_run' }
  }
  const url = buildWebhookUrl(key)
  const send = async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
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
