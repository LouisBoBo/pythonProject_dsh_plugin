import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConnectorConfig, EscState, SessionOverride } from './types.js'
import { loadCatalog } from './catalog.js'
import { getAnyScene } from './scenes.js'
import { asBool, asString, writeJsonAtomic, withLock } from './util.js'
import { publicMesSource, readWorkbuddyMes } from './workbuddy_mes.js'
import { publicImSource } from './workbuddy_im.js'

const HTTP_ON_ENABLE = new Set(['mcp-chart', 'mcp-wecom', 'mcp-feishu', 'mcp-web-read'])
export const OUTBOUND_CONNECTOR_IDS = new Set(['mcp-wecom', 'mcp-feishu'])
const WORKBUDDY_SECRET_CONNECTORS = new Set(['mes', 'mcp-wecom', 'mcp-feishu'])

function emptyConnector(): ConnectorConfig {
  return {
    enabled: false,
    outboundArmed: false,
    mode: 'mock',
    baseUrl: '',
    apiKey: '',
    username: '',
    password: '',
    token: '',
    enterpriseCode: '',
    datasetId: '',
  }
}

/** MES/企微/飞书密钥只存在系统配置，禁止写入插件账本。 */
function redactConnectorSecrets(id: string, row: ConnectorConfig): ConnectorConfig {
  if (id === 'dify') return { ...row, outboundArmed: false }
  const next: ConnectorConfig = {
    ...row,
    apiKey: '',
    password: '',
    token: '',
    username: '',
    outboundArmed: OUTBOUND_CONNECTOR_IDS.has(id) ? Boolean(row.outboundArmed) : false,
  }
  if (WORKBUDDY_SECRET_CONNECTORS.has(id) || id === 'mcp-web-read') {
    next.baseUrl = ''
  }
  return next
}

