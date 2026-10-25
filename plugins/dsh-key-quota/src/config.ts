import { homedir } from 'node:os'
import { join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'

export interface QuotaConfig {
  enabled?: boolean
  role?: string
  listen?: string
  port?: number
  quotaBaseUrl?: string
  reportToken?: string
}

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('关闭后不挂 llm/stream，行为与未安装相同'),
  role: Schema.string().default('client').description('client 或 server。只有你的电脑用 server'),
  listen: Schema.string().default('127.0.0.1').description('server 监听地址。给同事访问时填 0.0.0.0'),
  port: Schema.number().default(18790).description('额度服务端口'),
  quotaBaseUrl: Schema.string().default('').description('同事填写管理员电脑的 http://内网IP:18790'),
  reportToken: Schema.string().default('').description('上报令牌。不能改限额，也不能指定管理员'),
})

export type ResolvedQuotaConfig = {
  enabled: boolean
  role: 'client' | 'server'
  listen: string
  port: number
  quotaBaseUrl: string
  reportToken: string
  dataDir: string
}

export function dshHome(): string {
  return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}

export function resolveConfig(config: QuotaConfig | undefined): ResolvedQuotaConfig {
  const enabled = config?.enabled !== false
  const role = config?.role === 'server' ? 'server' : 'client'
  const portNumber = Number(config?.port)
  const port = Number.isFinite(portNumber) && portNumber > 0 && portNumber < 65536 ? Math.floor(portNumber) : 18790
  const listen = (config?.listen || (role === 'server' ? '127.0.0.1' : '127.0.0.1')).trim() || '127.0.0.1'
  const configuredUrl = (config?.quotaBaseUrl || '').trim().replace(/\/+$/, '')
  const quotaBaseUrl = configuredUrl || (role === 'server' ? `http://127.0.0.1:${port}` : '')
  return {
    enabled,
    role,
    listen: role === 'server' ? listen : '127.0.0.1',
    port,
    quotaBaseUrl,
    reportToken: (config?.reportToken || '').trim(),
    dataDir: join(dshHome(), 'key-quota'),
  }
}
