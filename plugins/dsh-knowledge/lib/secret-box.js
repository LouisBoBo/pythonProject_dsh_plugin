import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const PREFIX = 'enc:v1:'
const KEY_FILE = '.external-secret.key'
const ALGO = 'aes-256-gcm'

/**
 * Profile-bound AES-GCM box for external KB passwords at rest.
 * Key lives next to the knowledge DB under storageRoot (not in SQLite dumps alone).
 */
export function createSecretBox(storageRoot) {
    const keyPath = join(storageRoot, KEY_FILE)
    const key = loadOrCreateKey(keyPath)

    function seal(plaintext) {
        if (typeof plaintext !== 'string' || plaintext.length === 0)
            return null
        if (plaintext.startsWith(PREFIX))
            return plaintext
        const iv = randomBytes(12)
        const cipher = createCipheriv(ALGO, key, iv)
        const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
        const tag = cipher.getAuthTag()
        return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`
    }

    function open(stored) {
        if (stored == null)
            return null
        const value = String(stored)
        if (!value)
            return null
        if (!value.startsWith(PREFIX))
            return value
        const body = value.slice(PREFIX.length)
        const [ivB64, tagB64, dataB64] = body.split('.')
        if (!ivB64 || !tagB64 || !dataB64)
            throw new Error('external knowledge password ciphertext is corrupt')
        const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64url'))
        decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
        return Buffer.concat([
            decipher.update(Buffer.from(dataB64, 'base64url')),
            decipher.final(),
        ]).toString('utf8')
    }

    /** Seal plaintext; re-seal legacy plaintext so updates migrate at rest. */
    function persist(value) {
        if (value == null || value === '')
            return null
        const text = String(value)
        if (text.startsWith(PREFIX))
            return text
        return seal(text)
    }

    function isConfigured(stored) {
        return typeof stored === 'string' && stored.length > 0
    }

    return { seal, open, persist, isConfigured, keyPath }
}

function loadOrCreateKey(keyPath) {
    mkdirSync(dirname(keyPath), { recursive: true })
    if (existsSync(keyPath)) {
        const raw = readFileSync(keyPath)
        if (raw.length === 32)
            return raw
        throw new Error('external knowledge secret key file is invalid')
    }
    const key = randomBytes(32)
    writeFileSync(keyPath, key, { mode: 0o600 })
    return key
}
