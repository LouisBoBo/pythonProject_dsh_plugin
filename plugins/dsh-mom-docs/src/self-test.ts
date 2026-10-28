import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MomError } from './types.js'
import { assertCalendarDate, resolveWorkspaceDir, safeFileName, shanghaiDate } from './paths.js'
import { handleMomRequest } from './http.js'
import { MAX_BYTES, listDocuments, listLibraries, listLibrary, readDocument, saveDocument, setWorkspaceCatalog } from './store.js'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

function assertCode(run: () => void, code: string): void {
  try {
    run()
  } catch (err) {
    assert(err instanceof MomError && err.code === code, `expected ${code}, got ${String(err)}`)
    return
  }
  throw new Error(`expected ${code}`)
}

function testDates(): void {
  assert(shanghaiDate(new Date('2026-10-21T15:30:00Z')) === '2026-10-21', 'shanghai same calendar day')
  assert(shanghaiDate(new Date('2026-10-21T16:30:00Z')) === '2026-10-22', 'shanghai next calendar day')
  assert(assertCalendarDate('2026-10-21') === '2026-10-21', 'accept calendar date')
  assertCode(() => assertCalendarDate('2026-13-40'), 'directory_invalid')
  assertCode(() => assertCalendarDate('21-10-2026'), 'directory_invalid')
}

function testNames(): void {
  assert(safeFileName('周会纪要', '') === '周会纪要.md', 'default md')
  assert(safeFileName('', '方案说明') === '方案说明.md', 'title fallback')
  assert(safeFileName('notes.MD', '') === 'notes.md', 'lower ext')
  assert(safeFileName('a/../../周会.md', '') === '周会.md', 'basename only')
  assert(safeFileName('readme.txt', '') === 'readme.txt', 'keep txt')
  assertCode(() => safeFileName('tool.exe', ''), 'filename_invalid')
  assertCode(() => safeFileName('.env', ''), 'filename_invalid')
  assertCode(() => safeFileName('../secret.pem', ''), 'filename_invalid')
  assertCode(() => safeFileName('CON.md', ''), 'filename_invalid')
  assertCode(() => safeFileName('aux.txt', ''), 'filename_invalid')
  assertCode(() => safeFileName('', ''), 'filename_invalid')
}

function canLink(target: string, path: string, type: 'file' | 'junction'): boolean {
  try {
    symlinkSync(target, path, type)
    return true
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : ''
    if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EACCES') return false
    throw err
  }
}

