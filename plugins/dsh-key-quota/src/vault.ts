import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VERSION = 1

/** 本机保存分配出去的 Key。账本里只有密文，页面和日志不读原文。 */
export class KeyVault {
  constructor(private readonly dir: string) {}

  seal(plain: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv)
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([Buffer.from([VERSION]), iv, tag, enc]).toString('base64')
  }

  open(sealed: string): string | null {
    try {
      const buf = Buffer.from(sealed, 'base64')
      if (buf.length < 1 + 12 + 16 + 1 || buf[0] !== VERSION) return null
      const iv = buf.subarray(1, 13)
      const tag = buf.subarray(13, 29)
      const enc = buf.subarray(29)
      const decipher = createDecipheriv('aes-256-gcm', this.key(), iv)
      decipher.setAuthTag(tag)
      const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
      return plain.trim() ? plain : null
    } catch {
      return null
    }
  }

  private key(): Buffer {
    mkdirSync(this.dir, { recursive: true })
    const path = join(this.dir, 'vault.key')
    if (!existsSync(path)) writeFileSync(path, randomBytes(32), { mode: 0o600 })
    const buf = readFileSync(path)
    if (buf.length < 32) throw new Error('vault key')
    return buf.subarray(0, 32)
  }
}
