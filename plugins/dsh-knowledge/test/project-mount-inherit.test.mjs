import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { LocalKnowledgeProvider } from '../lib/local-provider.js'
import { knowledgeHomeFromDatabasePath, projectMountDraftsToAdopt, sessionIdsForCwd } from '../lib/project-mount-inherit.js'

const PROJECT_A = '/work/alpha'
const PROJECT_B = '/work/beta'
const SESSION_OLD = 'session-11111111-1111-4111-8111-111111111111'
const SESSION_NEW = 'session-22222222-2222-4222-8222-222222222222'
const SESSION_FRESH = 'session-33333333-3333-4333-8333-333333333333'
const SESSION_OFF = 'session-44444444-4444-4444-8444-444444444444'
const SESSION_OTHER = 'session-55555555-5555-4555-8555-555555555555'

function mount(targetId, knowledgeBaseId, updatedAt, extra = {}) {
  return {
    targetKind: 'session',
    targetId,
    knowledgeBaseId,
    enabled: true,
    recallEnabled: true,
    writeMode: 'audit',
    includeTags: [],
    excludeTags: [],
    extractionInstructions: '',
    updatedAt,
    ...extra,
  }
}

describe('project mount inheritance', () => {
  it('copies only the newest same-project session, and keeps an explicit disable', () => {
    const drafts = projectMountDraftsToAdopt([
      mount(SESSION_OLD, 'base-a', '2026-11-09T06:00:53.000Z'),
      mount(SESSION_OLD, 'base-b', '2026-11-09T06:00:53.000Z'),
      mount(SESSION_NEW, 'base-a', '2026-11-09T06:58:57.000Z', { enabled: false, writeMode: 'none' }),
      mount(SESSION_NEW, 'base-b', '2026-11-09T06:58:57.000Z', { writeMode: 'audit' }),
      mount(SESSION_OTHER, 'base-c', '2026-11-09T09:00:00.000Z'),
    ], [SESSION_OLD, SESSION_NEW])
    assert.deepEqual(drafts.map(item => item.knowledgeBaseId), ['base-b'])
    assert.equal(drafts[0].targetKind, 'project')
    assert.equal(drafts[0].writeMode, 'audit')
    assert.equal(drafts[0].enabled, true)
    assert.equal('targetId' in drafts[0], false)
  })

  it('returns nothing when the session list is empty', () => {
    assert.deepEqual(projectMountDraftsToAdopt([
      mount(SESSION_NEW, 'base-a', '2026-11-09T06:58:57.000Z'),
    ], []), [])
  })

  it('reads cwd only from the session projection and ignores other files', async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp', randomUUID())
    await mkdir(root, { recursive: true })
    try {
      assert.equal(knowledgeHomeFromDatabasePath(join(root, 'knowledge', 'knowledge.sqlite')), root)
      assert.equal(knowledgeHomeFromDatabasePath(join(root, 'other', 'knowledge.sqlite')), undefined)
      assert.equal(knowledgeHomeFromDatabasePath(':memory:'), undefined)
      const dir = join(root, 'storages', 'session_projcache', 'sessions')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${SESSION_NEW}.json`), JSON.stringify({
        version: 7,
        record: { identity: { cwd: PROJECT_A }, rows: { secret: 'do-not-use' } },
      }))
      writeFileSync(join(dir, `${SESSION_OTHER}.json`), JSON.stringify({
        version: 7,
        record: { identity: { cwd: PROJECT_B } },
      }))
      writeFileSync(join(dir, 'notes.txt'), 'ignore')
      writeFileSync(join(dir, `${SESSION_OLD}.json`), '{')
      const found = sessionIdsForCwd(root, PROJECT_A)
      assert.equal(found.ok, true)
      assert.deepEqual(found.ids, [SESSION_NEW])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a session directory that is a symlink outside the home', async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp', randomUUID())
    const outside = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp', randomUUID())
    await mkdir(join(outside, 'sessions'), { recursive: true })
    await mkdir(join(root, 'storages', 'session_projcache'), { recursive: true })
    try {
      writeFileSync(join(outside, 'sessions', `${SESSION_NEW}.json`), JSON.stringify({
        version: 7,
        record: { identity: { cwd: PROJECT_A } },
      }))
      symlinkSync(join(outside, 'sessions'), join(root, 'storages', 'session_projcache', 'sessions'))
      const found = sessionIdsForCwd(root, PROJECT_A)
      assert.equal(found.ok, false)
      assert.deepEqual(found.ids, [])
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})

describe('LocalKnowledgeProvider keeps mounts for a new session in the same directory', () => {
  async function withHome(run) {
    const home = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp', randomUUID())
    await mkdir(join(home, 'knowledge'), { recursive: true })
    const provider = new LocalKnowledgeProvider(join(home, 'knowledge', 'knowledge.sqlite'))
    try {
      await run(provider, home)
    } finally {
      await provider.close().catch(() => {})
      await rm(home, { recursive: true, force: true })
    }
  }

  function writeSession(home, id, cwd) {
    const dir = join(home, 'storages', 'session_projcache', 'sessions')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({
      version: 7,
      record: { identity: { cwd } },
    }))
  }

  async function createBase(provider, name) {
    return provider.createKnowledgeBase({
      name,
      description: '',
      defaultTags: [],
      extractionInstructions: '',
      writebackPolicy: 'conservative',
    })
  }

  it('inherits the newest same-directory mounts and still honors a session that turned one off', async () => {
    await withHome(async (provider, home) => {
      const alpha = await createBase(provider, '甲库')
      const beta = await createBase(provider, '乙库')
      const gamma = await createBase(provider, '丙库')
      writeSession(home, SESSION_OLD, PROJECT_A)
      writeSession(home, SESSION_NEW, PROJECT_A)
      writeSession(home, SESSION_FRESH, PROJECT_A)
      writeSession(home, SESSION_OFF, PROJECT_A)
      writeSession(home, SESSION_OTHER, PROJECT_B)
      const draft = (targetId, knowledgeBaseId) => ({
        targetKind: 'session',
        targetId,
        knowledgeBaseId,
        enabled: true,
        recallEnabled: true,
        writeMode: 'audit',
        includeTags: [],
        excludeTags: [],
        extractionInstructions: '',
      })
      await provider.upsertMount(draft(SESSION_OLD, alpha.id))
      await provider.upsertMount(draft(SESSION_NEW, alpha.id))
      await provider.upsertMount(draft(SESSION_NEW, beta.id))
      await provider.upsertMount(draft(SESSION_OTHER, gamma.id))
      provider.db.prepare('UPDATE knowledge_mounts SET updated_at=? WHERE target_id=?').run('2026-11-09T06:00:53.000Z', SESSION_OLD)
      provider.db.prepare('UPDATE knowledge_mounts SET updated_at=? WHERE target_id=?').run('2026-11-09T06:58:57.000Z', SESSION_NEW)
      provider.db.prepare('UPDATE knowledge_mounts SET updated_at=? WHERE target_id=?').run('2026-11-09T09:00:00.000Z', SESSION_OTHER)

      const inherited = await provider.resolveMounts(SESSION_FRESH, PROJECT_A)
      assert.deepEqual(inherited.map(item => item.knowledgeBaseId).sort(), [alpha.id, beta.id].sort())
      assert.equal(inherited.every(item => item.inheritedFrom === 'project'), true)
      assert.equal(inherited.every(item => item.writeMode === 'audit'), true)
      const sessionRows = await provider.listMounts('session', SESSION_NEW)
      assert.equal(sessionRows.length, 2)

      await provider.upsertMount({
        ...draft(SESSION_OFF, alpha.id),
        enabled: false,
        recallEnabled: false,
        writeMode: 'none',
      })
      const turnedOff = await provider.resolveMounts(SESSION_OFF, PROJECT_A)
      assert.deepEqual(turnedOff.map(item => item.knowledgeBaseId), [beta.id])

      const projectRows = await provider.listMounts('project', PROJECT_A)
      for (const row of projectRows) await provider.deleteMount(row.id)
      const afterDelete = await provider.resolveMounts('session-66666666-6666-4666-8666-666666666666', PROJECT_A)
      assert.deepEqual(afterDelete, [])
      const otherProject = await provider.resolveMounts(SESSION_FRESH, PROJECT_B)
      assert.deepEqual(otherProject.map(item => item.knowledgeBaseId), [gamma.id])
    })
  })

  it('does not replace a project mount that is already saved', async () => {
    await withHome(async (provider, home) => {
      const alpha = await createBase(provider, '甲库')
      const beta = await createBase(provider, '乙库')
      writeSession(home, SESSION_NEW, PROJECT_A)
      await provider.upsertMount({
        targetKind: 'project',
        targetId: PROJECT_A,
        knowledgeBaseId: alpha.id,
        enabled: true,
        recallEnabled: true,
        writeMode: 'none',
        includeTags: [],
        excludeTags: [],
        extractionInstructions: '',
      })
      await provider.upsertMount({
        targetKind: 'session',
        targetId: SESSION_NEW,
        knowledgeBaseId: beta.id,
        enabled: true,
        recallEnabled: true,
        writeMode: 'audit',
        includeTags: [],
        excludeTags: [],
        extractionInstructions: '',
      })
      const resolved = await provider.resolveMounts(SESSION_FRESH, PROJECT_A)
      assert.deepEqual(resolved.map(item => item.knowledgeBaseId), [alpha.id])
      assert.equal(resolved[0].writeMode, 'none')
    })
  })
})
