import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { readDeepseekApiKey } from '../lib/workbuddy-key.js'

describe('deepseek key path', () => {
  it('reads the desktop persist file when DSH_HOME has no engine link', () => {
    const root = mkdtempSync(join(tmpdir(), 'kq-key-'))
    const persistDir = join(root, 'Roaming', 'zr-workbuddy-desktop', 'persist')
    mkdirSync(persistDir, { recursive: true })
    writeFileSync(join(persistDir, 'config.yaml'), 'deepseek:\n  provider: deepseek\n  api_key: sk-desktop-key-9876\n')
    try {
      const key = readDeepseekApiKey(undefined, {
        DSH_HOME: join(root, 'dsh-home'),
        APPDATA: join(root, 'Roaming'),
        WORKBUDDY_CONFIG_YAML: '',
      }, root)
      assert.equal(key, 'sk-desktop-key-9876')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps an explicit config file ahead of the desktop persist file', () => {
    const root = mkdtempSync(join(tmpdir(), 'kq-key-'))
    const explicit = join(root, 'explicit.yaml')
    const persistDir = join(root, 'Roaming', 'zr-workbuddy-desktop', 'persist')
    mkdirSync(persistDir, { recursive: true })
    writeFileSync(explicit, 'deepseek:\n  api_key: sk-explicit-key-1111\n')
    writeFileSync(join(persistDir, 'config.yaml'), 'deepseek:\n  api_key: sk-desktop-key-9876\n')
    try {
      const key = readDeepseekApiKey(undefined, {
        DSH_HOME: join(root, 'dsh-home'),
        APPDATA: join(root, 'Roaming'),
        WORKBUDDY_CONFIG_YAML: explicit,
      }, root)
      assert.equal(key, 'sk-explicit-key-1111')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
