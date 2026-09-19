import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCatalog, publicCatalog } from './catalog.js'
import { matchSkill } from './prompt.js'
import { applyScene, clearSessionScene, loadState, setActiveExpert, setConnectorEnabled, summonExpert, summonScene, unsummonExpert, unsummonScene } from './store.js'
import { createUserScene, reviewSceneCombo, suggestCombo } from './scenes.js'
import { queryMes } from './adapters/mes.js'
import { searchDify } from './adapters/dify.js'
import { sendWecom, normalizeWecomKey } from './adapters/wecom.js'
import { normalizeWikiToken, writeFeishuWiki } from './adapters/feishu.js'
import { assertPublicHttpUrl } from './adapters/web_read.js'
import { mockQuery } from './adapters/mock-data.js'
import { parseFrontMatter, sanitizeMdCaption, sanitizeMdImageUrl, writeJsonAtomic } from './util.js'
import { emptyState } from './store.js'
import { parseChartSeries, normalizeChartType, buildGptVisPayload, parseGptVisBody } from './adapters/mcp_chart.js'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

async function main() {
  {
    const { meta, body } = parseFrontMatter('---\nid: a\ntriggers:\n  - 售后工单\n  - WO-\n---\nhello')
    assert(meta.id === 'a', 'front matter id')
    assert(Array.isArray(meta.triggers) && (meta.triggers as string[]).includes('WO-'), 'list triggers')
    assert(body === 'hello', 'body')
    const emptyList = parseFrontMatter('---\nid: a\nrequiredConnectorIds: []\n---\nx')
    assert(Array.isArray(emptyList.meta.requiredConnectorIds) && (emptyList.meta.requiredConnectorIds as unknown[]).length === 0, 'empty yaml list')
  }

  {
    const catalog = loadCatalog()
    assert(catalog.experts.length === 6, `experts ${catalog.experts.length}`)
    assert(catalog.experts.some((s) => s.id === 'pcb-data-analyst'), 'pcb analyst')
    assert(catalog.skills.some((s) => s.id === 'mes-ops-analysis'), 'mes ops skill')
    assert(catalog.skills.some((s) => s.id === 'mes-wo-trace'), 'wo trace skill')
    assert(catalog.skills.some((s) => s.id === 'mes-material-kitting'), 'kitting skill')
    assert(catalog.skills.some((s) => s.id === 'mes-wip-bottleneck'), 'wip skill')
    assert(catalog.skills.some((s) => s.id === 'mes-yield-defect'), 'yield skill')
    assert(catalog.skills.some((s) => s.id === 'mes-oee-capacity'), 'oee skill')
    assert(catalog.skills.length === 9, `skills ${catalog.skills.length}`)
    const pub = publicCatalog()
    assert(typeof pub.pluginVersion === 'string' && pub.pluginVersion.length > 0, 'plugin version')
    const wo = pub.skills.find((s) => s.id === 'mes-wo-trace')
    assert(wo && typeof wo.sop === 'string' && wo.sop.includes('工单'), 'skill sop in catalog')
    assert(catalog.connectors.some((s) => s.id === 'mcp-chart'), 'mcp chart')
    assert(catalog.connectors.some((s) => s.id === 'mcp-wecom'), 'wecom')
    assert(catalog.connectors.some((s) => s.id === 'mcp-feishu'), 'feishu')
    assert(catalog.connectors.some((s) => s.id === 'mcp-web-read'), 'web read')
    assert(catalog.connectors.length === 6, `connectors ${catalog.connectors.length}`)
    assert(catalog.scenes[0].id === 'pcb-ops-analysis', 'trial scene first')
    assert(catalog.scenes.length === 4, 'four scenes')
    for (const s of catalog.scenes) {
      assert(s.skillIds.length <= 3, `${s.id} skills cap`)
      assert(s.connectorIds.length <= 3, `${s.id} connectors cap`)
      const r = reviewSceneCombo(s.expertId, s.skillIds, s.connectorIds, { existing: catalog.scenes.filter((x) => x.id !== s.id) })
      assert(r.ok, `${s.id} review ${r.errors.map((e) => e.message).join(';')}`)
    }
    const tooMany = reviewSceneCombo('pcb-data-analyst', ['mes-ops-analysis', 'after-sales-ticket', 'test-case-gen', 'office-minutes'], ['mes'])
    assert(!tooMany.ok && tooMany.errors.some((e) => e.code === 'too_many_skills'), 'cap 3 skills')
    const missing = reviewSceneCombo('after-sales-expert', ['after-sales-ticket'], [])
    assert(!missing.ok && missing.errors.some((e) => e.code === 'missing_required_connector'), 'required connector')
    const dup = reviewSceneCombo('pcb-data-analyst', ['mes-ops-analysis'], ['mes', 'mcp-chart'], { existing: catalog.scenes })
    assert(!dup.ok && dup.errors.some((e) => e.code === 'duplicate_combo'), 'dup builtin')
  }

  {
    const enabled = ['after-sales-ticket', 'test-case-gen', 'mes-ops-analysis']
    assert(matchSkill('请分析工单 WO-1', enabled, null) === 'after-sales-ticket', 'wo trigger')
    assert(matchSkill('帮我出测试用例', enabled, null) === 'test-case-gen', 'test trigger')
    assert(matchSkill('请出生产运营分析', enabled, null) === 'mes-ops-analysis', 'ops trigger')
    assert(matchSkill('今天天气如何', enabled, null) === null, 'no match')
    assert(matchSkill('随便说说', enabled, 'test-case-gen') === 'test-case-gen', 'pinned')
    const mesPack = ['after-sales-ticket', 'mes-wo-trace', 'mes-oee-capacity', 'mes-yield-defect', 'mes-material-kitting']
    assert(matchSkill('工单追溯 WO-1', mesPack, null) === 'mes-wo-trace', 'longer trigger wins')
    assert(matchSkill('看一下 OEE 和稼动率', mesPack, null) === 'mes-oee-capacity', 'oee skill')
    assert(matchSkill('缺料会不会停 SMT', mesPack, null) === 'mes-material-kitting', 'kitting trigger')
    assert(matchSkill('虚焊落在哪道工序', mesPack, null) === 'mes-yield-defect', 'defect trigger')
  }

  {
    const r = mockQuery('work_order', 'WO-20260918-01')
    assert(r.ok && r.source === 'mock', 'mock wo')
    const miss = mockQuery('work_order', 'WO-NONE')
    assert(miss.ok && JSON.stringify(miss.data).includes('items'), 'mock miss empty items')
    const oee = mockQuery('oee', '')
    assert(oee.ok && JSON.stringify(oee.data).includes('availability'), 'mock oee')
    const inv = mockQuery('inventory', '')
    assert(inv.ok && JSON.stringify(inv.data).includes('白光 LED'), 'mock inventory')
  }

  {
    assert(normalizeChartType('pie') === 'pie', 'chart pie')
    assert(normalizeChartType('funnel') === 'funnel', 'chart funnel')
    assert(normalizeChartType('dual-axes') === 'dual-axes', 'chart dual')
    assert(normalizeChartType('cancel') === null, 'chart reject junk')
    const series = parseChartSeries('贴片,焊接,AOI', '97.8,97.9,98.1')
    assert(!('error' in series) && series.length === 3, 'chart series')
    const pts = series as { label: string; value: number }[]
    const payload = buildGptVisPayload('bar', '工序良率', pts)
    assert(payload.type === 'bar' && payload.theme === 'academy', 'vis type')
    const radar = buildGptVisPayload('radar', '工序雷达', pts)
    assert(Array.isArray(radar.data) && (radar.data as { name: string }[])[0].name === '贴片', 'radar name')
    const plan = parseChartSeries('贴片,焊接,AOI', '100,100,100') as { label: string; value: number }[]
    const dual = buildGptVisPayload('dual-axes', '计划vs实际', pts, plan)
    const dualSeries = dual.series as Array<{ type: string; data: number[] }>
    assert(Array.isArray(dual.categories) && dualSeries.length === 2 && dualSeries[0].type === 'column', 'dual axes')
    const funnel = buildGptVisPayload('funnel', '缺陷漏斗', pts)
    assert(funnel.type === 'funnel', 'funnel type')
    const bad = parseChartSeries('A', '1,2')
    assert('error' in bad, 'series mismatch')
    const visOk = parseGptVisBody({ resultObj: 'https://cdn.example.com/chart.png' })
    assert(visOk.ok && (visOk.data as { imageUrl: string }).imageUrl === 'https://cdn.example.com/chart.png', 'vis https')
    const visInj = parseGptVisBody({ resultObj: 'https://cdn.example.com/a.png)![x](https://evil' })
    assert(!visInj.ok, 'vis reject markdown break')
    const visLan = parseGptVisBody({ resultObj: 'https://127.0.0.1/chart.png' })
    assert(!visLan.ok, 'vis reject loopback image')
    const visHttp = parseGptVisBody({ resultObj: 'http://cdn.example.com/chart.png' })
    assert(!visHttp.ok, 'vis https only')
    assert(sanitizeMdCaption('良率](http://x)\n下一行') === '良率 http://x 下一行', 'caption stripped')
    assert(sanitizeMdImageUrl('https://a.com/x.png) ') === '', 'image url paren')
  }

  const dir = mkdtempSync(join(tmpdir(), 'dsh-esc-'))
  const prevWb = process.env.WORKBUDDY_CONFIG_YAML
  process.env.WORKBUDDY_CONFIG_YAML = '-'
  try {
    const before = emptyState()
    assert(before.connectors.mes.enabled === false, 'mes default off')
    assert(before.connectors['mcp-chart']?.enabled === false, 'chart default off')
    const applied = await applyScene(dir, 'after-sales-ticket')
    assert(applied.activeExpertId === 'after-sales-expert', 'scene expert')
    assert(applied.skills['after-sales-ticket']?.enabled === true, 'scene skill')
    assert(applied.connectors.mes.enabled === true, 'scene mes on')
    assert(applied.summonedSceneIds.includes('after-sales-ticket'), 'summoned after-sales')
    const ops = await applyScene(dir, 'pcb-ops-analysis')
    assert(ops.summonedSceneIds.includes('after-sales-ticket') && ops.summonedSceneIds.includes('pcb-ops-analysis'), 'keep summoned history')
    assert(ops.activeSceneId === 'pcb-ops-analysis', 'ops scene id')
    assert(ops.pinnedSkillId === 'mes-ops-analysis', 'ops skill pinned')
    assert(ops.skills['mes-ops-analysis']?.enabled === true, 'ops skill')
    assert(ops.connectors.mes.enabled === true, 'ops mes')
    assert(ops.connectors['mcp-chart']?.enabled === true, 'ops chart')
    assert(ops.connectors['mcp-chart']?.mode === 'http', 'chart http')
    assert(ops.skills['after-sales-ticket']?.enabled !== true, 'other skills off')
    assert(ops.connectors.dify.enabled !== true, 'other connectors off')
    assert(ops.connectors['mcp-wecom']?.enabled !== true, 'ops wecom off')
    assert(ops.connectors['mcp-feishu']?.enabled !== true, 'ops feishu off')
    const cleared = await setActiveExpert(dir, null)
    assert(cleared.activeExpertId === null, 'clear expert')
    const sessBound = await applyScene(dir, 'pcb-ops-analysis', 'chat-1')
    assert(sessBound.sessions['chat-1']?.sceneId === 'pcb-ops-analysis', 'session scene')
    assert(sessBound.sessions['chat-1']?.skillIds.includes('mes-ops-analysis'), 'session skills')
    const clearedSess = await clearSessionScene(dir, 'chat-1')
    assert(clearedSess.sessions['chat-1']?.sceneId === null, 'session scene clear')
    let blocked = false
    try {
      await applyScene(dir, 'test-case-gen', 'chat-2')
    } catch (e) {
      blocked = String(e).indexOf('召唤') >= 0
    }
    assert(blocked, 'dialog only summoned scenes')
    const extra = await summonScene(dir, 'test-case-gen')
    assert(extra.summonedSceneIds.includes('test-case-gen') && extra.summonedSceneIds.includes('pcb-ops-analysis'), 'summon keeps others')
    assert(extra.activeSceneId !== 'test-case-gen', 'summon does not mark in-use')
    const dropped = await unsummonScene(dir, 'test-case-gen')
    assert(!dropped.summonedSceneIds.includes('test-case-gen'), 'unsummon removes')
    assert(dropped.summonedSceneIds.includes('after-sales-ticket'), 'unsummon keeps others')
    const boundThen = await applyScene(dir, 'pcb-ops-analysis', 'chat-unsummon')
    assert(boundThen.sessions['chat-unsummon']?.sceneId === 'pcb-ops-analysis', 'bind before unsummon')
    const afterUn = await unsummonScene(dir, 'pcb-ops-analysis')
    assert(afterUn.sessions['chat-unsummon']?.sceneId === null, 'unsummon clears session bind')
    assert(!afterUn.summonedSceneIds.includes('pcb-ops-analysis'), 'pcb unsummoned')
    const resurrect = await applyScene(dir, 'after-sales-ticket')
    assert(resurrect.summonedSceneIds.includes('after-sales-ticket'), 'reapply summons')
    const unAfter = await unsummonScene(dir, 'after-sales-ticket')
    assert(!unAfter.summonedSceneIds.includes('after-sales-ticket'), 'unsummon applied scene')
    const reread = loadState(dir)
    assert(!reread.summonedSceneIds.includes('after-sales-ticket'), 'unsummon survives reread')
    const twoEx = await summonExpert(dir, 'pcb-data-analyst')
    assert(twoEx.summonedExpertIds.includes('pcb-data-analyst'), 'summon second expert')
    const moreEx = await summonExpert(dir, 'test-expert')
    assert(moreEx.summonedExpertIds.includes('pcb-data-analyst') && moreEx.summonedExpertIds.includes('test-expert'), 'keep multiple experts')
    const dropEx = await unsummonExpert(dir, 'test-expert')
    assert(!dropEx.summonedExpertIds.includes('test-expert') && dropEx.summonedExpertIds.includes('pcb-data-analyst'), 'unsummon one expert')
    const rereadEx = loadState(dir)
    assert(!rereadEx.summonedExpertIds.includes('test-expert') && rereadEx.summonedExpertIds.includes('pcb-data-analyst'), 'expert unsummon survives reread')
    const created = createUserScene(dir, {
      title: '夜班库存',
      expertId: 'pm-assistant',
      skillIds: ['office-minutes'],
      connectorIds: [],
    })
    assert(created.scene.id.startsWith('user-'), 'user scene id')
    const suggested = suggestCombo(ops, dir)
    assert(suggested && suggested.matchesSceneId === 'pcb-ops-analysis', 'suggest matches scene')
    const st = loadState(dir)
    const mesOff = { ...st.connectors.mes, enabled: false }
    const disabled = await queryMes(mesOff, 'work_order', 'WO-1')
    assert(disabled.code === 'connector_disabled', 'mes disabled')
    const mesMock = { ...st.connectors.mes, enabled: true, mode: 'mock' as const }
    const ok = await queryMes(mesMock, 'work_order', 'WO-20260918-01')
    assert(ok.ok && ok.source === 'mock', 'mes mock query')
    const badKind = await queryMes(mesMock, '取消', 'x')
    assert(badKind.code === 'invalid_kind', 'kind enum')
    const invKind = await queryMes(mesMock, 'inventory', '')
    assert(invKind.ok && invKind.source === 'mock', 'mes mock inventory')
    const dify = await searchDify({ ...st.connectors.dify, enabled: true, datasetId: '' }, '对策')
    assert(dify.code === 'connector_unconfigured', 'dify no dataset')
    const wecom = await sendWecom({ ...st.connectors['mcp-wecom'], enabled: true, mode: 'http' }, '测试')
    assert(wecom.code === 'outbound_not_armed', 'wecom needs panel arm')
    const wecomArmed = await sendWecom(
      { ...st.connectors['mcp-wecom'], enabled: true, outboundArmed: true, mode: 'http' },
      '测试',
    )
    assert(wecomArmed.code === 'connector_unconfigured', 'wecom no key')
    const feishu = await writeFeishuWiki(
      { ...st.connectors['mcp-feishu'], enabled: true, mode: 'http' },
      '标题',
      '正文',
      'https://xxx.feishu.cn/wiki/NodeToken',
    )
    assert(feishu.code === 'outbound_not_armed', 'feishu needs panel arm')
    assert(normalizeWecomKey('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc') === 'abc', 'wecom key')
    assert(normalizeWikiToken('https://xxx.feishu.cn/wiki/NodeToken?from=space') === 'NodeToken', 'wiki token')
    let ssrf = false
    try {
      assertPublicHttpUrl('http://127.0.0.1/secret')
    } catch {
      ssrf = true
    }
    assert(ssrf, 'block localhost')
    let ssrfNum = false
    try {
      assertPublicHttpUrl('http://2130706433/')
    } catch {
      ssrfNum = true
    }
    assert(ssrfNum, 'block decimal ipv4')
    let ssrfTen = false
    try {
      assertPublicHttpUrl('http://10.1.2.3/x')
    } catch {
      ssrfTen = true
    }
    assert(ssrfTen, 'block rfc1918')
    const armed = await setConnectorEnabled(dir, 'mcp-wecom', true)
    assert(armed.connectors['mcp-wecom']?.outboundArmed === true, 'panel enable arms wecom')
    assert(armed.connectors['mcp-wecom']?.mode === 'http', 'panel enable http')
    const modelBind = await applyScene(dir, 'pcb-ops-analysis')
    assert(modelBind.connectors['mcp-wecom']?.enabled !== true, 'model scene without wecom disables it')
    const uiBind = await applyScene(dir, 'pcb-ops-analysis', undefined, { armOutbound: true })
    assert(uiBind.connectors['mcp-wecom']?.outboundArmed !== true, 'ui scene without wecom disarms')
    const secretFile = join(dir, 'state.json')
    writeJsonAtomic(secretFile, loadState(dir))
    const mode = statSync(secretFile).mode & 0o777
    assert(mode === 0o600, `state.json mode ${mode.toString(8)}`)
    const disk = JSON.parse(readFileSync(secretFile, 'utf8')) as {
      connectors: Record<string, { token?: string; password?: string; apiKey?: string }>
    }
    const wecomDisk = disk.connectors['mcp-wecom']
    assert(!wecomDisk?.token && !wecomDisk?.password && !wecomDisk?.apiKey, 'wecom secrets not persisted')
  } finally {
    if (prevWb === undefined) delete process.env.WORKBUDDY_CONFIG_YAML
    else process.env.WORKBUDDY_CONFIG_YAML = prevWb
    rmSync(dir, { recursive: true, force: true })
  }

  console.log('[esc self-test] ok')
}

void main()
