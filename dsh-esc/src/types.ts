export type ConnectorMode = 'mock' | 'http'
export type MesKind = 'work_order' | 'yield' | 'scrap' | 'wip' | 'oee' | 'inventory' | 'capacity' | 'output'

/** 一张场景卡：1 专家 + 最多 3 技能 + 最多 3 连接器 */
export const SCENE_MAX_SKILLS = 3
export const SCENE_MAX_CONNECTORS = 3
export const USER_SCENE_MAX = 8

export type ExpertMeta = {
  id: string
  title: string
  role: string
  author: string
  avatar: string
  tags: string[]
  preferredSkillIds: string[]
  preferredConnectorIds: string[]
  body: string
}

export type SkillMeta = {
  id: string
  name: string
  description: string
  category: string
  icon: string
  triggers: string[]
  requiredConnectorIds: string[]
  optionalConnectorIds: string[]
  body: string
}

export type ConnectorMeta = {
  id: string
  title: string
  summary: string
  vendor?: string
  marketplace?: string
  mcpServer?: string
  mcpUrl?: string
  kind?: string
  avatar?: string
  tools: string[]
  defaultEnabled: boolean
}

export type SceneSource = 'builtin' | 'user'

export type SceneMeta = {
  id: string
  title: string
  description: string
  expertId: string
  skillIds: string[]
  connectorIds: string[]
  source?: SceneSource
}

export type SceneIssue = {
  level: 'error' | 'warning'
  code: string
  message: string
}

export type SceneReview = {
  ok: boolean
  errors: SceneIssue[]
  warnings: SceneIssue[]
}

export type ConnectorConfig = {
  enabled: boolean
  /** 仅本机面板启用或选用场景卡时置位；模型绑卡不得置位。 */
  outboundArmed: boolean
  mode: ConnectorMode
  baseUrl: string
  apiKey: string
  username: string
  password: string
  token: string
  enterpriseCode: string
  datasetId: string
}

export type SessionOverride = {
  expertId: string | null
  sceneId: string | null
  pinnedSkillId: string | null
  skillIds: string[]
  connectorIds: string[]
}

export type EscState = {
  activeExpertId: string | null
  activeSceneId: string | null
  pinnedSkillId: string | null
  summonedSceneIds: string[]
  summonedExpertIds: string[]
  skills: Record<string, { enabled: boolean }>
  connectors: Record<string, ConnectorConfig>
  sessions: Record<string, SessionOverride>
}

export type EscConfig = {
  listen: string
  port: number
  dataRoot: string
}

export type QueryResult = {
  ok: boolean
  code?: string
  detail: string
  source: 'mock' | 'http' | 'none'
  data?: unknown
}