function testEscapes(): void {
  const workspace = mkdtempSync(join(tmpdir(), 'mom-docs-link-'))
  const outside = mkdtempSync(join(tmpdir(), 'mom-docs-out-'))
  let junctionWorkspace = ''
  const now = new Date('2026-10-21T15:30:00Z')
  try {
    const secret = join(outside, 'secret.txt')
    writeFileSync(secret, 'SECRET-VALUE\n')
    saveDocument({ directory: workspace, filename: 'ok.md', title: '', content: 'safe', now })
    const day = join(workspace, 'MOM', '2026-10-21')
    if (canLink(secret, join(day, 'leak.md'), 'file')) {
      assertCode(() => readDocument(workspace, '2026-10-21', 'leak.md', now), 'filename_invalid')
      assert(!listDocuments(workspace, '2026-10-21', now).items.some((item) => item.fileName === 'leak.md'), 'file symlink hidden')
      assert(
        !listLibrary(workspace).days.some((item) => item.items.some((file) => file.fileName === 'leak.md')),
        'library hides file symlink',
      )
      const page = captureMom(
        'GET',
        `/mom-docs/v1/file?directory=${encodeURIComponent(workspace)}&date=2026-10-21&name=leak.md`,
      )
      assert(page.status === 400, 'http refuses file symlink')
      assert(!JSON.stringify(page.json).includes('SECRET-VALUE'), 'http body has no secret')
    }

    const sink = join(outside, 'sink.txt')
    writeFileSync(sink, 'ORIGINAL')
    const indexPath = join(day, '_index.jsonl')
    unlinkSync(indexPath)
    if (canLink(sink, indexPath, 'file')) {
      const saved = saveDocument({
        directory: workspace,
        filename: 'after.md',
        title: 'after',
        content: 'after',
        now,
      })
      assert(saved.indexWritten === false, 'symlink index not appended')
      assert(readFileSync(sink, 'utf8') === 'ORIGINAL', 'index symlink not followed')
    }

    const outsideDay = join(outside, 'day')
    mkdirSync(outsideDay)
    writeFileSync(join(outsideDay, 'outside.md'), 'OUTSIDE\n')
    assert(canLink(outsideDay, join(workspace, 'MOM', '2026-10-20'), 'junction'), 'date junction')
    assertCode(() => readDocument(workspace, '2026-10-20', 'outside.md', now), 'filename_invalid')
    assert(!listLibrary(workspace).days.some((item) => item.date === '2026-10-20'), 'junction day hidden')
    assertCode(
      () => saveDocument({ directory: workspace, filename: 'x.md', title: '', content: 'nope', now: new Date('2026-10-19T16:30:00Z') }),
      'directory_invalid',
    )
    assert(!existsSyncSafe(join(outsideDay, 'x.md')), 'save did not follow the junction')

    junctionWorkspace = mkdtempSync(join(tmpdir(), 'mom-docs-junc-'))
    assert(canLink(outsideDay, join(junctionWorkspace, 'MOM'), 'junction'), 'MOM junction')
    assert(listLibrary(junctionWorkspace).days.length === 0, 'junction MOM not listed')
    assertCode(() => readDocument(junctionWorkspace, '2026-10-20', 'outside.md', now), 'filename_invalid')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
    if (junctionWorkspace) rmSync(junctionWorkspace, { recursive: true, force: true })
  }
}

function existsSyncSafe(path: string): boolean {
  try {
    return readFileSync(path, 'utf8').includes('nope')
  } catch {
    return false
  }
}