function uniqueIds(ids: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of ids) {
    const id = String(raw || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function emptySession(): SessionOverride {
  return { expertId: null, sceneId: null, pinnedSkillId: null, skillIds: [], connectorIds: [] }
}

function readSessionRow(row: Partial<SessionOverride> | null | undefined): SessionOverride {
  const base = emptySession()
  if (!row || typeof row !== 'object') return base
  const skillIds = Array.isArray(row.skillIds) ? row.skillIds.map((x) => String(x)).filter(Boolean) : []
  const connectorIds = Array.isArray(row.connectorIds) ? row.connectorIds.map((x) => String(x)).filter(Boolean) : []
  return {
    expertId: row.expertId === undefined ? null : (row.expertId as string | null),
    sceneId: row.sceneId === undefined ? null : (row.sceneId as string | null),
    pinnedSkillId: row.pinnedSkillId === undefined ? null : (row.pinnedSkillId as string | null),
    skillIds,
    connectorIds,
  }
}

export function emptyState(): EscState {
  const catalog = loadCatalog()
  const skills: EscState['skills'] = {}
  for (const s of catalog.skills) skills[s.id] = { enabled: false }
  const connectors: EscState['connectors'] = {}
  for (const c of catalog.connectors) connectors[c.id] = emptyConnector()
  return {
    activeExpertId: null,
    activeSceneId: null,
    pinnedSkillId: null,
    summonedSceneIds: [],
    summonedExpertIds: [],
    skills,
    connectors,
    sessions: {},
  }
}

function statePath(dataRoot: string): string {
  return join(dataRoot, 'state.json')
}

function readStateFile(dataRoot: string): EscState {
  const fallback = emptyState()
  const path = statePath(dataRoot)
  if (!existsSync(path)) return fallback
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<EscState>
    const next = emptyState()
    if (raw.activeExpertId === null || typeof raw.activeExpertId === 'string') {
      next.activeExpertId = raw.activeExpertId ?? null
    }
    if (raw.activeSceneId === null || typeof raw.activeSceneId === 'string') {
      next.activeSceneId = raw.activeSceneId ?? null
    }
    if (raw.pinnedSkillId === null || typeof raw.pinnedSkillId === 'string') {
      next.pinnedSkillId = raw.pinnedSkillId ?? null
    }
    const rawSummoned = Array.isArray(raw.summonedSceneIds) ? raw.summonedSceneIds : null
    const summoned: string[] = []
    if (rawSummoned) {
      summoned.push(...rawSummoned.map((x) => String(x)))
    }
    if (raw.skills && typeof raw.skills === 'object') {
      for (const id of Object.keys(next.skills)) {
        const row = (raw.skills as Record<string, { enabled?: unknown }>)[id]
        if (row) next.skills[id] = { enabled: asBool(row.enabled, false) }
      }
    }
    if (raw.connectors && typeof raw.connectors === 'object') {
      for (const id of Object.keys(next.connectors)) {
        const row = (raw.connectors as Record<string, Partial<ConnectorConfig>>)[id]
        if (!row) continue
        next.connectors[id] = redactConnectorSecrets(id, {
          enabled: asBool(row.enabled, false),
          outboundArmed: asBool(row.outboundArmed, false),
          mode: row.mode === 'http' ? 'http' : 'mock',
          baseUrl: asString(row.baseUrl),
          apiKey: asString(row.apiKey),
          username: asString(row.username),
          password: asString(row.password),
          token: asString(row.token),
          enterpriseCode: asString(row.enterpriseCode),
          datasetId: asString(row.datasetId),
        })
      }
    }
    if (raw.sessions && typeof raw.sessions === 'object') {
      for (const [sid, row] of Object.entries(raw.sessions)) {
        if (!sid || !row || typeof row !== 'object') continue
        next.sessions[sid] = readSessionRow(row)
      }
    }
    if (next.activeSceneId) {
      const scene = getAnyScene(dataRoot, next.activeSceneId)
      if (scene && (!next.activeExpertId || scene.expertId === next.activeExpertId)) {
        for (const id of Object.keys(next.skills)) {
          next.skills[id] = { enabled: scene.skillIds.includes(id) }
        }
        for (const id of Object.keys(next.connectors)) {
          next.connectors[id] = { ...next.connectors[id], enabled: scene.connectorIds.includes(id) }
        }
        next.pinnedSkillId = scene.skillIds[0] || next.pinnedSkillId
      }
    }
    if (!rawSummoned) {
      if (!next.activeSceneId && next.activeExpertId) {
        const hit = loadCatalog().scenes.find((s) => s.expertId === next.activeExpertId)
        if (hit) {
          next.activeSceneId = hit.id
          if (!next.pinnedSkillId) next.pinnedSkillId = hit.skillIds[0] || null
        }
      }
      if (next.activeSceneId) summoned.push(next.activeSceneId)
      for (const sess of Object.values(next.sessions)) {
        if (sess.sceneId) summoned.push(sess.sceneId)
      }
    }
    next.summonedSceneIds = uniqueIds(summoned)
    const rawExperts = Array.isArray(raw.summonedExpertIds) ? raw.summonedExpertIds : null
    const summonedExperts: string[] = []
    if (rawExperts) {
      summonedExperts.push(...rawExperts.map((x) => String(x)))
    } else {
      if (next.activeExpertId) summonedExperts.push(next.activeExpertId)
      for (const sceneId of next.summonedSceneIds) {
        const scene = getAnyScene(dataRoot, sceneId)
        if (scene?.expertId) summonedExperts.push(scene.expertId)
      }
      for (const sess of Object.values(next.sessions)) {
        if (sess.expertId) summonedExperts.push(sess.expertId)
      }
    }
    next.summonedExpertIds = uniqueIds(summonedExperts)
    return next
  } catch {
    return fallback
  }
}

export function loadState(dataRoot: string): EscState {
  return readStateFile(dataRoot)
}

function persist(dataRoot: string, state: EscState): EscState {
  const connectors: EscState['connectors'] = {}
  for (const [id, row] of Object.entries(state.connectors)) {
    connectors[id] = redactConnectorSecrets(id, row)
  }
  const next = { ...state, connectors }
  writeJsonAtomic(statePath(dataRoot), next)
  return next
}

export function saveState(dataRoot: string, state: EscState): Promise<EscState> {
  return withLock(() => persist(dataRoot, state))
}

export function resolveExpertId(state: EscState, sessionId: string): string | null {
  const sid = sessionId.trim()
  if (sid && Object.prototype.hasOwnProperty.call(state.sessions, sid)) {
    return state.sessions[sid].expertId
  }
  return state.activeExpertId
}

export function resolveSceneId(state: EscState, sessionId: string): string | null {
  const sid = sessionId.trim()
  if (sid && Object.prototype.hasOwnProperty.call(state.sessions, sid)) {
    return state.sessions[sid].sceneId
  }
  return null
}

export function resolveSkillPool(state: EscState, sessionId: string): string[] {
  const sid = sessionId.trim()
  if (sid && Object.prototype.hasOwnProperty.call(state.sessions, sid) && state.sessions[sid].sceneId) {
    return state.sessions[sid].skillIds
  }
  return Object.entries(state.skills)
    .filter(([, v]) => v.enabled)
    .map(([id]) => id)
}

export function resolveConnectorPool(state: EscState, sessionId: string): string[] | null {
  const sid = sessionId.trim()
  if (sid && Object.prototype.hasOwnProperty.call(state.sessions, sid) && state.sessions[sid].sceneId) {
    return state.sessions[sid].connectorIds
  }
  return null
}

export function resolvePinnedSkillId(state: EscState, sessionId: string): string | null {
  const sid = sessionId.trim()
  const pool = resolveSkillPool(state, sid)
  if (sid && state.sessions[sid] && state.sessions[sid].sceneId) {
    const pin = state.sessions[sid].pinnedSkillId
    if (pin && pool.includes(pin)) return pin
    return pool[0] || null
  }
  if (sid && state.sessions[sid] && state.sessions[sid].pinnedSkillId) {
    return state.sessions[sid].pinnedSkillId
  }
  return state.pinnedSkillId
}

export function publicConnectors(state: EscState) {
  const mesSrc = publicMesSource()
  const imSrc = publicImSource()
  const out: Record<string, Record<string, unknown>> = {}
  for (const [id, row] of Object.entries(state.connectors)) {
    out[id] = {
      enabled: row.enabled,
      mode: row.mode,
      baseUrl: row.baseUrl,
      username: row.username,
      enterpriseCode: row.enterpriseCode,
      datasetId: row.datasetId,
      apiKeyConfigured: Boolean(row.apiKey.trim()),
      passwordConfigured: Boolean(row.password.trim()),
      tokenConfigured: Boolean(row.token.trim()),
      outboundArmed: Boolean(row.outboundArmed),
      mesFromWorkbuddy: id === 'mes' ? mesSrc.fromWorkbuddy : undefined,
      mesWorkbuddyBaseUrl: id === 'mes' && mesSrc.fromWorkbuddy ? mesSrc.baseUrl : undefined,
      wecomFromWorkbuddy: id === 'mcp-wecom' ? imSrc.wecomFromWorkbuddy : undefined,
      feishuFromWorkbuddy: id === 'mcp-feishu' ? imSrc.feishuFromWorkbuddy : undefined,
    }
  }
  return out
}

export function publicState(state: EscState, sessionId = '') {
  const sid = sessionId.trim()
  return {
    activeExpertId: state.activeExpertId,
    activeSceneId: state.activeSceneId,
    sessionExpertId: resolveExpertId(state, sid),
    sessionSceneId: resolveSceneId(state, sid),
    sessionSkillIds: sid && resolveSceneId(state, sid) ? resolveSkillPool(state, sid) : [],
    sessionConnectorIds: resolveConnectorPool(state, sid) || [],
    pinnedSkillId: resolvePinnedSkillId(state, sid),
    summonedSceneIds: state.summonedSceneIds,
    summonedExpertIds: state.summonedExpertIds,
    skills: state.skills,
    connectors: publicConnectors(state),
  }
}

export async function patchState(dataRoot: string, patch: Partial<EscState>): Promise<EscState> {
  return withLock(() => {
    const cur = readStateFile(dataRoot)
    const next: EscState = {
      ...cur,
      ...patch,
      skills: patch.skills ? { ...cur.skills, ...patch.skills } : cur.skills,
      connectors: patch.connectors ? { ...cur.connectors, ...patch.connectors } : cur.connectors,
      sessions: patch.sessions ? { ...cur.sessions, ...patch.sessions } : cur.sessions,
    }
    return persist(dataRoot, next)
  })
}

export async function setSessionOverride(
  dataRoot: string,
  sessionId: string,
  patch: Partial<SessionOverride>,
): Promise<EscState> {
  const sid = sessionId.trim()
  if (!sid) throw new Error('sessionId 不能为空')
  return withLock(() => {
    const cur = readStateFile(dataRoot)
    const prev = cur.sessions[sid] || emptySession()
    cur.sessions[sid] = {
      expertId: patch.expertId === undefined ? prev.expertId : patch.expertId,
      sceneId: patch.sceneId === undefined ? prev.sceneId : patch.sceneId,
      pinnedSkillId: patch.pinnedSkillId === undefined ? prev.pinnedSkillId : patch.pinnedSkillId,
      skillIds: patch.skillIds === undefined ? prev.skillIds : patch.skillIds,
      connectorIds: patch.connectorIds === undefined ? prev.connectorIds : patch.connectorIds,
    }
    return persist(dataRoot, cur)
  })
}

export async function summonScene(dataRoot: string, sceneId: string): Promise<EscState> {
  const scene = getAnyScene(dataRoot, sceneId)
  if (!scene) throw new Error(`未知场景：${sceneId}`)
  return withLock(() => {
    const cur = readStateFile(dataRoot)
    cur.summonedSceneIds = uniqueIds([...cur.summonedSceneIds, scene.id])
    cur.summonedExpertIds = uniqueIds([...cur.summonedExpertIds, scene.expertId])
    return persist(dataRoot, cur)
  })
}

export async function unsummonScene(dataRoot: string, sceneId: string): Promise<EscState> {
  const id = String(sceneId || '').trim()
  if (!id) throw new Error('sceneId 不能为空')
  const scene = getAnyScene(dataRoot, id)
  return withLock(() => {
    const cur = readStateFile(dataRoot)
    cur.summonedSceneIds = cur.summonedSceneIds.filter((x) => x !== id)
    if (cur.activeSceneId === id) {
      cur.activeSceneId = null
      if (scene && cur.activeExpertId === scene.expertId) cur.activeExpertId = null
    }
    for (const [sid, sess] of Object.entries(cur.sessions)) {
      if (sess.sceneId === id) cur.sessions[sid] = emptySession()
    }
    return persist(dataRoot, cur)
  })
}

export async function summonExpert(dataRoot: string, expertId: string): Promise<EscState> {
  const id = String(expertId || '').trim()
  if (!loadCatalog().experts.some((x) => x.id === id)) throw new Error(`未知专家：${id}`)
  return withLock(() => {
    const cur = readStateFile(dataRoot)
    cur.summonedExpertIds = uniqueIds([...cur.summonedExpertIds, id])
    return persist(dataRoot, cur)
  })
}

export async function unsummonExpert(dataRoot: string, expertId: string): Promise<EscState> {
  const id = String(expertId || '').trim()
  if (!id) throw new Error('expertId 不能为空')
  return withLock(() => {
    const cur = readStateFile(dataRoot)
    cur.summonedExpertIds = cur.summonedExpertIds.filter((x) => x !== id)
    if (cur.activeExpertId === id) cur.activeExpertId = null
    return persist(dataRoot, cur)
  })
}

export async function applyScene(
  dataRoot: string,
  sceneId: string,
  sessionId?: string,
  opts?: { armOutbound?: boolean },
): Promise<EscState> {
  const scene = getAnyScene(dataRoot, sceneId)
  if (!scene) throw new Error(`未知场景：${sceneId}`)
  const armOutbound = Boolean(opts?.armOutbound)
  return withLock(() => {
    const cur = readStateFile(dataRoot)
    const sid = String(sessionId || '').trim()
    if (sid) {
      if (!cur.summonedSceneIds.includes(scene.id)) {
        throw new Error('请先在左侧「专家·技能·连接器」召唤该场景卡，再添加到当前对话')
      }
    } else {
      cur.summonedSceneIds = uniqueIds([...cur.summonedSceneIds, scene.id])
    }
    cur.summonedExpertIds = uniqueIds([...cur.summonedExpertIds, scene.expertId])
    cur.activeExpertId = scene.expertId
    cur.activeSceneId = scene.id
    cur.pinnedSkillId = scene.skillIds[0] || null
    for (const id of Object.keys(cur.skills)) {
      cur.skills[id] = { enabled: scene.skillIds.includes(id) }
    }
    for (const id of Object.keys(cur.connectors)) {
      let on = scene.connectorIds.includes(id)
      if (on && OUTBOUND_CONNECTOR_IDS.has(id) && !armOutbound) {
        on = cur.connectors[id].enabled
      }
      const row = { ...cur.connectors[id], enabled: on }
      if (on && id === 'mes' && readWorkbuddyMes().baseUrl) row.mode = 'http'
      if (on && HTTP_ON_ENABLE.has(id)) row.mode = 'http'
      if (OUTBOUND_CONNECTOR_IDS.has(id) && armOutbound) row.outboundArmed = on
      cur.connectors[id] = row
    }
    if (sid) {
      cur.sessions[sid] = {
        expertId: scene.expertId,
        sceneId: scene.id,
        pinnedSkillId: scene.skillIds[0] || null,
        skillIds: [...scene.skillIds],
        connectorIds: [...scene.connectorIds],
      }
    }
    return persist(dataRoot, cur)
  })
}

export async function clearSessionScene(dataRoot: string, sessionId: string): Promise<EscState> {
  const sid = sessionId.trim()
  if (!sid) throw new Error('sessionId 不能为空')
  return withLock(() => {
    const cur = readStateFile(dataRoot)
    cur.sessions[sid] = emptySession()
    return persist(dataRoot, cur)
  })
}

export async function setSkillEnabled(dataRoot: string, skillId: string, enabled: boolean): Promise<EscState> {
  return withLock(() => {
    const cur = readStateFile(dataRoot)
    if (!cur.skills[skillId]) throw new Error(`未知技能：${skillId}`)
    cur.skills[skillId] = { enabled }
    cur.activeSceneId = null
    return persist(dataRoot, cur)
  })
}

export async function setConnectorEnabled(dataRoot: string, connectorId: string, enabled: boolean): Promise<EscState> {
  return withLock(() => {
    const cur = readStateFile(dataRoot)
    if (!cur.connectors[connectorId]) throw new Error(`未知连接器：${connectorId}`)
    cur.connectors[connectorId] = {
      ...cur.connectors[connectorId],
      enabled,
      outboundArmed: OUTBOUND_CONNECTOR_IDS.has(connectorId) ? enabled : false,
    }
    cur.activeSceneId = null
    if (enabled && connectorId === 'mes' && readWorkbuddyMes().baseUrl) {
      cur.connectors[connectorId].mode = 'http'
    }
    if (enabled && HTTP_ON_ENABLE.has(connectorId)) {
      cur.connectors[connectorId].mode = 'http'
    }
    return persist(dataRoot, cur)
  })
}

export async function setActiveExpert(dataRoot: string, expertId: string | null): Promise<EscState> {
  const catalog = loadCatalog()
  if (expertId && !catalog.experts.some((x) => x.id === expertId)) {
    throw new Error(`未知专家：${expertId}`)
  }
  return withLock(() => {
    const cur = readStateFile(dataRoot)
    cur.activeExpertId = expertId
    if (!expertId) {
      cur.activeSceneId = null
      cur.pinnedSkillId = null
    } else {
      const scene = catalog.scenes.find((s) => s.id === cur.activeSceneId)
      if (scene && scene.expertId !== expertId) {
        cur.activeSceneId = null
        cur.pinnedSkillId = null
      }
    }
    return persist(dataRoot, cur)
  })
}
