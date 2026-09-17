import { loadConfig } from './config.js'
import { listAutomations, updateAutomation } from './store.js'
import { shouldRunNow, enrichSchedule } from './schedule.js'
import { executeAutomation } from './executor.js'

let timer: ReturnType<typeof setInterval> | null = null
let ticking = false

async function tickOnce(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const cfg = loadConfig()
    if (!cfg.schedulerEnabled) return
    const items = listAutomations(cfg.dataRoot)
    for (const raw of items) {
      let item = raw
      if (item.status === 'active' && (item.next_run_at == null || !Number.isFinite(item.next_run_at))) {
        item = enrichSchedule(item)
        await updateAutomation(cfg.dataRoot, item.id, { next_run_at: item.next_run_at })
      }
      if (!shouldRunNow(item)) continue
      try {
        const result = await executeAutomation(cfg.dataRoot, item)
        if (result.skipped) {
          console.log(`[automations] skip ${item.id}: ${result.reason}`)
        }
      } catch (err) {
        console.warn(`[automations] tick execute failed ${item.id}:`, err)
      }
    }
  } catch (err) {
    console.warn('[automations] tick failed:', err)
  } finally {
    ticking = false
  }
}

export function startScheduler(): void {
  stopScheduler()
  const cfg = loadConfig()
  if (!cfg.schedulerEnabled) {
    console.log('[automations] 调度器已关闭（设置中可开启）')
    return
  }
  const ms = Math.max(5, cfg.tickSec) * 1000
  setTimeout(() => {
    void tickOnce()
  }, 2000)
  timer = setInterval(() => {
    void tickOnce()
  }, ms)
  console.log(`[automations] 调度器已启动，每 ${cfg.tickSec}s 扫描`)
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export { tickOnce }
