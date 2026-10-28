import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { readDeepseekApiKey, readProviderKeyMasks } from '../lib/workbuddy-key.js'

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

  it('returns only the masked supplier keys from system config', () => {
    const root = mkdtempSync(join(tmpdir(), 'kq-key-'))
    const explicit = join(root, 'explicit.yaml')
    const deepseek = 'sk-5ec2eHIDDEN-MIDDLE-VALUEb3eb'
    const zhipu = `50a${'x'.repeat(40)}wxyz`
    const cursor = `crsr${'y'.repeat(40)}c9d2`
    writeFileSync(explicit, [
      'deepseek:',
      `  api_key: ${deepseek}`,
      'vision:',
      `  api_key: ${zhipu}`,
      'code_dev:',
      `  cursor_api_key: ${cursor}`,
      '',
    ].join('\n'))
    try {
      const masks = readProviderKeyMasks(undefined, {
        DSH_HOME: join(root, 'dsh-home'),
        APPDATA: join(root, 'Roaming'),
        WORKBUDDY_CONFIG_YAML: explicit,
      }, root)
      assert.equal(masks.deepseek, 'sk-5ec2e*****b3eb')
      assert.equal(masks.zhipu, '50axxxxx*****wxyz')
      assert.equal(masks.cursor, 'crsryyyy*****c9d2')
      const packed = JSON.stringify(masks)
      assert.equal(packed.includes(deepseek), false)
      assert.equal(packed.includes(zhipu), false)
      assert.equal(packed.includes(cursor), false)
      assert.equal(packed.includes('HIDDEN-MIDDLE'), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
