import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { MeterEvent } from './event.js'

export type MeterLogger = {
  warn?: (msg: string) => void
}

export type MeterSink = {
  append: (event: MeterEvent) => Promise<void>
  flush?: () => Promise<void>
}

function utcStamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export class JsonlStore implements MeterSink {
  private chain: Promise<void> = Promise.resolve()

  constructor(
    readonly filePath: string,
    readonly maxFileBytes: number,
    private readonly logger?: MeterLogger,
  ) {}

  append(event: MeterEvent): Promise<void> {
    const line = `${JSON.stringify(event)}\n`
    const run = () => this.writeLine(line)
    this.chain = this.chain.then(run, run)
    return this.chain.catch((err: unknown) => {
      this.warn(`append failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  flush(): Promise<void> {
    return this.chain.catch(() => undefined)
  }

  private warn(msg: string): void {
    try {
      this.logger?.warn?.(`llm-meter: ${msg}`)
    } catch {
      // 记账日志失败不得抛出
    }
  }

  private async writeLine(line: string): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await this.rotateIfNeeded(Buffer.byteLength(line, 'utf8'))
    await appendFile(this.filePath, line, 'utf8')
  }

  private async rotateIfNeeded(nextBytes: number): Promise<void> {
    let size = 0
    try {
      size = (await stat(this.filePath)).size
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return
      throw err
    }
    if (size + nextBytes <= this.maxFileBytes) return
    const dest = await uniqueRotatedPath(this.filePath)
    await rename(this.filePath, dest)
  }
}

export async function uniqueRotatedPath(filePath: string, now = new Date()): Promise<string> {
  const stamp = utcStamp(now)
  let dest = `${filePath}.${stamp}`
  let n = 0
  while (true) {
    try {
      await stat(dest)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return dest
      throw err
    }
    n += 1
    dest = `${filePath}.${stamp}.${n}`
  }
}
