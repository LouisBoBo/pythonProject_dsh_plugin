import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Snap } from './decide.js'

export type PendingRow = {
  callId: string
  period: string
  total_tokens: number
  body: Record<string, unknown>
}

export class PendingStore {
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  list(): PendingRow[] {
    const path = join(this.dir, 'pending.jsonl')
    if (!existsSync(path)) return []
    const out: PendingRow[] = []
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line) as PendingRow)
      } catch {
        // 跳过坏行
      }
    }
    return out
  }

  total(period: string): number {
    return this.list().filter((row) => row.period === period).reduce((sum, row) => sum + Math.max(0, row.total_tokens || 0), 0)
  }

  add(row: PendingRow): void {
    const rows = this.list().filter((item) => item.callId !== row.callId)
    rows.push(row)
    this.write(rows)
  }

  remove(callId: string): void {
    this.write(this.list().filter((row) => row.callId !== callId))
  }

  saveSnap(snap: Snap): void {
    writeFileSync(join(this.dir, 'snapshot.json'), JSON.stringify(snap))
  }

  loadSnap(): Snap | null {
    const path = join(this.dir, 'snapshot.json')
    if (!existsSync(path)) return null
    try {
      const snap = JSON.parse(readFileSync(path, 'utf8')) as Snap
      if (!snap || typeof snap.period !== 'string') return null
      return snap
    } catch {
      return null
    }
  }

  private write(rows: PendingRow[]): void {
    const text = rows.map((row) => JSON.stringify(row)).join('\n')
    writeFileSync(join(this.dir, 'pending.jsonl'), text ? `${text}\n` : '')
  }
}
