/**
 * 四套软件兼容自检：读 compat-matrix.json + 本机已装版本。
 * 仅告警/上报，不阻断写码主路径。
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type CompatCheck = {
  id: string
  ok: boolean
  soft?: boolean
  detail: string
  actual?: string
  expect?: string
}

export type CompatReport = {
  ok: boolean
  softOnly: boolean
  matrixVersion: number
  pluginVersion: string
  checks: CompatCheck[]
  detail: string
}

type Matrix = {
  schemaVersion?: number
  declarations?: Array<{
    from?: string
    pluginVersionRange?: string
    requires?: Record<string, string>
  }>
}

function parseVer(v: string): number[] {
  const core = String(v || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
  return core.split('.').map((p) => {
    const n = parseInt(p, 10)
    return Number.isFinite(n) ? n : 0
  })
}

function cmpVer(a: string, b: string): number {
  const aa = parseVer(a)
  const bb = parseVer(b)
  const n = Math.max(aa.length, bb.length)
  for (let i = 0; i < n; i += 1) {
    const x = aa[i] || 0
    const y = bb[i] || 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** 支持 >=x <y、^x.y.z、精确版本、* */
export function satisfiesRange(version: string, range: string): boolean {
  const ver = String(version || '').trim()
  const r = String(range || '').trim()
  if (!ver) return false
  if (!r || r === '*' || r === '>=0.0.0') return true
  if (r.startsWith('^')) {
    const base = r.slice(1)
    if (cmpVer(ver, base) < 0) return false
    const maj = parseVer(base)[0] || 0
    return (parseVer(ver)[0] || 0) === maj
  }
  const parts = r.split(/\s+/).filter(Boolean)
  for (const p of parts) {
    if (p.startsWith('>=')) {
      if (cmpVer(ver, p.slice(2)) < 0) return false
    } else if (p.startsWith('<=')) {
      if (cmpVer(ver, p.slice(2)) > 0) return false
    } else if (p.startsWith('>')) {
      if (cmpVer(ver, p.slice(1)) <= 0) return false
    } else if (p.startsWith('<')) {
      if (cmpVer(ver, p.slice(1)) >= 0) return false
    } else if (p.startsWith('=')) {
      if (cmpVer(ver, p.slice(1)) !== 0) return false
    } else if (/^\d/.test(p)) {
      if (cmpVer(ver, p) !== 0) return false
    }
  }
  return true
}

function readPkgVersion(name: string, fromDir: string): string | null {
  const candidates = [
    join(fromDir, 'node_modules', ...name.split('/'), 'package.json'),
    // 宿主 profile 安装时依赖可能在上一级 node_modules
    join(fromDir, '..', 'node_modules', ...name.split('/'), 'package.json'),
  ]
  for (const pkgPath of candidates) {
    if (!existsSync(pkgPath)) continue
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
      if (pkg.version) return pkg.version
    } catch {
      /* try next */
    }
  }
  try {
    const req = createRequire(join(fromDir, 'package.json'))
    // 部分包 exports 禁止 require('pkg/package.json')，改 resolve 入口再旁路
    const entry = req.resolve(name)
    let dir = dirname(entry)
    for (let i = 0; i < 6; i += 1) {
      const pkgPath = join(dir, 'package.json')
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string; version?: string }
        if (pkg.name === name && pkg.version) return pkg.version
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {
    /* missing */
  }
  return null
}

function loadMatrix(): Matrix {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '..', 'compat-matrix.json'),
    join(here, 'compat-matrix.json'),
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as Matrix
    } catch {
      /* try next */
    }
  }
  return { schemaVersion: 0, declarations: [] }
}

function pluginRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..')
}

export function readPluginVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(pluginRoot(), 'package.json'), 'utf8')) as {
      version?: string
    }
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export function checkCompat(): CompatReport {
  const matrix = loadMatrix()
  const pluginVersion = readPluginVersion()
  const root = pluginRoot()
  const checks: CompatCheck[] = []

  const cordis = readPkgVersion('@deepseek-ai/cordis', root)
  const dshTools = readPkgVersion('@deepseek-ai/dsh-tools', root)
  const sdk = readPkgVersion('@cursor/sdk', root)
  const workbuddy =
    process.env.WORKBUDDY_VERSION || process.env.DSH_APP_VERSION || process.env.DSH_VERSION || ''

  const decl =
    (matrix.declarations || []).find((d) => d.from === 'plugin_cursor_coding') ||
    (matrix.declarations || [])[0]

  if (decl?.pluginVersionRange && !satisfiesRange(pluginVersion, decl.pluginVersionRange)) {
    checks.push({
      id: 'plugin_self',
      ok: false,
      actual: pluginVersion,
      expect: decl.pluginVersionRange,
      detail: `插件自身版本不在声明区间 ${decl.pluginVersionRange}`,
    })
  } else {
    checks.push({
      id: 'plugin_self',
      ok: true,
      actual: pluginVersion,
      expect: decl?.pluginVersionRange,
      detail: '插件版本在声明区间内',
    })
  }

  const reqs = decl?.requires || {}
  const pairs: Array<{ id: string; actual: string | null; expect?: string; soft?: boolean }> = [
    { id: 'cursor_sdk', actual: sdk, expect: reqs.cursor_sdk },
    { id: 'dsh_runtime.cordis', actual: cordis, expect: reqs['dsh_runtime.cordis'] },
    { id: 'dsh_runtime.dsh_tools', actual: dshTools, expect: reqs['dsh_runtime.dsh_tools'] },
    { id: 'workbuddy', actual: workbuddy || null, expect: reqs.workbuddy, soft: true },
  ]

  for (const p of pairs) {
    if (!p.expect) continue
    if (!p.actual) {
      checks.push({
        id: p.id,
        ok: Boolean(p.soft),
        soft: p.soft,
        expect: p.expect,
        detail: p.soft
          ? `未检测到 ${p.id} 版本（soft 通过）`
          : `缺少 ${p.id}，期望 ${p.expect}`,
      })
      continue
    }
    const ok = satisfiesRange(p.actual, p.expect)
    checks.push({
      id: p.id,
      ok,
      soft: p.soft,
      actual: p.actual,
      expect: p.expect,
      detail: ok ? `${p.id}=${p.actual} 兼容 ${p.expect}` : `${p.id}=${p.actual} 不满足 ${p.expect}`,
    })
  }

  const hardFail = checks.some((c) => !c.ok && !c.soft)
  const softOnly = !hardFail && checks.some((c) => c.soft && !c.actual)
  return {
    ok: !hardFail,
    softOnly,
    matrixVersion: matrix.schemaVersion || 0,
    pluginVersion,
    checks,
    detail: hardFail
      ? '兼容检查未通过（详见 checks）'
      : softOnly
        ? '兼容检查通过（宿主版本未声明，soft）'
        : '兼容检查通过',
  }
}
