/**
 * 写范围与敏感路径（改编自 WorkBuddy path_scope / sandbox 语义）。
 * scope 空 = 全部允许；目录项须以 / 结尾才按前缀匹配。
 */

export const COPY_SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.next',
  'coverage',
  '.idea',
  '.vscode',
  'target',
  'out',
  '.vite',
  '.dev-logs',
  '.cursor-sdk-store',
  '.cursor',
  'sandboxes',
  'local_dev',
])

const SENSITIVE_BASENAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.env.staging',
  '.env.test',
  'credentials.json',
  'service-account.json',
  'secrets.yml',
  'secrets.yaml',
  'secrets.json',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  'authorized_keys',
  'known_hosts',
])

const SENSITIVE_SUFFIXES = ['.pem', '.p12', '.pfx', '.key', '.ppk', '.env']

const SENSITIVE_PATH_PARTS = new Set(['.git', '.ssh', '.gnupg', '.aws', '.kube', '.docker'])

export function normalizeRel(rel: string): string {
  let text = String(rel || '')
    .trim()
    .replace(/\\/g, '/')
  if (!text || text.includes('\x00') || text.includes('~') || text.includes(':')) return ''
  while (text.startsWith('./')) text = text.slice(2)
  text = text.replace(/^\/+/, '')
  const parts = text.split('/').filter((p) => p && p !== '.')
  if (!parts.length || parts.includes('..')) return ''
  if (parts.length > 64 || text.length > 512) return ''
  return parts.join('/')
}

export function normalizeWriteScope(raw: string[] | null | undefined, maxItems = 200): string[] {
  if (!raw || !raw.length) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const rawS = String(item || '')
      .trim()
      .replace(/\\/g, '/')
    const wantDir = rawS.endsWith('/')
    const rel = normalizeRel(rawS)
    if (!rel) continue
    const key = rel + (wantDir ? '/' : '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
    if (out.length >= maxItems) break
  }
  return out
}

export function pathInScope(rel: string, scope: string[] | null | undefined): boolean {
  const scopeN = normalizeWriteScope(scope)
  if (!scopeN.length) return true
  const relN = normalizeRel(rel)
  if (!relN) return false
  for (const allowed of scopeN) {
    if (allowed.endsWith('/')) {
      const prefix = allowed.replace(/\/+$/, '')
      if (!prefix) continue
      if (relN === prefix || relN.startsWith(prefix + '/')) return true
      continue
    }
    if (relN === allowed) return true
  }
  return false
}

export function isSensitiveRel(rel: string): boolean {
  const parts = normalizeRel(rel).split('/').filter(Boolean)
  if (!parts.length) return false
  for (const part of parts) {
    if (SENSITIVE_PATH_PARTS.has(part) || SENSITIVE_BASENAMES.has(part)) return true
    const lower = part.toLowerCase()
    if (SENSITIVE_SUFFIXES.some((suf) => lower.endsWith(suf))) return true
  }
  return false
}

export function shouldSkipDirname(name: string): boolean {
  if (COPY_SKIP_DIR_NAMES.has(name) || name.startsWith('.git')) return true
  return false
}

export function partitionChangedPaths(
  changed: string[],
  scope: string[] | null | undefined,
): { inScope: string[]; deferred: string[] } {
  const inScope: string[] = []
  const deferred: string[] = []
  for (const rel of changed) {
    const r = normalizeRel(rel)
    if (!r || isSensitiveRel(r)) continue
    if (pathInScope(r, scope)) inScope.push(r)
    else deferred.push(r)
  }
  return { inScope, deferred }
}
