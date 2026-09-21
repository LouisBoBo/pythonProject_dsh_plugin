import { inflateRawSync } from 'node:zlib'

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 65535)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i
  }
  throw new Error('不是有效的 zip 包')
}

function safeZipName(raw: string): string | null {
  const name = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!name || name.includes('\0')) return null
  const parts = name.split('/')
  if (parts.some((p) => p === '..')) return null
  return name
}

function isSkillMd(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower.includes('__macosx/')) return false
  const base = lower.split('/').pop() || ''
  return base === 'skill.md'
}

function inflateEntry(buf: Buffer, method: number, start: number, size: number, uncompressed: number): Buffer {
  const slice = buf.subarray(start, start + size)
  if (method === 0) return Buffer.from(slice)
  if (method === 8) {
    const out = inflateRawSync(slice, { maxOutputLength: Math.max(uncompressed, 1) })
    return Buffer.from(out)
  }
  throw new Error(`zip 压缩方法 ${method} 不支持`)
}

/** 从 SkillHub zip 中取出 SKILL.md；只认手册正文，不执行包内脚本。 */
export function extractSkillMarkdown(buf: Buffer): { path: string; text: string } {
  if (buf.length < 22 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('SkillHub 返回的不是 zip')
  const eocd = findEocd(buf)
  const count = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOff = buf.readUInt32LE(eocd + 16)
  if (cdOff + cdSize > buf.length) throw new Error('zip 目录损坏')
  let best: { path: string; text: string; depth: number } | null = null
  let offset = cdOff
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL_SIG) throw new Error('zip 中央目录损坏')
    const method = buf.readUInt16LE(offset + 10)
    const compSize = buf.readUInt32LE(offset + 20)
    const uncompSize = buf.readUInt32LE(offset + 24)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOff = buf.readUInt32LE(offset + 42)
    const name = safeZipName(buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8'))
    offset += 46 + nameLen + extraLen + commentLen
    if (!name || !isSkillMd(name)) continue
    if (uncompSize > 512 * 1024) throw new Error('SKILL.md 过大')
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== LOCAL_SIG) throw new Error('zip 本地头损坏')
    const localNameLen = buf.readUInt16LE(localOff + 26)
    const localExtra = buf.readUInt16LE(localOff + 28)
    const dataStart = localOff + 30 + localNameLen + localExtra
    if (dataStart + compSize > buf.length) throw new Error('zip 数据越界')
    const text = inflateEntry(buf, method, dataStart, compSize, uncompSize).toString('utf8')
    const depth = name.split('/').length
    if (!best || depth < best.depth) best = { path: name, text, depth }
  }
  if (!best || !best.text.trim()) throw new Error('安装包里没有 SKILL.md')
  return { path: best.path, text: best.text }
}

/** 仅测用：生成未压缩 zip。 */
export function makeStoredZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const data = file.data
    const crc = crc32(data)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(LOCAL_SIG, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    locals.push(local, data)
    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(CENTRAL_SIG, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)
    offset += local.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}
