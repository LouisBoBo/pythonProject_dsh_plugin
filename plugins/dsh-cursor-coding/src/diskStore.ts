/**
 * 本机 JSON 落盘 + 短锁，供 HITL / pending 跨进程共享（子进程 HTTP 与宿主工具同读）。
 * 锁用 Atomics.wait，避免空转占满事件循环；过期锁可回收；文件权限 600。
 */
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { defaultDataRoot, loadConfig } from './config.js'

const LOCK_STALE_MS = 3000

function sleepMs(ms: number): void {
  try {
    const buf = new Int32Array(new SharedArrayBuffer(4))
    Atomics.wait(buf, 0, 0, ms)
  } catch {
    const end = Date.now() + ms
    while (Date.now() < end) {
      /* SharedArrayBuffer 不可用时的短自旋 */
    }
  }
}

function chmodQuiet(path: string, mode: number): void {
  try {
    chmodSync(path, mode)
  } catch {
    /* ignore */
  }
}

export function storeDir(subdir: string): string {
  const root = join(loadConfig().dataRoot || defaultDataRoot(), subdir)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  chmodQuiet(root, 0o700)
  return root
}

export function withFileLock<T>(lockPath: string, fn: () => T): T {
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 })
  let fd: number | null = null
  for (let i = 0; i < 80; i += 1) {
    try {
      fd = openSync(lockPath, 'wx')
      break
    } catch {
      try {
        const st = statSync(lockPath)
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          try {
            unlinkSync(lockPath)
          } catch {
            /* 并发回收 */
          }
          continue
        }
      } catch {
        /* 锁文件已消失 */
      }
      sleepMs(8)
    }
  }
  if (fd == null) throw new Error('diskStore lock busy: ' + lockPath)
  try {
    return fn()
  } finally {
    try {
      closeSync(fd)
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(lockPath)
    } catch {
      /* ignore */
    }
  }
}

export function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = path + '.tmp.' + process.pid
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })
  chmodQuiet(tmp, 0o600)
  renameSync(tmp, path)
  chmodQuiet(path, 0o600)
}
