/**
 * ORM ↔ SQLite 列漂移验尸。
 *
 * 现场：模型有 material_outbound_notes.status，库表是旧结构无该列 → 列表 500；
 * 旧审计只认 OpenAPI 路径在文档里，拦不住。
 *
 * 只认本轮同步的 models/*.py 里 Mapped 字段 vs 本机 sqlite PRAGMA；不扫结论文案。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { detectProjectLayout } from './projectLayout.js'
import { normalizeRel } from './pathScope.js'

export type SchemaDriftResult = { ok: boolean; detail: string }

const SKIP_ATTR = new Set([
  'metadata',
  'registry',
  'query',
  'query_class',
  '__mapper__',
  '__table__',
])

function readText(path: string, limit = 120_000): string {
  try {
    if (!existsSync(path)) return ''
    return readFileSync(path, 'utf8').slice(0, limit)
  } catch {
    return ''
  }
}

/** 从 SQLAlchemy 2.x Mapped 模型抽出表名 → 列名（不含 relationship）。 */
export function parseOrmTablesFromModel(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const classes = text.split(/\n(?=class\s+\w+)/)
  for (const block of classes) {
    if (!/\bMapped\[/.test(block) && !/\bmapped_column\s*\(/.test(block)) continue
    const tableM = block.match(/__tablename__\s*=\s*['"]([A-Za-z_][\w]*)['"]/)
    if (!tableM) continue
    const table = tableM[1]!
    const cols: string[] = []
    const colRe = /^\s*([A-Za-z_][\w]*)\s*:\s*Mapped\[/gm
    let m: RegExpExecArray | null
    while ((m = colRe.exec(block))) {
      const name = m[1]!
      if (SKIP_ATTR.has(name) || name.startsWith('_')) continue
      // 只看本行（Mapped 列声明），relationship 无 Mapped 注解不会进此正则
      const line = block.slice(m.index).split(/\r?\n/, 1)[0] || ''
      if (/\brelationship\s*\(/.test(line)) continue
      if (!cols.includes(name)) cols.push(name)
    }
    if (cols.length) out.set(table, cols)
  }
  return out
}

function findSqliteDbs(backendRoot: string): string[] {
  const found: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 3 || found.length >= 6) return
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (!name || name.startsWith('.')) continue
      if (name === 'node_modules' || name === '.venv' || name === 'venv' || name === '__pycache__') continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isFile() && /\.db$/i.test(name) && !/\.db-(wal|shm|journal)$/i.test(name)) {
        found.push(full)
        continue
      }
      if (st.isDirectory()) walk(full, depth + 1)
    }
  }
  walk(backendRoot, 0)
  // 常见路径优先
  found.sort((a, b) => {
    const score = (p: string) =>
      /pcb_procurement\.db$/i.test(p) ? 0 : /procurement\.db$/i.test(p) ? 1 : 2
    return score(a) - score(b) || a.length - b.length
  })
  return found
}

function pragmaColumns(dbPath: string, table: string): string[] | null {
  const py = process.platform === 'win32' ? 'python' : 'python3'
  const script =
    'import sqlite3,sys;\n' +
    `c=sqlite3.connect(${JSON.stringify(dbPath)});\n` +
    `rows=c.execute(${JSON.stringify(`PRAGMA table_info(${table})`)}).fetchall();\n` +
    'print(",".join(r[1] for r in rows) if rows else "");\n'
  const run = spawnSync(py, ['-c', script], {
    encoding: 'utf8',
    timeout: 8_000,
    windowsHide: true,
  })
  if (run.status !== 0) return null
  const line = String(run.stdout || '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop()
  if (line == null) return null
  if (!line) return [] // 表不存在
  return line.split(',').filter(Boolean)
}

/**
 * 本轮同步了 models 时：ORM 声明的列必须在本机 sqlite 表里存在。
 * 无 sqlite / 扫不到模型列时跳过（不编造失败）。
 */
export function verifySchemaDriftOnTarget(
  targetRoot: string,
  opts?: {
    synced_files?: string[]
    /** 读模型文件的根（同步前可用沙箱）；默认 targetRoot */
    modelRoot?: string
    /** 找 sqlite 的工程根（同步前用真工程）；默认 targetRoot */
    dbRoot?: string
  },
): SchemaDriftResult {
  const workspace = resolve(targetRoot)
  const modelRoot = resolve(opts?.modelRoot || targetRoot)
  const dbScanRoot = resolve(opts?.dbRoot || targetRoot)
  const synced = (opts?.synced_files || []).map((s) => normalizeRel(s)).filter(Boolean)
  const modelRels = synced.filter(
    (r) =>
      /(?:^|\/)models\/[^/]+\.py$/i.test(r) &&
      !/\/__init__\.py$/i.test(r) &&
      !/enums\.py$/i.test(r),
  )
  if (!modelRels.length) return { ok: true, detail: '' }

  const expected = new Map<string, string[]>()
  for (const rel of modelRels) {
    const text = readText(join(modelRoot, rel))
    for (const [table, cols] of parseOrmTablesFromModel(text)) {
      const prev = expected.get(table) || []
      for (const c of cols) if (!prev.includes(c)) prev.push(c)
      expected.set(table, prev)
    }
  }
  if (!expected.size) return { ok: true, detail: '' }

  const layout = detectProjectLayout(dbScanRoot, synced)
  const roots = layout.backendRoots.length ? layout.backendRoots : [dbScanRoot]
  const dbs: string[] = []
  for (const root of roots) {
    for (const db of findSqliteDbs(root)) {
      if (!dbs.includes(db)) dbs.push(db)
    }
  }
  if (!dbs.length) {
    // 同步了 models 却扫不到本机 sqlite：不得静默通过（否则缺列 500 仍假绿）
    return {
      ok: false,
      detail:
        '本轮同步了 ORM 模型，但未在工程内找到可核验的 .db。' +
        '无法确认表结构，禁止当作交付通过。请确认 sqlite 库路径或补迁移后重启后端。',
    }
  }

  const missing: string[] = []
  let readable = false
  // 多库时：凡含目标表的库都核；都读不到才算失败
  for (const [table, cols] of expected) {
    let best: string[] | null = null
    let sawUnreadable = false
    for (const dbPath of dbs) {
      const actual = pragmaColumns(dbPath, table)
      if (actual == null) {
        sawUnreadable = true
        continue
      }
      readable = true
      if (!actual.length) continue
      best = actual
      break
    }
    if (best == null) {
      if (sawUnreadable && !readable) {
        return {
          ok: false,
          detail: '无法读取本机库表结构（python/sqlite 不可用），不能确认 ORM 与库一致',
        }
      }
      missing.push(`${table}（表不存在）`)
      continue
    }
    for (const col of cols) {
      if (!best.includes(col)) missing.push(`${table}.${col}`)
    }
  }
  if (!missing.length) {
    return { ok: true, detail: 'ORM 声明列在本机库表中均存在' }
  }
  const sample = missing.slice(0, 6).join('、')
  return {
    ok: false,
    detail:
      `本机库缺 ORM 列：${sample}` +
      `${missing.length > 6 ? ` 等 ${missing.length} 项` : ''}。` +
      '列表接口会 sqlite OperationalError / no such column。请补迁移（ALTER/重建表）并重启后端。',
  }
}
