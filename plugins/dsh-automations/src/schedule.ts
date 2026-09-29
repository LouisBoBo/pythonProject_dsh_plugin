import type { Automation, ScheduleType } from './types.js'

const WEEKDAY_MAP: Record<string, number> = {
  MO: 0,
  TU: 1,
  WE: 2,
  TH: 3,
  FR: 4,
  SA: 5,
  SU: 6,
}

function parseIsoDate(value: string | null | undefined): Date | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  try {
    if (raw.length === 10 && raw[4] === '-') {
      const d = new Date(`${raw}T00:00:00`)
      return Number.isNaN(d.getTime()) ? null : d
    }
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

export function parseRrule(rrule: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const seg of String(rrule || '').split(';')) {
    const s = seg.trim()
    if (!s || !s.includes('=')) continue
    const i = s.indexOf('=')
    out[s.slice(0, i).trim().toUpperCase()] = s.slice(i + 1).trim()
  }
  return out
}

function withinValidWindow(automation: Pick<Automation, 'valid_from' | 'valid_until'>, when: Date): boolean {
  const vf = parseIsoDate(automation.valid_from)
  const vu = parseIsoDate(automation.valid_until)
  if (vf && when.getTime() < vf.getTime()) return false
  if (vu) {
    const end = new Date(vu)
    end.setHours(23, 59, 59, 0)
    if (when.getTime() > end.getTime()) return false
  }
  return true
}

function dailyNext(when: Date, hour: number, minute: number): Date {
  const candidate = new Date(when)
  candidate.setHours(hour, minute, 0, 0)
  if (candidate.getTime() <= when.getTime()) candidate.setDate(candidate.getDate() + 1)
  return candidate
}

function jsToPythonWeekday(d: Date): number {
  return (d.getDay() + 6) % 7
}

function weeklyNextPy(when: Date, hour: number, minute: number, byday: string[]): Date | null {
  const allowed = new Set(
    byday.map((d) => WEEKDAY_MAP[d.trim().toUpperCase()]).filter((n) => n !== undefined),
  )
  if (allowed.size === 0) allowed.add(0)
  const probe = new Date(when)
  probe.setHours(hour, minute, 0, 0)
  if (probe.getTime() <= when.getTime()) {
    probe.setDate(probe.getDate() + 1)
    probe.setHours(hour, minute, 0, 0)
  }
  for (let i = 0; i < 370; i += 1) {
    if (allowed.has(jsToPythonWeekday(probe)) && probe.getTime() > when.getTime()) {
      return new Date(probe)
    }
    probe.setDate(probe.getDate() + 1)
    probe.setHours(hour, minute, 0, 0)
  }
  return null
}

export function computeNextRunAt(
  automation: Pick<
    Automation,
    'status' | 'schedule_type' | 'rrule' | 'scheduled_at' | 'valid_from' | 'valid_until'
  >,
  base?: Date,
): number | null {
  const now = base ?? new Date()
  if (String(automation.status || '').toLowerCase() !== 'active') return null
  if (!withinValidWindow(automation, now)) return null

  const scheduleType = (String(automation.schedule_type || 'recurring').toLowerCase() ||
    'recurring') as ScheduleType
  if (scheduleType === 'once') {
    const dt = parseIsoDate(automation.scheduled_at)
    if (!dt || dt.getTime() <= now.getTime()) return null
    return Math.floor(dt.getTime() / 1000)
  }

  const parts = parseRrule(String(automation.rrule || ''))
  const freq = (parts.FREQ || 'DAILY').toUpperCase()
  let hour = Number.parseInt(parts.BYHOUR ?? '9', 10)
  let minute = Number.parseInt(parts.BYMINUTE ?? '0', 10)
  if (!Number.isFinite(hour)) hour = 9
  if (!Number.isFinite(minute)) minute = 0
  hour = Math.max(0, Math.min(23, hour))
  minute = Math.max(0, Math.min(59, minute))

  let nxt: Date | null
  if (freq === 'WEEKLY') {
    const byday = (parts.BYDAY || 'MO').split(',')
    nxt = weeklyNextPy(now, hour, minute, byday)
    if (!nxt) return null
  } else {
    nxt = dailyNext(now, hour, minute)
  }
  if (!withinValidWindow(automation, nxt)) return null
  return Math.floor(nxt.getTime() / 1000)
}

export function enrichSchedule<
  T extends Pick<Automation, 'status' | 'schedule_type' | 'rrule' | 'scheduled_at' | 'valid_from' | 'valid_until'>,
>(item: T, base?: Date): Omit<T, 'next_run_at'> & { next_run_at: number | null } {
  return { ...item, next_run_at: computeNextRunAt(item, base) }
}

export function shouldRunNow(
  automation: Pick<Automation, 'status' | 'next_run_at' | 'last_run_at' | 'valid_from' | 'valid_until'>,
  nowTs?: number,
): boolean {
  if (String(automation.status || '').toLowerCase() !== 'active') return false
  const now = nowTs ?? Math.floor(Date.now() / 1000)
  const nra = automation.next_run_at
  if (typeof nra !== 'number' || !Number.isFinite(nra)) return false
  if (nra > now) return false
  const last = automation.last_run_at
  if (typeof last === 'number' && Number.isFinite(last) && last >= nra) return false
  return withinValidWindow(automation, new Date(now * 1000))
}

export function rruleToScheduleLabel(rrule: string): string {
  const raw = String(rrule || '')
  const hour = raw.match(/BYHOUR=(\d+)/)?.[1]
  const minute = raw.match(/BYMINUTE=(\d+)/)?.[1]
  const pad = (n: string) => n.padStart(2, '0')
  const time = hour != null && minute != null ? `${pad(hour)}:${pad(minute)}` : ''
  if (raw.includes('FREQ=DAILY')) return time ? `每天 ${time}` : '每天'
  if (raw.includes('FREQ=WEEKLY')) {
    const day = raw.match(/BYDAY=([A-Z,]+)/)?.[1] || ''
    const map: Record<string, string> = {
      MO: '一',
      TU: '二',
      WE: '三',
      TH: '四',
      FR: '五',
      SA: '六',
      SU: '日',
    }
    if (day === 'MO,TU,WE,TH,FR' && time) return `工作日 ${time}`
    const days = day
      .split(',')
      .map((d) => map[d] || d)
      .join('、')
    return days && time ? `每周${days} ${time}` : '每周'
  }
  return '循环执行'
}

export function scheduleSummary(item: Pick<Automation, 'schedule_type' | 'scheduled_at' | 'rrule'>): string {
  if (item.schedule_type === 'once') {
    return item.scheduled_at ? `单次 · ${item.scheduled_at.replace('T', ' ')}` : '单次执行'
  }
  return rruleToScheduleLabel(item.rrule)
}
