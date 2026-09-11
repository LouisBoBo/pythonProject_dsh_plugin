import { createHmac } from 'node:crypto'
import { parseWebhookPayload, secretsEqual, verifyGitHubSignature, verifyWebhookSecret } from './payload.js'
import { buildReportMarkdown } from './review-client.js'
import { HOOK_MARKER } from './config.js'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const localEv = parseWebhookPayload(
  { event: 'git-commit', local_path: '/tmp/demo-repo', commit: 'abc1234', branch: 'main', repo: 'demo-repo' },
  {},
)
assert(localEv.source === 'local' && localEv.localPath === '/tmp/demo-repo', 'local event')
assert(!localEv.skip, 'local should run')

const ping = parseWebhookPayload({ zen: 'pong' }, { 'x-github-event': 'ping' })
assert(ping.skip, 'github ping skip')

const gh = parseWebhookPayload(
  {
    after: 'deadbeef',
    ref: 'refs/heads/dev',
    repository: { full_name: 'org/app', name: 'app', clone_url: 'https://github.com/org/app.git' },
  },
  { 'x-github-event': 'push' },
)
assert(gh.source === 'github' && gh.branch === 'dev' && gh.cloneUrl?.includes('github.com'), 'github push')

const glDel = parseWebhookPayload(
  { object_kind: 'push', after: '0000000000000000000000000000000000000000', ref: 'refs/heads/gone', project: { name: 'p' } },
  { 'x-gitlab-event': 'Push Hook' },
)
assert(glDel.skip, 'gitlab delete skip')

const md = buildReportMarkdown({
  repo: 'demo',
  commit: 'abc',
  branch: 'main',
  source: 'local',
  reportId: 'cr-1',
  reply: '## 发现\n- 无阻塞问题',
  workspace: '/tmp/demo',
})
assert(md.includes('cr-1') && md.includes('无阻塞问题'), 'markdown')
assert(HOOK_MARKER.includes('dsh-remote-review'), 'hook marker')
assert(secretsEqual('abc', 'abc') && !secretsEqual('abc', 'abd'), 'secret compare')
assert(verifyWebhookSecret({ configuredSecret: '', headers: {}, listenHost: '127.0.0.1' }).ok, 'loopback empty secret')
assert(!verifyWebhookSecret({ configuredSecret: '', headers: {}, listenHost: '0.0.0.0' }).ok, 'non-loopback empty secret')
assert(
  !verifyWebhookSecret({
    configuredSecret: '',
    headers: {},
    listenHost: '127.0.0.1',
    requireSecret: true,
  }).ok,
  'requireSecret blocks empty',
)
{
  const body = '{"zen":"test"}'
  const secret = 'gh-secret'
  const sig = 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  assert(verifyGitHubSignature(secret, body, sig), 'github hmac ok')
  assert(
    verifyWebhookSecret({
      configuredSecret: secret,
      headers: { 'x-hub-signature-256': sig },
      listenHost: '0.0.0.0',
      requireSecret: true,
      rawBody: body,
    }).ok,
    'github header path ok',
  )
}
assert(parseWebhookPayload({ local_path: '/etc' }, {}).skip, 'bare local_path skip')

console.log('self-test ok')
