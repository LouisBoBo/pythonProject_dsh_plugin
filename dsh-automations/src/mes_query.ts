/**
 * 自定义任务只读查 MES：对照 simplified query_platform_data（GET + 资料包实体）。
 * 禁止写接口；查不到返回 error，由模型省略，禁止编造。
 */
import type { MesSettings } from './config.js'
import { mesGet, mesLogin, MesHttpError } from './mes_client.js'
import { loadMesEntities, resolveMesEntity, type MesEntity } from './mes_catalog.js'

type Json = Record<string, unknown>

function asRecord(v: unknown): Json {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}
}

function recordsFromPayload(body: unknown, listKeys: string[]): { records: Json[]; total: number } {
  if (Array.isArray(body)) {
    const records = body.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Json[]
    return { records, total: records.length }
  }
  const rec = asRecord(body)
  const keys = listKeys.length ? listKeys : ['items', 'records', 'data', 'results', 'list', 'rows']
  for (const k of keys) {
    const chunk = rec[k]
    if (!Array.isArray(chunk)) continue
    const records = chunk.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Json[]
    const t = Number(rec.total)
    return { records, total: Number.isFinite(t) ? t : records.length }
  }
  return { records: [], total: Number(rec.total) || 0 }
}

function clampLimit(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 50
  return Math.min(80, Math.max(1, Math.round(v)))
}

function cleanFilters(raw: unknown): Record<string, string | number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(raw as Json)) {
    const key = String(k || '').trim()
    if (!key || key === 'page' || key === 'page_size') continue
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
    else if (typeof v === 'string' && v.trim()) out[key] = v.trim()
  }
  return out
}

export function listMesEntitiesView(entities = loadMesEntities()): {
  count: number
  entities: { id: string; label: string; aliases: string[]; path: string }[]
  hint: string
} {
  const rows = entities.filter((e) => e.ops.includes('query') || e.ops.includes('export'))
  return {
    count: rows.length,
    entities: rows.map((e) => ({
      id: e.id,
      label: e.label,
      aliases: e.aliases.slice(0, 8),
      path: e.path,
    })),
    hint: 'query_mes_data 的 entity 用英文 id 或中文别名。库存明细用 warehouse-inventory-stock，不要用 warehouse-dashboard。',
  }
}

export async function queryMesEntity(
  cfg: MesSettings,
  token: string,
  entityQuery: string,
  filters?: unknown,
  limit?: unknown,
  entities = loadMesEntities(),
): Promise<Record<string, unknown>> {
  const ent: MesEntity | null = resolveMesEntity(entityQuery, entities)
  if (!ent) {
    return { error: `未知实体「${String(entityQuery || '').slice(0, 80)}」`, hint: '先调用 list_mes_entities' }
  }
  const pageSize = clampLimit(limit)
  try {
    const body = await mesGet(cfg, token, ent.path, {
      page: 1,
      page_size: pageSize,
      ...cleanFilters(filters),
    })
    const { records, total } = recordsFromPayload(body, ent.listKeys)
    return {
      entity: ent.id,
      label: ent.label,
      total,
      records: records.slice(0, pageSize),
    }
  } catch (e) {
    const msg = e instanceof MesHttpError ? e.message : e instanceof Error ? e.message : String(e)
    return { error: `查询失败：${msg.slice(0, 300)}`, entity: ent.id }
  }
}

export async function mesLoginOrThrow(cfg: MesSettings): Promise<string> {
  try {
    return await mesLogin(cfg)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw e instanceof Error ? e : new Error(msg)
  }
}

export const MES_CHAT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_mes_entities',
      description: '列出当前 MES 可查询实体（id、中文名、别名）。查库存/工单前先调用。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_mes_data',
      description:
        '只读查询 MES 实体数据。entity 用 list_mes_entities 的英文 id 或中文别名（如「库存」「物料库存」）。',
      parameters: {
        type: 'object',
        properties: {
          entity: { type: 'string', description: '实体 id 或中文别名' },
          filters: {
            type: 'object',
            description: '可选过滤条件，字段名以资料包为准',
            additionalProperties: true,
          },
          limit: { type: 'integer', description: '返回条数上限，默认 50，最大 80' },
        },
        required: ['entity'],
        additionalProperties: false,
      },
    },
  },
]