function testStore(): void {
  const workspace = mkdtempSync(join(tmpdir(), 'mom-docs-'))
  try {
    assertCode(() => resolveWorkspaceDir('相对目录'), 'directory_invalid')
    assertCode(() => resolveWorkspaceDir(join(workspace, 'missing')), 'directory_invalid')
    assertCode(() => resolveWorkspaceDir(process.env.SystemRoot || 'C:\\Windows'), 'directory_invalid')

    const now = new Date('2026-10-21T15:30:00Z')
    const first = saveDocument({
      directory: workspace,
      filename: '周会纪要',
      title: '周会纪要',
      content: '第一版',
      now,
    })
    assert(first.date === '2026-10-21', 'save date')
    assert(first.relativePath === 'MOM/2026-10-21/周会纪要.md', 'relative path')
    assert(first.indexWritten === true, 'index written')
    assert(readFileSync(first.filePath, 'utf8') === '第一版\n', 'trailing newline')

    const second = saveDocument({
      directory: workspace,
      filename: '周会纪要.md',
      title: '周会纪要',
      content: '第二版',
      now,
    })
    assert(second.fileName === '周会纪要-2.md', 'no overwrite')
    assert(readFileSync(first.filePath, 'utf8') === '第一版\n', 'original unchanged')

    const crossed = saveDocument({
      directory: workspace,
      filename: '../../outside.md',
      title: '',
      content: '仍在 MOM 内',
      now,
    })
    assert(crossed.relativePath === 'MOM/2026-10-21/outside.md', 'traversal stays inside MOM')

    assertCode(
      () =>
        saveDocument({
          directory: workspace,
          filename: '空',
          title: '',
          content: '   ',
          now,
        }),
      'content_empty',
    )
    assertCode(
      () =>
        saveDocument({
          directory: workspace,
          filename: '太大.md',
          title: '',
          content: 'a'.repeat(MAX_BYTES),
          now,
        }),
      'content_too_large',
    )

    const listed = listDocuments(workspace, '', now)
    assert(listed.date === '2026-10-21', 'list today')
    assert(listed.items.length === 3, 'three files')
    const read = readDocument(workspace, '2026-10-21', '周会纪要-2.md', now)
    assert(read.content === '第二版\n', 'read second')
    assertCode(() => readDocument(workspace, '2026-10-21', '没有.md', now), 'filename_invalid')

    saveDocument({
      directory: workspace,
      filename: '次日.md',
      title: '次日',
      content: '第二天',
      now: new Date('2026-10-21T16:30:00Z'),
    })
    const library = listLibrary(workspace)
    assert(library.directory.length > 0, 'library directory')
    assert(library.days.map((day) => day.date).join(',') === '2026-10-22,2026-10-21', 'days newest first')
    assert(library.days[0]?.items[0]?.fileName === '次日.md', 'newest day file')
    assert(!library.days.some((day) => day.items.some((item) => item.fileName.startsWith('_'))), 'index hidden')
    const page = captureMom('GET', `/mom-docs/v1/files?directory=${encodeURIComponent(workspace)}`)
    assert(page.status === 200 && page.json.ok === true, 'http list')
    const workspaces = page.json.workspaces || []
    assert(workspaces.length === 1, 'http workspace')
    assert((workspaces[0]?.days || []).length === 2, 'http days')
    const denied = captureMom(
      'GET',
      `/mom-docs/v1/file?directory=${encodeURIComponent(workspace)}&date=2026-10-22&name=次日.md`,
      { 'sec-fetch-site': 'cross-site', 'x-dsh-mom-client': 'library' },
    )
    assert(denied.status === 403, 'cross-site denied')
    const opened = captureMom(
      'GET',
      `/mom-docs/v1/file?directory=${encodeURIComponent(workspace)}&date=2026-10-22&name=次日.md`,
    )
    assert(opened.status === 200 && opened.json.content === '第二天\n', 'http read')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

function captureMom(method: string, url: string, headers: Record<string, string> = {}) {
  let status = 0
  let body = ''
  handleMomRequest(
    {
      method,
      url,
      headers: {
        'x-dsh-mom-client': 'library',
        'sec-fetch-site': 'same-origin',
        host: '127.0.0.1',
        ...headers,
      },
    },
    {
      writeHead(code) {
        status = code
      },
      end(text) {
        body = text || ''
      },
    },
  )
  let json: { ok?: boolean; days?: unknown[]; content?: string; workspaces?: Array<{ directory?: string; days?: unknown[] }> } = {}
  try {
    json = JSON.parse(body) as { ok?: boolean; days?: unknown[]; content?: string; workspaces?: Array<{ directory?: string; days?: unknown[] }> }
  } catch {
    json = {}
  }
  return { status, json }
}

function testAllWorkspaces(): void {
  const root = mkdtempSync(join(tmpdir(), 'mom-docs-all-'))
  const first = join(root, 'alpha')
  const second = join(root, 'beta')
  const catalog = join(root, 'workspaces.txt')
  mkdirSync(first)
  mkdirSync(second)
  setWorkspaceCatalog(catalog)
  try {
    const now = new Date('2026-10-21T02:00:00Z')
    saveDocument({ directory: first, filename: '甲.md', title: '甲', content: '甲', now })
    saveDocument({ directory: second, filename: '乙.md', title: '乙', content: '乙', now })
    const listed = listLibraries([first, join(root, 'missing')])
    assert(listed.workspaces.length === 2, 'both saved workspaces')
    const files = listed.workspaces.flatMap((item) => item.days.flatMap((day) => day.items.map((file) => file.fileName))).sort()
    assert(files.join(',') === '乙.md,甲.md', 'each workspace keeps its own file')
    const page = captureMom('GET', `/mom-docs/v1/files?directory=${encodeURIComponent(first)}`)
    assert(page.status === 200 && page.json.workspaces?.length === 2, 'http keeps the other workspace')
  } finally {
    setWorkspaceCatalog(null)
    rmSync(root, { recursive: true, force: true })
  }
}

function main(): void {
  testDates()
  testNames()
  testStore()
  testEscapes()
  testAllWorkspaces()
  console.log('[mom-docs self-test] ok')
}

main()
