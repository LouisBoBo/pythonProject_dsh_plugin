/**
 * 企微 / 飞书凭证只读 WorkBuddy automations 段。不写回、不打印密钥。
 */
import { readYamlSection } from './workbuddy_mes.js'

export type WorkbuddyImCreds = {
  wecomWebhookKey: string
  wecomDryRun: boolean
  feishuAppId: string
  feishuAppSecret: string
}

function yamlBool(raw: string, fallback = false): boolean {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return fallback
  if (['true', '1', 'yes', 'on'].includes(s)) return true
  if (['false', '0', 'no', 'off'].includes(s)) return false
  return fallback
}

export function readWorkbuddyIm(): WorkbuddyImCreds {
  const auto = readYamlSection('automations')
  return {
    wecomWebhookKey: auto.wecom_webhook_key || '',
    wecomDryRun: yamlBool(auto.wecom_push_dry_run, false),
    feishuAppId: auto.feishu_app_id || '',
    feishuAppSecret: auto.feishu_app_secret || '',
  }
}

export function publicImSource(): { wecomFromWorkbuddy: boolean; feishuFromWorkbuddy: boolean } {
  const wb = readWorkbuddyIm()
  return {
    wecomFromWorkbuddy: Boolean(wb.wecomWebhookKey.trim()),
    feishuFromWorkbuddy: Boolean(wb.feishuAppId.trim() && wb.feishuAppSecret.trim()),
  }
}
