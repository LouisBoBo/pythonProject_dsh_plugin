/**
 * DSH 客户端面：设置页「Cursor 对话写码」+ zr_cchat_begin / continue / wait 交互卡。
 * 挂官方插槽 settings.section / tool.call.toolview；不自造壳。
 * 立刻开工 → SSE 进度卡（无确认卡）；过程区不限高随聊天上滚。
 * BUILD_MARK: cc-0.3.42-turn-tail-conclusion
 */
window.__ModuleLoader__.load({
  id: '@zhongruan/dsh-cursor-chat',
  factory: (require) => {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useRef = React.useRef

    var SECRET_MASK = '••••••••••••'
    var LS_PORT = 'dsh-cursor-chat-port'
    var LS_HOST = 'dsh-cursor-chat-host'

    function servicePort() {
      try {
        var p = localStorage.getItem(LS_PORT)
        if (p && /^\d+$/.test(p)) return p
      } catch (e) {}
      return '18791'
    }

    function serviceHost() {
      try {
        var x = localStorage.getItem(LS_HOST)
        if (x) return x
      } catch (e) {}
      return '127.0.0.1'
    }

    function serviceBase() {
      var host = serviceHost()
      var port = servicePort()
      if (port === '80') return 'http://' + host
      return 'http://' + host + ':' + port
    }

    /** 剪贴板写入：API 失败时用 textarea+execCommand 兜底（DSH 内嵌页常见） */
    function copyTextViaTextarea(text) {
      var t = String(text || '')
      if (!t) return false
      var ta = document.createElement('textarea')
      ta.value = t
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.top = '0'
      ta.style.left = '-9999px'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      var ok = false
      try {
        ta.focus()
        ta.select()
        ta.setSelectionRange(0, t.length)
        ok = document.execCommand('copy')
      } catch (e) {
        ok = false
      }
      try {
        document.body.removeChild(ta)
      } catch (e2) {}
      return ok
    }

    function copyTextToClipboard(text) {
      var t = String(text || '')
      if (!t) return Promise.resolve(false)
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          return navigator.clipboard.writeText(t).then(
            function () {
              return true
            },
            function () {
              return copyTextViaTextarea(t)
            },
          )
        } catch (e) {
          return Promise.resolve(copyTextViaTextarea(t))
        }
      }
      return Promise.resolve(copyTextViaTextarea(t))
    }

    function buildDialogTextFromTranscript(items) {
      var parts = []
      var prevAsst = []
      ;(items || []).forEach(function (it) {
        if (!it) return
        if (it.kind === 'thinking') parts.push('【Thinking】\n' + (it.text || ''))
        else if (it.kind === 'assistant') {
          var shown = refineAssistantSegmentTextClient(it.text || '', prevAsst)
          if (!shown) return
          prevAsst.push(String(it.text || ''))
          parts.push('【Assistant】\n' + shown)
        } else if (it.kind === 'user') parts.push('【You】\n' + (it.text || ''))
        else if (it.kind === 'status') {
          var sm = normalizeStatusDisplayClient(it.text || '')
          if (sm) parts.push('【状态】' + sm)
        } else if (it.kind === 'tool') {
          var line =
            '【Tool】' +
            (it.name || '') +
            ' ' +
            (it.tool_status || '') +
            (it.path ? ' path=' + it.path : '') +
            (it.pattern ? ' pattern=' + it.pattern : '') +
            (it.command ? ' cmd=' + it.command : '')
          if (it.snippet) line += '\n' + String(it.snippet)
          parts.push(line)
        }
      })
      return parts.join('\n\n').trim()
    }

    function looksLikeFinalPlanBodyClient(text) {
      var s = String(text || '').trim()
      if (!s) return false
      if (/^\*\*结论[：:]?\*\*/.test(s)) return true
      if (/^结论[：:]/.test(s)) return true
      var hits = 0
      if (/\*\*结论[：:]?\*\*/.test(s)) hits++
      if (/\*\*改动文件/.test(s)) hits++
      if (/\*\*说明[：:]?\*\*/.test(s)) hits++
      if (/\*\*验收步骤[：:]?\*\*/.test(s)) hits++
      if (/验收步骤[：:]/.test(s)) hits++
      return hits >= 2
    }

    function stripFinalPlanSectionClient(text) {
      var t = String(text || '')
      var markers = [/##\s*说明方案/, /##\s*本轮结论/, /##\s*Git\s*交付结论/, /【本轮结论】/]
      var cut = -1
      for (var i = 0; i < markers.length; i++) {
        var m = t.match(markers[i])
        if (m && m.index != null && (cut < 0 || m.index < cut)) cut = m.index
      }
      if (cut === 0) return ''
      if (cut > 0) t = t.slice(0, cut)
      t = t.trim()
      t = t.replace(/^#{1,6}\s*(?:\n+|$)/, '').trim()
      if (!t || /^#{1,6}\s*$/.test(t)) return ''
      if (looksLikeFinalPlanBodyClient(t)) return ''
      return t
    }

    function stripRepeatedAssistantPrefixClient(previous, current) {
      var prev = String(previous || '').trim()
      var curr = String(current || '').trim()
      if (!curr) return ''
      if (!prev) return curr
      if (curr === prev) return ''
      if (curr.indexOf(prev) === 0) return curr.slice(prev.length).replace(/^\s+/, '')
      return curr
    }

    function refineAssistantSegmentTextClient(incoming, previousTexts) {
      var t = stripFinalPlanSectionClient(incoming)
      if (!t) return ''
      var list = previousTexts || []
      for (var i = list.length - 1; i >= 0; i--) {
        var next = stripRepeatedAssistantPrefixClient(list[i] || '', t)
        if (next !== t) {
          t = next
          break
        }
      }
      t = stripFinalPlanSectionClient(t)
      if (!t) return ''
      if (looksLikeFinalPlanBodyClient(t)) return ''
      if (
        /##\s*说明方案/.test(t) ||
        /##\s*本轮结论/.test(t) ||
        /##\s*Git\s*交付结论/.test(t) ||
        /【本轮结论】/.test(t)
      )
        return ''
      // 模型复述写码/Git 三段式（任务结果+具体行为）时整段丢掉，避免与 turnTail 结论双份
      if (/任务结果/.test(t) && /具体行为|如何继续|和上一轮的关联/.test(t)) return ''
      return t
    }

    function normalizeStatusDisplayClient(message) {
      var msg = String(message || '').trim()
      if (!msg) return ''
      if (/^RUNNING$/i.test(msg)) return 'Cursor 运行中，请稍候…'
      return String(message || '')
    }

    /** 审码进度是同一条：「正在审码本批」和「正在审码（3/8）」都算这一条。 */
    function isReviewProgressLine(text) {
      return /正在审码（\s*\d+\s*\/\s*\d+\s*）|正在审码本批/.test(String(text || ''))
    }

    /** 与 workKind.ts 同一口径。账本 work_kind=code 时一律保持写码。 */
    function looksLikeOpsOnlyClient(message) {
      var t = String(message || '').replace(/\s+/g, '')
      if (!t) return false
      var code = t.replace(/不要改代码|不改代码|别改代码|无需改代码|不要改文件|别改文件|不要改任何文件/g, '')
      if (/(新增|增加|添加|新建|修改|修复|实现|重构|优化)/.test(code)) return false
      if (/(改|修)(一下|下|成|为|掉|这个|页面|接口|代码|样式|按钮|字段|文案|bug)/i.test(code)) return false
      if (/(删除|去掉|移除|下线)/.test(code) && /(页面|菜单|接口|文件|代码|字段|路由|函数|组件)/.test(code)) {
        return false
      }
      if (/(新增一列|加一列|增加一列|多一列|加列|增列)/.test(code)) return false
      if (/(重启|重新启动|重开|拉起|启动).{0,8}(前端|后端|服务|前后端|项目|dev)/i.test(t)) return true
      if (/(前端|后端|前后端|服务).{0,6}(重启|重新启动|重开|拉起)/.test(t)) return true
      if (/^(请|帮我|帮忙|麻烦)?(把)?(前端|后端|前后端|服务|项目)?(重启|重新启动|重开|启动|拉起)(一下|下|前后端|前端|后端|服务|项目)?$/.test(t)) {
        return true
      }
      if (/把(项目|服务|前后端|前端|后端)跑起来/.test(t)) return true
      if (/(跑|执行|运行).{0,4}(测试|单测)/.test(t)) return true
      // 与 workKind.opsLooksLikeInstall / Troubleshoot 同口径（此处仅影响进度卡文案）
      if (/(安装|装).{0,6}(依赖|deps|packages?|包)/i.test(t)) return true
      if (/依赖.{0,6}(安装|装上|装一下|没装|缺失|不全)/.test(t)) return true
      if (/npminstall|npmi|pnpminstall|pnpmi|yarninstall|yarnadd|pipinstall|uvsync|poetryinstall/i.test(t)) {
        return true
      }
      if (/(看|查|查看|读).{0,6}日志/.test(t)) return true
      if (/(查|看|检查).{0,4}环境/.test(t)) return true
      if (/排障|排查/.test(t)) return true
      if (/(定位|诊断).{0,6}(问题|报错|错误|异常|原因)/.test(t)) return true
      if (/为什么.{0,10}(报错|失败|起不来|挂了|不行)/.test(t)) return true
      if (/(启动|重启).{0,8}(失败|报错|错误|异常|不了)/.test(t)) return true
      if (/起不来/.test(t)) return true
      return false
    }

    function serviceRunCard(requirement, workKind) {
      if (workKind === 'code') return false
      if (workKind === 'ops') return true
      return looksLikeOpsOnlyClient(requirement)
    }

    var TERMINAL_JOB = {
      succeeded: 1,
      failed: 1,
      cancelled: 1,
      blocked_no_runner: 1,
    }

    /** 与 cardBootstrap.preferJobStatus 一致：工具终态优先于缓存 running */
    function preferJobStatus(cacheStatus, uiStatus) {
      var cache = String(cacheStatus || '').trim()
      var uiSt = String(uiStatus || '').trim()
      if (TERMINAL_JOB[uiSt]) return uiSt
      if (TERMINAL_JOB[cache]) return cache
      if (uiSt === 'pending_review') return uiSt
      if (cache === 'pending_review') return cache
      return cache || uiSt
    }

    function shouldApplyJobSnapshot(sealedStatus, incomingStatus) {
      var sealed = String(sealedStatus || '').trim()
      var incoming = String(incomingStatus || '').trim()
      if (!TERMINAL_JOB[sealed]) return true
      if (TERMINAL_JOB[incoming]) return true
      return false
    }

    function sseMayForceRunning(sealedStatus) {
      return !TERMINAL_JOB[String(sealedStatus || '').trim()]
    }

    function cardVisiblePhase(opts) {
      var o = opts || {}
      if (o.cancelled || o.toolCancelled) return 'done'
      // 工具已结束且本卡无 job：禁止再显示 form「正在开工」转圈（重开已停止会话的典型脏态）
      if (o.idleSettled && (o.phase === 'form' || !String(o.liveJobId || '').trim())) return 'done'
      var live = String(o.liveJobId || '').trim()
      var resultJob = String(o.resultJobId || '').trim()
      var resultMatches = !live || !resultJob || resultJob === live
      var resultSt = o.resultDone === true && resultMatches ? String(o.resultStatus || '').trim() : ''
      var auth = preferJobStatus(preferJobStatus(String(o.sealedStatus || ''), resultSt), String(o.uiStatus || ''))
      if (TERMINAL_JOB[auth]) return 'done'
      return o.phase
    }

    function readToolJobFields(value) {
      var empty = { jobId: '', status: '', done: false, detail: '', chatBody: '' }
      var seen = []
      function walk(v, depth) {
        if (v == null || depth > 4) return empty
        if (typeof v === 'string') {
          var t = String(v).trim()
          if (t.charAt(0) !== '{' && t.charAt(0) !== '[') return empty
          try {
            return walk(JSON.parse(t), depth + 1)
          } catch (e) {
            return empty
          }
        }
        if (typeof v !== 'object') return empty
        for (var i = 0; i < seen.length; i++) if (seen[i] === v) return empty
        seen.push(v)
        var ui = v.cursor_chat_ui && typeof v.cursor_chat_ui === 'object' ? v.cursor_chat_ui : null
        var jobId = String((v.job_id || (ui && ui.job_id) || '')).trim()
        var status = String((v.status || (ui && ui.status) || '')).trim()
        var done = v.done === true
        var detail = String(v.detail || '').trim()
        var chatBody = String(v.chat_body || v.chat_conclusion || '').trim()
        if (jobId || status || done || chatBody) {
          return { jobId: jobId, status: status, done: done, detail: detail, chatBody: chatBody }
        }
        var keys = ['result', 'value', 'output', 'data', 'json']
        for (var k = 0; k < keys.length; k++) {
          var inner = walk(v[keys[k]], depth + 1)
          if (inner.jobId || inner.status || inner.done || inner.chatBody) return inner
        }
        if (Array.isArray(v.content)) {
          for (var c = 0; c < v.content.length; c++) {
            var block = v.content[c]
            if (!block || typeof block !== 'object') continue
            var fromText = walk(block.text, depth + 1)
            if (fromText.jobId || fromText.status || fromText.done || fromText.chatBody) return fromText
          }
        }
        return empty
      }
      return walk(value, 0)
    }

    function sealTranscriptItems(items) {
      if (!Array.isArray(items)) return items
      return items.map(function (it) {
        return it && it.streaming ? Object.assign({}, it, { streaming: false }) : it
      })
    }

    /** 仅认 DSH tool block 权威错误字段；禁止扫用户可见正文（原话/结论含「取消」会误杀） */
    function toolBlockCancelled(block) {
      if (!block) return false
      var err = block.error && typeof block.error === 'object' ? block.error : {}
      var code = String(err.code || block.code || block.errorCode || '')
        .trim()
        .toLowerCase()
      if (code === 'interrupted' || code === 'cancelled' || code === 'aborted') return true
      // 宿主点「停止」常见：isError + error.name/message 为 aborted，不一定有 code
      if (block.isError === true) {
        var name = String(err.name || err.type || '')
          .trim()
          .toLowerCase()
        if (
          name === 'aborterror' ||
          name === 'aborted' ||
          name === 'cancelled' ||
          name === 'interrupted' ||
          /^abort/.test(name)
        ) {
          return true
        }
        var msg = String(err.message || '')
          .trim()
          .toLowerCase()
        if (msg === 'aborted' || msg === 'cancelled' || msg === 'interrupted' || msg === 'tool call aborted') {
          return true
        }
      }
      return false
    }

    function toolBlockSettled(block) {
      if (!block) return false
      var kind = String(block.kind || '')
      // 进行中的 tool-call 即使残留旧 result 也不算本跳终态
      if (kind === 'tool-call' || kind === 'tool.call') {
        // 已停止会话：进行中调用被标 isError/aborted 也算终态
        if (toolBlockCancelled(block) || block.isError === true) return true
        return false
      }
      if (kind === 'tool-result' || kind === 'tool.result') return true
      if (block.isError === true) return true
      if (toolBlockCancelled(block)) return true
      if (block.result || block.value) return true
      return false
    }

    function phaseFromJobStatus(st, detail, inScopeLen, reviewGate) {
      var s = String(st || '').trim()
      if (TERMINAL_JOB[s]) return 'done'
      if (s === 'pending_review') {
        var gate = String(reviewGate || '').trim()
        var n = typeof inScopeLen === 'number' ? inScopeLen : -1
        // 只认 review_gate / 范围内数量；旧账本仅全等编排器固定 detail
        if (gate === 'auto_applying') return 'running'
        if (gate === 'auto_failed') return 'review'
        if (gate === 'await_user') return n === 0 ? 'done' : 'review'
        if (detail === '自动同步中…') return 'running'
        if (n === 0) return 'done'
        if (n > 0) return 'review'
        return 'running'
      }
      if (s) return 'running'
      return 'form'
    }

    /** 展示用结论：只认账本 chat_conclusion（formatChatConclusion），禁止拼原始 assistant 造成双份正文 */
    function conclusionFromJob(job) {
      if (!job) return ''
      var ready = String(job.chat_conclusion || '').trim()
      if (!ready) return ''
      return concludeMdForWorkKind(ready, job.work_kind)
    }

    /** 写码停止兜底：永远「本轮结论」，禁止套 Git 文案 */
    function codingStoppedConclusionMd() {
      return '## 本轮结论\n\n结果：⏹ 已停止。用户停止了本轮任务。\n\n改动：\n• 本轮未继续写码\n'
    }

    /** 提交代码停止兜底：永远「Git 交付结论」，禁止套写码文案 */
    function gitStoppedConclusionMd() {
      return '## Git 交付结论\n\n结果：⏹ 已取消 Git 交付。工作区改动仍在，未执行 commit。\n\n说明：\n• 用户停止\n'
    }

    function stoppedConclusionMd(workKind) {
      return String(workKind || '') === 'git_deliver'
        ? gitStoppedConclusionMd()
        : codingStoppedConclusionMd()
    }

    /**
     * 按 work_kind 钉死结论标题：写码/ops → 本轮结论；git_deliver → Git 交付结论。
     * 禁止两套结论标题互相冒充。
     */
    function concludeMdForWorkKind(md, workKind) {
      var t = normalizeConclusionMd(String(md || '').trim())
      if (!t) return ''
      var git = String(workKind || '') === 'git_deliver'
      if (git) {
        if (/##\s*Git\s*交付结论/.test(t)) return t
        if (/##\s*本轮结论/.test(t)) return t.replace(/##\s*本轮结论/, '## Git 交付结论')
        return '## Git 交付结论\n\n' + t
      }
      if (/##\s*本轮结论/.test(t)) return t
      if (/##\s*Git\s*交付结论/.test(t)) return t.replace(/##\s*Git\s*交付结论/, '## 本轮结论')
      return t
    }

    /** 同一段 md 里若被刷了两遍结论标题，只留一份；写码认「本轮结论」，Git 认「Git 交付结论」 */
    function normalizeConclusionMd(md) {
      var t = String(md || '').trim()
      if (!t) return ''
      // 不用 \b：中文后 word-boundary 在 JS 不可靠
      var parts = t.split(/\n(?=##\s*(?:本轮结论|Git\s*交付结论))/)
      if (parts.length <= 1) return t
      var best = parts[0]
      var bestScore = 0
      for (var i = 0; i < parts.length; i++) {
        var p = String(parts[i] || '').trim()
        if (!p) continue
        var score = 0
        if (/结果：/.test(p)) score += 2
        if (/改动：/.test(p)) score += 2
        if (/验收：/.test(p)) score += 2
        if (/Git\s*交付结论/.test(p)) score += 1
        // 偏好干净三段式，惩罚模型乱表/管道符长文
        if ((p.match(/\|/g) || []).length > 4) score -= 3
        if (score > bestScore || (score === bestScore && p.length < best.length)) {
          best = p
          bestScore = score
        }
      }
      return best
    }

    function labelFromJobStatus(st, detail, inScopeLen, reviewGate) {
      var s = String(st || '').trim()
      if (s === 'succeeded') return '已完成'
      if (s === 'failed') return '失败'
      if (s === 'cancelled') {
        return /暂停提交|审码闸|高危/.test(String(detail || '')) ? '已暂停提交' : '已取消'
      }
      if (s === 'blocked_no_runner') return '无 Runner'
      if (s === 'pending_review') {
        var gate = String(reviewGate || '').trim()
        var n = typeof inScopeLen === 'number' ? inScopeLen : -1
        if (gate === 'auto_applying' || detail === '自动同步中…') return '自动同步中'
        if (gate === 'auto_failed') return '同步失败'
        if (gate === 'await_user') return n === 0 ? '已完成·有范围外文件' : '待审同步'
        if (n === 0) return '已完成·有范围外文件'
        if (n > 0) return '待审同步'
        return '自动同步中'
      }
      if (s === 'syncing') return '自动同步中'
      if (s === 'running' || s === 'queued') return '写码中'
      return s || ''
    }

    /** 已确认后的 Git 进度文案：禁止再显示「写码中」；跟 SSE/账本 detail 动态刷新 */
    function gitPostConfirmLabel(detail, fallback) {
      var d = String(detail || '').replace(/\s+/g, ' ').trim()
      if (/推送失败（网络瞬断）|准备重试|秒后重试/.test(d)) return '推送遇网络瞬断，准备重试…'
      if (/正在重试推送|重试推送/.test(d)) return '正在重试推送…'
      if (/正在推送到远端|正在推送/.test(d)) {
        return d.length > 48 ? d.slice(0, 48) + '…' : d
      }
      if (/正在审码（\s*\d+\s*\/\s*\d+\s*）/.test(d)) return d
      if (/正在创建 commit|本地已提交|正在暂存/.test(d)) {
        return d.length > 48 ? d.slice(0, 48) + '…' : d
      }
      if (/正在切换|正在创建分支|已在目标分支|正在核对|正在重新读取|正在尝试开 PR/.test(d)) {
        return d.length > 48 ? d.slice(0, 48) + '…' : d
      }
      if (/^已推送\b/.test(d)) return d.length > 56 ? d.slice(0, 56) + '…' : d
      if (/^Commit：/.test(d) || /^PR：/.test(d) || /^本地已提交/.test(d)) {
        return d.length > 56 ? d.slice(0, 56) + '…' : d
      }
      var fb = String(fallback || '').trim()
      if (fb && fb !== '写码中' && !/确认|待审|读取 Git/.test(fb)) return fb
      return '正在 commit / push…'
    }

    function sessionCacheKey(jid) {
      return 'dsh-cchat-accel:' + String(jid || '').trim()
    }

    function loadSessionCache(jid) {
      try {
        var raw = sessionStorage.getItem(sessionCacheKey(jid))
        if (!raw) return null
        var o = JSON.parse(raw)
        return o && typeof o === 'object' ? o : null
      } catch (e) {
        return null
      }
    }

    function saveSessionCache(jid, patch) {
      var id = String(jid || '').trim()
      if (!id) return
      try {
        var prev = loadSessionCache(id) || {}
        var next = Object.assign({}, prev, {
          job_id: id,
          updated_at: Date.now(),
        })
        var p = patch || {}
        Object.keys(p).forEach(function (k) {
          if (p[k] !== undefined) next[k] = p[k]
        })
        sessionStorage.setItem(sessionCacheKey(id), JSON.stringify(next))
        // 同步进长期结论库，切会话后仍可按路径/诉求对齐挂回
        if (next.chat_conclusion) {
          rememberConclusionItem({
            id: id,
            updated_at: new Date().toISOString(),
            requirement: next.requirement || '',
            chat_conclusion: next.chat_conclusion,
            synced_files: next.synced_files || [],
            deleted_files: next.deleted_files || [],
          })
        }
      } catch (e) {}
    }

    /**
     * 取用户头像底色：优先读壳里头像节点 computed background，再退主题变量。
     * 产品壳本机头像默认 #1aa6a6（AccountMenu local avatar）。
     */
    function resolveAvatarAccent() {
      if (typeof document === 'undefined') return '#1aa6a6'
      try {
        var nodes = document.querySelectorAll(
          '[data-avatar-status], [class*="avatar"], [class*="Avatar"]',
        )
        for (var i = 0; i < nodes.length && i < 12; i++) {
          var bg = ''
          try {
            bg = String(window.getComputedStyle(nodes[i]).backgroundColor || '').trim()
          } catch (e0) {
            bg = ''
          }
          if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') continue
          // 跳过近白/近透明底，避免读到容器而不是头像色块
          if (/^rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(bg)) continue
          return bg
        }
      } catch (e1) {}
      try {
        var root = window.getComputedStyle(document.documentElement)
        var keys = [
          '--dsw-alias-brand-primary',
          '--wb-palette-brand-8',
          '--wb-brand',
          '--color-primary',
        ]
        for (var k = 0; k < keys.length; k++) {
          var v = String(root.getPropertyValue(keys[k]) || '').trim()
          if (v) return v
        }
      } catch (e2) {}
      return '#1aa6a6'
    }

    function applyGitAccentVars(host) {
      var accent = resolveAvatarAccent()
      try {
        if (typeof document !== 'undefined' && document.documentElement) {
          document.documentElement.style.setProperty('--cc-avatar-accent', accent)
        }
      } catch (e0) {}
      if (host && host.style) {
        try {
          host.style.setProperty('--cc-avatar-accent', accent)
          host.style.setProperty('--cc-git-accent', accent)
        } catch (e1) {}
      }
      return accent
    }

    function ensureCss() {
      if (typeof document === 'undefined') return
      applyGitAccentVars(null)
      var style = document.getElementById('cc-set-css')
      var css =
        '.cc-set{max-width:720px;padding:4px 2px 24px;font-size:13px;line-height:1.5;color:var(--color-text,inherit)}' +
        '.cc-set-lead{margin:0 0 12px;opacity:.85}' +
        '.cc-set-card{border:1px solid var(--color-border,rgba(127,127,127,.35));border-radius:10px;padding:12px 14px;margin:0 0 12px;background:var(--color-bg-subtle,transparent)}' +
        '.cc-set-card h3{margin:0 0 10px;font-size:14px}' +
        '.cc-set-field{display:flex;flex-direction:column;gap:4px;margin:0 0 10px}' +
        '.cc-set-field label{font-size:12px;opacity:.8}' +
        '.cc-set-field .cc-req{color:#cf222e;font-weight:700;margin-right:2px}' +
        '.cc-set-field input,.cc-set-field textarea{padding:7px 9px;border-radius:8px;border:1px solid var(--color-border,rgba(127,127,127,.4));background:var(--color-bg,transparent);color:inherit;font:inherit}' +
        '.cc-set-hint{font-size:12px;opacity:.75;margin:6px 0 0}' +
        '.cc-set-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}' +
        '.cc-set-btn{padding:7px 12px;border-radius:8px;border:1px solid var(--color-border,rgba(127,127,127,.45));background:var(--color-bg-elevated,transparent);cursor:pointer;color:inherit}' +
        '.cc-set-btn:disabled{opacity:.5;cursor:not-allowed}' +
        '.cc-set-btn.primary{background:var(--color-primary,#2f6fed);border-color:transparent;color:#fff}' +
        '.cc-set-msg{font-size:12px}.cc-set-msg.ok{color:#1a7f37}.cc-set-msg.err{color:#cf222e}' +
        '.cc-card{border:1px solid var(--color-border,rgba(127,127,127,.35));border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.45;max-width:100%;overflow:visible}' +
        '.cc-card.cc-stream-card{border:none;border-radius:0;padding:4px 0 8px;background:transparent;box-shadow:none}' +
        '.cc-card h4{margin:0 0 8px;font-size:14px}' +
        '.cc-card.cc-stream-card h4{display:none}' +
        '.cc-card .cc-banner{padding:8px 10px;border-radius:8px;margin:0 0 10px;background:rgba(47,111,237,.08)}' +
        '.cc-card .cc-banner.warn{background:rgba(207,34,46,.08)}' +
        '.cc-stream{max-height:220px;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:pre-wrap;border:1px solid var(--color-border,rgba(127,127,127,.3));border-radius:8px;padding:8px;margin-top:8px}' +
        '.cc-phase{opacity:.75;font-size:12px;margin:0 0 8px}' +
        '.cc-card.cc-stream-card .cc-phase{display:none}' +
        '.cc-review{margin-top:10px;border-top:1px solid var(--color-border,rgba(127,127,127,.3));padding-top:10px;max-height:none;overflow:visible}' +
        '.cc-check{display:flex;align-items:flex-start;gap:8px;margin:4px 0;font-size:12px}' +
        '.cc-check input{margin-top:2px}' +
        '.cc-check .tag{opacity:.65;margin-left:4px}' +
        '.cc-expand{margin-top:8px}' +
        '.cc-tabs{display:flex;gap:4px;flex-wrap:wrap;margin:10px 0 8px}' +
        '.cc-tab{padding:5px 10px;border-radius:7px;border:1px solid var(--color-border,rgba(127,127,127,.4));background:transparent;cursor:pointer;color:inherit;font:inherit;font-size:12px}' +
        '.cc-tab.active{background:var(--color-primary,#2f6fed);border-color:transparent;color:#fff}' +
        '.cc-body-wrap{margin-top:4px}' +
        '.cc-body-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin:0 0 6px;font-size:12px;opacity:.8}' +
        '.cc-card.cc-stream-card .cc-body-meta{display:none}' +
        '.cc-card.cc-stream-card .cc-stream-actions{display:flex;justify-content:flex-end;gap:8px;margin:4px 0 0;opacity:.45}' +
        '.cc-card.cc-stream-card .cc-stream-actions:hover{opacity:.85}' +
        '.cc-card.cc-stream-card .cc-log-fold{display:none}' +
        '.cc-card.cc-stream-card.is-done .cc-log-fold{display:block;margin-top:10px;opacity:.4;font-size:12px}' +
        '.cc-body{max-height:none;min-height:0;overflow:visible;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;border:1px solid var(--color-border,rgba(127,127,127,.35));border-radius:8px;padding:10px 12px;background:var(--color-bg-subtle,rgba(127,127,127,.06))}' +
        '.cc-body.empty{opacity:.55;font-style:italic}' +
        '.cc-quote{margin:4px 0 10px;padding:8px 10px;border:1px solid var(--color-border,rgba(127,127,127,.35));border-radius:8px;background:var(--color-bg-subtle,rgba(127,127,127,.06));font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;max-height:none;overflow:visible}' +
        '.cc-quote.empty{opacity:.65;font-style:italic;max-height:none;min-height:0}' +
        '.cc-set-btn.primary:disabled{opacity:.45;cursor:not-allowed}' +
        '.cc-tools{max-height:none;overflow:visible;margin-top:4px}' +
        '.cc-tool-row{display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border-bottom:1px solid var(--color-border,rgba(127,127,127,.2));font-size:12px}' +
        '.cc-tool-row .k{flex:0 0 auto;opacity:.65;min-width:64px}' +
        '.cc-tool-row .v{flex:1;word-break:break-all}' +
        '.cc-note{font-size:12px;opacity:.75;margin:6px 0 0}' +
        /* Cursor IDE 式：过程区不限高，随内容增高；由外层聊天窗滚动上推 */ +
        '.cc-dialog{height:auto;max-height:none;min-height:0;overflow:visible;border:none;border-radius:0;padding:2px 2px 16px;background:transparent;margin-top:0;position:relative}' +
        '.cc-card.cc-stream-card{overflow:visible}' +
        '.cc-bubble{margin:0 0 10px;padding:0}' +
        '.cc-bubble .role{font-size:11px;opacity:.55;margin:0 0 4px;letter-spacing:.02em}' +
        '.cc-bubble.user .role{color:#2f6fed}' +
        '.cc-bubble.user .body{font-size:13.5px;line-height:1.6;white-space:pre-wrap}' +
        /* 过程 UI：Thinking 淡紫胶囊，仅样式；开合逻辑不变 */ +
        '.cc-bubble.thinking{margin:6px 0 12px}' +
        '.cc-bubble.thinking details{border:1px solid rgba(109,40,217,.16);padding:8px 12px;background:rgba(109,40,217,.055);border-radius:12px}' +
        '.cc-bubble.thinking summary{cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px;font-size:13px;line-height:1.4;padding:0;border-radius:0;background:transparent;color:#6d28d9;opacity:.92;user-select:none;font-weight:600}' +
        '.cc-bubble.thinking summary::-webkit-details-marker{display:none}' +
        '.cc-bubble.thinking summary .cc-think-ico{display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center;border-radius:999px;background:rgba(109,40,217,.12);font-size:10px;line-height:1;flex:0 0 auto}' +
        '.cc-bubble.thinking summary .cc-chev{display:inline-block;transition:transform .15s ease;opacity:.65;font-size:12px;color:inherit}' +
        '.cc-bubble.thinking details[open] summary .cc-chev{transform:rotate(90deg)}' +
        '.cc-bubble.thinking .body{margin-top:8px;padding:0;white-space:pre-wrap;font-size:12.5px;line-height:1.65;opacity:.78;max-height:none;overflow:visible;background:transparent;color:inherit}' +
        '.cc-bubble.thinking.is-stream details{border-color:rgba(109,40,217,.28);background:rgba(109,40,217,.08)}' +
        '.cc-bubble.thinking.is-stream summary{opacity:1}' +
        /* 仅终态且用户未点展开时才裁切；进行中绝不裁切，避免结论未出先空白 */ +
        '.cc-bubble.thinking.is-done:not(.is-hold) .body{max-height:8.5em;overflow:hidden}' +
        '.cc-bubble.thinking details[open].is-full .body,.cc-bubble.thinking.is-hold .body{max-height:none!important;overflow:visible!important}' +
        '.cc-hold{min-height:48px;margin:6px 0 10px;padding:10px 12px;font-size:13px;opacity:.72;line-height:1.5;border-radius:10px;background:rgba(127,127,127,.06);border:1px dashed rgba(127,127,127,.22)}' +
        '.cc-dialog:empty::after{content:"正在准备过程…";display:block;padding:12px 0;opacity:.55;font-size:13px}' +
        '.cc-think-more{display:inline-block;margin-top:6px;border:0;background:transparent;padding:0;font-size:12px;opacity:.55;cursor:pointer;color:#6d28d9}' +
        '.cc-think-more:hover{opacity:.9}' +
        '.cc-bubble.thought{display:inline-flex;align-items:center;gap:8px;margin:6px 0 12px;padding:8px 12px;font-size:13px;opacity:.85;border-radius:12px;background:rgba(109,40,217,.055);border:1px solid rgba(109,40,217,.16);color:#6d28d9;font-weight:600}' +
        '.cc-bubble.thought .ico{opacity:.8}' +
        /* 正文叙事：主视觉，专业可读 */ +
        '.cc-bubble.assistant{margin:2px 0 16px}' +
        '.cc-bubble.assistant .role{font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.42;margin:0 0 6px;font-weight:600}' +
        '.cc-bubble.assistant .body{white-space:pre-wrap;font-size:14px;line-height:1.7;color:inherit;letter-spacing:.01em}' +
        '.cc-bubble.assistant .body h3{font-size:13.5px;font-weight:600;margin:14px 0 6px;opacity:.95}' +
        '.cc-bubble.assistant .body strong{font-weight:600}' +
        '.cc-bubble.assistant .body .cc-li{margin:3px 0 3px 2px;padding-left:0}' +
        '.cc-bubble.assistant .body .cc-ol{margin:3px 0 3px 2px}' +
        '.cc-bubble.assistant .body code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;padding:1px 6px;border-radius:5px;background:rgba(127,127,127,.16)}' +
        '.cc-bubble.assistant .body pre.cc-md-code{margin:10px 0;padding:12px 14px;border-radius:10px;background:rgba(24,24,27,.92);color:#e4e4e7;overflow:auto;max-height:none;border:1px solid rgba(255,255,255,.06);position:relative}' +
        '.cc-bubble.assistant .body pre.cc-md-code code{padding:0;background:transparent;color:inherit;font-size:12px;line-height:1.55;white-space:pre}' +
        /* 工具汇总：摘要弱化 + 行内浅蓝芯片（对齐 Cursor 过程条） */ +
        '.cc-bubble.tool-group{margin:4px 0 12px}' +
        '.cc-bubble.tool-group details{border:none;padding:0;background:transparent}' +
        '.cc-bubble.tool-group summary{cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px;font-size:12.5px;line-height:1.45;opacity:.62;user-select:none;padding:2px 0;background:transparent;font-weight:500}' +
        '.cc-bubble.tool-group summary::-webkit-details-marker{display:none}' +
        '.cc-bubble.tool-group summary .cc-chev{display:inline-block;transition:transform .15s ease;font-size:12px;opacity:.7}' +
        '.cc-bubble.tool-group details[open] summary .cc-chev{transform:rotate(90deg)}' +
        '.cc-bubble.tool-group .cc-tool-list{margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}' +
        '.cc-bubble.tool-group .cc-tool-line{display:flex;align-items:center;gap:8px;min-width:0;padding:7px 10px;border-radius:10px;border:1px solid rgba(47,111,237,.18);background:rgba(47,111,237,.07);color:#1d4ed8;font-size:12px;line-height:1.4;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden}' +
        '.cc-bubble.tool-group .cc-tool-line .ico{flex:0 0 auto;opacity:.75;font-size:12px;line-height:1}' +
        '.cc-bubble.tool-group .cc-tool-line .name{flex:0 0 auto;font-weight:600;color:#1d4ed8}' +
        '.cc-bubble.tool-group .cc-tool-line .st{flex:0 0 auto;opacity:.62;font-size:11px;letter-spacing:.02em}' +
        '.cc-bubble.tool-group .cc-tool-line .st.is-fail{color:#cf222e;opacity:.9}' +
        '.cc-cmd .cc-cmd-st{margin-left:auto;font-size:11px;opacity:.75}' +
        '.cc-cmd .cc-cmd-st.is-fail{color:#ff7b72;opacity:.95}' +
        '.cc-cmd .cc-cmd-fail{margin:0;padding:8px 12px;font-size:12px;line-height:1.45;color:#ffb4a8;background:#161b22;border-top:1px solid #30363d;white-space:pre-wrap;word-break:break-word}' +
        '.cc-user-choice{margin:10px 0 12px;padding:12px 14px;border-radius:12px;border:1px solid rgba(47,111,237,.28);background:rgba(47,111,237,.06)}' +
        '.cc-user-choice .q{font-size:13px;font-weight:600;line-height:1.45;margin:0 0 10px;color:inherit}' +
        '.cc-user-choice .opts{display:flex;flex-direction:column;gap:8px}' +
        '.cc-user-choice .opt{display:block;width:100%;text-align:left;padding:9px 12px;border-radius:10px;border:1px solid rgba(47,111,237,.22);background:#fff;color:#1d4ed8;font-size:12.5px;line-height:1.4;cursor:pointer}' +
        '.cc-user-choice .opt:hover{border-color:rgba(47,111,237,.45);background:rgba(47,111,237,.08)}' +
        '.cc-user-choice .opt:disabled{opacity:.55;cursor:wait}' +
        '.cc-user-choice .hint{margin:8px 0 0;font-size:11px;opacity:.65}' +
        '/* git-accent-v4：隐藏原生勾，自绘白钩（Electron accentColor 会出黑钩） */' +
        '.cc-git-deliver{--cc-git-accent:var(--cc-avatar-accent,#1aa6a6);margin:10px 0 12px;padding:12px 14px;border-radius:12px;border:1px solid color-mix(in srgb,var(--cc-git-accent) 35%,transparent);background:color-mix(in srgb,var(--cc-git-accent) 8%,transparent)}' +
        '.cc-git-deliver .cc-git-title{font-size:13px;font-weight:600;margin:0 0 8px}' +
        '.cc-git-deliver .cc-git-row{display:flex;gap:8px;align-items:flex-start;margin:0 0 8px;font-size:12px;line-height:1.45}' +
        '.cc-git-deliver .cc-git-lab{flex:0 0 72px;opacity:.7}' +
        '.cc-git-deliver .cc-git-val{flex:1;word-break:break-all}' +
        '.cc-git-deliver input[type=text],.cc-git-deliver textarea{width:100%;box-sizing:border-box;padding:7px 10px;border-radius:8px;border:1px solid rgba(0,0,0,.12);font-size:12.5px}' +
        '.cc-git-deliver textarea{min-height:56px;resize:vertical}' +
        '.cc-git-deliver .cc-git-files{max-height:160px;overflow:auto;margin:6px 0 10px;padding:6px 8px;border-radius:8px;background:rgba(0,0,0,.03)}' +
        '.cc-git-deliver .cc-git-file{display:flex;gap:8px;align-items:flex-start;font-size:12px;margin:0 0 4px;cursor:pointer}' +
        '.cc-git-deliver .cc-git-file input[type=checkbox]{' +
        'position:absolute;opacity:0;width:1px;height:1px;margin:0;padding:0;overflow:hidden;clip:rect(0,0,0,0);' +
        'appearance:none;-webkit-appearance:none;accent-color:transparent;pointer-events:none}' +
        '.cc-git-deliver .cc-git-file .cc-git-tick{' +
        'flex:0 0 auto;width:14px;height:14px;margin-top:2px;box-sizing:border-box;border-radius:3px;' +
        'border:1.5px solid color-mix(in srgb,var(--cc-git-accent) 55%,#888);background:#fff;position:relative}' +
        '.cc-git-deliver .cc-git-file input[type=checkbox]:checked + .cc-git-tick{' +
        'border-color:var(--cc-git-accent);background:var(--cc-git-accent)}' +
        '.cc-git-deliver .cc-git-file input[type=checkbox]:checked + .cc-git-tick::after{' +
        'content:\"\";position:absolute;left:3.5px;top:0.5px;width:4px;height:8px;' +
        'border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}' +
        '.cc-git-deliver .cc-git-file input[type=checkbox]:focus-visible + .cc-git-tick{' +
        'outline:2px solid color-mix(in srgb,var(--cc-git-accent) 55%,transparent);outline-offset:2px}' +
        '.cc-git-deliver .cc-git-file.sens{opacity:.55;cursor:not-allowed}' +
        '.cc-git-deliver .cc-git-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end;margin-top:10px}' +
        '.cc-git-deliver .cc-set-btn.primary{background:var(--cc-git-accent);border-color:transparent;color:#fff}' +
        '.cc-git-deliver .cc-set-btn.primary:hover{filter:brightness(1.05)}' +

        '.cc-bubble.tool-group .cc-tool-line .path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.72;color:inherit}' +
        /* Cursor Diff：强制深色（!important 防宿主浅色主题冲掉） */ +
        '.cc-bubble.tool-rich{margin:8px 0 12px}' +
        '.cc-diff,.cc-card .cc-diff,.cc-stream-card .cc-diff{' +
        'border:1px solid #333!important;border-radius:8px!important;overflow:hidden!important;' +
        'background:#0d1117!important;color:#e6edf3!important;box-shadow:none!important;' +
        'color-scheme:dark!important}' +
        '.cc-diff-head,.cc-card .cc-diff-head{' +
        'display:flex!important;align-items:center;gap:8px;flex-wrap:nowrap;' +
        'padding:8px 12px!important;font-size:12px;line-height:1.35;' +
        'background:#161b22!important;color:#e6edf3!important;' +
        'border-bottom:1px solid #30363d!important;' +
        'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}' +
        '.cc-diff-head .lang{flex:0 0 auto;color:#8b949e!important;opacity:1!important;' +
        'text-transform:uppercase;font-size:11px;letter-spacing:.04em;font-weight:600}' +
        '.cc-diff-head .file{color:#e6edf3!important;opacity:1!important;min-width:0;' +
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.cc-diff-head .plus{color:#3fb950!important;margin-left:auto;font-variant-numeric:tabular-nums;font-weight:600}' +
        '.cc-diff-head .minus{color:#f85149!important;margin-left:6px;font-variant-numeric:tabular-nums;font-weight:600}' +
        '.cc-diff-body,.cc-card .cc-diff-body{' +
        'margin:0!important;padding:4px 0!important;overflow:auto;max-height:260px;' +
        'background:#0d1117!important;color:#e6edf3!important;' +
        'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.55;' +
        'scrollbar-width:thin}' +
        '.cc-diff-body.is-open{max-height:none}' +
        '.cc-diff-row{display:flex;min-width:0;width:100%;background:transparent!important}' +
        '.cc-diff-row.hunk{opacity:.55;font-size:11px;background:#0d1117!important}' +
        '.cc-diff-row.hunk .code{color:#8b949e!important}' +
        '.cc-diff-row .ln{flex:0 0 44px;text-align:right;padding:0 6px;color:#6e7681!important;' +
        'user-select:none;font-variant-numeric:tabular-nums}' +
        '.cc-diff-row .sign{flex:0 0 14px;text-align:center;user-select:none;font-weight:600}' +
        '.cc-diff-row .code{flex:1;min-width:0;padding:0 12px 0 6px;white-space:pre;' +
        'overflow:hidden;text-overflow:ellipsis;color:#e6edf3!important}' +
        '.cc-diff-row.add,.cc-card .cc-diff-row.add{background:#033a16!important}' +
        '.cc-diff-row.add .sign{color:#3fb950!important}' +
        '.cc-diff-row.add .ln{color:#3fb950!important}' +
        '.cc-diff-row.add .code{color:#e6edf3!important}' +
        '.cc-diff-row.del,.cc-card .cc-diff-row.del{background:#67060c!important}' +
        '.cc-diff-row.del .sign{color:#f85149!important}' +
        '.cc-diff-row.del .ln{color:#f85149!important}' +
        '.cc-diff-row.del .code{color:#e6edf3!important}' +
        '.cc-diff-row.ctx .code{color:#c9d1d9!important}' +
        '.cc-diff-row.ctx .sign{color:transparent}' +
        '.cc-diff-more{display:block;width:100%;border:0;background:#161b22!important;' +
        'color:#8b949e!important;font-size:12px;padding:6px 12px 8px;cursor:pointer;text-align:left}' +
        '.cc-diff-more:hover{color:#e6edf3!important}' +
        '.cc-cmd,.cc-card .cc-cmd{' +
        'margin:0;border:1px solid #333!important;border-radius:8px;overflow:hidden;' +
        'background:#0d1117!important;color:#e6edf3!important;color-scheme:dark}' +
        '.cc-cmd-head{padding:7px 12px;font-size:12px;color:#8b949e!important;' +
        'border-bottom:1px solid #30363d!important;' +
        'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#161b22!important}' +
        '.cc-cmd pre{margin:0;padding:10px 12px;color:#e6edf3!important;' +
        'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;' +
        'line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto;' +
        'background:#0d1117!important}' +
        /* 禁止入场动画：SSE/对账重渲会反复触发，造成整卡闪烁 */ +
        '.cc-bubble.tool-live{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:4px 0 10px;padding:7px 10px;border-radius:10px;border:1px solid rgba(47,111,237,.2);background:rgba(47,111,237,.08);color:#1d4ed8;font-size:12.5px;opacity:1;line-height:1.4;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}' +
        '.cc-bubble.tool-live .name{flex:0 0 auto;font-weight:600}' +
        '.cc-bubble.tool-live .meta{opacity:.7;font-size:12px;font-family:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}' +
        '.cc-bubble.tool-live .cc-cmd,.cc-bubble.tool-live .cc-diff{flex:1 1 100%;margin-top:4px;opacity:1}' +
        '.cc-bubble.status{font-size:12.5px;opacity:.7;margin:4px 0 10px;display:flex;align-items:flex-start;gap:8px;line-height:1.45;padding:7px 10px;background:rgba(127,127,127,.05);border:1px solid rgba(127,127,127,.14);border-radius:10px}' +
        '.cc-bubble.status.is-live{opacity:.88;border-color:rgba(47,111,237,.18);background:rgba(47,111,237,.05);color:#1d4ed8}' +
        '.cc-spin{display:inline-block;width:11px;height:11px;border:1.5px solid rgba(47,111,237,.22);border-top-color:#1d4ed8;border-radius:50%;animation:ccspin .65s linear infinite;flex:0 0 auto}' +
        '.cc-live-bar{display:flex;align-items:center;gap:10px;margin:0 0 10px;padding:7px 10px;border-radius:10px;background:rgba(47,111,237,.06);border:1px solid rgba(47,111,237,.14);font-size:13px;opacity:.88;color:#1d4ed8}' +
        '.cc-live-bar .cc-spin{margin-top:0}' +
        '.cc-plan{display:flex;align-items:center;gap:8px;margin:10px 0 2px;padding:7px 10px;border-radius:10px;background:rgba(127,127,127,.05);border:1px solid rgba(127,127,127,.12);font-size:13px;opacity:.72;line-height:1.4}' +
        '.cc-steer{margin-top:10px;border-top:1px solid var(--color-border,rgba(127,127,127,.3));padding-top:10px}' +
        '.cc-done-panel{margin-top:12px;padding-top:4px;border-top:none}' +
        '.cc-done-panel h5{margin:0 0 8px;font-size:13px;opacity:.7;font-weight:500}' +
        '.cc-be-restart{margin:10px 0 0;padding:10px 12px;border:1px solid rgba(180,83,9,.28);background:rgba(245,158,11,.08);border-radius:10px}' +
        '.cc-be-restart .cc-be-title{font-size:13px;font-weight:600;color:#b45309;margin:0 0 6px}' +
        '.cc-be-restart .cc-be-reason{font-size:12.5px;line-height:1.5;opacity:.9;margin:0 0 8px;white-space:pre-wrap}' +
        '.cc-be-restart .cc-be-cmd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.45;opacity:.78;margin:0 0 10px;word-break:break-all}' +
        '.cc-be-restart .cc-set-actions{margin-top:0}' +
        /* 挂在结论正文旁：进度卡折叠后仍可见，避免「一闪被结论盖住」 */
        '.cc-conclusion-hoist .cc-be-restart{margin:12px 0 0;box-shadow:0 0 0 1px rgba(180,83,9,.12)}' +
        '.cc-conclusion-hoist .cc-be-restart.cc-be-hoist{position:relative;z-index:2}' +
        '.cc-conclusion{margin:4px 0 0;padding:0;border:none;border-radius:0;line-height:1.6;background:transparent;max-height:none;overflow:visible;white-space:normal;font-size:14px;color:inherit}' +
        '.cc-conclusion h2{margin:0 0 10px;font-size:15px;font-weight:600;line-height:1.35}' +
        '.cc-conclusion .cc-sec-title{margin:10px 0 4px;font-size:14px;font-weight:600;line-height:1.35}' +
        '.cc-conclusion .cc-label{margin:0 0 2px;line-height:1.6;word-break:break-word}' +
        '.cc-conclusion .cc-label strong{font-weight:600}' +
        '.cc-conclusion .cc-p{margin:0 0 4px;line-height:1.6;word-break:break-word}' +
        '.cc-conclusion .cc-gap{height:10px}' +
        '.cc-conclusion .cc-li{position:relative;margin:3px 0;padding:0 0 0 1.05em;line-height:1.55;word-break:break-word}' +
        '.cc-conclusion .cc-li::before{content:"•";position:absolute;left:0;opacity:.65}' +
        '.cc-conclusion .cc-ol{margin:3px 0;padding:0;line-height:1.55;word-break:break-word}' +
        '.cc-conclusion .cc-md-link{color:#38bdf8!important;text-decoration:underline!important;word-break:break-all;cursor:pointer!important;background:transparent!important;border:none!important;padding:0!important;margin:0;font:inherit;display:inline;vertical-align:baseline;box-shadow:none!important}' +
        '.cc-conclusion .cc-md-link:hover{opacity:.9;filter:brightness(1.08)}' +
        '.cc-conclusion hr{margin:10px 0 6px;border:none;border-top:1px dashed rgba(127,127,127,.35)}' +

        '.cc-conclusion pre.cc-md-code{margin:6px 0;padding:10px 12px;border-radius:8px;background:rgba(24,24,27,.92);color:#e4e4e7;overflow:auto;max-height:none;border:1px solid rgba(255,255,255,.06)}' +
        '.cc-conclusion .cc-md-table-wrap{margin:8px 0 10px;overflow:auto;max-width:100%}' +
        '.cc-conclusion .cc-md-table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.45}' +
        '.cc-conclusion .cc-md-table th,.cc-conclusion .cc-md-table td{border:1px solid rgba(127,127,127,.28);padding:6px 10px;text-align:left;vertical-align:top;word-break:break-word}' +
        '.cc-conclusion .cc-md-table th{font-weight:600;background:rgba(127,127,127,.1)}' +
        '.cc-conclusion .cc-md-table td code{white-space:pre-wrap}' +
        '.cc-conclusion code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;padding:1px 6px;border-radius:5px;background:rgba(127,127,127,.18)}' +
        /* 挂到过程组外：宿主折叠「已调用工具」后用户仍能看见三段式结论 */
        '.cc-conclusion-hoist{display:block;margin:8px 0 12px;padding:0;color:inherit;font-size:14px;line-height:1.6}' +
        '.cc-conclusion-hoist .cc-conclusion{margin:0}' +
        /* 对齐底座 deliverables「已编辑 N 个文件」；仅当本轮未见底座卡时兜底 */
        '.cc-changes-card{margin:10px 0 12px;border:1px solid var(--color-border,rgba(127,127,127,.28));border-radius:12px;background:var(--color-bg-elevated,var(--color-bg,#fff));overflow:hidden;font-size:13px;color:inherit}' +
        '.cc-changes-head{display:flex;align-items:flex-start;gap:10px;padding:12px 14px 10px}' +
        '.cc-changes-ico{flex:0 0 36px;width:36px;height:36px;border-radius:8px;background:rgba(127,127,127,.1);display:flex;align-items:center;justify-content:center;font-size:16px;opacity:.85}' +
        '.cc-changes-meta{flex:1;min-width:0}' +
        '.cc-changes-title{font-weight:600;font-size:14px;line-height:1.35;margin:0 0 2px}' +
        '.cc-changes-stats{font-size:12px;line-height:1.3;font-variant-numeric:tabular-nums}' +
        '.cc-changes-stats .plus{color:#1a7f37;margin-right:8px}' +
        '.cc-changes-stats .minus{color:#cf222e}' +
        '.cc-changes-actions{display:flex;align-items:center;gap:8px;flex:0 0 auto;padding-top:2px}' +
        '.cc-changes-actions .cc-ch-link{border:0;background:transparent;color:inherit;opacity:.75;cursor:default;font:inherit;padding:0 2px}' +
        '.cc-changes-actions .cc-ch-review{border:1px solid var(--color-border,rgba(127,127,127,.35));border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:12px;padding:4px 12px;cursor:default;opacity:.85}' +
        '.cc-changes-list{border-top:1px solid var(--color-border,rgba(127,127,127,.22));padding:4px 0}' +
        '.cc-changes-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 14px;font-size:12.5px;line-height:1.35;width:100%;box-sizing:border-box;border:0;background:transparent;color:inherit;text-align:left;font:inherit}' +
        '.cc-changes-row.is-clickable{cursor:pointer}' +
        '.cc-changes-row.is-clickable:hover{background:rgba(127,127,127,.08)}' +
        '.cc-changes-row.is-clickable:hover .path{opacity:1;text-decoration:underline;text-underline-offset:2px}' +
        '.cc-changes-row .path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.88;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}' +
        '.cc-changes-row .tag{flex:0 0 auto;font-size:12px;opacity:.7;font-variant-numeric:tabular-nums}' +
        '.cc-changes-row .tag.del{color:#cf222e}' +
        '.cc-changes-row .tag.add{color:#1a7f37}' +
        '.cc-follow-hint{margin:12px 0 0;padding:0;border-radius:0;background:transparent;font-size:13px;line-height:1.55;opacity:.7}' +
        '.cc-cursor{display:inline-block;width:7px;height:1em;background:currentColor;margin-left:2px;animation:ccblink 1s step-end infinite;vertical-align:text-bottom;opacity:.55}' +
        '.cc-card.cc-stream-card details.cc-log-fold{margin-top:8px;opacity:.45;font-size:12px}' +
        '@keyframes ccblink{50%{opacity:0}}' +
        '@keyframes ccspin{to{transform:rotate(360deg)}}'
      if (!style) {
        style = document.createElement('style')
        style.id = 'cc-set-css'
        document.head.appendChild(style)
      }
      style.setAttribute('data-cc-css', '1.3.32-backend-restart')
      style.textContent = css
    }


    function field(label, props, required) {
      return h(
        'div',
        { className: 'cc-set-field' },
        h('label', null, required ? h('span', { className: 'cc-req' }, '*') : null, required ? ' ' : null, label),
        props.multiline ? h('textarea', props) : h('input', props),
      )
    }

    function CursorCodingSettingsSection() {
      ensureCss()
      var draftState = useState({
        listen: '127.0.0.1',
        port: '18791',
        cursorApiKey: '',
        cursorKeyConfigured: false,
        gitHostToken: '',
        gitHostTokenConfigured: false,
        writeScopeText: '',
        dataRoot: '',
      })
      var draft = draftState[0]
      var setDraft = draftState[1]
      var busyState = useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var msgState = useState('')
      var msg = msgState[0]
      var setMsg = msgState[1]
      var msgOkState = useState(false)
      var msgOk = msgOkState[0]
      var setMsgOk = msgOkState[1]
      var healthState = useState('')
      var health = healthState[0]
      var setHealth = healthState[1]
      var jobIdDraftState = useState('')
      var jobIdDraft = jobIdDraftState[0]
      var setJobIdDraft = jobIdDraftState[1]
      var jobBodyState = useState('')
      var jobBody = jobBodyState[0]
      var setJobBody = jobBodyState[1]
      var jobMetaState = useState('')
      var jobMeta = jobMetaState[0]
      var setJobMeta = jobMetaState[1]

      function rememberEndpoint() {
        try {
          localStorage.setItem(LS_HOST, '127.0.0.1')
          localStorage.setItem(LS_PORT, String(draft.port || '18791').trim())
        } catch (e) {}
      }

      function base() {
        return 'http://127.0.0.1:' + String(draft.port || servicePort()).trim()
      }

      function loadConfig() {
        setBusy(true)
        setMsg('')
        fetch(base() + '/api/config')
          .then(function (r) {
            return r.json()
          })
          .then(function (data) {
            if (!data || !data.ok) throw new Error((data && data.detail) || '加载失败')
            var c = data.config || {}
            setDraft({
              listen: c.listen || '127.0.0.1',
              port: String(c.port || 18791),
              cursorApiKey: c.cursorKeyConfigured ? SECRET_MASK : '',
              cursorKeyConfigured: Boolean(c.cursorKeyConfigured),
              gitHostToken: c.gitHostTokenConfigured ? SECRET_MASK : '',
              gitHostTokenConfigured: Boolean(c.gitHostTokenConfigured),
              writeScopeText: c.writeScopeText || '',
              dataRoot: c.dataRoot || '',
            })
            rememberEndpoint()
            setMsgOk(true)
            setMsg('已加载本机配置')
          })
          .catch(function (err) {
            setMsgOk(false)
            setMsg(String(err && err.message ? err.message : err))
          })
          .finally(function () {
            setBusy(false)
          })
      }

      function saveConfig() {
        setBusy(true)
        setMsg('')
        rememberEndpoint()
        var key = String(draft.cursorApiKey || '').trim()
        var gitTok = String(draft.gitHostToken || '').trim()
        var body = {
          listen: '127.0.0.1',
          port: draft.port,
          writeScopeText: draft.writeScopeText,
        }
        if (key && key !== SECRET_MASK && !/^•+$/.test(key)) {
          body.cursorApiKey = key
        }
        if (gitTok && gitTok !== SECRET_MASK && !/^•+$/.test(gitTok)) {
          body.gitHostToken = gitTok
        }
        fetch(base() + '/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then(function (r) {
            return r.json().then(function (d) {
              return { status: r.status, data: d }
            })
          })
          .then(function (out) {
            if (!out.data || !out.data.ok) throw new Error((out.data && out.data.detail) || '保存失败 HTTP ' + out.status)
            var c = out.data.config || {}
            setDraft({
              listen: c.listen || '127.0.0.1',
              port: String(c.port || 18791),
              cursorApiKey: c.cursorKeyConfigured ? SECRET_MASK : '',
              cursorKeyConfigured: Boolean(c.cursorKeyConfigured),
              gitHostToken: c.gitHostTokenConfigured ? SECRET_MASK : '',
              gitHostTokenConfigured: Boolean(c.gitHostTokenConfigured),
              writeScopeText: c.writeScopeText || '',
              dataRoot: c.dataRoot || '',
            })
            setMsgOk(true)
            setMsg(out.data.detail || '已保存')
          })
          .catch(function (err) {
            setMsgOk(false)
            setMsg(String(err && err.message ? err.message : err))
          })
          .finally(function () {
            setBusy(false)
          })
      }

      function checkHealth() {
        rememberEndpoint()
        fetch(base() + '/health')
          .then(function (r) {
            return r.json()
          })
          .then(function (d) {
            setHealth(
              (d.ok ? 'OK' : 'FAIL') +
                ' · Key ' +
                (d.cursorKeyReady ? '已配置' : '未配置') +
                ' · ' +
                (d.detail || ''),
            )
          })
          .catch(function (err) {
            setHealth('无法连接 ' + base() + '：' + String(err))
          })
      }

      function loadJobBody() {
        var jid = String(jobIdDraft || '').trim()
        if (!jid) {
          setJobMeta('请填写 job_id')
          setJobBody('')
          return
        }
        setBusy(true)
        fetch(base() + '/api/cursor-chat/jobs/' + encodeURIComponent(jid))
          .then(function (r) {
            return r.json().then(function (d) {
              return { status: r.status, data: d }
            })
          })
          .then(function (out) {
            var job = out.data && out.data.job
            if (!job) throw new Error((out.data && out.data.detail) || '任务不存在')
            setJobMeta(
              job.id +
                ' · ' +
                job.status +
                ' · 正文 ' +
                String((job.assistant_text || '').length) +
                ' · 思考 ' +
                String((job.thinking_text || '').length) +
                ' · 片段 ' +
                String((job.transcript || []).length),
            )
            var parts = []
            if (job.thinking_text) parts.push('【Thinking】\n' + job.thinking_text)
            if (job.assistant_text) parts.push('【Assistant】\n' + job.assistant_text)
            if (job.transcript && job.transcript.length) {
              parts.push(
                '【Transcript】\n' +
                  job.transcript
                    .map(function (it) {
                      return (
                        '- ' +
                        it.kind +
                        (it.name ? ' ' + it.name : '') +
                        (it.path ? ' ' + it.path : '') +
                        (it.text ? '\n' + String(it.text).slice(0, 500) : '')
                      )
                    })
                    .join('\n'),
              )
            }
            setJobBody(parts.join('\n\n') || String(job.assistant_text || ''))
          })
          .catch(function (err) {
            setJobMeta(String(err && err.message ? err.message : err))
            setJobBody('')
          })
          .finally(function () {
            setBusy(false)
          })
      }

      function copyJobBody() {
        var t = String(jobBody || '')
        if (!t) return
        copyTextToClipboard(t).then(function (ok) {
          if (ok) setJobMeta((jobMeta || '') + ' · 已复制')
          else setJobMeta((jobMeta || '') + ' · 复制失败')
        })
      }

      useEffect(function () {
        loadConfig()
      }, [])

      return h(
        'div',
        { className: 'cc-set' },
        h(
          'p',
          { className: 'cc-set-lead' },
          '独立插件：立刻开工出进度卡（无确认卡）→ Cursor 流式改码 → 同步 → 正文结论。提交代码开 PR 可在下方填写 Git Token。',
        ),
        h(
          'div',
          { className: 'cc-set-card', 'data-cc-settings': 'cursor-key' },
          h('h3', null, '1 · Cursor API Key（硬性）'),
          field(
            'Cursor API Key',
            {
              type: 'password',
              value: draft.cursorApiKey,
              placeholder: draft.cursorKeyConfigured ? '已配置，留空保存则保持不变' : '必填，保存后才能开工',
              onChange: function (e) {
                setDraft(Object.assign({}, draft, { cursorApiKey: e.target.value }))
              },
            },
            true,
          ),
          h('p', { className: 'cc-set-hint' }, '密钥只存本机 ~/.zhongruan/cursor-chat/config.json（权限 600），不进项目仓库。'),
        ),
        h(
          'div',
          { className: 'cc-set-card', 'data-cc-settings': 'git-token' },
          h('h3', null, '2 · Git 托管 Token（开 PR，可选）'),
          field(
            'GitHub / Gitee Token',
            {
              type: 'password',
              value: draft.gitHostToken || '',
              placeholder: draft.gitHostTokenConfigured
                ? '已配置，留空保存则保持不变'
                : '可选：填了才能自动开 PR；不填则 push 后给手动链接',
              onChange: function (e) {
                setDraft(Object.assign({}, draft, { gitHostToken: e.target.value }))
              },
            },
            false,
          ),
          h(
            'p',
            { className: 'cc-set-hint' },
            '与 Cursor Key 同页、同文件保存。不必装 GitHub CLI；无 Token 时「提交代码」仍会 push，结论里给 Compare 开 PR 链接。',
          ),
        ),
        h(
          'div',
          { className: 'cc-set-actions' },
          h(
            'button',
            { type: 'button', className: 'cc-set-btn primary', disabled: busy, onClick: saveConfig },
            '保存配置',
          ),
          h(
            'button',
            { type: 'button', className: 'cc-set-btn', disabled: busy, onClick: loadConfig },
            '重新加载',
          ),
          h(
            'button',
            { type: 'button', className: 'cc-set-btn', disabled: busy, onClick: checkHealth },
            '检测服务',
          ),
          msg ? h('span', { className: 'cc-set-msg' + (msgOk ? ' ok' : ' err') }, msg) : null,
        ),
        health ? h('p', { className: 'cc-set-hint' }, health) : null,
      )
    }

    function readUiFromProps(props) {
      try {
        var block = props && props.block
        var meta = block && (block.presentationMeta || block.meta || block.resultMeta)
        if (meta && meta.cc && meta.cc.ui) return meta.cc.ui
        var value = block && (block.result || block.value || block.output)
        if (value && value.cursor_chat_ui) return value.cursor_chat_ui
        if (props && props.result && props.result.cursor_chat_ui) return props.result.cursor_chat_ui
      } catch (e) {}
      return {}
    }

    function textFromContentBlocks(content) {
      if (!Array.isArray(content)) return ''
      return content
        .map(function (c) {
          if (!c) return ''
          if (c.type === 'text' || c.kind === 'text') return String(c.text || '')
          return ''
        })
        .filter(Boolean)
        .join('\n')
        .trim()
    }

    function toolArgsRawObject(block) {
      if (!block) return null
      if (block.arguments && typeof block.arguments === 'object') return block.arguments
      if (block.args && typeof block.args === 'object') return block.args
      var raw = ''
      if (typeof block.argsRaw === 'string') raw = block.argsRaw
      else if (block.call && typeof block.call.argsRaw === 'string') raw = block.call.argsRaw
      if (!raw) return null
      try {
        var o = JSON.parse(raw)
        return o && typeof o === 'object' ? o : null
      } catch (e) {
        return null
      }
    }

    /** 从 tool call argsRaw 取出 message */
    function toolArgsMessage(block) {
      var o = toolArgsRawObject(block)
      if (!o) return ''
      return String(o.message || o.requirement || '').trim()
    }

    /** 工具名：用于 Git 交付卡在结果返回前就切到正确 UI */
    function toolBlockName(block) {
      if (!block || typeof block !== 'object') return ''
      return String(block.name || block.toolName || block.tool_name || '').trim()
    }

    /** wait/begin 入参里的 job_id */
    function toolArgsJobId(block) {
      var o = toolArgsRawObject(block)
      if (!o) return ''
      return String(o.job_id || o.jobId || '').trim()
    }

    /** 宿主 toolview 相位：preparing | start | result（缺省按 block.kind 推断） */
    function toolViewPhase(props) {
      var p = props && props.phase
      if (p === 'preparing' || p === 'start' || p === 'result') return p
      var block = props && props.block
      if (!block) return ''
      if (block.kind === 'tool-result' || block.kind === 'tool.result' || 'isError' in block) return 'result'
      if (block.phase === 'preparing' || block.phase === 'start') return block.phase
      return ''
    }

    /**
     * 本轮是否仍在宿主「运行中」。已停止会话重开后 tool 可能仍停在 start，
     * 若 turn 上没有 data-chat-running，则视为孤儿 start，必须封口停转圈。
     */
    function turnIsLiveNear(el) {
      try {
        if (!el || typeof el.closest !== 'function') return false
        var turn = el.closest('[data-chat-turn]')
        if (!turn) {
          // 找不到 turn 时：全局若完全没有 running 标记，也当非 live（历史重开）
          return !!(typeof document !== 'undefined' && document.querySelector('[data-chat-running]'))
        }
        return !!turn.querySelector('[data-chat-running]')
      } catch (e) {
        return false
      }
    }

    /** 会话里最近一条用户原话（Agent 未传 message 时兜底） */
    function lastUserUtterance(props) {
      try {
        if (!props || typeof props.useSession !== 'function') return ''
        var text = props.useSession(function (s) {
          var list =
            (s && Array.isArray(s.nodes) && s.nodes) ||
            (s && s.chat && s.chat.legacy && Array.isArray(s.chat.legacy.nodes) && s.chat.legacy.nodes) ||
            null
          if (!list) return ''
          for (var i = list.length - 1; i >= 0; i--) {
            var n = list[i]
            if (n && n.kind === 'user') return textFromContentBlocks(n.content)
          }
          return ''
        })
        return String(text || '').trim()
      } catch (e) {
        return ''
      }
    }

    function initialRequirement(props, ui) {
      var fromUi = String((ui && (ui.requirement || ui.original_goal)) || '').trim()
      if (fromUi) return fromUi
      var fromArgs = toolArgsMessage(props && props.block)
      if (fromArgs) return fromArgs
      return lastUserUtterance(props) || ''
    }

    function expandHomePath(p, home) {
      var s = String(p || '').trim()
      if (!s) return ''
      if (s.charAt(0) === '~') {
        var h = String(home || '').trim()
        if (h) return (h.replace(/\/$/, '') + s.slice(1)).replace(/\/+/g, '/') || h
      }
      return s
    }

    /** DSH 当前会话工作区（侧栏已选目录 = session cwd） */
    function resolveDshCwd(props) {
      if (!props) return ''
      var direct = String(props.cwd || '').trim()
      if (direct) return expandHomePath(direct, props.home)
      try {
        if (typeof props.useSessions === 'function' && props.sessionId) {
          var cwd = props.useSessions(function (s) {
            var row = s && s.byId && s.byId[props.sessionId]
            return row && row.cwd
          })
          if (cwd) return expandHomePath(cwd, props.home)
        }
      } catch (e) {}
      return ''
    }

    function readAwaitAskUser(props) {
      try {
        var block = props && props.block
        // 本跳仍在执行（阻塞确认卡）：禁止用上一跳 need_clarify 把确认卡藏掉
        if (block && !toolBlockSettled(block)) return false
        var ui0 = readUiFromProps(props) || {}
        if (ui0.kind === 'await_ask_user' || ui0.kind === 'clarify') return true
        var value = block && (block.result || block.value || block.output)
        if (value && (value.need_clarify === true || value.need_clarify === 'true')) return true
        if (props && props.result && props.result.need_clarify) return true
      } catch (e) {}
      return false
    }

    /** 保留：供调试；确认卡显隐只认 need_clarify / await_ask_user，避免与服务端阻塞死锁 */
    function clientNeedsClarify(msg) {
      var t = String(msg || '').replace(/\s+/g, '')
      if (!t) return false
      if (/新增一列|加一列|增加一列|修一下|请求失败|bug/i.test(t)) return false
      var evidence = /澄清|选项|用户已选|用户选择|已确认[:：]|结论[:：]|只删|仅删|只去菜单|保留页面|保留路由/.test(
        String(msg || ''),
      )
      if (evidence) return false
      if (/(菜单|子菜单|页面|界面|路由|入口).{0,24}(删除|去掉|移除|下线)/.test(t)) return true
      if (/(删除|去掉|移除).{0,40}(报表)/.test(t) && /(菜单|报表中心|中心|导航|侧栏)/.test(t)) return true
      if (/(新增|增加|添加|新建).{0,28}(菜单|子菜单|页面|界面)/.test(t)) return true
      if (/(菜单|子菜单).{0,16}(新增|增加|添加|新建)/.test(t)) return true
      if (/(新增|增加|添加|新建).{0,24}(报表)/.test(t) && /(菜单|报表中心|中心|页面|页)/.test(t)) return true
      return false
    }

    function normReq(s) {
      return String(s || '')
        .replace(/\s+/g, '')
        .trim()
    }

    function requirementsConflict(a, b) {
      var na = normReq(a)
      var nb = normReq(b)
      if (!na || !nb) return false
      if (na === nb) return false
      var n = Math.min(80, na.length, nb.length)
      if (n >= 8 && na.slice(0, n) === nb.slice(0, n)) return false
      var head = Math.min(20, na.length, nb.length)
      return na.slice(0, head) !== nb.slice(0, head)
    }

    function cardIdentity(props, argsMsg, confirmTok) {
      var callId = String((props && props.callId) || '').trim()
      if (callId) return 'call:' + callId
      var block = props && props.block
      var blockId = String(
        (block && (block.id || block.callId || block.toolCallId || block.tool_call_id)) || '',
      ).trim()
      if (blockId) return 'block:' + blockId
      var tok = String(confirmTok || '').trim()
      if (tok) return 'tok:' + tok
      var msg = normReq(argsMsg || '')
      if (msg) return 'msg:' + msg.slice(0, 96)
      return ''
    }

    /**
     * 宿主默认 stepGrouping=collapsed：工具卡塞进「正在调用工具」折叠组。
     * 只改属性 / 必要时点一次。
     * 严禁改 overflow/height：会把聊天滚动容器弄坏 → 自动/手动都滚不动。
     */
    function expandParentProcessGroup(fromEl, allowClick) {
      try {
        var el = fromEl
        if (!el || typeof el.closest !== 'function') return false
        var opened = false
        var cur = el
        for (var depth = 0; depth < 10 && cur; depth++) {
          var group =
            (cur.closest && cur.closest('[data-step-process]')) ||
            (cur.closest && cur.closest('[data-process-group]')) ||
            (cur.closest && cur.closest('.process-group'))
          if (!group) break
          try {
            group.setAttribute('data-group-expanded-mode', 'true')
            group.setAttribute('data-expanded', 'true')
            group.setAttribute('aria-expanded', 'true')
            // 清掉历史误写的 inline overflow，恢复宿主样式表滚动
            if (group.style) {
              group.style.removeProperty('overflow')
              group.style.removeProperty('height')
              group.style.removeProperty('max-height')
            }
            var body = group.querySelector(
              '[data-step-process-body], .process-group-body, [data-collapsed-body]',
            )
            if (body) {
              body.hidden = false
              if (body.style) {
                body.style.removeProperty('overflow')
                body.style.removeProperty('height')
                body.style.removeProperty('max-height')
                body.style.removeProperty('display')
                body.style.removeProperty('visibility')
              }
            }
            opened = true
          } catch (eAttr) {}
          if (allowClick) {
            var btn = group.querySelector(
              'button[aria-expanded="false"], [role="button"][aria-expanded="false"]',
            )
            if (btn && typeof btn.click === 'function') {
              try {
                btn.click()
                opened = true
              } catch (eClick) {}
            }
          }
          cur = group.parentElement
        }
        return opened
      } catch (e) {
        return false
      }
    }

    /** 收集卡片祖先里所有可纵向滚动容器（不要求当前已溢出，避免找错/漏找） */
    function listChatScrollParents(fromEl) {
      var out = []
      try {
        var node = fromEl && fromEl.parentElement
        while (node && node !== document.documentElement) {
          var st = window.getComputedStyle(node)
          var oy = st && st.overflowY
          var ox = st && st.overflowX
          var canY =
            oy === 'auto' ||
            oy === 'scroll' ||
            oy === 'overlay' ||
            ((oy === 'hidden' || oy === 'clip') && node.scrollHeight > node.clientHeight + 2)
          if (canY || (node === document.body && document.scrollingElement)) {
            out.push(node)
          }
          // 常见宿主聊天主列 class / role
          try {
            var cls = String(node.className || '')
            var role = node.getAttribute && node.getAttribute('role')
            if (
              /chat|message|transcript|scroll|conversation|virtual/i.test(cls) ||
              role === 'log' ||
              role === 'list'
            ) {
              if (out.indexOf(node) < 0) out.push(node)
            }
          } catch (eCls) {}
          void ox
          node = node.parentElement
        }
        if (document.scrollingElement && out.indexOf(document.scrollingElement) < 0) {
          out.push(document.scrollingElement)
        }
      } catch (e) {}
      return out
    }

    function findChatScrollParent(fromEl) {
      var list = listChatScrollParents(fromEl)
      // 优先：真正已经能滚、且包含卡片的最近祖先
      for (var i = 0; i < list.length; i++) {
        var n = list[i]
        if (n && n.scrollHeight > n.clientHeight + 4) return n
      }
      return list[0] || null
    }

    function pinScrollersToBottom(fromEl) {
      var list = listChatScrollParents(fromEl)
      var moved = false
      for (var i = 0; i < list.length; i++) {
        var n = list[i]
        if (!n) continue
        try {
          if (n.scrollHeight > n.clientHeight + 2) {
            n.scrollTop = n.scrollHeight
            moved = true
          }
        } catch (e) {}
      }
      return moved
    }

    function transcriptSig(list) {
      if (!list || !list.length) return '0'
      var s = String(list.length)
      for (var i = 0; i < list.length; i++) {
        var it = list[i] || {}
        var body = String(it.text || '')
        var sum = 0
        for (var c = 0; c < body.length; c++) sum = (sum + body.charCodeAt(c)) % 100000
        s +=
          '|' +
          String(it.id || i) +
          ':' +
          String(it.kind || '') +
          ':' +
          body.length +
          ':' +
          sum +
          ':' +
          String(it.tool_status || '') +
          ':' +
          String(it.snippet || '').length +
          ':' +
          (it.streaming ? '1' : '0')
      }
      return s
    }

    /** 终态/已停止：收回宿主过程组，避免重开会话仍摊开「已调用工具并执行了命令」 */
    function collapseParentProcessGroup(fromEl) {
      try {
        var el = fromEl
        if (!el || typeof el.closest !== 'function') return false
        var closed = false
        var cur = el
        for (var depth = 0; depth < 10 && cur; depth++) {
          var group =
            (cur.closest && cur.closest('[data-step-process]')) ||
            (cur.closest && cur.closest('[data-process-group]')) ||
            (cur.closest && cur.closest('.process-group'))
          if (!group) break
          try {
            group.removeAttribute('data-group-expanded-mode')
            group.setAttribute('data-expanded', 'false')
          } catch (eAttr) {}
          var openBtns = group.querySelectorAll('button[aria-expanded="true"], [role="button"][aria-expanded="true"]')
          for (var i = 0; i < openBtns.length; i++) {
            try {
              if (typeof openBtns[i].click === 'function') openBtns[i].click()
              closed = true
            } catch (eClick) {}
          }
          cur = group.parentElement
        }
        return closed
      } catch (e) {
        return false
      }
    }

    /** 拆掉与本轮入参冲突的旧 job，禁止「新诉求却显示上一轮已完成」 */
    function detachStaleJobUi(uiRaw, argsMsg, lastUser) {
      var jobId = String((uiRaw && uiRaw.job_id) || '').trim()
      if (!jobId) return { ui: uiRaw || {}, stale: false }
      var args = String(argsMsg || '').trim()
      var user = String(lastUser || '').trim()
      var uiReq = String((uiRaw && (uiRaw.requirement || uiRaw.original_goal)) || '').trim()
      var live = args || user
      // 只认「双方都有原文且冲突」才拆。刷新时常丢 ui.requirement，禁止因此拆掉已完成 job（会丢 Diff/结论）
      var stale = !!(live && uiReq && requirementsConflict(live, uiReq))
      if (!stale) return { ui: uiRaw || {}, stale: false }
      return {
        stale: true,
        ui: {
          kind: uiRaw.parent_job_id || uiRaw.job_id ? 'continue' : uiRaw.kind || 'live',
          workspace: uiRaw.workspace,
          requirement: live,
          parent_job_id: uiRaw.parent_job_id || uiRaw.job_id || '',
          service: uiRaw.service,
          confirm_token: '',
          job_id: '',
          status: '',
          detail: '',
        },
      }
    }

    /**
     * 进度卡自己拦住渲染异常。
     * tool.call.toolview 是 keyed + session：异常冒到宿主 SlotErrorBoundary 后，
     * 该注册会被 abdicate，本会话后续 zr_cchat_begin 只剩空槽，写码过程不再出现。
     * 09:22:19 重启任务结束时的 React #311 就是这样把 09:23 的写码卡注销的。
     */
    function CursorCodingCardBoundary(props) {
      React.Component.call(this, props)
      this.state = { failed: false }
    }
    CursorCodingCardBoundary.prototype = Object.create(React.Component.prototype)
    CursorCodingCardBoundary.prototype.constructor = CursorCodingCardBoundary
    CursorCodingCardBoundary.getDerivedStateFromError = function () {
      return { failed: true }
    }
    CursorCodingCardBoundary.prototype.componentDidCatch = function (error) {
      try {
        console.error('[cursor-chat] 进度卡渲染失败，已拦住以免注销写码过程卡', error)
      } catch (eLog) {}
    }
    CursorCodingCardBoundary.prototype.render = function () {
      if (this.state && this.state.failed) {
        return h(
          'div',
          { className: 'cc-note', 'data-cc-card-error': '1' },
          '进度卡这一帧没有渲染出来。写码任务仍在本机进行；请再发一轮查看过程。',
        )
      }
      return this.props.children
    }

    /**
     * 须澄清时整卡隐藏。禁止在同组件里「先 return null 再跑 hooks」——
     * slot 按工具名复用实例时 hooks 数量变化会触发 React #300 / #311，
     * tool.call.toolview 整槽崩溃后只剩终态结论、写码过程不再渲染。
     */
    function CursorCodingBeginCard(props) {
      ensureCss()
      if (readAwaitAskUser(props)) {
        return null
      }
      return h(CursorCodingCardBoundary, null, h(CursorCodingBeginCardLive, props))
    }

    function CursorCodingBeginCardLive(props) {
      ensureCss()
      var uiRaw = readUiFromProps(props) || {}
      var argsMsg = toolArgsMessage(props && props.block)
      var lastUser = lastUserUtterance(props)
      var detached = detachStaleJobUi(uiRaw, argsMsg, lastUser)
      var ui = detached.ui
      var staleReuse = detached.stale
      var initialWs = resolveDshCwd(props) || String(ui.workspace || '').trim()
      var wsState = useState(initialWs)
      var workspace = wsState[0]
      var setWorkspace = wsState[1]
      var reqState = useState(
        staleReuse ? String(argsMsg || lastUser || ui.requirement || '').trim() : initialRequirement(props, ui),
      )
      var requirement = reqState[0]
      var setRequirement = reqState[1]
      var imageCountState = useState(Number((ui && ui.image_count) || 0) || 0)
      var imageCount = imageCountState[0]
      var setImageCount = imageCountState[1]
      var imageNamesState = useState(
        Array.isArray(ui && ui.image_names)
          ? ui.image_names.map(function (n) {
              return String(n || '').trim()
            }).filter(Boolean)
          : [],
      )
      var imageNames = imageNamesState[0]
      var setImageNames = imageNamesState[1]
      var parentState = useState(String(ui.parent_job_id || ''))
      var parentJobId = parentState[0]
      var setParentJobId = parentState[1]
      var tokenState = useState(String(ui.confirm_token || ''))
      var confirmToken = tokenState[0]
      var setConfirmToken = tokenState[1]
      var viewPhase0 = toolViewPhase(props)
      var block0 = props && props.block
      var argsJob0 = toolArgsJobId(block0)
      var result0 = readToolJobFields(
        (block0 && (block0.result || block0.value || block0.output)) || (props && props.result) || null,
      )
      var jobIdInit = staleReuse
        ? ''
        : String(ui.job_id || argsJob0 || result0.jobId || '').trim()
      var cache0 = jobIdInit ? loadSessionCache(jobIdInit) : null
      var abortedInit = toolBlockCancelled(block0)
      var settledInit = toolBlockSettled(block0) || viewPhase0 === 'result'
      // raw：严格认 RunningStatus。boot 对 start/preparing 乐观视为 live（避免首帧 RunningStatus 未挂就误封）。
      // 转圈只认 rawHostLive；孤儿 start 由下方 600ms effect 封口。
      var rawHostLive =
        typeof document !== 'undefined' && !!document.querySelector('[data-chat-running]')
      var hostLive0 =
        rawHostLive || viewPhase0 === 'start' || viewPhase0 === 'preparing'
      var statusInit = preferJobStatus(
        preferJobStatus((cache0 && cache0.status) || '', (ui && ui.status) || ''),
        result0.done ? String(result0.status || '') : '',
      )
      if (!statusInit && cache0 && cache0.phase === 'done') statusInit = 'succeeded'
      if (!statusInit && result0.done && TERMINAL_JOB[String(result0.status || '')]) {
        statusInit = String(result0.status)
      }
      var detailInit = String((cache0 && cache0.detail) || ui.detail || result0.detail || '').trim()
      var conclusionInit = String(
        (cache0 && cache0.chat_conclusion) || result0.chatBody || '',
      ).trim()
      var gitTool0 =
        toolBlockName(block0) === 'zr_cchat_git_deliver' || String((ui && ui.kind) || '') === 'git_deliver'
      var gitPlan0 = ui && ui.git_plan && typeof ui.git_plan === 'object' ? ui.git_plan : null
      // 与 cardBootstrap.resolveCardBoot 同口径（改一处必须改两处 + 自测）
      var boot = (function () {
        if (abortedInit) {
          return { phase: 'done', statusLabel: '已停止', sealedStatus: 'cancelled', cancelled: true }
        }
        // Git 交付：工具已返回确认卡计划时，即使宿主 turn 已停，也必须停在确认相位
        if (
          gitTool0 &&
          (gitPlan0 || String((ui && ui.status) || statusInit || '') === 'pending_review')
        ) {
          return {
            phase: 'review',
            statusLabel: '确认 Git 交付',
            sealedStatus: '',
            cancelled: false,
          }
        }
        if (!jobIdInit && settledInit) {
          return { phase: 'done', statusLabel: '已结束', sealedStatus: 'cancelled', cancelled: true }
        }
        // 有未终态 job：必须 running 并挂 SSE，禁止因 RunningStatus 滞后误封成「已停止」
        if (jobIdInit) {
          if (TERMINAL_JOB[statusInit]) {
            return {
              phase: 'done',
              statusLabel: labelFromJobStatus(statusInit) || '已停止',
              sealedStatus: statusInit,
              cancelled: statusInit === 'cancelled',
            }
          }
          var p = phaseFromJobStatus(statusInit || (cache0 && cache0.phase) || 'running', detailInit, -1)
          return {
            phase: p === 'done' ? 'running' : p,
            statusLabel:
              (cache0 && cache0.statusLabel) ||
              labelFromJobStatus(statusInit) ||
              (p === 'review' ? (gitTool0 ? '确认 Git 交付' : '待审同步') : gitTool0 ? '读取 Git 中' : '写码中'),
            sealedStatus: '',
            cancelled: false,
          }
        }
        if (!hostLive0) {
          return { phase: 'done', statusLabel: '已停止', sealedStatus: 'cancelled', cancelled: true }
        }
        if (viewPhase0 === 'start' || viewPhase0 === 'preparing') {
          return {
            phase: 'running',
            statusLabel: gitTool0 ? '读取 Git 中' : '写码中',
            sealedStatus: '',
            cancelled: false,
          }
        }
        return { phase: 'form', statusLabel: '', sealedStatus: '', cancelled: false }
      })()
      var phaseInit = boot.phase
      var phaseState = useState(phaseInit)
      var phase = phaseState[0]
      var setPhase = phaseState[1]
      var busyState = useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var errState = useState('')
      var err = errState[0]
      var setErr = errState[1]
      var copyFlashState = useState('')
      var copyFlash = copyFlashState[0]
      var setCopyFlash = copyFlashState[1]
      var jobState = useState(jobIdInit)
      var jobId = jobState[0]
      var setJobId = jobState[1]
      var streamState = useState('')
      var streamText = streamState[0]
      var setStreamText = streamState[1]
      var transcriptState = useState(
        cache0 && Array.isArray(cache0.transcript) ? cache0.transcript : [],
      )
      var transcript = transcriptState[0]
      var setTranscript = transcriptState[1]
      var statusLabelState = useState(boot.statusLabel)
      var statusLabel = statusLabelState[0]
      var setStatusLabel = statusLabelState[1]
      var toolName0 = toolBlockName(props && props.block)
      var workKindState = useState(
        toolName0 === 'zr_cchat_git_deliver' || (ui && ui.kind) === 'git_deliver' ? 'git_deliver' : '',
      )
      var workKind = workKindState[0]
      var setWorkKind = workKindState[1]
      var gitDeliverState = useState(gitPlan0)
      var gitDeliver = gitDeliverState[0]
      var setGitDeliver = gitDeliverState[1]
      // 点确认后立刻收起确认卡（勿等工具返回）；防 SSE 短暂 pending_review 又把卡刷回来
      var gitSubmittedState = useState(false)
      var gitSubmitted = gitSubmittedState[0]
      var setGitSubmitted = gitSubmittedState[1]
      var gitSubmittedRef = useRef(false)
      var conclusionState = useState(conclusionInit)
      var conclusionMd = conclusionState[0]
      var setConclusionMd = conclusionState[1]
      var filesState = useState({ synced: [], deleted: [] })
      var changedFiles = filesState[0]
      var setChangedFiles = filesState[1]
      var reviewState = useState({ inScope: [], deleted: [], deferred: [] })
      var review = reviewState[0]
      var setReview = reviewState[1]
      var selectedState = useState({})
      var selected = selectedState[0]
      var setSelected = selectedState[1]
      var expandState = useState('')
      var expandText = expandState[0]
      var setExpandText = expandState[1]
      var diffOpenState = useState({})
      var diffOpenMap = diffOpenState[0]
      var setDiffOpenMap = diffOpenState[1]
      var thinkFullState = useState({})
      var thinkFullMap = thinkFullState[0]
      var setThinkFullMap = thinkFullState[1]
      // 思考目标全文（服务端）→ 展示长度渐进追上，禁止整段硬蹦
      var thinkTargetRef = useRef({})
      var thinkShownRef = useRef({})
      var thinkRevealState = useState(0)
      var thinkRevealTick = thinkRevealState[0]
      var setThinkRevealTick = thinkRevealState[1]
      var steerState = useState('')
      var steerText = steerState[0]
      var setSteerText = steerState[1]
      var beRestartState = useState(null)
      var beRestart = beRestartState[0]
      var setBeRestart = beRestartState[1]
      var beHintState = useState('')
      var beHint = beHintState[0]
      var setBeHint = beHintState[1]
      var beConfirmState = useState(false)
      var beConfirmOpen = beConfirmState[0]
      var setBeConfirmOpen = beConfirmState[1]
      var pendingChoiceState = useState(null)
      var pendingChoice = pendingChoiceState[0]
      var setPendingChoice = pendingChoiceState[1]
      var choiceBusyState = useState(false)
      var choiceBusy = choiceBusyState[0]
      var setChoiceBusy = choiceBusyState[1]
      // 本卡本轮写码过才武装自动重启，避免刷新旧卡误杀端口
      var beAutoArmedRef = useRef(false)
      var beAutoDoneRef = useRef('')
      var reviewReadyRef = useRef(false)
      var esRef = useRef(null)
      // 卡内过程区：进展中强制贴底；完成后才允许自由滚
      var dialogPinRef = useRef(phaseInit === 'running' || phaseInit === 'review')
      var stickBottomRef = useRef(phaseInit === 'running' || phaseInit === 'review')
      // 整页聊天滚动：仅本页点确认后才允许轻推；刷新 remount 禁止抢会话位置
      var liveChatScrollRef = useRef(false)
      var phasePrevRef = useRef(phaseInit)
      // 工具卡身份：callId 变化必须硬重置，防止 React 复用实例带着旧 job「秒完成」
      var identityRef = useRef('')
      var identity = cardIdentity(props, argsMsg, ui.confirm_token)
      var cancelOnceRef = useRef(!!boot.cancelled)
      // 当前 job 已封口的权威 status；禁止晚到的 running 快照把卡打回「写码中」
      var sealedStatusRef = useRef(String(boot.sealedStatus || ''))
      var emptyDonePullRef = useRef('')
      var jobIdRef = useRef(jobIdInit)
      jobIdRef.current = jobId
      var confirmTokenRef = useRef(confirmToken)
      confirmTokenRef.current = confirmToken

      /** 取消/确认前兜底：从 awaiting / jobs-by-call / pending-latest 回填 token+jobId */
      function recoverGitDeliverHandles() {
        var baseUrl = base()
        var callId = String(
          (props && props.callId) ||
            (props && props.block && (props.block.callId || props.block.toolCallId || props.block.tool_call_id)) ||
            '',
        ).trim()
        var sid = String((props && props.sessionId) || '').trim()
        var ws = String(resolveDshCwd(props) || workspace || '').trim()
        var steps = []
        if (sid) {
          steps.push(
            fetch(baseUrl + '/api/cursor-chat/git-deliver/awaiting?session_id=' + encodeURIComponent(sid))
              .then(function (r) {
                return r.json()
              })
              .then(function (d) {
                var items = (d && d.items) || []
                var hit = null
                for (var i = 0; i < items.length; i++) {
                  var it = items[i]
                  if (!it || !it.confirm_token) continue
                  if (callId && it.dsh_call_id && String(it.dsh_call_id) !== callId) continue
                  hit = it
                  break
                }
                if (!hit && items.length) hit = items[0]
                return hit
                  ? {
                      token: String(hit.confirm_token || ''),
                      jobId: String(hit.job_id || ''),
                      plan: hit.git_plan || null,
                    }
                  : null
              })
              .catch(function () {
                return null
              }),
          )
        }
        if (callId) {
          steps.push(
            fetch(baseUrl + '/api/cursor-chat/jobs-by-call?call_id=' + encodeURIComponent(callId))
              .then(function (r) {
                return r.json()
              })
              .then(function (d) {
                if (!d || !d.found || !d.job_id) return null
                return fetch(baseUrl + '/api/cursor-chat/jobs/' + encodeURIComponent(d.job_id) + '?view=card')
                  .then(function (r2) {
                    return r2.json()
                  })
                  .then(function (pack) {
                    var job = pack && pack.job ? pack.job : pack
                    var g = (job && job.git_deliver) || {}
                    return {
                      token: String(g.confirm_token || ''),
                      jobId: String((job && job.id) || d.job_id || ''),
                      plan: g.remote_url ? g : null,
                    }
                  })
              })
              .catch(function () {
                return null
              }),
          )
        }
        if (ws && callId) {
          steps.push(
            fetch(
              baseUrl +
                '/api/cursor-chat/pending-latest?workspace=' +
                encodeURIComponent(ws) +
                '&call_id=' +
                encodeURIComponent(callId),
            )
              .then(function (r) {
                return r.json()
              })
              .then(function (d) {
                var p = d && d.pending
                if (!p) return null
                return {
                  token: String(p.confirm_token || ''),
                  jobId: String(p.job_id || ''),
                  plan: p.git_plan || null,
                }
              })
              .catch(function () {
                return null
              }),
          )
        }
        return Promise.all(steps).then(function (rows) {
          var out = { token: '', jobId: '', plan: null }
          for (var i = 0; i < rows.length; i++) {
            var row = rows[i]
            if (!row) continue
            if (!out.token && row.token) out.token = row.token
            if (!out.jobId && row.jobId) out.jobId = row.jobId
            if (!out.plan && row.plan) out.plan = row.plan
          }
          if (out.token) {
            confirmTokenRef.current = out.token
            setConfirmToken(out.token)
          }
          if (out.jobId) {
            jobIdRef.current = out.jobId
            setJobId(out.jobId)
          }
          if (out.plan) hydrateGitDeliver(out.plan)
          return out
        })
      }

      function hardResetToConfirm(nextReq) {
        try {
          if (esRef.current && typeof esRef.current.close === 'function') esRef.current.close()
        } catch (e) {}
        esRef.current = null
        reviewReadyRef.current = false
        liveChatScrollRef.current = false
        dialogPinRef.current = false
        stickBottomRef.current = false
        cancelOnceRef.current = false
        sealedStatusRef.current = ''
        emptyDonePullRef.current = ''
        jobIdRef.current = ''
        confirmTokenRef.current = ''
        gitSubmittedRef.current = false
        setGitSubmitted(false)
        setJobId('')
        setPhase('form')
        setBusy(false)
        setErr('')
        setCopyFlash('')
        setStreamText('')
        setTranscript([])
        setStatusLabel('')
        setWorkKind('')
        setGitDeliver(null)
        setConclusionMd('')
        setReview({ inScope: [], deleted: [], deferred: [] })
        setSelected({})
        setConfirmToken('')
        setParentJobId('')
        setBeRestart(null)
        setBeHint('')
        setBeConfirmOpen(false)
        setPendingChoice(null)
        setChoiceBusy(false)
        beAutoArmedRef.current = false
        beAutoDoneRef.current = ''
        var req = String(nextReq || argsMsg || lastUser || '').trim()
        if (req) setRequirement(req)
      }

      // 新工具调用 / 新诉求：绝不继承上一张卡的已完成 job
      useEffect(
        function () {
          if (!identity) return
          var prev = identityRef.current
          if (prev === identity) {
            // 同卡：只用本轮工具入参 argsMsg 比对，禁止 lastUser（会话最新一句会误拆进行中的卡）
            if (jobId && argsMsg && requirement) {
              var live = String(argsMsg || '').trim()
              // 进行中/已完成禁止因 args 晚到而 hardReset（会清空 jobId/SSE）
              if (live && requirementsConflict(live, requirement) && phase === 'form') {
                hardResetToConfirm(live)
              }
            }
            return
          }
          identityRef.current = identity
          if (!prev) return
          hardResetToConfirm(argsMsg || requirement)
        },
        [identity, argsMsg, jobId, requirement, phase],
      )

      // 写码中 / 终态恢复：展开宿主过程组，刷新后仍能看见 Diff+本轮结论
      useEffect(
        function () {
          var cardId =
            'cc-card-' + String(identity || jobId || confirmToken || (ui && ui.confirm_token) || 'x').trim()
          var stopped = false
          var abortedNow = toolBlockCancelled(props && props.block) || cancelOnceRef.current
          var sealDone =
            (phase === 'done' && !!TERMINAL_JOB[String(sealedStatusRef.current || '')]) ||
            (abortedNow && !jobId)
          var coding =
            !sealDone &&
            !cancelOnceRef.current &&
            (phase === 'form' || phase === 'running' || phase === 'review' || !!jobId)
          var needOpen = coding || sealDone || phase === 'done'
          if (!needOpen) return
          function pull(allowClick) {
            if (stopped) return
            var el = typeof document !== 'undefined' ? document.getElementById(cardId) : null
            if (!el) return
            expandParentProcessGroup(el, !!allowClick)
          }
          pull(true)
          var timers = [200, 600, 1400, 2800].map(function (ms, i) {
            return setTimeout(function () {
              pull(i === 0)
            }, ms)
          })
          return function () {
            stopped = true
            timers.forEach(function (t) {
              clearTimeout(t)
            })
          }
        },
        [phase, identity, jobId, confirmToken, props && props.block, transcript && transcript.length, conclusionMd],
      )

      // 无 job 的孤儿卡：宿主已停才封口。有未终态 job 时只 reconcile，禁止误取消写码过程。
      // begin 阻塞中 toolview 停在 start/preparing、jobId 尚未对账上：绝不可当孤儿封口（否则空等只见结论）。
      useEffect(
        function () {
          if (phase === 'done' || cancelOnceRef.current) return
          if (toolBlockCancelled(props && props.block)) return
          var vp = toolViewPhase(props)
          if (vp === 'start' || vp === 'preparing') return
          var jid = String(jobId || (ui && ui.job_id) || toolArgsJobId(props && props.block) || '').trim()
          var cardId =
            'cc-card-' + String(identity || jid || confirmToken || (ui && ui.confirm_token) || 'x').trim()
          var timer = setTimeout(function () {
            if (cancelOnceRef.current || phase === 'done') return
            var vp2 = toolViewPhase(props)
            if (vp2 === 'start' || vp2 === 'preparing') return
            var el = typeof document !== 'undefined' ? document.getElementById(cardId) : null
            var live =
              (el && turnIsLiveNear(el)) ||
              (typeof document !== 'undefined' && !!document.querySelector('[data-chat-running]'))
            if (live) return
            if (jid) {
              // 活 job：拉账本刷新；终态由 applyJobSnapshot 封口，绝不 cancelOnce 掐 SSE
              reconcileJob(jid)
              return
            }
            cancelOnceRef.current = true
            sealedStatusRef.current = sealedStatusRef.current || 'cancelled'
            setPhase('done')
            setStatusLabel('已停止')
            try {
              if (esRef.current && typeof esRef.current.close === 'function') esRef.current.close()
            } catch (e0) {}
            esRef.current = null
            if (el) collapseParentProcessGroup(el)
          }, 800)
          return function () {
            clearTimeout(timer)
          }
        },
        [phase, identity, jobId, props && props.phase, props && props.block],
      )

      function isProgressPhase(p) {
        return p === 'running' || p === 'review'
      }

      /** 过程增高 → 外层聊天贴底上推；用户明确上滑后暂停跟随 */
      function scrollStreamFollow(force) {
        if (!force && !stickBottomRef.current) return
        var cardId =
          'cc-card-' + String(identity || jobId || confirmToken || (ui && ui.confirm_token) || 'x').trim()
        var card =
          (typeof document !== 'undefined' && document.getElementById(cardId)) ||
          (typeof document !== 'undefined' && document.querySelector('.cc-card'))
        try {
          var el = document.getElementById('cc-dialog-' + (jobId || 'x'))
          if (el && el.scrollHeight > el.clientHeight + 4) {
            el.scrollTop = el.scrollHeight
          }
        } catch (e) {}
        try {
          if (card) pinScrollersToBottom(card)
          else scrollChatTowardBottom(!!force)
        } catch (e2) {}
      }

      // 会话工作区 / 用户原话晚到时再补一次
      useEffect(
        function () {
          var dsh = resolveDshCwd(props)
          if (dsh && dsh !== workspace) setWorkspace(dsh)
          if (!String(requirement || '').trim()) {
            var req = initialRequirement(props, ui)
            if (req) setRequirement(req)
          }
        },
        [props && props.cwd, props && props.sessionId],
      )

      // Git 确认卡：工具结果里已带 git_plan 时立刻灌表，不等 SSE
      useEffect(
        function () {
          var plan = (ui && ui.git_plan) || gitPlan0
          if (!plan || typeof plan !== 'object') return
          setWorkKind('git_deliver')
          if (ui && ui.confirm_token) setConfirmToken(String(ui.confirm_token))
          hydrateGitDeliver(plan)
          if (String((ui && ui.status) || '') === 'pending_review' || plan.remote_url) {
            setPhase('review')
            setStatusLabel('确认 Git 交付')
          }
        },
        [ui && ui.confirm_token, ui && ui.status, ui && ui.git_plan && ui.git_plan.remote_url],
      )

      useEffect(function () {
        return function () {
          if (esRef.current && typeof esRef.current.close === 'function') {
            try {
              esRef.current.close()
            } catch (e) {}
          }
        }
      }, [])

      // 进入进展：贴底跟随；form/running/review 都跟（begin 阻塞时也是 form/running）
      useEffect(
        function () {
          if (phase === 'running' || phase === 'review' || phase === 'form') {
            dialogPinRef.current = true
            stickBottomRef.current = true
            liveChatScrollRef.current = true
            var t = setTimeout(function () {
              scrollStreamFollow(true)
            }, 50)
            return function () {
              clearTimeout(t)
            }
          }
          dialogPinRef.current = false
          stickBottomRef.current = false
        },
        [phase],
      )

      // 过程卡空窗兜底：结论未出前至少留一行可见状态，禁止大块空白
      useEffect(
        function () {
          if (phase !== 'running' && phase !== 'review' && phase !== 'form') return
          if (cancelOnceRef.current) return
          if (transcript && transcript.length) return
          setTranscript([
            {
              id: 'cc-hold-' + String(jobId || identity || 'x'),
              kind: 'status',
              at: new Date().toISOString(),
              text: '正在连接写码进度，请稍候…',
              streaming: true,
            },
          ])
        },
        [phase, jobId, identity, transcript && transcript.length],
      )

      // 内容 / 思考显现增高 → 贴底跟随
      useEffect(
        function () {
          if (phase !== 'running' && phase !== 'review' && phase !== 'form') return
          if (!stickBottomRef.current) return
          var t = setTimeout(function () {
            scrollStreamFollow(false)
          }, 32)
          return function () {
            clearTimeout(t)
          }
        },
        [transcriptSig(transcript), phase, jobId, thinkRevealTick],
      )

      // ResizeObserver：进度卡变高就跟滚（比只依赖 React 依赖更稳）
      useEffect(
        function () {
          if (phase !== 'running' && phase !== 'review' && phase !== 'form') return
          var cardId =
            'cc-card-' + String(identity || jobId || confirmToken || (ui && ui.confirm_token) || 'x').trim()
          var card = typeof document !== 'undefined' ? document.getElementById(cardId) : null
          if (!card || typeof ResizeObserver === 'undefined') return
          // 清历史误伤 overflow
          try {
            var n = card
            for (var d = 0; d < 14 && n; d++) {
              if (
                n.getAttribute &&
                (n.getAttribute('data-step-process') != null ||
                  n.getAttribute('data-process-group') != null ||
                  (n.className && String(n.className).indexOf('process-group') >= 0))
              ) {
                if (n.style) {
                  n.style.removeProperty('overflow')
                  n.style.removeProperty('height')
                  n.style.removeProperty('max-height')
                }
              }
              n = n.parentElement
            }
          } catch (e0) {}
          var ro = new ResizeObserver(function () {
            if (!stickBottomRef.current) return
            scrollStreamFollow(false)
          })
          ro.observe(card)
          var keep = setInterval(function () {
            if (!stickBottomRef.current) return
            scrollStreamFollow(false)
          }, 700)
          return function () {
            try {
              ro.disconnect()
            } catch (e1) {}
            clearInterval(keep)
          }
        },
        [identity, jobId, confirmToken, phase],
      )

      // 用户滚轮/触控上滑 → 暂停跟随；回到底部附近 → 恢复
      useEffect(
        function () {
          var cardId =
            'cc-card-' + String(identity || jobId || confirmToken || (ui && ui.confirm_token) || 'x').trim()
          var card = typeof document !== 'undefined' ? document.getElementById(cardId) : null
          var scrollers = listChatScrollParents(card)
          if (!scrollers.length) return
          var lastUserIntent = 0
          function onWheel(ev) {
            try {
              if (ev && ev.deltaY < -2) {
                stickBottomRef.current = false
                lastUserIntent = Date.now()
              } else if (ev && ev.deltaY > 2) {
                // 向下滚且接近底则恢复
                var sc = findChatScrollParent(card)
                if (sc) {
                  var gap = sc.scrollHeight - sc.scrollTop - sc.clientHeight
                  if (gap < 48) stickBottomRef.current = true
                }
              }
            } catch (e0) {}
          }
          function onScroll(ev) {
            try {
              var sc = (ev && ev.currentTarget) || findChatScrollParent(card)
              if (!sc) return
              var gap = sc.scrollHeight - sc.scrollTop - sc.clientHeight
              // 程序贴底也会触发 scroll；仅在用户刚滚过之后才根据 gap 解绑
              if (Date.now() - lastUserIntent < 800) {
                if (gap > 64) stickBottomRef.current = false
                else if (gap < 28) stickBottomRef.current = true
              } else if (gap < 28) {
                stickBottomRef.current = true
              }
            } catch (e1) {}
          }
          for (var i = 0; i < scrollers.length; i++) {
            scrollers[i].addEventListener('scroll', onScroll, { passive: true })
            scrollers[i].addEventListener('wheel', onWheel, { passive: true })
          }
          return function () {
            for (var j = 0; j < scrollers.length; j++) {
              scrollers[j].removeEventListener('scroll', onScroll)
              scrollers[j].removeEventListener('wheel', onWheel)
            }
          }
        },
        [identity, jobId, confirmToken, phase],
      )

      // 同步思考目标全文；展示长度由独立时钟追上（不因 SSE 重渲整段蹦出）
      useEffect(
        function () {
          var targets = thinkTargetRef.current
          var shown = thinkShownRef.current
          ;(transcript || []).forEach(function (it) {
            if (!it || it.kind !== 'thinking') return
            var id = String(it.id || '')
            if (!id) return
            var full = String(it.text || '')
            var prev = String(targets[id] || '')
            targets[id] = full
            if (shown[id] == null) shown[id] = 0
            // 新段落（变短或前缀不一致）：从头显现
            if (full.length < prev.length || (prev && full.indexOf(prev.slice(0, Math.min(32, prev.length))) !== 0)) {
              shown[id] = 0
            }
            if (!it.streaming && shown[id] < full.length && full.length - shown[id] < 20) {
              shown[id] = full.length
            }
          })
        },
        [transcript],
      )

      useEffect(
        function () {
          if (phase === 'done') {
            var targetsDone = thinkTargetRef.current
            var shownDone = thinkShownRef.current
            var snap = false
            Object.keys(targetsDone).forEach(function (id) {
              var len = String(targetsDone[id] || '').length
              if (Number(shownDone[id] || 0) !== len) {
                shownDone[id] = len
                snap = true
              }
            })
            if (snap) {
              setThinkRevealTick(function (n) {
                return (n + 1) % 100000
              })
            }
            return
          }
          if (phase !== 'running' && phase !== 'review' && phase !== 'form') return
          var stopped = false
          function step() {
            if (stopped) return
            var targets = thinkTargetRef.current
            var shown = thinkShownRef.current
            var changed = false
            Object.keys(targets).forEach(function (id) {
              var full = String(targets[id] || '')
              var cur = Number(shown[id] || 0)
              if (cur > full.length) {
                shown[id] = 0
                cur = 0
              }
              if (cur >= full.length) return
              var nl = full.indexOf('\n', cur)
              var next
              if (nl >= cur && nl - cur <= 120) {
                next = nl + 1
              } else {
                // 追赶时略快，接近 Cursor 流式体感；禁止一次吐完
                var lag = full.length - cur
                var pace = lag > 800 ? 90 : lag > 300 ? 56 : 36
                next = Math.min(full.length, cur + pace)
              }
              shown[id] = next
              changed = true
            })
            if (changed) {
              setThinkRevealTick(function (n) {
                return (n + 1) % 100000
              })
            }
            timer = setTimeout(step, 28)
          }
          var timer = setTimeout(step, 42)
          return function () {
            stopped = true
            clearTimeout(timer)
          }
        },
        [phase],
      )

      function thinkingDisplayText(it) {
        var id = String((it && it.id) || '')
        var full = String((it && it.text) || '')
        if (!id) return full
        thinkTargetRef.current[id] = full
        var n = Number(thinkShownRef.current[id] || 0)
        if (n <= 0) return ''
        if (n >= full.length) return full
        return full.slice(0, n)
      }

      function onDialogScroll(ev) {
        try {
          var el = ev && ev.currentTarget
          if (!el) return
          var gap = el.scrollHeight - el.scrollTop - el.clientHeight
          if (gap > 48) stickBottomRef.current = false
          else if (gap < 16) stickBottomRef.current = true
        } catch (e) {}
      }

      // begin 阻塞未返回（phase=start）：用 callId 对账 job 并挂 SSE，否则用户空等只见终态结论
      // 优先 jobs-by-call；旧子进程无该路由时回退 pending-latest（launch 已落盘 call_id→job_id）
      useEffect(
        function () {
          if (jobId) return
          if (cancelOnceRef.current) return
          var vp = toolViewPhase(props)
          var needPull = vp === 'start' || vp === 'preparing' || phase === 'form' || phase === 'running'
          if (!needPull) return
          var block = props && props.block
          var callId = String(
            (props && props.callId) ||
              (block && (block.callId || block.toolCallId || block.tool_call_id)) ||
              '',
          ).trim()
          if (!callId) return
          var ws = String(resolveDshCwd(props) || workspace || '').trim()
          var stopped = false
          function attach(jid, hint) {
            if (!jid || stopped) return
            setJobId(String(jid))
            var isGit =
              (hint && hint.work_kind === 'git_deliver') ||
              workKind === 'git_deliver' ||
              toolBlockName(props && props.block) === 'zr_cchat_git_deliver'
            if (isGit) {
              setWorkKind('git_deliver')
              // 已有计划时直接进人审相位，禁止 attach 把确认卡打回「读取中」
              setPhase(function (prev) {
                return prev === 'review' ? prev : 'running'
              })
              setStatusLabel(function (prev) {
                return prev === '确认 Git 交付' ? prev : '读取 Git 中'
              })
            } else {
              setPhase('running')
              setStatusLabel('写码中')
            }
            reconcileJob(String(jid))
            if (!esRef.current) openStream(String(jid))
          }
          function hydrateGitPending(pending) {
            if (!pending) return
            if (pending.call_id && String(pending.call_id) !== callId) return
            if (pending.confirm_token) setConfirmToken(String(pending.confirm_token))
            if (pending.kind === 'git_deliver') {
              setWorkKind('git_deliver')
              if (pending.git_plan) {
                hydrateGitDeliver(pending.git_plan)
                setPhase('review')
                setStatusLabel('确认 Git 交付')
              }
            }
            if (pending.job_id) attach(String(pending.job_id), { work_kind: pending.kind || '' })
          }
          function pullPending() {
            if (stopped || !ws) return Promise.resolve(null)
            return fetch(
              serviceBase() +
                '/api/cursor-chat/pending-latest?workspace=' +
                encodeURIComponent(ws) +
                '&call_id=' +
                encodeURIComponent(callId),
            )
              .then(function (r2) {
                return r2.json()
              })
              .then(function (d2) {
                if (stopped || !d2 || !d2.pending) return null
                hydrateGitPending(d2.pending)
                return d2
              })
              .catch(function () {
                return null
              })
          }
          function pull() {
            if (stopped) return
            var base = serviceBase()
            // 已挂 job 时：写码停拉；Git 仍要继续拉 pending，否则 jobs-by-call 抢先挂上会永远灌不进确认卡
            var isGitTool =
              workKind === 'git_deliver' || toolBlockName(props && props.block) === 'zr_cchat_git_deliver'
            if (jobIdRef.current && !isGitTool) return
            if (jobIdRef.current && isGitTool) {
              pullPending()
              return
            }
            fetch(base + '/api/cursor-chat/jobs-by-call?call_id=' + encodeURIComponent(callId))
              .then(function (r) {
                return r.json().then(function (d) {
                  return { status: r.status, d: d }
                })
              })
              .then(function (pack) {
                if (stopped || jobIdRef.current) return pullPending()
                var d = pack && pack.d
                if (d && d.found && d.job_id) {
                  if (d.work_kind === 'git_deliver') setWorkKind('git_deliver')
                  attach(String(d.job_id), { work_kind: d.work_kind || '' })
                  // Git：必须再拉 pending 拿 confirm_token + git_plan（jobs-by-call 不含计划）
                  if (d.work_kind === 'git_deliver') return pullPending()
                  return null
                }
                return pullPending()
              })
              .catch(function () {})
          }
          pull()
          var t = setInterval(pull, 700)
          return function () {
            stopped = true
            clearInterval(t)
          }
        },
        [phase, jobId, workspace, props && props.phase, props && props.callId, props && props.block],
      )

      // begin 已开工：立刻从服务水合会话态（刷新后不依赖陈旧 presentationMeta），再挂 SSE
      useEffect(
        function () {
          var jid = String(jobId || '').trim()
          if (!jid) {
            var cand = String((ui && ui.job_id) || result0.jobId || '').trim()
            if (cand && !staleReuse) {
              var live0 = String(argsMsg || lastUser || requirement || '').trim()
              var ureq0 = String((ui && (ui.requirement || ui.original_goal)) || '').trim()
              // 禁止用与本轮入参冲突的旧 presentationMeta.job_id 重新挂上
              if (!live0 || !ureq0 || !requirementsConflict(live0, ureq0)) jid = cand
            }
          }
          if (!jid) return
          if (cancelOnceRef.current || toolBlockCancelled(props && props.block)) return
          // 终态也必须水合 transcript/结论（刷新会话）；仅跳过把 form 打回 running + 跳过 SSE
          var sealedDone =
            (phase === 'done' && !!TERMINAL_JOB[String(sealedStatusRef.current || '')]) ||
            !!TERMINAL_JOB[String(sealedStatusRef.current || '')]
          if (phase === 'form' && !sealedDone) {
            setPhase(phaseFromJobStatus((ui && ui.status) || 'running'))
            setStatusLabel(labelFromJobStatus((ui && ui.status) || 'running') || '写码中')
          }
          reconcileJob(jid)
          if (!sealedDone && !esRef.current) openStream(jid)
        },
        [jobId, identity, staleReuse, argsMsg, lastUser, requirement],
      )

      function onCancelTask() {
        cancelOnceRef.current = true
        setTranscript(function (prev) {
          return sealTranscriptItems(prev)
        })
        setPhase('done')
        setStatusLabel('已取消')
        setConclusionMd(function (prev) {
          return String(prev || '').trim() ? prev : stoppedConclusionMd(workKind)
        })
        dialogPinRef.current = false
        stickBottomRef.current = false
        try {
          if (esRef.current && typeof esRef.current.close === 'function') esRef.current.close()
        } catch (e0) {}
        esRef.current = null
        var jid = String(jobId || (ui && ui.job_id) || toolArgsJobId(props && props.block) || '').trim()
        var callId = String((props && props.callId) || '').trim()
        function postCancel(id) {
          if (!id) return Promise.resolve(null)
          return fetch(base() + '/api/hitl/issue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'cursor-chat.cancel', job_id: id }),
          })
            .then(function (r) {
              return r.json()
            })
            .then(function (issued) {
              if (!issued || !issued.ok || !issued.nonce) {
                throw new Error((issued && issued.detail) || '签发取消令牌失败')
              }
              return fetch(base() + '/api/cursor-chat/jobs/' + encodeURIComponent(id) + '/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nonce: issued.nonce }),
              })
            })
            .then(function (r) {
              return r.json()
            })
            .then(function (d) {
              if (d && d.job) {
                if (Array.isArray(d.job.transcript)) {
                  setTranscript(sealTranscriptItems(d.job.transcript))
                }
                var conc = conclusionFromJob(d.job)
                if (conc) setConclusionMd(conc)
              }
              setPhase('done')
              setStatusLabel('已取消')
              return d
            })
        }
        // 无 jobId 时用 call_id 对账，避免宿主停止时漏取消后台写码
        var resolveId = jid
          ? Promise.resolve(jid)
          : callId
            ? fetch(base() + '/api/cursor-chat/jobs-by-call?call_id=' + encodeURIComponent(callId))
                .then(function (r) {
                  return r.json()
                })
                .then(function (d) {
                  return String((d && (d.job_id || (d.job && d.job.id))) || '').trim()
                })
                .catch(function () {
                  return ''
                })
            : Promise.resolve('')
        resolveId
          .then(function (id) {
            return postCancel(id)
          })
          .catch(function () {})
        // Git 交付阻塞在 wait：停止时须同时取消确认等待，否则工具永不返回
        if (workKind === 'git_deliver') {
          var gToken = String(
            confirmToken ||
              (gitDeliver && gitDeliver.confirm_token) ||
              (ui && ui.confirm_token) ||
              '',
          ).trim()
          var gJob = String(jobId || (ui && ui.job_id) || '').trim()
          if (gToken || gJob) {
            fetch(base() + '/api/cursor-chat/git-deliver/cancel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                confirm_token: gToken,
                job_id: gJob,
                reason: '用户停止',
              }),
            }).catch(function () {})
          }
        }
      }

      useEffect(
        function () {
          var block = props && props.block
          if (toolBlockCancelled(block)) {
            sealedStatusRef.current = sealedStatusRef.current || 'cancelled'
            if (!cancelOnceRef.current) {
              onCancelTask()
              setStatusLabel('已停止')
            } else {
              setPhase('done')
              setStatusLabel(function (prev) {
                return prev && prev !== '写码中' && prev !== '自动同步中' && prev !== '准备中'
                  ? prev
                  : '已停止'
              })
              setConclusionMd(function (prev) {
                if (String(prev || '').trim()) return prev
                var payload0 = readToolJobFields(
                  (block && (block.result || block.value || block.output)) ||
                    (props && props.result) ||
                    null,
                )
                var body0 = String(payload0.chatBody || '').trim()
                if (body0) return concludeMdForWorkKind(body0, workKind)
                return stoppedConclusionMd(workKind)
              })
            }
            return
          }
          // 无 job 的已结算 begin（空失败/被停）：禁止停留 form 转圈
          if (!jobId && toolBlockSettled(block) && phase === 'form') {
            sealedStatusRef.current = sealedStatusRef.current || 'cancelled'
            setPhase('done')
            setStatusLabel(function (prev) {
              return prev || '已结束'
            })
            return
          }
          if (cancelOnceRef.current) return
          if (phase === 'done' && sealedStatusRef.current) return
          var payload = readToolJobFields(
            (block && (block.result || block.value || block.output)) || (props && props.result) || null,
          )
          var vJob = payload.jobId
          var vSt = payload.status
          var uiJid = String((ui && ui.job_id) || '').trim()
          var uiSt = String((ui && ui.status) || '').trim()
          var sameJob = function (id) {
            return jobId && id && String(id) === String(jobId)
          }
          // 只认本卡 job_id 的工具结果 status。进行中 leftover 无 done=true，不会误封。
          if (
            payload.done === true &&
            (TERMINAL_JOB[vSt] || vSt === 'pending_review') &&
            vJob &&
            (!jobId || sameJob(vJob)) &&
            (!uiJid || uiJid === vJob)
          ) {
            if (!jobId) setJobId(vJob)
            // 工具一返回立刻钉结论，不等宿主下一轮「深度求索」
            if (payload.chatBody) setConclusionMd(normalizeConclusionMd(payload.chatBody))
            applyJobSnapshot({
              id: vJob,
              status: vSt,
              detail: payload.detail,
              chat_conclusion: payload.chatBody || undefined,
              review_in_scope: ui && ui.review_in_scope,
              review_deleted: ui && ui.review_deleted,
              review_deferred: ui && ui.review_deferred,
            })
            reconcileJob(vJob)
            return
          }
          if (sameJob(uiJid) && (TERMINAL_JOB[uiSt] || uiSt === 'pending_review')) {
            applyJobSnapshot({
              id: jobId,
              status: uiSt,
              detail: String((ui && ui.detail) || ''),
              review_in_scope: ui.review_in_scope,
              review_deleted: ui.review_deleted,
              review_deferred: ui.review_deferred,
            })
            reconcileJob(jobId)
            return
          }
          if ((toolBlockSettled(block) || payload.done === true) && phase === 'running' && jobId) {
            reconcileJob(jobId)
          }
        },
        [props && props.block, props && props.result, ui && ui.status, ui && ui.job_id, phase, jobId],
      )

      function applyJobSnapshot(job) {
        if (!job) return
        var incomingId = String(job.id || '').trim()
        var liveId = String((jobIdRef && jobIdRef.current) || jobId || '').trim()
        if (incomingId && liveId && incomingId !== liveId) return
        var st = String(job.status || '')
        if (!shouldApplyJobSnapshot(sealedStatusRef.current, st)) {
          return
        }
        if (cancelOnceRef.current) {
          setTranscript(function (prev) {
            var src = Array.isArray(job.transcript) && job.transcript.length ? job.transcript : prev
            return sealTranscriptItems(src)
          })
          setPhase('done')
          setStatusLabel(function (prev) {
            return prev && prev !== '写码中' && prev !== '自动同步中' ? prev : '已取消'
          })
          // 停止后仍要落结论，禁止一直停在「正在汇总本轮结论」转圈
          var cancelConc = conclusionFromJob(job)
          if (cancelConc) {
            setConclusionMd(cancelConc)
          } else {
            setConclusionMd(function (prev) {
              return String(prev || '').trim()
                ? prev
                : stoppedConclusionMd(job.work_kind || workKind)
            })
          }
          // Git 停止：清空候选文件列表，避免结论下仍挂「已编辑 N 个文件」
          if (job.work_kind === 'git_deliver') {
            setChangedFiles({ synced: [], deleted: [] })
          }
          dialogPinRef.current = false
          stickBottomRef.current = false
          return
        }
        var detail = String(job.detail || '')
        var inScopeLen = Array.isArray(job.review_in_scope) ? job.review_in_scope.length : -1
        var reviewGate = job.review_gate || null
        var nextPhase = phaseFromJobStatus(st, detail, inScopeLen, reviewGate)
        var nextLabel = labelFromJobStatus(st, detail, inScopeLen, reviewGate)
        if (job.work_kind === 'ops' || job.work_kind === 'code' || job.work_kind === 'git_deliver') {
          setWorkKind(function (prev) {
            return prev === job.work_kind ? prev : job.work_kind
          })
        }
        if (job.work_kind === 'git_deliver' && job.git_deliver) {
          hydrateGitDeliver(job.git_deliver)
          if (job.git_deliver.stage === 'paused' || st === 'cancelled') {
            // 暂停/取消终态：禁止再被 risk_gate 或 running 文案带回转圈
            nextPhase = 'done'
            nextLabel = job.git_deliver.stage === 'paused' || /暂停提交/.test(detail)
              ? '已暂停提交'
              : nextLabel || '已取消'
          } else if (job.git_deliver.risk_gate === 'await_risk') {
            nextPhase = 'review'
            nextLabel =
              job.git_deliver.risk_code === 'files_skipped'
                ? '有勾选文件未能纳入审码'
                : job.git_deliver.risk_kind === 'engine_unavailable'
                  ? '审码引擎不可用'
                  : '本批存在高危，请选择修复或暂停'
          }
        }
        if (TERMINAL_JOB[st]) sealedStatusRef.current = st
        var phaseOut = nextPhase
        var labelOut = nextLabel
        var isGitJob = job.work_kind === 'git_deliver'
        if (
          isGitJob &&
          !gitSubmittedRef.current &&
          /已确认|正在审码|正在 commit|正在推送|重试推送|正在重试推送/.test(detail)
        ) {
          gitSubmittedRef.current = true
          setGitSubmitted(true)
        }
        if (nextPhase === 'done') {
          phaseOut = 'done'
          labelOut = nextLabel || '已完成'
          dialogPinRef.current = false
          stickBottomRef.current = false
        } else if (
          isGitJob &&
          gitSubmittedRef.current &&
          (st === 'pending_review' || st === 'running' || st === 'queued' || st === 'syncing')
        ) {
          // 已点确认：禁止再回人审卡；文案用 commit/push，禁止「写码中」
          phaseOut = 'running'
          labelOut = gitPostConfirmLabel(detail, nextLabel)
          dialogPinRef.current = true
          stickBottomRef.current = true
          beAutoArmedRef.current = true
        } else if (nextPhase === 'review' || (isGitJob && st === 'pending_review')) {
          // Git 人审：pending_review 一律进人审卡，禁止被「待审同步/自动同步」文案带跑
          phaseOut = 'review'
          labelOut = isGitJob ? '确认 Git 交付' : nextLabel || '待审同步'
          dialogPinRef.current = true
          stickBottomRef.current = true
          beAutoArmedRef.current = true
          if (!isGitJob && (job.review_in_scope || job.review_deferred)) {
            enterReview({
              in_scope: job.review_in_scope || [],
              deleted: job.review_deleted || [],
              deferred: job.review_deferred || job.deferred_files || [],
            })
          }
        } else if (st === 'pending_review') {
          phaseOut = 'running'
          labelOut = nextLabel || '自动同步中'
          dialogPinRef.current = true
          stickBottomRef.current = true
          beAutoArmedRef.current = true
        } else if (st === 'running' || st === 'queued' || st === 'syncing') {
          phaseOut = 'running'
          if (isGitJob && gitSubmittedRef.current) {
            labelOut = gitPostConfirmLabel(detail, nextLabel)
          } else {
            labelOut =
              st === 'syncing' ? '自动同步中' : nextLabel || (isGitJob ? '读取 Git 中' : '写码中')
            if (isGitJob && labelOut === '写码中') labelOut = '读取 Git 中'
          }
          dialogPinRef.current = true
          stickBottomRef.current = true
          beAutoArmedRef.current = true
        } else if (st) {
          phaseOut = nextPhase === 'form' ? 'running' : nextPhase
          labelOut = nextLabel || ''
        }
        setPhase(function (prev) {
          return prev === phaseOut ? prev : phaseOut
        })
        if (labelOut) {
          setStatusLabel(function (prev) {
            return prev === labelOut ? prev : labelOut
          })
        }
        if (Array.isArray(job.transcript) && job.transcript.length) {
          var nextTr =
            phaseOut === 'done' ? sealTranscriptItems(job.transcript) : job.transcript
          setTranscript(function (prev) {
            if (transcriptSig(prev) === transcriptSig(nextTr)) return prev
            return nextTr
          })
        }
        var conc = conclusionFromJob(job)
        if (conc) setConclusionMd(conc)
        // Git 交付：进度卡不挂写码「已编辑」列表（成功文件只在结论正文）
        var syncedNow = isGitJob
          ? []
          : job.synced_files || job.last_synced_files || job.review_in_scope || []
        var deletedNow = isGitJob ? [] : job.deleted_files || job.review_deleted || []
        if ((syncedNow && syncedNow.length) || (deletedNow && deletedNow.length)) {
          setChangedFiles({
            synced: Array.isArray(syncedNow) ? syncedNow : [],
            deleted: Array.isArray(deletedNow) ? deletedNow : [],
          })
        } else if (isGitJob) {
          setChangedFiles({ synced: [], deleted: [] })
        }
        if (job.backend_restart && job.backend_restart.offered) {
          setBeRestart(function (prev) {
            var next = job.backend_restart
            // 本地已下发、账本尚未回写时，禁止 reconcile 冲掉 started_at（否则黄条一闪又变「将自动」）
            if (
              prev &&
              prev.started_at &&
              !next.started_at &&
              Number(prev.port || 0) === Number(next.port || 0)
            ) {
              return Object.assign({}, next, {
                started_at: prev.started_at,
                last_detail: prev.last_detail || next.last_detail || null,
                shell_lines: prev.shell_lines || next.shell_lines,
              })
            }
            return next
          })
        } else if (job.backend_restart === null || job.backend_restart === undefined) {
          setBeRestart(null)
        }
        if (typeof job.backend_restart_hint === 'string') {
          setBeHint(String(job.backend_restart_hint || ''))
        } else if (job.backend_restart_hint === null) {
          setBeHint('')
        }
        if (job.pending_user_choice && job.pending_user_choice.question) {
          setPendingChoice(job.pending_user_choice)
        } else if (job.pending_user_choice === null || TERMINAL_JOB[st]) {
          setPendingChoice(null)
        }
        var jid = String(job.id || jobId || '').trim()
        if (jid) {
          saveSessionCache(jid, {
            status: st,
            phase: nextPhase === 'form' ? 'running' : nextPhase,
            statusLabel: nextLabel || st,
            transcript: Array.isArray(job.transcript) ? job.transcript : undefined,
            chat_conclusion: conc || undefined,
          })
        }
      }

      function submitUserChoice(choice) {
        var id = String(jobId || '').trim()
        var text = String(choice || '').trim()
        if (!id || !text || choiceBusy) return
        setChoiceBusy(true)
        fetch(base() + '/api/hitl/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cursor-chat.user-choice', job_id: id }),
        })
          .then(function (r) {
            return r.json()
          })
          .then(function (issued) {
            if (!issued || !issued.ok || !issued.nonce) {
              throw new Error((issued && issued.detail) || '签发确认令牌失败')
            }
            return fetch(base() + '/api/cursor-chat/jobs/' + encodeURIComponent(id) + '/user-choice', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ choice: text, nonce: issued.nonce }),
            })
          })
          .then(function (r) {
            return r.json().then(function (d) {
              return { status: r.status, data: d }
            })
          })
          .then(function (out) {
            if (!out.data || !out.data.ok) {
              throw new Error((out.data && out.data.detail) || '确认失败 HTTP ' + out.status)
            }
            setPendingChoice(null)
            appendStream('用户已选：' + String(out.data.answer || text))
          })
          .catch(function (e) {
            setErr(String((e && e.message) || e || '确认失败'))
          })
          .finally(function () {
            setChoiceBusy(false)
          })
      }

      function reconcileJob(jid) {
        var id = String(jid || jobId || '').trim()
        if (!id) return Promise.resolve(null)
        return fetch(base() + '/api/cursor-chat/jobs/' + encodeURIComponent(id) + '?view=card')
          .then(function (r) {
            return r.json()
          })
          .then(function (j) {
            // 服务返回 { ok, job }，旧逻辑误读顶层 status 导致刷新永不恢复终态
            var job = j && j.job ? j.job : j
            if (job && (job.id || job.status)) {
              applyJobSnapshot(job)
              return job
            }
            return null
          })
          .catch(function () {
            return null
          })
      }

      function base() {
        return (ui.service && String(ui.service)) || serviceBase()
      }

      function appendStream(line) {
        setStreamText(function (prev) {
          var next = (prev ? prev + '\n' : '') + line
          if (next.length > 16000) return next.slice(-14000)
          return next
        })
      }

      function enterReview(payload) {
        reviewReadyRef.current = true
        var inScope = payload.in_scope || payload.review_in_scope || []
        var deleted = payload.deleted || payload.review_deleted || []
        var deferred = payload.deferred || payload.review_deferred || []
        setReview({ inScope: inScope, deleted: deleted, deferred: deferred })
        var next = {}
        inScope.forEach(function (p) {
          next[p] = true
        })
        deleted.forEach(function (p) {
          next[p] = true
        })
        deferred.forEach(function (p) {
          if (next[p] === undefined) next[p] = false
        })
        setSelected(next)
        setPhase('review')
        setStatusLabel('待审同步')
      }

      function hydrateGitDeliver(raw) {
        if (!raw || typeof raw !== 'object') return
        var entries = Array.isArray(raw.entries) ? raw.entries : null
        var selectedFiles = Array.isArray(raw.selected_files) ? raw.selected_files : []
        var held = Array.isArray(raw.held_sensitive_files) ? raw.held_sensitive_files : []
        var nextSel = {}
        if (entries && entries.length) {
          entries.forEach(function (e) {
            if (!e || !e.rel) return
            nextSel[e.rel] = e.sensitive ? false : e.selected !== false
          })
        } else {
          selectedFiles.forEach(function (p) {
            nextSel[p] = true
          })
          held.forEach(function (p) {
            nextSel[p] = false
          })
        }
        setSelected(function (prev) {
          return Object.keys(nextSel).length ? nextSel : prev
        })
        var tok = String(raw.confirm_token || '').trim()
        if (tok) {
          confirmTokenRef.current = tok
          setConfirmToken(tok)
        }
        setGitDeliver({
          remote_url: String(raw.remote_url || ''),
          current_branch: String(raw.current_branch || ''),
          target_branch: String(raw.target_branch || raw.current_branch || ''),
          base_branch: String(raw.base_branch || 'main'),
          commit_message: String(raw.commit_message || ''),
          create_pr: raw.create_pr !== false,
          selected_files: selectedFiles,
          held_sensitive_files: held,
          confirm_token: tok || confirmTokenRef.current || undefined,
          entries: entries,
          risk_gate: raw.risk_gate === 'await_risk' ? 'await_risk' : null,
          risk_kind:
            raw.risk_kind === 'engine_unavailable'
              ? 'engine_unavailable'
              : raw.risk_kind === 'high'
                ? 'high'
                : null,
          risk_code: raw.risk_code === 'files_skipped' ? 'files_skipped' : null,
          high_count: Number(raw.high_count || 0) || 0,
          medium_count: Number(raw.medium_count || 0) || 0,
          low_count: Number(raw.low_count || 0) || 0,
          risk_summary: String(raw.risk_summary || ''),
          report_id: String(raw.report_id || ''),
          high_titles: Array.isArray(raw.high_titles)
            ? raw.high_titles.map(function (t) {
                return String(t || '')
              }).filter(Boolean)
            : [],
        })
      }

      function onGitDeliverRiskDecision(decision) {
        setErr('')
        setBusy(true)
        var g0 = gitDeliver || {}
        Promise.resolve()
          .then(function () {
            var token0 = String(
              confirmTokenRef.current ||
                confirmToken ||
                g0.confirm_token ||
                (ui && ui.confirm_token) ||
                '',
            ).trim()
            if (token0) return { token: token0, jobId: String(jobIdRef.current || jobId || ''), plan: null }
            return recoverGitDeliverHandles()
          })
          .then(function (ids) {
            var token = String((ids && ids.token) || '').trim()
            if (!token) throw new Error('确认令牌未就绪，请稍候再点。')
            return fetch(base() + '/api/hitl/issue', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'cursor-chat.git-deliver-risk',
                confirm_token: token,
                workspace: workspace,
              }),
            })
              .then(function (r) {
                return r.json()
              })
              .then(function (issued) {
                if (!issued || !issued.ok || !issued.nonce) {
                  throw new Error((issued && issued.detail) || '签发 HITL 失败')
                }
                return fetch(base() + '/api/cursor-chat/git-deliver/risk-decision', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    confirm_token: token,
                    nonce: issued.nonce,
                    decision: decision,
                  }),
                }).then(function (r2) {
                  return r2.json()
                })
              })
          })
          .then(function (d) {
            if (!d || !d.ok) throw new Error((d && d.detail) || '决策失败')
            var jid = d.job_id ? String(d.job_id) : String(jobIdRef.current || jobId || '')
            if (decision === 'pause') {
              // 暂停=任务结束：立刻封口，禁止再落回「读取 Git 中」转圈
              sealedStatusRef.current = 'cancelled'
              gitSubmittedRef.current = true
              setGitSubmitted(true)
              setPhase('done')
              setStatusLabel('已暂停提交')
              setConclusionMd(function (prev) {
                return String(prev || '').trim()
                  ? prev
                  : '## Git 交付结论\n\n结果：⏸ 已暂停提交（审码闸未放行）。工作区改动仍在，未执行 commit / push。\n\n本轮已结束。\n'
              })
              dialogPinRef.current = false
              stickBottomRef.current = false
              if (jid) {
                jobIdRef.current = jid
                setJobId(jid)
                reconcileJob(jid)
              }
              return
            }
            setPhase('running')
            setStatusLabel(
              decision === 'fix' ? '正在修复高危…' : '已跳过审码，继续提交…',
            )
            if (jid) {
              jobIdRef.current = jid
              setJobId(jid)
              reconcileJob(jid)
              if (!esRef.current) openStream(jid)
            }
          })
          .catch(function (e) {
            setErr(String(e && e.message ? e.message : e))
          })
          .finally(function () {
            setBusy(false)
          })
      }

      function onGitDeliverConfirm() {
        setErr('')
        setBusy(true)
        var g0 = gitDeliver || {}
        Promise.resolve()
          .then(function () {
            var token0 = String(
              confirmTokenRef.current ||
                confirmToken ||
                g0.confirm_token ||
                (ui && ui.confirm_token) ||
                '',
            ).trim()
            if (token0) return { token: token0, jobId: String(jobIdRef.current || jobId || ''), plan: null }
            return recoverGitDeliverHandles()
          })
          .then(function (ids) {
            var token = String((ids && ids.token) || '').trim()
            if (!token) throw new Error('确认令牌未就绪，请稍候再点。')
            var g = Object.assign({}, g0, ids && ids.plan ? ids.plan : {})
            var files = Object.keys(selected || {}).filter(function (p) {
              return selected[p]
            })
            if (!files.length) throw new Error('请至少勾选一个非敏感文件。')
            return fetch(base() + '/api/hitl/issue', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'cursor-chat.git-deliver',
                confirm_token: token,
                workspace: workspace,
              }),
            })
              .then(function (r) {
                return r.json()
              })
              .then(function (issued) {
                if (!issued || !issued.ok || !issued.nonce) {
                  throw new Error((issued && issued.detail) || '签发 HITL 失败')
                }
                return fetch(base() + '/api/cursor-chat/git-deliver/confirm', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    confirm_token: token,
                    nonce: issued.nonce,
                    selected_files: files,
                    commit_message: String(g.commit_message || ''),
                    target_branch: String(g.target_branch || ''),
                    base_branch: String(g.base_branch || ''),
                    create_pr: g.create_pr !== false,
                  }),
                }).then(function (r2) {
                  return r2.json().then(function (d) {
                    return { status: r2.status, data: d }
                  })
                })
              })
          })
          .then(function (out) {
            if (!out || !out.data || !out.data.ok) {
              throw new Error((out && out.data && out.data.detail) || '确认失败')
            }
            var jid = out.data.job_id ? String(out.data.job_id) : ''
            if (jid) {
              jobIdRef.current = jid
              setJobId(jid)
            }
            if (out.data.waiting_tool || out.data.accepted) {
              // 确认成功：收起文件确认卡；进度走审码闸 → 再 commit
              gitSubmittedRef.current = true
              setGitSubmitted(true)
              sealedStatusRef.current = ''
              setPhase('running')
              setStatusLabel('正在审码本批…')
              if (jid) {
                reconcileJob(jid)
                if (!esRef.current) openStream(jid)
              }
              return
            }
            gitSubmittedRef.current = true
            setGitSubmitted(true)
            var conc = String((out.data && out.data.conclusion) || '').trim()
            if (conc) setConclusionMd(normalizeConclusionMd(conc))
            sealedStatusRef.current = out.data.ok === false ? 'failed' : 'succeeded'
            setPhase('done')
            setStatusLabel(out.data.ok === false ? '失败' : '已完成')
            if (jid) reconcileJob(jid)
          })
          .catch(function (e) {
            setErr(String(e && e.message ? e.message : e))
          })
          .finally(function () {
            setBusy(false)
          })
      }

      function onGitDeliverCancel() {
        setErr('')
        setBusy(true)
        Promise.resolve()
          .then(function () {
            var token0 = String(
              confirmTokenRef.current ||
                confirmToken ||
                (gitDeliver && gitDeliver.confirm_token) ||
                (ui && ui.confirm_token) ||
                '',
            ).trim()
            var jid0 = String(jobIdRef.current || jobId || (ui && ui.job_id) || '').trim()
            if (token0 || jid0) return { token: token0, jobId: jid0, plan: null }
            return recoverGitDeliverHandles()
          })
          .then(function (ids) {
            var token = String((ids && ids.token) || '').trim()
            var jid = String((ids && ids.jobId) || '').trim()
            if (!token && !jid) throw new Error('确认令牌未就绪，请稍候再点取消')
            return fetch(base() + '/api/cursor-chat/git-deliver/cancel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                confirm_token: token,
                job_id: jid,
                reason: '用户取消 Git 交付',
              }),
            }).then(function (r) {
              return r.json()
            })
          })
          .then(function (d) {
            if (!d || !d.ok) throw new Error((d && d.detail) || '取消失败')
            cancelOnceRef.current = true
            sealedStatusRef.current = 'cancelled'
            setPhase('done')
            setStatusLabel('已取消')
            var conc = String((d && d.conclusion) || '').trim()
            if (conc) setConclusionMd(normalizeConclusionMd(conc))
            else {
              setConclusionMd(
                '## Git 交付结论\n\n结果：⏹ 已取消 Git 交付。工作区改动仍在，未执行 commit。\n\n说明：\n• 用户取消 Git 交付\n',
              )
            }
            if (d.job_id) {
              jobIdRef.current = String(d.job_id)
              reconcileJob(String(d.job_id))
            }
          })
          .catch(function (e) {
            setErr(String(e && e.message ? e.message : e))
          })
          .finally(function () {
            setBusy(false)
          })
      }

      function renderGitDeliverPanel() {
        if (workKind !== 'git_deliver') return null
        var g = gitDeliver || {}
        var sealed = String(sealedStatusRef.current || '')
        var pausedNow =
          g.stage === 'paused' ||
          statusLabel === '已暂停提交' ||
          statusLabel === '已暂停提交…' ||
          /已暂停提交/.test(String(statusLabel || ''))
        var closed =
          phase === 'done' ||
          !!TERMINAL_JOB[sealed] ||
          pausedNow ||
          statusLabel === '已取消' ||
          statusLabel === '已停止' ||
          statusLabel === '失败' ||
          statusLabel === '已完成'
        if (closed) {
          var stopLike =
            sealed === 'cancelled' ||
            pausedNow ||
            statusLabel === '已取消' ||
            statusLabel === '已停止'
          var pausedLike =
            pausedNow ||
            /已暂停提交|审码闸|高危/.test(String(conclusionMd || '') + String(statusLabel || ''))
          var idleLike =
            /没有可提交|无需 Git|没有未提交改动|没有可安全提交/.test(
              String(conclusionMd || '') + String(statusLabel || ''),
            ) ||
            (sealed === 'succeeded' &&
              /没有未提交|无需 Git|没有可安全提交/.test(String(statusLabel || '')))
          return h(
            'div',
            { className: 'cc-git-deliver', 'data-cc-git-deliver': '1' },
            h('p', { className: 'cc-git-title' }, 'Git 交付'),
            h(
              'p',
              { className: 'cc-note' },
              stopLike
                ? pausedLike
                  ? '已暂停提交：任务已结束，未执行 commit。'
                  : (statusLabel === '已停止' ? '已停止' : '已取消') +
                    '：未执行 commit，工作区改动仍在。'
                : idleLike
                  ? '当前没有可提交的改动，无需交付。'
                  : statusLabel === '失败'
                    ? '交付未完成，详见下方 Git 交付结论。'
                    : statusLabel || '已结束',
            ),
          )
        }
        // 审码闸二次人审：确认后仍可出卡（权威字段 risk_gate）
        if (g.risk_gate === 'await_risk') {
          var accentRisk = resolveAvatarAccent()
          var titles = Array.isArray(g.high_titles) ? g.high_titles : []
          var engineDown = g.risk_kind === 'engine_unavailable'
          var filesMissed = engineDown && g.risk_code === 'files_skipped'
          return h(
            'div',
            {
              className: 'cc-git-deliver',
              'data-cc-git-deliver': '1',
              'data-cc-risk-gate': 'await_risk',
              'data-cc-risk-kind': engineDown ? 'engine_unavailable' : 'high',
              'data-cc-risk-code': filesMissed ? 'files_skipped' : '',
              style: { ['--cc-git-accent']: accentRisk, ['--cc-avatar-accent']: accentRisk },
            },
            h(
              'p',
              { className: 'cc-git-title' },
              filesMissed
                ? '有勾选文件未能纳入审码'
                : engineDown
                  ? '审码引擎不可用'
                  : '本批审码：发现高危',
            ),
            h(
              'p',
              { className: 'cc-note' },
              filesMissed
                ? String(g.risk_summary || '有勾选文件未能纳入审码，未放行') +
                    '。可暂停，或仍继续 commit / push（自行承担风险）。'
                : engineDown
                  ? '未能连接审码引擎，无法完成本批自动审码。可暂停，或仍继续 commit / push（自行承担风险）。'
                  : '高危 ' +
                      String(g.high_count || titles.length || 0) +
                      ' · 中危 ' +
                      String(g.medium_count || 0) +
                      ' · 低危 ' +
                      String(g.low_count || 0) +
                      '。高危未清前不会 commit / push。',
            ),
            !filesMissed && g.risk_summary
              ? h('p', { className: 'cc-note' }, String(g.risk_summary))
              : null,
            !engineDown && titles.length
              ? h(
                  'ul',
                  { className: 'cc-git-files', style: { margin: '8px 0', paddingLeft: '18px' } },
                  titles.slice(0, 8).map(function (t, i) {
                    return h('li', { key: 'ht-' + i }, String(t))
                  }),
                )
              : null,
            err ? h('p', { className: 'cc-set-msg err' }, err) : null,
            h(
              'div',
              {
                className: 'cc-git-actions',
                style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' },
              },
              h(
                'button',
                {
                  type: 'button',
                  className: 'cc-set-btn',
                  disabled: busy,
                  onClick: function () {
                    onGitDeliverRiskDecision('pause')
                  },
                },
                '暂停提交',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cc-set-btn primary',
                  disabled: busy,
                  style: { background: accentRisk, borderColor: 'transparent', color: '#fff' },
                  onClick: function () {
                    onGitDeliverRiskDecision(engineDown ? 'continue' : 'fix')
                  },
                },
                busy ? '处理中…' : engineDown ? '仍继续提交' : '修复高危',
              ),
            ),
          )
        }
        // 点确认后：文件确认卡消失（进度看 transcript）；高危卡由 risk_gate 另开
        if (gitSubmitted || gitSubmittedRef.current) {
          return null
        }
        // 计划已灌入即出确认卡；不卡死在 phase===review（SSE 曾漏带 git_deliver 时会永远转圈）
        var hasPlan = !!(
          g.remote_url ||
          g.current_branch ||
          (g.selected_files && g.selected_files.length) ||
          (g.entries && g.entries.length)
        )
        if (!hasPlan) {
          return h(
            'div',
            { className: 'cc-git-deliver', 'data-cc-git-deliver': '1' },
            h('p', { className: 'cc-git-title' }, 'Git 交付进行中'),
            h(
              'div',
              { className: 'cc-hold' },
              h('span', { className: 'cc-spin', 'aria-hidden': 'true' }),
              h('span', null, statusLabel || '正在读取仓库地址、当前分支与未提交改动…'),
            ),
            h('p', { className: 'cc-note' }, '确认卡就绪后可勾选文件并提交；在此之前不会 commit。'),
          )
        }
        var fileKeys = Object.keys(selected || {})
        if (!fileKeys.length && Array.isArray(g.entries)) {
          fileKeys = g.entries.map(function (e) {
            return e.rel
          })
        }
        if (!fileKeys.length && Array.isArray(g.selected_files)) {
          fileKeys = g.selected_files.slice()
          ;(g.held_sensitive_files || []).forEach(function (p) {
            if (fileKeys.indexOf(p) < 0) fileKeys.push(p)
          })
        }
        var heldSet = {}
        ;(g.held_sensitive_files || []).forEach(function (p) {
          heldSet[p] = true
        })
        if (Array.isArray(g.entries)) {
          g.entries.forEach(function (e) {
            if (e && e.sensitive) heldSet[e.rel] = true
          })
        }
        var accent = resolveAvatarAccent()
        var tokNow = String(
          confirmTokenRef.current || confirmToken || g.confirm_token || (ui && ui.confirm_token) || '',
        ).trim()
        var jidNow = String(jobIdRef.current || jobId || (ui && ui.job_id) || '').trim()
        return h(
          'div',
          {
            className: 'cc-git-deliver',
            'data-cc-git-deliver': '1',
            'data-cc-confirm-token': tokNow,
            'data-cc-job-id': jidNow,
            style: { ['--cc-git-accent']: accent, ['--cc-avatar-accent']: accent },
            ref: function (el) {
              if (el) applyGitAccentVars(el)
            },
          },
          h('p', { className: 'cc-git-title' }, '确认 Git 交付（人审）'),
          h(
            'div',
            { className: 'cc-git-row' },
            h('span', { className: 'cc-git-lab' }, '仓库'),
            h('span', { className: 'cc-git-val' }, g.remote_url || '（未配置 remote）'),
          ),
          h(
            'div',
            { className: 'cc-git-row' },
            h('span', { className: 'cc-git-lab' }, '当前分支'),
            h('span', { className: 'cc-git-val' }, g.current_branch || '—'),
          ),
          h(
            'div',
            { className: 'cc-git-row' },
            h('span', { className: 'cc-git-lab' }, '提交分支'),
            h('input', {
              type: 'text',
              value: String(g.target_branch || ''),
              onChange: function (ev) {
                var v = ev && ev.target ? ev.target.value : ''
                setGitDeliver(function (prev) {
                  return Object.assign({}, prev || {}, { target_branch: v })
                })
              },
            }),
          ),
          h(
            'div',
            { className: 'cc-git-row' },
            h('span', { className: 'cc-git-lab' }, '合并到'),
            h('input', {
              type: 'text',
              value: String(g.base_branch || ''),
              onChange: function (ev) {
                var v = ev && ev.target ? ev.target.value : ''
                setGitDeliver(function (prev) {
                  return Object.assign({}, prev || {}, { base_branch: v })
                })
              },
            }),
          ),
          h(
            'div',
            { className: 'cc-git-row' },
            h('span', { className: 'cc-git-lab' }, '说明'),
            h('textarea', {
              value: String(g.commit_message || ''),
              onChange: function (ev) {
                var v = ev && ev.target ? ev.target.value : ''
                setGitDeliver(function (prev) {
                  return Object.assign({}, prev || {}, { commit_message: v })
                })
              },
            }),
          ),
          h('p', { className: 'cc-note' }, '将纳入提交的文件（敏感文件默认不勾选，禁止提交）'),
          h(
            'div',
            { className: 'cc-git-files' },
            fileKeys.length
              ? fileKeys.map(function (p) {
                  var sens = !!heldSet[p]
                  return h(
                    'label',
                    { key: p, className: 'cc-git-file' + (sens ? ' sens' : '') },
                    h('input', {
                      type: 'checkbox',
                      checked: !!selected[p],
                      disabled: sens || busy,
                      onChange: function (ev) {
                        if (sens) return
                        var on = !!(ev && ev.target && ev.target.checked)
                        setSelected(function (prev) {
                          var next = Object.assign({}, prev)
                          next[p] = on
                          return next
                        })
                      },
                    }),
                    h('span', { className: 'cc-git-tick', 'aria-hidden': 'true' }),
                    h('span', null, p + (sens ? '（敏感·已排除）' : '')),
                  )
                })
              : h('span', { className: 'cc-note' }, '暂无文件列表'),
          ),
          err ? h('p', { className: 'cc-set-msg err' }, err) : null,
          h(
            'div',
            {
              className: 'cc-git-actions',
              style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' },
            },
            h(
              'button',
              {
                type: 'button',
                className: 'cc-set-btn',
                disabled: busy,
                onClick: onGitDeliverCancel,
              },
              '取消',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'cc-set-btn primary',
                disabled: busy,
                style: { background: accent, borderColor: 'transparent', color: '#fff' },
                onClick: onGitDeliverConfirm,
              },
              busy ? '提交中…' : '确认提交并开 PR',
            ),
          ),
        )
      }

      function openStream(jid) {
        if (esRef.current && typeof esRef.current.close === 'function') {
          try {
            esRef.current.close()
          } catch (e) {}
        }
        var url = base() + '/api/cursor-chat/jobs/' + encodeURIComponent(jid) + '/stream'
        var es = new EventSource(url)
        esRef.current = es
        es.onmessage = function (ev) {
          try {
            var data = JSON.parse(ev.data)
            if (data.type === 'hello') return
            if (data.type === 'snapshot') {
              applyJobSnapshot({
                id: jid,
                status: data.status,
                detail: data.detail,
                work_kind: data.work_kind,
                git_deliver: data.git_deliver,
                assistant_text: data.assistant_text,
                chat_conclusion: data.chat_conclusion,
                synced_files: data.synced_files,
                pending_user_choice: data.pending_user_choice,
                transcript: Array.isArray(data.transcript)
                  ? data.transcript.map(function (it) {
                      if (!it || it.kind !== 'tool') return it
                      var st = String(it.tool_status || '').toLowerCase()
                      if (st === 'error' || st === 'failed') {
                        return Object.assign({}, it, { tool_status: 'failed', streaming: false })
                      }
                      if (st === 'completed' || st === 'done' || st === 'success') {
                        return Object.assign({}, it, { tool_status: 'completed', streaming: false })
                      }
                      return it
                    })
                  : undefined,
                review_in_scope: data.review_in_scope,
                review_deleted: data.review_deleted,
                review_deferred: data.review_deferred,
                review_gate: data.review_gate,
              })
              // Git 人审 / 高危二次人审：只认 work_kind=git_deliver，禁止靠 git_deliver 字段误伤写码卡
              if (
                data.work_kind === 'git_deliver' &&
                data.status === 'pending_review' &&
                data.git_deliver
              ) {
                setWorkKind('git_deliver')
                hydrateGitDeliver(data.git_deliver)
                setPhase('review')
                if (data.git_deliver.risk_gate === 'await_risk') {
                  setStatusLabel('本批存在高危，请选择修复或暂停')
                } else {
                  setStatusLabel('确认 Git 交付')
                }
                return
              }
              if (
                data.work_kind === 'git_deliver' &&
                data.git_deliver &&
                data.git_deliver.risk_gate === 'await_risk' &&
                data.status === 'pending_review'
              ) {
                setWorkKind('git_deliver')
                hydrateGitDeliver(data.git_deliver)
                setPhase('review')
                setStatusLabel('本批存在高危，请选择修复或暂停')
                return
              }
              if (data.status === 'pending_review') {
                var inN = Array.isArray(data.review_in_scope) ? data.review_in_scope.length : 0
                var snapPhase = phaseFromJobStatus(
                  data.status,
                  data.detail,
                  inN,
                  data.review_gate,
                )
                if (data.work_kind === 'git_deliver') {
                  setWorkKind('git_deliver')
                  if (snapPhase === 'review' || data.review_gate === 'await_user') {
                    setPhase('review')
                    setStatusLabel('确认 Git 交付')
                  }
                  return
                }
                if (snapPhase === 'done') {
                  setPhase('done')
                  setStatusLabel('已完成·有范围外文件')
                } else if (snapPhase === 'running' || data.auto_apply || data.review_gate === 'auto_applying') {
                  if (sseMayForceRunning(sealedStatusRef.current)) {
                    setPhase('running')
                    setStatusLabel('自动同步中')
                  }
                } else if (data.review_in_scope || data.review_deleted || data.review_deferred) {
                  setReview({
                    inScope: data.review_in_scope || [],
                    deleted: data.review_deleted || [],
                    deferred: data.review_deferred || [],
                  })
                }
              }
              return
            }
            if (data.type === 'review') {
              var parsed = {}
              try {
                parsed = JSON.parse(data.message || '{}')
              } catch (e3) {
                parsed = {}
              }
              if (!sseMayForceRunning(sealedStatusRef.current)) {
                return
              }
              if (parsed.auto_apply) {
                setPhase('running')
                setStatusLabel('自动同步中')
                setReview({
                  inScope: parsed.in_scope || [],
                  deleted: parsed.deleted || [],
                  deferred: parsed.deferred || [],
                })
              } else {
                enterReview(parsed)
              }
              return
            }
            // 原始 assistant 终稿禁止进过程流：正文结论只走 chat_conclusion → hoist
            if (data.type === 'status' && data.message && String(data.message).indexOf('【本轮结论】') === 0) {
              return
            }
            if (data.type === 'done') {
              var dst = String(data.status || 'done')
              // 只认 SSE 封口（带 job_id）。账本回放的 done 只有 message，提前关流会丢掉 snapshot 过程片段。
              if (!String(data.job_id || '').trim() || String(data.job_id) !== String(jid)) {
                if (data.message) appendStream(String(data.message))
                return
              }
              appendStream('— 流结束：' + dst)
              setTranscript(function (prev) {
                return sealTranscriptItems(prev)
              })
              // 终态帧若已带结论：立刻展示，禁止等宿主下一轮空白思考
              var doneConc = normalizeConclusionMd(String(data.chat_conclusion || '').trim())
              if (doneConc) setConclusionMd(doneConc)
              if (dst === 'succeeded' || dst === 'failed' || dst === 'cancelled') {
                sealedStatusRef.current = dst
                setPhase('done')
                setStatusLabel(dst === 'succeeded' ? '已完成' : dst === 'failed' ? '失败' : '已取消')
              }
              reconcileJob(jid)
              try {
                es.close()
              } catch (e2) {}
              if (esRef.current === es) esRef.current = null
              return
            }
            if (data.type === 'thinking') {
              var delta = String(data.message || '')
              if (!delta) return
              setTranscript(function (prev) {
                var items = Array.isArray(prev) ? prev.slice() : []
                var idx = -1
                for (var i = items.length - 1; i >= 0; i--) {
                  if (items[i] && items[i].kind === 'thinking' && items[i].streaming) {
                    idx = i
                    break
                  }
                }
                if (idx < 0) {
                  var nid = 'think-live-' + Date.now()
                  items.push({
                    id: nid,
                    kind: 'thinking',
                    at: new Date().toISOString(),
                    text: delta,
                    streaming: true,
                    thinking_duration_ms: data.thinking_duration_ms,
                  })
                  thinkTargetRef.current[nid] = delta
                  if (thinkShownRef.current[nid] == null) thinkShownRef.current[nid] = 0
                } else {
                  var cur = items[idx]
                  var nextText = String(cur.text || '') + delta
                  items[idx] = Object.assign({}, cur, {
                    text: nextText,
                    streaming: true,
                    thinking_duration_ms:
                      data.thinking_duration_ms || cur.thinking_duration_ms,
                  })
                  thinkTargetRef.current[String(cur.id)] = nextText
                }
                return items
              })
              return
            }
            if (data.type === 'assistant' && data.message) {
              // lean 事件：只追加过程短句；完整对账仍靠 snapshot
              var asDelta = String(data.message || '')
              if (!asDelta || /##\s*说明方案|【本轮结论】/.test(asDelta)) return
              setTranscript(function (prev) {
                var items = Array.isArray(prev) ? prev.slice() : []
                var idx = -1
                for (var i = items.length - 1; i >= 0; i--) {
                  if (items[i] && items[i].kind === 'assistant' && items[i].streaming) {
                    idx = i
                    break
                  }
                }
                if (idx < 0) {
                  items.push({
                    id: 'asst-live-' + Date.now(),
                    kind: 'assistant',
                    at: new Date().toISOString(),
                    text: asDelta.slice(0, 2000),
                    streaming: true,
                  })
                } else {
                  var a = items[idx]
                  items[idx] = Object.assign({}, a, {
                    text: String(a.text || '') + asDelta.slice(0, 2000),
                    streaming: true,
                  })
                }
                return items
              })
              return
            }
            if (data.type === 'error') appendStream('错误：' + (data.message || ''))
            if (data.type === 'status') {
              var statusMsg = String(data.message || '').trim()
              appendStream(statusMsg)
              // Git 交付：SSE 进度必须立刻刷到灰条（不能等 5s reconcile），否则会钉死在「已确认」
              if (
                statusMsg &&
                (workKind === 'git_deliver' || gitSubmittedRef.current) &&
                !/【本轮结论】|^##\s*本轮结论|^##\s*Git\s*交付结论|说明方案/.test(statusMsg)
              ) {
                setTranscript(function (prev) {
                  var items = Array.isArray(prev) ? prev.slice() : []
                  var last = items.length ? items[items.length - 1] : null
                  if (last && last.kind === 'status' && String(last.text || '').trim() === statusMsg) {
                    return prev
                  }
                  // 审码进度只改同一条：2/8 → 3/8 刷新数字，不另起一行
                  if (isReviewProgressLine(statusMsg)) {
                    var hit = -1
                    for (var ri = 0; ri < items.length; ri++) {
                      if (items[ri] && items[ri].kind === 'status' && isReviewProgressLine(items[ri].text)) {
                        hit = ri
                      }
                    }
                    var kept = []
                    for (var rj = 0; rj < items.length; rj++) {
                      var row = items[rj]
                      if (row && row.kind === 'status' && isReviewProgressLine(row.text)) {
                        if (rj === hit) {
                          kept.push(Object.assign({}, row, { text: statusMsg, at: new Date().toISOString() }))
                        }
                        continue
                      }
                      kept.push(row)
                    }
                    if (hit < 0) {
                      kept.push({
                        id: 'git-live-review',
                        kind: 'status',
                        at: new Date().toISOString(),
                        text: statusMsg,
                      })
                    }
                    return kept.slice(-80)
                  }
                  items.push({
                    id: 'git-live-' + Date.now() + '-' + items.length,
                    kind: 'status',
                    at: new Date().toISOString(),
                    text: statusMsg,
                  })
                  return items.slice(-80)
                })
                if (gitSubmittedRef.current) {
                  setStatusLabel(gitPostConfirmLabel(statusMsg, ''))
                }
              }
            }
          } catch (e) {
            appendStream(String(ev.data || ''))
          }
        }
        es.onerror = function () {
          appendStream('（SSE 异常，正在对账任务状态…）')
          reconcileJob(jid)
        }
      }

      // 运行中低频对账即可（SSE 已推）；Git 确认后略加密，避免灰条长时间不刷新
      useEffect(
        function () {
          if (phase !== 'running' || !jobId) return
          var ms = workKind === 'git_deliver' || gitSubmittedRef.current ? 1000 : 5000
          var t = setInterval(function () {
            reconcileJob(jobId)
          }, ms)
          return function () {
            clearInterval(t)
          }
        },
        [phase, jobId, workKind, gitSubmitted],
      )

      // 权威 status 已是终态时，把 React phase 对齐（不依赖 SSE / 宿主是否更新 kind）
      useEffect(
        function () {
          if (cancelOnceRef.current) return
          if (phase === 'done' && sealedStatusRef.current) return
          var payload = readToolJobFields(
            ((props && props.block && (props.block.result || props.block.value || props.block.output)) ||
              (props && props.result) ||
              null),
          )
          var liveId = String(jobId || '').trim()
          var payloadId = String(payload.jobId || '').trim()
          var uiJid = String((ui && ui.job_id) || '').trim()
          var toolSt =
            payload.done === true && payloadId && (!liveId || payloadId === liveId) ? String(payload.status || '') : ''
          var uiSt = liveId && uiJid === liveId ? String((ui && ui.status) || '') : ''
          var auth = preferJobStatus(preferJobStatus(String(sealedStatusRef.current || ''), toolSt), uiSt)
          if (!TERMINAL_JOB[auth]) return
          var jid = liveId || (toolSt ? payloadId : '') || (uiSt ? uiJid : '')
          if (!jid) return
          applyJobSnapshot({
            id: jid,
            status: auth,
            detail: payload.detail || String((ui && ui.detail) || ''),
          })
          reconcileJob(jid)
        },
        [phase, jobId, ui && ui.status, ui && ui.job_id, props && props.block, props && props.result],
      )

      // 已完成但过程/结论为空：回拉账本（刷新会话必补 Diff + 本轮结论格式）
      useEffect(
        function () {
          if (phase !== 'done' || !jobId) return
          var hasTr = !!(transcript && transcript.length)
          var hasConc = !!String(conclusionMd || '').trim()
          if (hasTr && hasConc) {
            emptyDonePullRef.current = jobId
            return
          }
          if (emptyDonePullRef.current === jobId && hasTr) return
          emptyDonePullRef.current = jobId
          var n = 0
          var timer = 0
          var stopped = false
          var expectId = String(jobId)
          function pull() {
            if (stopped) return
            n += 1
            reconcileJob(expectId).then(function (job) {
              if (stopped) return
              var trOk = job && Array.isArray(job.transcript) && job.transcript.length
              var concOk = !!(job && conclusionFromJob(job))
              if (trOk && concOk) return
              if (n < 6) timer = setTimeout(pull, 600)
            })
          }
          pull()
          return function () {
            stopped = true
            if (timer) clearTimeout(timer)
          }
        },
        [phase, jobId, transcript && transcript.length, conclusionMd],
      )

      function togglePath(path) {
        setSelected(function (prev) {
          var copy = Object.assign({}, prev)
          copy[path] = !copy[path]
          return copy
        })
      }

      function copyDialog() {
        setCopyFlash('')
        var local = buildDialogTextFromTranscript(transcript)
        function finishCopy(text) {
          var t = String(text || '').trim()
          if (!t) {
            setCopyFlash('无可复制内容')
            return
          }
          // 同步优先走 textarea 兜底，保住点击手势；API 成功则覆盖写入
          var synced = copyTextViaTextarea(t)
          if (synced) {
            setCopyFlash('已复制')
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
              navigator.clipboard.writeText(t).catch(function () {})
            }
            return
          }
          copyTextToClipboard(t).then(function (ok) {
            setCopyFlash(ok ? '已复制' : '复制失败，请手动选择进度区内容')
          })
        }
        if (local) {
          finishCopy(local)
          return
        }
        var jid = String(jobId || (ui && ui.job_id) || '').trim()
        if (!jid) {
          setCopyFlash('无可复制内容')
          return
        }
        fetch(base() + '/api/cursor-chat/jobs/' + encodeURIComponent(jid) + '/dialog')
          .then(function (r) {
            return r.json()
          })
          .then(function (d) {
            var md = d && d.ok ? String(d.markdown || '').trim() : ''
            if (md) {
              finishCopy(md)
              return
            }
            setCopyFlash('无可复制内容')
          })
          .catch(function () {
            setCopyFlash('拉取对话失败')
          })
      }

      function renderMd(text) {
        // 与全局 lightMdHtml 同一套按行排版，进度卡与会话挂载观感一致
        var raw = String(text || '')
        var fences = []
        raw = raw.replace(/```[\w.-]*\n([\s\S]*?)```/g, function (_m, code) {
          var i = fences.length
          fences.push('<pre class="cc-md-code"><code>' + String(code || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n$/, '') + '</code></pre>')
          return '\n%%CCFENCE' + i + '%%\n'
        })
        var html = lightMdHtml(raw)
        html = html.replace(/%%CCFENCE(\d+)%%/g, function (_m, idx) {
          return fences[Number(idx)] || ''
        })
        return html
      }

      function onSteer() {
        setErr('')
        var jid = String(jobId || '').trim()
        var msg = String(steerText || '').trim()
        if (!jid) return setErr('缺少 job_id')
        if (!msg) return setErr('请输入追问内容')
        setBusy(true)
        fetch(base() + '/api/hitl/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cursor-chat.steer', job_id: jid }),
        })
          .then(function (r) {
            return r.json()
          })
          .then(function (issued) {
            if (!issued || !issued.ok || !issued.nonce) {
              throw new Error((issued && issued.detail) || '签发 steer HITL 失败')
            }
            return fetch(base() + '/api/cursor-chat/jobs/' + encodeURIComponent(jid) + '/steer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nonce: issued.nonce, message: msg }),
            }).then(function (r2) {
              return r2.json().then(function (d) {
                return { status: r2.status, data: d }
              })
            })
          })
          .then(function (out) {
            if (!out.data || !out.data.ok) {
              throw new Error((out.data && out.data.detail) || '追问失败')
            }
            setSteerText('')
            setPhase('running')
            reviewReadyRef.current = false
            setStatusLabel('追问续跑中')
            openStream(jid)
          })
          .catch(function (e) {
            setErr(String(e && e.message ? e.message : e))
          })
          .finally(function () {
            setBusy(false)
          })
      }

      function onRestartBackend(opts) {
        var auto = Boolean(opts && opts.auto)
        setErr('')
        var jid = String(jobId || '').trim()
        if (!jid) {
          if (!auto) setErr('缺少 job_id')
          return
        }
        if (!beRestart || !beRestart.offered) {
          if (!auto) setErr('本轮未开放后端重启')
          return
        }
        if (beRestart.started_at) {
          if (!auto) setErr('本轮已下发过重启，请查看应用终端')
          return
        }
        // 自动路径跳过二次确认；手工点按钮仍保留「预览脚本 → 确认」两步
        if (!auto && !beConfirmOpen) {
          setBeConfirmOpen(true)
          return
        }
        setBusy(true)
        if (auto) {
          appendStream('正在由本机服务自动重启后端 :' + String(beRestart.port || ''))
        }
        var autoKey =
          jid +
          '|' +
          String((beRestart && beRestart.port) || '') +
          '|' +
          String(((beRestart && beRestart.hit_files) || []).join(','))
        issueBackendRestartAndRun(jid)
          .then(function (out) {
            if (!out || !out.data || !out.data.ok) {
              throw new Error((out && out.detail) || '重启准备失败')
            }
            var lines = Array.isArray(out.data.shell_lines) ? out.data.shell_lines : []
            var term = out.term || { ok: out.ok, detail: out.detail }
            setBeRestart(function (prev) {
              return Object.assign({}, prev || {}, {
                offered: true,
                started_at: new Date().toISOString(),
                command: out.data.command || (prev && prev.command) || '',
                port: out.data.port || (prev && prev.port) || 0,
                cwd: out.data.cwd || (prev && prev.cwd) || '',
                reason: out.data.reason || (prev && prev.reason) || '',
                shell_lines: lines,
                last_detail: term && term.detail ? term.detail : out.data.detail || '',
              })
            })
            setBeConfirmOpen(false)
            beAutoMark(autoKey)
            beAutoDoneRef.current = autoKey
            if (out.data && out.data.executed) {
              appendStream(
                '本机已执行后端重启 :' +
                  String(out.data.port || '') +
                  (out.data.detail ? '（' + String(out.data.detail) + '）' : ''),
              )
            }
            if (term && term.ok) {
              appendStream('侧栏终端已镜像命令（仅展示）')
            } else if (term && term.detail) {
              appendStream(String(term.detail))
            }
            return reconcileJob(jid)
          })
          .catch(function (e) {
            if (auto) {
              beAutoMark(autoKey + '#failed')
              beAutoDoneRef.current = autoKey + '#failed'
              appendStream('自动重启失败：' + String(e && e.message ? e.message : e))
            }
            setErr(String(e && e.message ? e.message : e))
            setBeConfirmOpen(false)
          })
          .finally(function () {
            setBusy(false)
          })
      }

      // 本轮写码武装后，门禁通过即自动下发重启（刷新旧卡不武装，避免误杀）
      useEffect(
        function () {
          // 前后端改由同步后的 Cursor 终端确认，进度卡不再私下重启
          return
          if (!beRestart || !beRestart.offered || beRestart.started_at) return
          if (!beAutoArmedRef.current) return
          var jid = String(jobId || '').trim()
          if (!jid) return
          var autoKey =
            jid +
            '|' +
            String(beRestart.port || '') +
            '|' +
            String((beRestart.hit_files || []).join(','))
          if (beAutoKeyTaken(autoKey) || beAutoKeyTaken(autoKey + '#failed')) return
          // 仅预约；真正占用键放在定时器回调里，避免重渲染 cleanup 清掉 timeout 后永不重试
          var t = setTimeout(function () {
            if (beAutoKeyTaken(autoKey) || beAutoKeyTaken(autoKey + '#failed')) return
            beAutoMark(autoKey)
            beAutoDoneRef.current = autoKey
            onRestartBackend({ auto: true })
          }, 450)
          return function () {
            clearTimeout(t)
          }
        },
        [beRestart, jobId],
      )

      function onApply() {
        setErr('')
        var jid = String(jobId || '').trim()
        if (!jid) {
          setErr('缺少 job_id')
          return
        }
        var accept = Object.keys(selected).filter(function (p) {
          return selected[p]
        })
        var expand_scope = String(expandText || '')
          .split(/[\n,]+/)
          .map(function (s) {
            return s.trim()
          })
          .filter(Boolean)
        setBusy(true)
        fetch(base() + '/api/hitl/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cursor-chat.apply', job_id: jid }),
        })
          .then(function (r) {
            return r.json()
          })
          .then(function (issued) {
            if (!issued || !issued.ok || !issued.nonce) {
              throw new Error((issued && issued.detail) || '签发 apply HITL 失败')
            }
            return fetch(base() + '/api/cursor-chat/jobs/' + encodeURIComponent(jid) + '/apply', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nonce: issued.nonce,
                accept: accept,
                expand_scope: expand_scope,
              }),
            }).then(function (r2) {
              return r2.json().then(function (d) {
                return { status: r2.status, data: d }
              })
            })
          })
          .then(function (out) {
            if (!out.data || !out.data.ok) {
              throw new Error((out.data && out.data.detail) || '同步失败 HTTP ' + out.status)
            }
            appendStream('已同步：' + ((out.data.synced_files || []).join(', ') || '（无文件）'))
            // 封口终态，避免 tool metadata 仍带 pending_review 把卡打回 review
            sealedStatusRef.current = 'succeeded'
            setPhase('done')
            setStatusLabel('已完成')
            dialogPinRef.current = false
            stickBottomRef.current = false
            if (esRef.current && typeof esRef.current.close === 'function') {
              try {
                esRef.current.close()
              } catch (e4) {}
            }
            esRef.current = null
            return reconcileJob(jid)
          })
          .catch(function (e) {
            setErr(String(e && e.message ? e.message : e))
          })
          .finally(function () {
            setBusy(false)
          })
      }

      function onConfirm() {
        setErr('')
        var ws = String(resolveDshCwd(props) || workspace || '').trim()
        var req = String(requirement || '').trim()
        var token = String(confirmToken || (ui && ui.confirm_token) || '').trim()
        if (!ws) {
          setErr('当前会话没有工作区。请先在侧栏打开/绑定工程目录（不必在卡片里手填路径）。')
          return
        }
        if (!req) {
          setErr('缺少写码诉求。请在对话里说明要改什么，由助手澄清后再出确认卡。')
          return
        }
        if (!token) {
          setErr('确认令牌未就绪，请稍候再点（或刷新后重试）。')
          return
        }
        if (ws !== workspace) setWorkspace(ws)
        setBusy(true)
        fetch(base() + '/api/hitl/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'cursor-chat.confirm',
            workspace: ws,
            requirement: req,
            confirm_token: token,
          }),
        })
          .then(function (r) {
            return r.json()
          })
          .then(function (issued) {
            if (!issued || !issued.ok || !issued.nonce) {
              throw new Error((issued && issued.detail) || '签发 HITL 失败')
            }
            var body = {
              workspace: ws,
              requirement: req,
              nonce: issued.nonce,
            }
            if (parentJobId) body.parent_job_id = parentJobId
            if (token) body.confirm_token = token
            return fetch(base() + '/api/cursor-chat/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }).then(function (r2) {
              return r2.json().then(function (d) {
                return { status: r2.status, data: d }
              })
            })
          })
          .then(function (out) {
            if (!out.data || !out.data.ok) {
              throw new Error((out.data && out.data.detail) || '确认失败 HTTP ' + out.status)
            }
            var jid = out.data.job_id
            cancelOnceRef.current = false
            setJobId(jid)
            setPhase('running')
            setStreamText('')
            setTranscript([])
            setSteerText('')
            reviewReadyRef.current = false
            setStatusLabel('写码中')
            appendStream('已确认 ' + jid)
            openStream(jid)
            // 进展中：卡内强制贴底；整页仅本页确认后轻推一次
            dialogPinRef.current = true
            stickBottomRef.current = true
            liveChatScrollRef.current = true
            setTimeout(scrollStreamFollow, 0)
            scrollChatTowardBottom(true)
          })
          .catch(function (e) {
            setErr(String(e && e.message ? e.message : e))
          })
          .finally(function () {
            setBusy(false)
          })
      }

      function scrollChatTowardBottom(force) {
        if (!liveChatScrollRef.current) return
        if (!force && !stickBottomRef.current) return
        try {
          var cardId =
            'cc-card-' + String(identity || jobId || confirmToken || (ui && ui.confirm_token) || 'x').trim()
          var card = document.getElementById(cardId) || document.querySelector('.cc-card')
          if (!card) return
          pinScrollersToBottom(card)
        } catch (e) {}
      }

      // 仅「本页用户点过确认」且 running/review→done 时，轻推一次到结论附近；
      // 禁止刷新水合（陈旧 running→done）与长间隔连滚抢会话位置
      useEffect(
        function () {
          var prev = phasePrevRef.current
          phasePrevRef.current = phase
          if (!liveChatScrollRef.current) return
          if (phase !== 'done') return
          if (prev !== 'running' && prev !== 'review') return
          scrollChatTowardBottom(true)
          var n = 0
          var t = setInterval(function () {
            n += 1
            scrollChatTowardBottom(true)
            if (n >= 3) clearInterval(t)
          }, 600)
          return function () {
            clearInterval(t)
          }
        },
        [phase],
      )

      var kind = (ui && ui.kind) || (parentJobId ? 'continue' : 'live')
      var resultFields = readToolJobFields(
        ((props && props.block && (props.block.result || props.block.value || props.block.output)) ||
          (props && props.result) ||
          null),
      )
      var authStatus = preferJobStatus(
        preferJobStatus(
          String(sealedStatusRef.current || ''),
          resultFields.done === true && (!jobId || !resultFields.jobId || resultFields.jobId === jobId)
            ? String(resultFields.status || '')
            : '',
        ),
        jobId && ui && ui.job_id && String(ui.job_id) === String(jobId) ? String(ui.status || '') : '',
      )
      var toolCancelledNow = toolBlockCancelled(props && props.block)
      var toolSettledNow = toolBlockSettled(props && props.block)
      var visiblePhase = cardVisiblePhase({
        phase: phase,
        sealedStatus: sealedStatusRef.current,
        uiStatus: ui && ui.status,
        resultDone: resultFields.done,
        resultStatus: resultFields.status,
        resultJobId: resultFields.jobId,
        liveJobId: jobId,
        cancelled: cancelOnceRef.current,
        toolCancelled: toolCancelledNow,
        idleSettled: toolSettledNow && !jobId,
      })
      var visibleLabel = cancelOnceRef.current || toolCancelledNow
        ? statusLabel && statusLabel !== '写码中' && statusLabel !== '自动同步中'
          ? statusLabel
          : '已停止'
        : TERMINAL_JOB[authStatus]
          ? labelFromJobStatus(authStatus)
          : statusLabel
      // 已废除确认卡：标题永远是进度，禁止再出现「· 确认」造成一闪即失的假确认卡
      var opsCard = serviceRunCard(requirement, workKind)
      var gitCard = workKind === 'git_deliver' || kind === 'git_deliver'
      var title = gitCard
        ? phase === 'done' || visiblePhase === 'done'
          ? 'Cursor Git 交付 · 交付结论'
          : phase === 'review'
            ? 'Cursor Git 交付 · 确认提交'
            : 'Cursor Git 交付 · 进度'
        : opsCard
          ? phase === 'done' || visiblePhase === 'done'
            ? 'Cursor 开发操作 · 本轮结论'
            : 'Cursor 开发操作 · 进度'
          : parentJobId || kind === 'continue'
            ? 'Cursor 对话写码 · 续改进度'
            : phase === 'done' || visiblePhase === 'done'
              ? 'Cursor 对话写码 · 本轮结论'
              : 'Cursor 对话写码 · 进度'

      var statusZh = (function () {
        var s = String(visibleLabel || '')
        if (gitCard) {
          if (s === '已暂停提交' || s === '已暂停提交…') return '已暂停提交'
          if (s === 'pending_review' || s === '确认 Git 交付' || phase === 'review') return '确认 Git 交付'
          if (s === '读取 Git 中' || s === '提交推送中') return s
          if (s === 'running' || s === 'queued' || s === '写码中') return '读取 Git 中'
        }
        if ((s === 'running' || s === 'queued' || s === '写码中') && opsCard) return '处理中'
        if (s === 'running' || s === 'queued') return '写码中'
        if (s === 'pending_review' || s === '待审同步') return '待审同步'
        if (s === 'succeeded' || s === 'done' || s === '已完成') return '已完成'
        if (s === 'failed') return '失败'
        if (s === 'cancelled' || s === '已取消' || s === '已停止') return s === '已停止' ? '已停止' : '已取消'
        // 禁止把内部相位名 form/running 直接渲到用户可见区
        if (s === 'form' || s === 'review' || visiblePhase === 'form') {
          return visiblePhase === 'done' ? '已结束' : '准备中'
        }
        if (visiblePhase === 'done') return s || '已结束'
        return s || '准备中'
      })()
      // 未终态 / begin 阻塞中必须展示过程；禁止空等只出结论
      var hostTurnLive =
        typeof document !== 'undefined' && !!document.querySelector('[data-chat-running]')
      var viewPhaseNow = toolViewPhase(props)
      var beginBlocking = viewPhaseNow === 'start' || viewPhaseNow === 'preparing'
      var hasActiveJob =
        !!jobId && !TERMINAL_JOB[String(sealedStatusRef.current || authStatus || '')]
      var showLiveChrome =
        visiblePhase !== 'done' &&
        !cancelOnceRef.current &&
        !toolCancelledNow &&
        !(toolSettledNow && !jobId && !beginBlocking) &&
        (!!hostTurnLive || hasActiveJob || beginBlocking)

      // 已停止/已取消却无卡内结论：立刻钉一文案，禁止「正在汇总」空转
      useEffect(
        function () {
          var sealed = String(sealedStatusRef.current || '')
          var stopped =
            cancelOnceRef.current ||
            toolCancelledNow ||
            sealed === 'cancelled' ||
            statusZh === '已取消' ||
            statusZh === '已停止'
          if (!stopped) return
          if (phase !== 'done' && visiblePhase !== 'done') return
          setConclusionMd(function (prev) {
            if (String(prev || '').trim()) return prev
            var body = String(resultFields.chatBody || '').trim()
            if (body) return concludeMdForWorkKind(body, workKind)
            return stoppedConclusionMd(workKind)
          })
        },
        [phase, visiblePhase, statusZh, toolCancelledNow, resultFields.chatBody, workKind],
      )

      // 三段式结论只挂过程组外一次；文件列表只用底座原生卡（禁止自绘）
      useEffect(
        function () {
          // 工具卡收在「已调用工具」里，从这里插节点到不了正文，还会和全局脚本各插一份。
          return
          var doneNow =
            phase === 'done' ||
            visiblePhase === 'done' ||
            !!TERMINAL_JOB[String(sealedStatusRef.current || '')]
          var md = normalizeConclusionMd(String(conclusionMd || '').trim())
          if (!doneNow || !md) return
          if (
            md.indexOf('本轮结论') < 0 &&
            md.indexOf('Git 交付结论') < 0 &&
            md.indexOf('结果：') < 0 &&
            md.indexOf('任务结果') < 0
          )
            return
          ensureCss()
          var cardId =
            'cc-card-' + String(identity || jobId || confirmToken || (ui && ui.confirm_token) || 'x').trim()
          var hoistId = 'cc-hoist-' + String(jobId || identity || 'x').replace(/[^\w.-]+/g, '_')
          var stopped = false
          function place() {
            // 任务结束后：只取这一份结论、去掉重复段，再逐行流式写入正文。
            if (stopped || typeof document === 'undefined') return
            if (document.querySelector('[data-chat-running]')) return
            var text = typeof normalizeConclusionMd === 'function' ? normalizeConclusionMd(md) : md
            if (!text) return
            var card = document.getElementById(cardId)
            var fileCard = typeof findEditedCardIn === 'function' ? findEditedCardIn(document) : null
            var parent = null
            var before = null
            if (fileCard && fileCard.parentElement) {
              parent = fileCard.parentElement
              before = fileCard
            } else if (card) {
              var group =
                (card.closest && card.closest('[data-step-process]')) ||
                (card.closest && card.closest('[data-process-group]')) ||
                (card.closest && card.closest('.process-group'))
              var anchor = group || card
              parent = anchor.parentElement
              before = anchor.nextSibling
            }
            if (!parent) return
            var host = document.getElementById(hoistId)
            if (host && (host.getAttribute('data-cc-streamed') === '1' || host.getAttribute('data-cc-streaming') === '1')) {
              return
            }
            if (!host) {
              host = document.createElement('div')
              host.id = hoistId
              host.className = 'cc-conclusion-hoist'
              host.setAttribute('data-cc-conclusion-hoist', '1')
              host.setAttribute('data-cc-job-id', String(jobId || ''))
              try {
                parent.insertBefore(host, before)
              } catch (eIns) {
                return
              }
            }
            try {
              var extras = parent.querySelectorAll('[data-cc-conclusion-hoist="1"]')
              for (var ei = 0; ei < extras.length; ei++) {
                if (extras[ei] !== host && extras[ei].parentElement) extras[ei].parentElement.removeChild(extras[ei])
              }
            } catch (eEx) {}
            host.setAttribute('data-cc-streaming', '1')
            var lines = String(text).split('\n')
            var shown = 0
            host.innerHTML = '<div class="cc-conclusion"></div>'
            var box = host.firstChild
            var tick = setInterval(function () {
              if (!document.getElementById(hoistId)) {
                clearInterval(tick)
                return
              }
              shown = Math.min(lines.length, shown + 2)
              try {
                box.innerHTML = renderMd(lines.slice(0, shown).join('\n'))
              } catch (eRd) {}
              if (shown >= lines.length) {
                clearInterval(tick)
                host.setAttribute('data-cc-streamed', '1')
                host.removeAttribute('data-cc-streaming')
              }
            }, 45)
            return
            if (stopped || typeof document === 'undefined') return
            var card = document.getElementById(cardId)
            if (!card) return
            var group =
              (card.closest && card.closest('[data-step-process]')) ||
              (card.closest && card.closest('[data-process-group]')) ||
              (card.closest && card.closest('.process-group'))
            var turn = (card.closest && card.closest('[data-chat-turn]')) || null
            var anchor = group || card
            var parent = (anchor && anchor.parentElement) || turn
            if (!parent || !anchor) return
            var scope = turn || parent
            var turnStillRunning =
              typeof document !== 'undefined' && !!document.querySelector('[data-chat-running]')
            var cardDone = card.classList && card.classList.contains('is-done')
            // 任务还在跑（含模型重试）：正文不许出现结论
            if (turnStillRunning || !cardDone) {
              if (typeof suppressConclusionsAfter === 'function') suppressConclusionsAfter(card)
              var early = document.getElementById(hoistId)
              if (early && early.parentElement) {
                try {
                  early.parentElement.removeChild(early)
                } catch (eEarly) {}
              }
              return
            }
            // 本轮回复里已经有结论：不再挂第二份，只留最后一份并把底座改动卡挪到下面
            var already =
              typeof leavesAfter === 'function' ? leavesAfter(scope, card) : []
            if (already.length) {
              var ours = document.getElementById(hoistId)
              var oursIsOnly = already.length === 1 && ours && (ours === already[0] || ours.contains(already[0]))
              if (!oursIsOnly && ours && ours.parentElement) {
                try {
                  ours.parentElement.removeChild(ours)
                } catch (eDrop) {}
              }
              if (typeof keepOneConclusion === 'function') keepOneConclusion(scope, card)
              return
            }
            var host = document.getElementById(hoistId)
            if (!host && scope.querySelector) host = scope.querySelector('[data-cc-conclusion-hoist="1"]')
            if (!host) {
              host = document.createElement('div')
              host.id = hoistId
              host.setAttribute('data-cc-conclusion-hoist', '1')
              host.setAttribute('data-cc-job-id', String(jobId || identity || ''))
              host.className = 'cc-conclusion-hoist'
              try {
                if (anchor.nextSibling) parent.insertBefore(host, anchor.nextSibling)
                else parent.appendChild(host)
              } catch (eIns) {
                try {
                  parent.appendChild(host)
                } catch (e2) {
                  return
                }
              }
            }
            host.innerHTML = '<div class="cc-conclusion">' + renderMd(md) + '</div>'
            if (typeof keepOneConclusion === 'function') keepOneConclusion(scope, card)
          }
          place()
          var timers = [120, 400, 1000, 2200, 4500].map(function (ms) {
            return setTimeout(place, ms)
          })
          var poll = setInterval(place, 800)
          return function () {
            stopped = true
            clearInterval(poll)
            timers.forEach(function (t) {
              clearTimeout(t)
            })
          }
        },
        [phase, visiblePhase, conclusionMd, jobId, identity, confirmToken],
      )

      function renderCheckGroup(titleText, paths, tag) {
        if (!paths || !paths.length) return null
        return h(
          'div',
          { style: { marginBottom: '8px' } },
          h('h5', null, titleText),
          paths.map(function (p) {
            return h(
              'label',
              { key: tag + ':' + p, className: 'cc-check' },
              h('input', {
                type: 'checkbox',
                checked: !!selected[p],
                onChange: function () {
                  togglePath(p)
                },
              }),
              h('span', null, p, h('span', { className: 'tag' }, tag)),
            )
          }),
        )
      }

      function shortPath(p) {
        if (!p) return ''
        var s = String(p)
        var m = s.replace(/\\/g, '/').match(/\/sandboxes\/[^/]+\/(.+)$/)
        return m ? m[1] : s
      }

      function isShellTool(name) {
        var n = String(name || '').toLowerCase()
        return n === 'shell' || n === 'bash' || n === 'terminal' || n.indexOf('shell') >= 0
      }

      /** read | search | cmd | edit | other — 对齐 Cursor 工具汇总文案 */
      function toolBucket(name) {
        var n = String(name || '').toLowerCase()
        if (isShellTool(n)) return 'cmd'
        if (n === 'glob' || n.indexOf('glob') >= 0) return 'search'
        if (n === 'grep' || n === 'rg' || n.indexOf('search') >= 0) return 'search'
        if (n === 'read' || n === 'readfile' || n.indexOf('read') >= 0) return 'read'
        if (n === 'ls' || n === 'list' || n.indexOf('dir') >= 0) return 'read'
        if (
          n === 'write' ||
          n === 'edit' ||
          n.indexOf('write') >= 0 ||
          n.indexOf('strreplace') >= 0 ||
          n.indexOf('delete') >= 0 ||
          n === 'rm'
        )
          return 'edit'
        return 'other'
      }

      function toolIsDone(it) {
        var st = String((it && it.tool_status) || '').toLowerCase()
        return st === 'completed' || st === 'done' || st === 'success' || st === 'error' || st === 'failed'
      }

      /** 仅展示文案；不参与状态机。认 tool_status 权威字段。 */
      function toolStatusLabel(it) {
        var st = String((it && it.tool_status) || '').toLowerCase()
        if (st === 'error' || st === 'failed') return 'failed'
        if (st === 'completed' || st === 'done' || st === 'success') return 'completed'
        if (st === 'running' || st === 'in_progress') return 'running'
        return toolIsDone(it) ? 'completed' : 'running'
      }

      function toolLiveWhy(name) {
        var b = toolBucket(name)
        if (b === 'cmd') return 'Running command'
        if (b === 'search') return 'Searching'
        if (b === 'read') return 'Reading file'
        if (b === 'edit') return 'Editing file'
        return 'Working'
      }

      function toolMetaLine(it) {
        if (!it) return ''
        if (it.command) {
          var cmd = String(it.command)
          if (cmd.length > 88) cmd = cmd.slice(0, 85) + '…'
          return cmd
        }
        if (it.path) {
          var p = shortPath(it.path)
          if (it.pattern) return p + ' · ' + String(it.pattern)
          return p
        }
        if (it.pattern) return String(it.pattern)
        return it.name ? String(it.name) : ''
      }

      /** Cursor 式：Explored 4 files, 1 search */
      function formatToolGroupSummary(tools) {
        var c = { read: 0, search: 0, cmd: 0, edit: 0, other: 0 }
        ;(tools || []).forEach(function (t) {
          c[toolBucket(t.name)] += 1
        })
        var parts = []
        if (c.read || c.search) {
          var bit = 'Explored'
          if (c.read) bit += ' ' + c.read + ' file' + (c.read > 1 ? 's' : '')
          if (c.search) {
            bit += (c.read ? ', ' : ' ') + c.search + ' search' + (c.search > 1 ? 'es' : '')
          }
          parts.push(bit)
        }
        if (c.cmd) parts.push('Ran ' + c.cmd + ' command' + (c.cmd > 1 ? 's' : ''))
        if (c.edit) parts.push('Edited ' + c.edit + ' file' + (c.edit > 1 ? 's' : ''))
        if (c.other) parts.push('Used ' + c.other + ' tool' + (c.other > 1 ? 's' : ''))
        if (!parts.length) return 'Explored'
        return parts.join(' · ')
      }

      function fileLangLabel(path) {
        var p = String(path || '')
        var m = p.toLowerCase().match(/\.([a-z0-9]+)$/)
        var ext = m ? m[1] : ''
        if (ext === 'ts' || ext === 'tsx') return 'ts'
        if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'js'
        if (ext === 'vue') return 'vue'
        if (ext === 'py') return 'py'
        if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css'
        if (ext === 'json') return 'json'
        if (ext === 'md' || ext === 'mdx') return 'md'
        if (ext === 'html' || ext === 'htm') return 'html'
        if (ext === 'java') return 'java'
        if (ext === 'go') return 'go'
        if (ext === 'rs') return 'rs'
        return ext || 'file'
      }

      function fileBaseName(path) {
        var p = String(path || '').replace(/\\/g, '/')
        var i = p.lastIndexOf('/')
        return i >= 0 ? p.slice(i + 1) : p
      }

      function countDiffStats(text) {
        var add = 0
        var del = 0
        String(text || '')
          .split('\n')
          .forEach(function (line) {
            if (/^\+/.test(line) && !/^\+\+\+/.test(line)) add += 1
            else if (/^-/.test(line) && !/^---/.test(line)) del += 1
          })
        return { add: add, del: del }
      }

      /** Cursor Diff：整卡黑底；行不靠浅粉底色，用深绿/深红条 + 白字 + 绿/红 +/-（全内联防宿主冲掉） */
      function renderDiffCard(path, snip, cardKey) {
        var text = String(snip || '').trim()
        if (!text) return null
        var stats = countDiffStats(text)
        var lines = text.split('\n').filter(function (ln) {
          return ln !== '…' && ln !== '...'
        })
        var oldLn = 0
        var newLn = 0
        var ROW_CAP = 14
        var key = String(cardKey || path || 'diff')
        var opened = !!(diffOpenMap && diffOpenMap[key])
        var clipped = !opened && lines.length > ROW_CAP
        var shownLines = clipped ? lines.slice(0, ROW_CAP) : lines
        var BG = '#1e1e1e'
        var FG = '#ffffff'
        var FG_DIM = '#9d9d9d'
        var ADD_BG = '#1b4332'
        var DEL_BG = '#4a1520'
        var ADD_FG = '#3fb950'
        var DEL_FG = '#f85149'
        var rows = shownLines.map(function (line, i) {
          var kind = 'ctx'
          var show = line
          var ln = ''
          var sign = ' '
          var rowBg = BG
          var signColor = 'transparent'
          var lnColor = FG_DIM
          if (/^@@/.test(line)) {
            var hm = line.match(/-(\d+)(?:,\d+)?\s+\+(\d+)/)
            if (hm) {
              oldLn = Math.max(0, parseInt(hm[1], 10) - 1)
              newLn = Math.max(0, parseInt(hm[2], 10) - 1)
            }
            return h(
              'div',
              {
                key: 'dr' + i,
                className: 'cc-diff-row hunk',
                style: { display: 'flex', background: BG, color: FG_DIM },
              },
              h('span', { className: 'ln', style: { flex: '0 0 44px', textAlign: 'right', padding: '0 6px', color: FG_DIM } }, ''),
              h('span', { className: 'sign', style: { flex: '0 0 14px', textAlign: 'center' } }, ''),
              h('span', { className: 'code', style: { flex: 1, padding: '0 12px 0 6px', whiteSpace: 'pre', color: FG_DIM } }, line),
            )
          }
          if (/^\+/.test(line) && !/^\+\+\+/.test(line)) {
            kind = 'add'
            sign = '+'
            newLn += 1
            ln = String(newLn)
            show = line.slice(1)
            if (/^ /.test(show)) show = show.slice(1)
            rowBg = ADD_BG
            signColor = ADD_FG
            lnColor = ADD_FG
          } else if (/^-/.test(line) && !/^---/.test(line)) {
            kind = 'del'
            sign = '-'
            oldLn += 1
            ln = String(oldLn)
            show = line.slice(1)
            if (/^ /.test(show)) show = show.slice(1)
            rowBg = DEL_BG
            signColor = DEL_FG
            lnColor = DEL_FG
          } else {
            oldLn += 1
            newLn += 1
            ln = String(newLn)
            if (/^ /.test(line)) show = line.slice(1)
          }
          return h(
            'div',
            {
              key: 'dr' + i,
              className: 'cc-diff-row ' + kind,
              style: { display: 'flex', width: '100%', background: rowBg, color: FG },
            },
            h(
              'span',
              {
                className: 'ln',
                style: {
                  flex: '0 0 44px',
                  textAlign: 'right',
                  padding: '0 6px',
                  color: lnColor,
                  userSelect: 'none',
                  fontVariantNumeric: 'tabular-nums',
                },
              },
              ln,
            ),
            h(
              'span',
              {
                className: 'sign',
                style: {
                  flex: '0 0 14px',
                  textAlign: 'center',
                  color: signColor,
                  fontWeight: 600,
                  userSelect: 'none',
                },
              },
              sign,
            ),
            h(
              'span',
              {
                className: 'code',
                style: {
                  flex: 1,
                  minWidth: 0,
                  padding: '0 12px 0 6px',
                  whiteSpace: 'pre',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  color: FG,
                },
              },
              show.length ? show : ' ',
            ),
          )
        })
        var rel = shortPath(path) || path || 'file'
        return h(
          'div',
          {
            className: 'cc-diff',
            'aria-label': '代码变更',
            style: {
              background: BG,
              color: FG,
              border: '1px solid #333',
              borderRadius: '8px',
              overflow: 'hidden',
              colorScheme: 'dark',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: '12px',
              lineHeight: 1.55,
            },
          },
          h(
            'div',
            {
              className: 'cc-diff-head',
              title: rel,
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                background: '#252526',
                color: FG,
                borderBottom: '1px solid #333',
              },
            },
            h('span', { className: 'lang', style: { color: '#9d9d9d', textTransform: 'uppercase', fontSize: '11px' } }, fileLangLabel(rel)),
            h('span', { className: 'file', style: { color: FG, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, fileBaseName(rel)),
            stats.add
              ? h('span', { className: 'plus', style: { color: ADD_FG, marginLeft: 'auto', fontWeight: 600 } }, '+' + stats.add)
              : h('span', { style: { marginLeft: 'auto' } }),
            stats.del
              ? h('span', { className: 'minus', style: { color: DEL_FG, marginLeft: '6px', fontWeight: 600 } }, '-' + stats.del)
              : null,
          ),
          h(
            'div',
            {
              className: 'cc-diff-body' + (opened ? ' is-open' : ''),
              style: {
                margin: 0,
                padding: '4px 0',
                overflow: 'auto',
                maxHeight: opened ? 'none' : '260px',
                background: BG,
                color: FG,
              },
            },
            rows,
          ),
          clipped
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'cc-diff-more',
                  style: {
                    display: 'block',
                    width: '100%',
                    border: 0,
                    background: '#252526',
                    color: '#9d9d9d',
                    fontSize: '12px',
                    padding: '6px 12px 8px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  },
                  onClick: function () {
                    setDiffOpenMap(function (prev) {
                      var next = Object.assign({}, prev || {})
                      next[key] = true
                      return next
                    })
                  },
                },
                '展开其余 ' + (lines.length - ROW_CAP) + ' 行…',
              )
            : null,
        )
      }

      function renderCmdCard(cmd, statusLabel, failHint) {
        var text = String(cmd || '').trim()
        if (!text) return null
        var st = String(statusLabel || '').toLowerCase()
        var failed = st === 'failed'
        var stText = failed ? 'failed' : st === 'completed' ? 'completed' : st === 'running' ? 'running' : st || ''
        return h(
          'div',
          {
            className: 'cc-cmd',
            'aria-label': '命令',
            style: { background: '#0d1117', color: '#e6edf3', border: '1px solid #30363d' },
          },
          h(
            'div',
            {
              className: 'cc-cmd-head',
              style: { background: '#161b22', display: 'flex', alignItems: 'center', gap: '8px' },
            },
            h('span', null, 'Terminal'),
            stText
              ? h('span', { className: 'cc-cmd-st' + (failed ? ' is-fail' : '') }, stText)
              : null,
          ),
          h('pre', { style: { background: '#0d1117', color: '#e6edf3' } }, text),
          failed && failHint ? h('pre', { className: 'cc-cmd-fail' }, failHint) : null,
        )
      }

      /** 有命令/代码片断：在流里直接展示，不藏进汇总 */
      function toolHasVisiblePayload(it) {
        if (!it) return false
        if (String(it.command || '').trim()) return true
        if (String(it.snippet || '').trim()) return true
        var b = toolBucket(it.name)
        return b === 'cmd' || b === 'edit'
      }

      function renderRichToolNode(it) {
        var cmd = String((it && it.command) || '').trim()
        var snip = String((it && it.snippet) || '').trim()
        var path = shortPath((it && it.path) || '') || toolMetaLine(it)
        if (cmd && path === cmd) path = ''
        var stLabel = toolStatusLabel(it)
        var failHint =
          stLabel === 'failed' && snip
            ? snip
            : ''
        var block = cmd
          ? renderCmdCard(cmd, stLabel, failHint)
          : snip
            ? renderDiffCard(path || (it && it.path) || '', snip, it && it.id)
            : null
        return h('div', { key: it.id, className: 'cc-bubble tool-rich' }, block)
      }

      function renderUserChoicePanel() {
        if (!pendingChoice || !pendingChoice.question) return null
        var opts = Array.isArray(pendingChoice.options) ? pendingChoice.options : []
        return h(
          'div',
          { className: 'cc-user-choice', 'data-cc-user-choice': '1' },
          h('p', { className: 'q' }, String(pendingChoice.question || '')),
          h(
            'div',
            { className: 'opts' },
            opts.map(function (o, i) {
              var label = String((o && o.label) || o || '').trim()
              if (!label) return null
              return h(
                'button',
                {
                  key: String((o && o.id) || i),
                  type: 'button',
                  className: 'opt',
                  disabled: !!choiceBusy,
                  onClick: function () {
                    submitUserChoice(label)
                  },
                },
                label,
              )
            }),
          ),
          h('p', { className: 'hint' }, choiceBusy ? '已提交，继续处理中…' : '请选择一项后继续'),
        )
      }

      function renderToolGroupNode(tools, key) {
        var title = formatToolGroupSummary(tools)
        var lines = (tools || []).map(function (t, i) {
          var meta = toolMetaLine(t)
          var label = String(t.name || 'tool')
          var stLabel = toolStatusLabel(t)
          var failed = stLabel === 'failed'
          return h(
            'div',
            { key: (t.id || i) + '', className: 'cc-tool-line', title: meta || label },
            h('span', { className: 'ico', 'aria-hidden': 'true' }, '⚙'),
            h('span', { className: 'name' }, label),
            h('span', { className: 'st' + (failed ? ' is-fail' : '') }, stLabel),
            meta ? h('span', { className: 'path' }, meta) : null,
          )
        })
        return h(
          'div',
          { key: key, className: 'cc-bubble tool-group' },
          h(
            'details',
            { open: true },
            h('summary', null, title, h('span', { className: 'cc-chev', 'aria-hidden': 'true' }, '›')),
            h('div', { className: 'cc-tool-list' }, lines),
          ),
        )
      }

      function renderTranscript() {
        if (!transcript || !transcript.length) {
          if (!showLiveChrome || visiblePhase === 'done' || phase === 'done') {
            return h(
              'div',
              { className: 'cc-note', style: { margin: '8px 0' } },
              statusZh === '已完成' || statusZh === '失败' || statusZh === '已取消' || statusZh === '已停止'
                ? '本轮写码已结束（' + statusZh + '）。过程片段正从本机服务恢复；若仍为空，结论见下方对话正文。'
                : '本轮过程已结束。',
            )
          }
          return h(
            'div',
            { className: 'cc-plan' },
            h('span', { className: 'cc-spin', 'aria-hidden': 'true' }),
            h('span', null, 'Starting…'),
          )
        }
        var prevAsst = []
        var nodes = []
        var toolBuf = []
        var streamActive = showLiveChrome && visiblePhase !== 'done' && phase !== 'done'
        void thinkRevealTick
        // 仅最近一条 Thought 默认展开；更早的收起
        var lastThinkId = ''
        ;(transcript || []).forEach(function (it) {
          if (it && it.kind === 'thinking') lastThinkId = String(it.id || '')
        })
        // 进行中只铺最近 2 张 Diff；终态/刷新恢复多铺几张，避免「改动文件全丢」观感
        var richDoneIds = []
        ;(transcript || []).forEach(function (it) {
          if (it && it.kind === 'tool' && toolIsDone(it) && toolHasVisiblePayload(it)) {
            richDoneIds.push(String(it.id || ''))
          }
        })
        var richKeep = {}
        var richKeepN = streamActive ? 2 : 8
        richDoneIds.slice(-richKeepN).forEach(function (id) {
          richKeep[id] = true
        })
        var richFoldBuf = []
        // 展示层：相邻同文 status 只留一条（多条沙箱进度会改写成同一句）
        var lastStatusShown = ''
        // 推送心跳「已等待 N 秒」只留最新一条，避免过程区堆一串
        var skipStatusId = {}
        ;(function collapsePushWaitHeartbeats() {
          var prevWait = ''
          ;(transcript || []).forEach(function (row) {
            if (!row || row.kind !== 'status') return
            var m = normalizeStatusDisplayClient(row.text || '')
            if (!/正在推送到远端.*已等待\s*\d+\s*秒/.test(m)) return
            if (prevWait) skipStatusId[prevWait] = true
            prevWait = String(row.id || '')
          })
        })()
        // 审码进度「正在审码（3/8）」只留最新一条，并盖住开头的「正在审码本批 N 个文件」
        ;(function collapseReviewProgress() {
          var prev = ''
          ;(transcript || []).forEach(function (row) {
            if (!row || row.kind !== 'status') return
            var m = normalizeStatusDisplayClient(row.text || '')
            if (!isReviewProgressLine(m)) return
            if (prev) skipStatusId[prev] = true
            prev = String(row.id || '')
          })
        })()
        // 进行中只让「当前最新一条」进度转圈；历史步骤静止，避免一大片同时转
        var liveStatusId = ''
        ;(function pickLiveStatusId() {
          var prev = ''
          ;(transcript || []).forEach(function (row) {
            if (!row || row.kind !== 'status') {
              prev = ''
              return
            }
            var id = String(row.id || '')
            if (id && skipStatusId[id]) return
            var m = normalizeStatusDisplayClient(row.text || '')
            if (/【本轮结论】|^##\s*本轮结论|^##\s*Git\s*交付结论|说明方案/.test(m)) return
            if (!m) return
            if (
              /准备沙箱|稀疏拷贝|沙箱就绪|启动 Cursor|正在启动|Mock Cursor|已入队|确认入队|写范围|只读上下文/i.test(
                m,
              )
            ) {
              if (!streamActive) return
              m = serviceRunCard(requirement, workKind) ? '正在准备执行，不改代码…' : '正在准备写码环境…'
            }
            if (m === prev) return
            prev = m
            liveStatusId = id
          })
        })()

        function noteNonStatusNode() {
          lastStatusShown = ''
        }

        function flushTools() {
          if (!toolBuf.length) return
          var key = 'tg-' + (toolBuf[0].id || nodes.length)
          nodes.push(renderToolGroupNode(toolBuf.slice(), key))
          noteNonStatusNode()
          toolBuf = []
        }

        function flushRichFold() {
          if (!richFoldBuf.length) return
          var n = richFoldBuf.length
          var key = 'rf-' + (richFoldBuf[0].id || nodes.length)
          nodes.push(
            h(
              'div',
              { key: key, className: 'cc-bubble tool-group' },
              h(
                'details',
                null,
                h(
                  'summary',
                  null,
                  'Edited ' + n + ' earlier file' + (n > 1 ? 's' : ''),
                  h('span', { className: 'cc-chev', 'aria-hidden': 'true' }, '›'),
                ),
                h(
                  'div',
                  { className: 'cc-tool-list', style: { marginTop: '8px' } },
                  richFoldBuf.map(function (t) {
                    return renderRichToolNode(t)
                  }),
                ),
              ),
            ),
          )
          noteNonStatusNode()
          richFoldBuf = []
        }

        ;(transcript || []).forEach(function (it) {
          if (!it) return
          if (it.kind === 'tool') {
            if (toolIsDone(it)) {
              if (toolHasVisiblePayload(it)) {
                flushTools()
                var tid = String(it.id || '')
                if (richKeep[tid] || richDoneIds.length <= 2) {
                  flushRichFold()
                  nodes.push(renderRichToolNode(it))
                  noteNonStatusNode()
                } else {
                  richFoldBuf.push(it)
                }
              } else {
                flushRichFold()
                toolBuf.push(it)
              }
              return
            }
            flushRichFold()
            flushTools()
            var metaLive = toolMetaLine(it)
            var liveCmd = String(it.command || '').trim()
            var liveSnip = String(it.snippet || '').trim()
            // 进行中：先一行状态；有 Diff/命令再跟卡片（同 Cursor）
            nodes.push(
              h(
                'div',
                { key: it.id, className: 'cc-bubble tool-live' },
                h('span', { className: 'cc-spin', 'aria-hidden': 'true' }),
                h('span', { className: 'name' }, toolLiveWhy(it.name)),
                metaLive && !liveCmd && !liveSnip
                  ? h('span', { className: 'meta' }, metaLive)
                  : null,
                liveCmd ? renderCmdCard(liveCmd, 'running', '') : null,
                !liveCmd && liveSnip
                  ? renderDiffCard(shortPath(it.path) || it.path || '', liveSnip, it.id)
                  : null,
              ),
            )
            noteNonStatusNode()
            return
          }
          flushRichFold()
          flushTools()
          if (it.kind === 'user') {
            // Cursor 过程区不回显用户原话（侧栏对话已有）
            return
          }
          if (it.kind === 'thinking') {
            var streaming = !!it.streaming && streamActive
            var durSec =
              it.thinking_duration_ms != null
                ? Math.max(1, Math.round(Number(it.thinking_duration_ms) / 1000))
                : 0
            var thinkId = String(it.id || '')
            var isLatestThink = thinkId && thinkId === lastThinkId
            var thinkText = thinkingDisplayText(it)
            var stillRevealing =
              String(it.text || '').length > String(thinkText || '').length
            // 结论未出前：最近一条 Thought 保持展开可见，禁止先收起再留白
            var holdThought =
              isLatestThink && streamActive && !String(conclusionMd || '').trim()
            // Cursor 式：Thought；正文自上而下显现，不整段硬蹦
            if ((streaming || stillRevealing || holdThought) && !String(thinkText || '').trim()) {
              nodes.push(
                h(
                  'div',
                  { key: it.id, className: 'cc-bubble thought' },
                  h('span', { className: 'ico', 'aria-hidden': 'true' }, '▸'),
                  h('span', null, 'Thinking'),
                  h('span', { className: 'cc-cursor', 'aria-hidden': 'true' }),
                ),
              )
              noteNonStatusNode()
              return
            }
            var thinkLabel =
              streaming || stillRevealing || holdThought
                ? 'Thinking'
                : 'Thinking' + (durSec ? ' · ' + durSec + 's' : '')
            var thinkOpen = streaming || stillRevealing || isLatestThink || holdThought
            var thinkFull = !!(thinkFullMap && thinkFullMap[thinkId]) || holdThought
            var fullLen = String(it.text || '').length
            var thinkLong = fullLen > 360 || String(it.text || '').split('\n').length > 6
            nodes.push(
              h(
                'div',
                {
                  key: it.id,
                  className:
                    'cc-bubble thinking' +
                    (streaming || stillRevealing || holdThought ? ' is-stream' : '') +
                    (holdThought ? ' is-hold' : '') +
                    (!streamActive && !holdThought ? ' is-done' : ''),
                },
                h(
                  'details',
                  {
                    open: thinkOpen,
                    className: thinkFull ? 'is-full' : '',
                  },
                  h(
                    'summary',
                    null,
                    h('span', { className: 'cc-think-ico', 'aria-hidden': 'true' }, '▸'),
                    thinkLabel,
                    h('span', { className: 'cc-chev', 'aria-hidden': 'true' }, '›'),
                  ),
                  h(
                    'div',
                    { className: 'body' },
                    thinkText,
                    streaming || stillRevealing || holdThought
                      ? h('span', { className: 'cc-cursor', 'aria-hidden': 'true' })
                      : null,
                  ),
                  thinkLong && !thinkFull && !stillRevealing && !streaming && !holdThought
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'cc-think-more',
                          onClick: function (ev) {
                            try {
                              if (ev && ev.preventDefault) ev.preventDefault()
                              if (ev && ev.stopPropagation) ev.stopPropagation()
                            } catch (e0) {}
                            setThinkFullMap(function (prev) {
                              var next = Object.assign({}, prev || {})
                              next[thinkId] = true
                              return next
                            })
                          },
                        },
                        '展开全部思考…',
                      )
                    : null,
                ),
              ),
            )
            noteNonStatusNode()
            return
          }
          if (it.kind === 'assistant') {
            var shown = refineAssistantSegmentTextClient(it.text || '', prevAsst)
            prevAsst.push(String(it.text || ''))
            if (!shown) return
            nodes.push(
              h(
                'div',
                { key: it.id, className: 'cc-bubble assistant' },
                h('div', { className: 'role' }, 'CURSOR'),
                h('div', {
                  className: 'body',
                  dangerouslySetInnerHTML: { __html: renderMd(shown) },
                }),
              ),
            )
            noteNonStatusNode()
            return
          }
          if (it.kind === 'status') {
            var sid = String(it.id || '')
            if (sid && skipStatusId[sid]) return
            var msg = normalizeStatusDisplayClient(it.text || '')
            if (/【本轮结论】|^##\s*本轮结论|^##\s*Git\s*交付结论|说明方案/.test(msg)) return
            if (!msg) return
            // 沙箱/启动细节：进行中改写为友好占位，禁止静默丢掉导致大块空白
            if (
              /准备沙箱|稀疏拷贝|沙箱就绪|启动 Cursor|正在启动|Mock Cursor|已入队|确认入队|写范围|只读上下文/i.test(
                msg,
              )
            ) {
              if (!streamActive) return
              msg = serviceRunCard(requirement, workKind) ? '正在准备执行，不改代码…' : '正在准备写码环境…'
            }
            // 仅展示去重：连续多条改写成同一句时只留一条，不改 transcript 账本
            if (msg === lastStatusShown) return
            lastStatusShown = msg
            // 只转最新一条；已完成文案即使是最新也不转圈
            var isLatest = streamActive && liveStatusId && sid === liveStatusId
            var settled =
              /^(已|本批)|通过|失败|成功|Commit：|PR：|跳过审码|无需/.test(msg) &&
              !/正在|请稍候|已等待|重试/.test(msg)
            var busy = Boolean(isLatest && !settled)
            nodes.push(
              h(
                'div',
                { key: it.id, className: 'cc-bubble status' + (busy ? ' is-live' : '') },
                busy ? h('span', { className: 'cc-spin', 'aria-hidden': 'true' }) : null,
                h('span', null, msg),
              ),
            )
          }
        })
        flushRichFold()
        flushTools()
        // 过程区绝不为空：结论未出前至少留一行友好占位
        if ((!nodes || !nodes.length) && streamActive) {
          return h(
            'div',
            { key: 'cc-hold-empty', className: 'cc-hold' },
            h('span', { className: 'cc-spin', 'aria-hidden': 'true' }),
            h('span', null, '正在分析请求，过程即将呈现…'),
          )
        }
        return nodes
      }

      var isStreamPhase = phase === 'running' || phase === 'review' || phase === 'done' || phase === 'form'
      var hasTranscript = Boolean(transcript && transcript.length)
      var isDoneView = phase === 'done' || visiblePhase === 'done'
      var planLabel =
        statusZh === '自动同步中'
          ? 'Applying changes…'
          : statusZh === '待审同步'
            ? 'Waiting for review…'
            : hasTranscript
              ? 'Planning next moves'
              : 'Starting…'
      return h(
        'div',
        {
          className:
            'cc-card' +
            (isStreamPhase ? ' cc-stream-card' : '') +
            (isDoneView ? ' is-done' : ''),
          id: 'cc-card-' + String(identity || jobId || confirmToken || (ui && ui.confirm_token) || 'x').trim(),
        },
        h('h4', null, title),
        h('p', { className: 'cc-phase' }, ''),
        phase === 'running' || phase === 'review' || phase === 'done' || phase === 'form'
          ? h(
              'div',
              null,
              // 终态：全文结论只在过程组外 hoist 展示一次；卡内仅保留复制/错误，禁止双份正文
              isDoneView
                ? h(
                    'div',
                    { className: 'cc-done-panel' },
                    (function () {
                      var sealed = String(sealedStatusRef.current || authStatus || '')
                      var stopped =
                        cancelOnceRef.current ||
                        toolCancelledNow ||
                        sealed === 'cancelled' ||
                        statusZh === '已取消' ||
                        statusZh === '已停止'
                      var terminal =
                        stopped ||
                        sealed === 'succeeded' ||
                        sealed === 'failed' ||
                        sealed === 'blocked_no_runner' ||
                        statusZh === '已完成' ||
                        statusZh === '失败'
                      var md = String(conclusionMd || resultFields.chatBody || '').trim()
                      if (md) {
                        return h(
                          'p',
                          { className: 'cc-note' },
                          gitCard ? 'Git 交付结论见下方正文' : '本轮结论见下方正文',
                        )
                      }
                      // 已终态/已停止：禁止「正在汇总」转圈（结论可能已在下方 hoist）
                      if (stopped) {
                        return h('p', { className: 'cc-note' }, '本轮已停止。')
                      }
                      if (terminal) {
                        return h(
                          'p',
                          { className: 'cc-note' },
                          gitCard ? 'Git 交付结论见下方正文' : '本轮结论见下方正文',
                        )
                      }
                      return h(
                        'div',
                        { className: 'cc-hold' },
                        h('span', { className: 'cc-spin', 'aria-hidden': 'true' }),
                        h(
                          'span',
                          null,
                          gitCard
                            ? 'Git 交付已结束，正在汇总交付结论…'
                            : serviceRunCard(requirement, workKind)
                              ? '处理已结束，正在汇总本轮结论…'
                              : '写码已结束，正在汇总本轮结论…',
                        ),
                      )
                    })(),
                    err ? h('p', { className: 'cc-set-msg err' }, err) : null,
                    conclusionMd
                      ? h(
                          'div',
                          { className: 'cc-stream-actions', style: { display: 'flex' } },
                          h(
                            'button',
                            { type: 'button', className: 'cc-set-btn', onClick: copyDialog },
                            '复制结论',
                          ),
                          copyFlash
                            ? h(
                                'span',
                                {
                                  className:
                                    'cc-set-msg' +
                                    (copyFlash === '已复制' ? ' ok' : ' err'),
                                  style: { alignSelf: 'center', margin: 0 },
                                },
                                copyFlash,
                              )
                            : null,
                        )
                      : null,
                    beRestart && beRestart.offered
                      ? h(
                          'div',
                          { className: 'cc-be-restart' },
                          h(
                            'p',
                            { className: 'cc-be-title' },
                            beRestart.started_at && beRestart.executed !== false
                              ? '后端已自动重启（本机已执行）'
                              : '后端将由本机自动重启以加载新接口',
                          ),
                          h(
                            'p',
                            { className: 'cc-be-reason' },
                            String(beRestart.reason || '') +
                              (beRestart.port ? '（端口 ' + beRestart.port + '）' : ''),
                          ),
                          h(
                            'p',
                            { className: 'cc-be-cmd' },
                            beConfirmOpen
                              ? '将在应用终端执行：\n' +
                                  (Array.isArray(beRestart.shell_lines) &&
                                  beRestart.shell_lines.length
                                    ? beRestart.shell_lines.join('\n')
                                    : String(beRestart.command || ''))
                              : String(beRestart.command || ''),
                          ),
                          h(
                            'div',
                            { className: 'cc-set-actions' },
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'cc-set-btn primary',
                                disabled: busy || Boolean(beRestart.started_at),
                                onClick: function () {
                                  onRestartBackend({ auto: false })
                                },
                              },
                              beRestart.started_at && beRestart.executed !== false
                                ? '本机已执行重启'
                                : beConfirmOpen
                                  ? busy
                                    ? '执行中…'
                                    : '确认并执行重启'
                                  : busy
                                    ? '自动重启中…'
                                    : '若未自动执行可点此重启',
                            ),
                            beConfirmOpen && !beRestart.started_at
                              ? h(
                                  'button',
                                  {
                                    type: 'button',
                                    className: 'cc-set-btn',
                                    disabled: busy,
                                    onClick: function () {
                                      setBeConfirmOpen(false)
                                    },
                                  },
                                  '取消',
                                )
                              : null,
                          ),
                          beRestart.last_detail
                            ? h('p', { className: 'cc-note' }, String(beRestart.last_detail))
                            : null,
                        )
                      : beHint
                        ? h(
                            'div',
                            { className: 'cc-be-restart' },
                            h('p', { className: 'cc-be-title' }, '后端需按工程方式重启'),
                            h('p', { className: 'cc-be-reason' }, String(beHint)),
                          )
                        : null,
                  )
                : null,
              renderUserChoicePanel(),
              renderGitDeliverPanel(),
              // 写码终态仍铺过程。开发操作保持折叠，避免终端流水把结论顶走。
              !isDoneView || !opsCard
                ? h(
                    'div',
                    {
                      className: 'cc-dialog',
                      id: 'cc-dialog-' + (jobId || 'x'),
                      onScroll: onDialogScroll,
                    },
                    renderTranscript(),
                  )
                : hasTranscript
                  ? h(
                      'details',
                      { className: 'cc-log-fold', style: { marginTop: '10px' } },
                      h('summary', null, '本轮过程'),
                      h(
                        'div',
                        {
                          className: 'cc-dialog',
                          id: 'cc-dialog-' + (jobId || 'x'),
                          onScroll: onDialogScroll,
                        },
                        renderTranscript(),
                      ),
                    )
                  : null,
              showLiveChrome && workKind !== 'git_deliver'
                ? h(
                    'div',
                    { className: 'cc-plan' },
                    h('span', { className: 'cc-spin', 'aria-hidden': 'true' }),
                    h('span', null, planLabel),
                  )
                : null,
              phase === 'review' && workKind !== 'git_deliver'
                ? h(
                    'div',
                    { className: 'cc-review' },
                    h('p', { className: 'cc-note' }, '自动同步已关闭，请勾选后手动同步。'),
                    renderCheckGroup('范围内变更', review.inScope, '改'),
                    renderCheckGroup('范围内删除', review.deleted, '删'),
                    renderCheckGroup('范围外', review.deferred, '外'),
                    err ? h('p', { className: 'cc-set-msg err' }, err) : null,
                    h(
                      'div',
                      { className: 'cc-set-actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'cc-set-btn primary',
                          disabled: busy,
                          onClick: onApply,
                        },
                        busy ? '同步中…' : '同步到本机',
                      ),
                    ),
                  )
                : err && phase === 'running'
                  ? h('p', { className: 'cc-set-msg err' }, err)
                  : null,
              h(
                'details',
                { className: 'cc-log-fold' },
                h('summary', null, '任务日志' + (jobId ? ' · ' + String(jobId).slice(0, 18) : '')),
                h('div', { className: 'cc-stream' }, streamText || '—'),
              ),
            )
          : null,
      )
    }

    /** 本机预览，或 GitHub / Gitee / GitLab 的 https 仓库与 PR。其它外链仍保持纯文本。 */
    function isGitBrowseHost(host) {
      var h = String(host || '').toLowerCase()
      var roots = ['github.com', 'gitee.com', 'gitlab.com']
      for (var i = 0; i < roots.length; i++) {
        var root = roots[i]
        if (h === root || h.slice(-(root.length + 1)) === '.' + root) return true
      }
      return false
    }

    function isSafeBrowseUrl(url) {
      try {
        var u = new URL(String(url || ''))
        if (u.username || u.password) return false
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
        var h = String(u.hostname || '').toLowerCase()
        if (h === '127.0.0.1' || h === 'localhost') return true
        if (u.protocol !== 'https:') return false
        return isGitBrowseHost(h)
      } catch (e0) {
        return false
      }
    }

    function openSafeBrowseUrl(url) {
      var href = String(url || '').trim()
      if (!isSafeBrowseUrl(href)) return false
      // 桌面端 window.open 会被拦截并改去系统浏览器，返回值仍是空。
      // 这时再点一次隐藏链接会打开第二个窗口。
      try {
        window.open(href, '_blank', 'noopener,noreferrer')
        return true
      } catch (e0) {}
      try {
        var a = document.createElement('a')
        a.href = href
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        return true
      } catch (e1) {
        return false
      }
    }

    /**
     * 用 button 而不是 a：部分宿主会剥掉结论 HTML 里的 <a>，URL 就变回纯文本。
     * 点击由 installConclusionLinkOpener 打开系统/新页浏览器。
     */
    function lightMdSafeLink(url, label) {
      var href = String(url || '').trim()
      if (!isSafeBrowseUrl(href)) return String(label || href)
      var text = String(label || href)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      var safeHref = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      return (
        '<button type="button" class="cc-md-link" data-cc-open="' +
        safeHref +
        '" title="在浏览器打开">' +
        text +
        '</button>'
      )
    }

    function installConclusionLinkOpener() {
      if (typeof document === 'undefined' || document.__ccMdLinkOpen) return
      document.__ccMdLinkOpen = true
      var onActivate = function (ev) {
        var t = ev && ev.target
        var el = t && t.closest ? t.closest('.cc-md-link[data-cc-open]') : null
        if (!el) return
        var href = String(el.getAttribute('data-cc-open') || '').trim()
        if (!isSafeBrowseUrl(href)) return
        try {
          if (ev.preventDefault) ev.preventDefault()
          if (ev.stopPropagation) ev.stopPropagation()
        } catch (e0) {}
        openSafeBrowseUrl(href)
      }
      document.addEventListener('click', onActivate, true)
      document.addEventListener(
        'keydown',
        function (ev) {
          if (!ev || (ev.key !== 'Enter' && ev.key !== ' ')) return
          onActivate(ev)
        },
        true,
      )
    }
    try {
      installConclusionLinkOpener()
    } catch (eLink) {}

    /** 结论里的可点地址用真实 <a>，不用 innerHTML。宿主会剥掉 HTML 字符串里的链接。 */
    function browseLinkVNode(url, label) {
      var href = String(url || '').trim()
      // 可见文字始终是真实地址，避免「点这里」链到另一处。
      var text = href || String(label || '')
      if (!isSafeBrowseUrl(href)) return String(label || href)
      return h(
        'a',
        {
          href: href,
          target: '_blank',
          rel: 'noopener noreferrer',
          className: 'cc-md-link',
          'data-cc-open': href,
          title: '在浏览器打开',
          style: {
            color: '#0969da',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
            cursor: 'pointer',
            wordBreak: 'break-all',
          },
          onClick: function (ev) {
            try {
              if (ev && ev.preventDefault) ev.preventDefault()
              if (ev && ev.stopPropagation) ev.stopPropagation()
            } catch (e0) {}
            openSafeBrowseUrl(href)
          },
        },
        text,
      )
    }

    function inlineVNodes(s) {
      var src = String(s || '')
      var nodes = []
      var re =
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`\n]+)`|(https?:\/\/[^\s<>"'））；;，,]+)/g
      var last = 0
      var m
      while ((m = re.exec(src))) {
        if (m.index > last) nodes.push(src.slice(last, m.index))
        if (m[1] != null && m[2]) nodes.push(browseLinkVNode(m[2], m[1]))
        else if (m[3] != null) nodes.push(h('strong', null, m[3]))
        else if (m[4] != null) nodes.push(h('code', null, m[4]))
        else if (m[5]) nodes.push(browseLinkVNode(m[5], m[5]))
        last = m.index + m[0].length
      }
      if (last < src.length) nodes.push(src.slice(last))
      if (!nodes.length) nodes.push('')
      return nodes
    }

    function lightMdNodes(text) {
      var lines = String(text || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
      var out = []
      for (var i = 0; i < lines.length; i++) {
        var t = String(lines[i] || '').trim()
        var key = 'md' + i
        if (!t) {
          out.push(h('div', { className: 'cc-gap', key: key }))
          continue
        }
        if (/^##\s+/.test(t)) {
          out.push(h('h2', { key: key }, inlineVNodes(t.replace(/^##\s+/, ''))))
          continue
        }
        if (/^###\s+/.test(t)) {
          out.push(h('div', { className: 'cc-sec-title', key: key }, inlineVNodes(t.replace(/^###\s+/, ''))))
          continue
        }
        if (/^---+$/.test(t)) {
          out.push(h('hr', { key: key }))
          continue
        }
        if (/^https?:\/\//i.test(t)) {
          out.push(h('div', { className: 'cc-p', key: key }, browseLinkVNode(t, t)))
          continue
        }
        if (/^[•·]\s+/.test(t) || /^[-*]\s+/.test(t)) {
          out.push(h('div', { className: 'cc-li', key: key }, inlineVNodes(t.replace(/^[•·\-*]\s+/, ''))))
          continue
        }
        if (/^\d+\.\s+/.test(t)) {
          out.push(h('div', { className: 'cc-ol', key: key }, inlineVNodes(t)))
          continue
        }
        var lm = t.match(/^([^：:]{1,16})([：:])\s*(.*)$/)
        if (lm && !/^https?$/i.test(lm[1])) {
          var kids = [h('strong', { key: key + 's' }, inlineVNodes(lm[1] + lm[2]))]
          if (lm[3]) {
            kids.push(' ')
            var restNodes = inlineVNodes(lm[3])
            for (var r = 0; r < restNodes.length; r++) kids.push(restNodes[r])
          }
          out.push(h('div', { className: 'cc-label', key: key }, kids))
          continue
        }
        if (/^\*\*[^*]+\*\*\s*$/.test(t)) {
          out.push(h('div', { className: 'cc-sec-title', key: key }, inlineVNodes(t)))
          continue
        }
        out.push(h('div', { className: 'cc-p', key: key }, inlineVNodes(t)))
      }
      return out
    }

    function lightMdInline(s) {
      var html = String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      // 先占位再还原，避免 data-cc-open 里的 URL 被二次包成控件
      var slots = []
      var park = function (piece) {
        var i = slots.length
        slots.push(piece)
        return '\u0000L' + i + '\u0000'
      }
      html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (_m, label, url) {
        return park(lightMdSafeLink(url, label))
      })
      html = html.replace(/(https?:\/\/[^\s<>"'\u0000））；;，,]+)/g, function (url) {
        return park(lightMdSafeLink(url, url))
      })
      html = html.replace(/\u0000L(\d+)\u0000/g, function (_m, idx) {
        return slots[Number(idx)] || ''
      })
      return html
    }

    function isLightMdTableRow(t) {
      var s = String(t || '').trim()
      if (!s || s.indexOf('|') < 0) return false
      if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(s)) return true
      return /^\|(.+\|)+/.test(s) || /\|(.+\|)+\s*$/.test(s)
    }

    function isLightMdTableSep(t) {
      var s = String(t || '').trim()
      return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(s)
    }

    function splitLightMdTableCells(t) {
      var s = String(t || '').trim()
      if (s.charAt(0) === '|') s = s.slice(1)
      if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1)
      return s.split('|').map(function (c) {
        return String(c || '').trim()
      })
    }

    function renderLightMdTable(rows) {
      if (!rows || !rows.length) return ''
      var start = 0
      var head = null
      if (rows.length >= 2 && isLightMdTableSep(rows[1])) {
        head = splitLightMdTableCells(rows[0])
        start = 2
      }
      var html = '<div class="cc-md-table-wrap"><table class="cc-md-table">'
      if (head && head.length) {
        html += '<thead><tr>'
        for (var h = 0; h < head.length; h++) {
          html += '<th>' + lightMdInline(head[h]) + '</th>'
        }
        html += '</tr></thead>'
      }
      html += '<tbody>'
      for (var r = start; r < rows.length; r++) {
        if (isLightMdTableSep(rows[r])) continue
        var cells = splitLightMdTableCells(rows[r])
        if (!cells.length) continue
        html += '<tr>'
        for (var c = 0; c < cells.length; c++) {
          html += '<td>' + lightMdInline(cells[c]) + '</td>'
        }
        html += '</tr>'
      }
      html += '</tbody></table></div>'
      return html
    }

    /** 按行排版（对齐图二：标签：正文 / • 列表 / 段间空行 / MD 表格） */
    function lightMdHtml(text) {
      var lines = String(text || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
      var out = []
      for (var i = 0; i < lines.length; i++) {
        var raw = lines[i]
        var t = String(raw || '').trim()
        if (!t) {
          out.push('<div class="cc-gap"></div>')
          continue
        }
        if (/^##\s+/.test(t)) {
          out.push('<h2>' + lightMdInline(t.replace(/^##\s+/, '')) + '</h2>')
          continue
        }
        if (/^###\s+/.test(t)) {
          out.push('<div class="cc-sec-title">' + lightMdInline(t.replace(/^###\s+/, '')) + '</div>')
          continue
        }
        if (/^---+$/.test(t)) {
          out.push('<hr/>')
          continue
        }
        // GFM 表：须整块转 <table>。结论壳不是宿主 GFM，| 行当普通段落不会成表。
        if (isLightMdTableRow(t)) {
          var tableRows = []
          while (i < lines.length) {
            var tr = String(lines[i] || '').trim()
            if (!tr || !isLightMdTableRow(tr)) break
            tableRows.push(tr)
            i += 1
            if (tableRows.length >= 40) break
          }
          i -= 1
          if (tableRows.length >= 2) out.push(renderLightMdTable(tableRows))
          else out.push('<div class="cc-p">' + lightMdInline(tableRows[0] || t) + '</div>')
          continue
        }
        if (/^[•·]\s+/.test(t) || /^[-*]\s+/.test(t)) {
          out.push('<div class="cc-li">' + lightMdInline(t.replace(/^[•·\-*]\s+/, '')) + '</div>')
          continue
        }
        if (/^\d+\.\s+/.test(t)) {
          out.push('<div class="cc-ol">' + lightMdInline(t) + '</div>')
          continue
        }
        // 单独一行的 https:// 不能走下面的「标签：正文」，否则会拆成粗体 https:
        if (/^https?:\/\//i.test(t)) {
          out.push('<div class="cc-p">' + lightMdInline(t) + '</div>')
          continue
        }
        // 结果：… / 改动： / 涉及文件： / 验收：
        var lm = t.match(/^([^：:]{1,16})([：:])\s*(.*)$/)
        if (lm && !/^https?$/i.test(lm[1])) {
          var rest = lm[3] || ''
          out.push(
            '<div class="cc-label"><strong>' +
              lightMdInline(lm[1] + lm[2]) +
              '</strong>' +
              (rest ? ' ' + lightMdInline(rest) : '') +
              '</div>',
          )
          continue
        }
        if (/^\*\*[^*]+\*\*\s*$/.test(t)) {
          out.push('<div class="cc-sec-title">' + lightMdInline(t) + '</div>')
          continue
        }
        out.push('<div class="cc-p">' + lightMdInline(t) + '</div>')
      }
      return out.join('')
    }

    function findHostEditedCard() {
      return findEditedCardIn(document)
    }

    function isHiddenConclusion(el) {
      if (!el) return true
      if (el.getAttribute && el.getAttribute('data-cc-dup-conclusion-hidden') === '1') return true
      try {
        if (el.style && el.style.display === 'none') return true
      } catch (e0) {}
      return false
    }

    /** 最小块：含结论标题，且含「结果：」或三段式「任务结果」。过程卡内部不算。 */
    function findConclusionLeaves(root) {
      if (!root || !root.querySelectorAll) return []
      var hits = []
      try {
        var nodes = root.querySelectorAll('div,section,article')
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i]
          if (!el || isHiddenConclusion(el)) continue
          if (el.closest && el.closest('.cc-card')) continue
          if (el.closest && el.closest('[data-cc-dup-conclusion-hidden="1"]')) continue
          var t = String(el.textContent || '')
          if (t.length > 8000 || t.length < 12) continue
          if (!/本轮结论|Git\s*交付结论/.test(t)) continue
          if (!/结果：|任务结果/.test(t)) continue
          hits.push(el)
        }
      } catch (e1) {}
      var leaves = []
      for (var a = 0; a < hits.length; a++) {
        var hasChild = false
        for (var b = 0; b < hits.length; b++) {
          if (a !== b && hits[a].contains(hits[b])) {
            hasChild = true
            break
          }
        }
        if (!hasChild) leaves.push(hits[a])
      }
      return leaves
    }

    function zoneHasNaturalConclusion(zone) {
      var leaves = findConclusionLeaves(zone)
      for (var i = 0; i < leaves.length; i++) {
        var el = leaves[i]
        if (el.closest && el.closest('[data-cc-conclusion-hoist="1"]')) continue
        if (el.getAttribute && el.getAttribute('data-cc-conclusion-hoist') === '1') continue
        return true
      }
      return false
    }

    function isGitConclusionBlockText(t) {
      return /Git\s*交付结论/.test(t) && /结果：|任务结果/.test(t)
    }

    /**
     * 模型在工具结果之外另写的交付摘要。
     * 没有「Git 交付结论」标题，但以「提交已完成」加上仓库 / Commit 复述结果。
     * 正式结论自己带标题和「任务结果」，不会被认成这种摘要。
     */
    function isModelGitDeliverSummary(t) {
      var s = String(t || '')
      if (s.length < 24 || s.length > 6000) return false
      if (/Git\s*交付结论/.test(s) && /任务结果|结果：/.test(s)) return false
      if (!/提交已完成/.test(s)) return false
      return /仓库|Commit|本次提交文件|已推送远端|审码/.test(s)
    }

    /** 节点里如果还包着原生文件卡或 turnTail，不能整段藏。 */
    function conclusionNodeProtects(el) {
      if (!el || !el.querySelector) return false
      if (el.querySelector('[data-changed-files]')) return true
      if (el.querySelector('[data-cc-turn-tail="1"]')) return true
      if (el.querySelector('[data-cc-conclusion-hoist="1"]')) return true
      if (typeof isNativeChangedFilesCard === 'function' && isNativeChangedFilesCard(el)) return true
      return false
    }

    /**
     * 从结论块里拆出可以藏的那一层。
     * 模型和工具结果常跟「已编辑」卡包在同一个父节点里，藏父节点会把文件卡一起藏掉，所以要往下拆。
     */
    function collectHideableConclusions(el, out) {
      if (!el || el.nodeType !== 1) return
      if (el.closest && el.closest('[data-cc-turn-tail="1"]')) return
      if (el.closest && el.closest('[data-cc-conclusion-hoist="1"]')) return
      if (el.closest && el.closest('[data-cc-git-deliver="1"]')) return
      if (el.getAttribute && el.getAttribute('data-cc-dup-conclusion-hidden') === '1') return
      var t = String(el.textContent || '')
      if (!isGitConclusionBlockText(t) || t.length < 12 || t.length > 8000) return
      if (conclusionNodeProtects(el) && el.children && el.children.length) {
        for (var i = 0; i < el.children.length; i++) collectHideableConclusions(el.children[i], out)
        return
      }
      if (conclusionNodeProtects(el)) return
      out.push(el)
    }

    function normalizeConcKey(s) {
      return String(s || '').replace(/[#>*`•·\s]/g, '')
    }

    /**
     * 检验：这段可见正文是不是账本上的那一份正式结论。
     * 只比对正文指纹，不拿「Git 交付结论」标题当通过。模型改写的标题一样，正文对不上。
     */
    function fragmentMatchesOfficial(text, official) {
      var o = normalizeConcKey(official)
      var t = normalizeConcKey(text)
      if (!o || o.length < 24 || !t) return false
      if (t.indexOf(o) >= 0) return true
      var start = Math.min(48, Math.max(0, o.length - 80))
      var probe = o.slice(start, start + 80)
      return probe.length >= 32 && t.indexOf(probe) >= 0
    }

    function collectModelGitSummaries(el, out) {
      if (!el || el.nodeType !== 1) return
      if (el.closest && el.closest('[data-cc-turn-tail="1"]')) return
      if (el.closest && el.closest('[data-cc-conclusion-hoist="1"]')) return
      if (el.closest && el.closest('[data-cc-git-deliver="1"]')) return
      if (el.getAttribute && el.getAttribute('data-cc-dup-conclusion-hidden') === '1') return
      var t = String(el.textContent || '')
      if (isModelGitDeliverSummary(t)) {
        if (el.children && el.children.length) {
          var before = out.length
          for (var i = 0; i < el.children.length; i++) collectModelGitSummaries(el.children[i], out)
          if (out.length > before) return
        }
        if (conclusionNodeProtects(el)) return
        out.push(el)
        return
      }
      if (/提交已完成/.test(t) && el.children && el.children.length) {
        for (var j = 0; j < el.children.length; j++) collectModelGitSummaries(el.children[j], out)
      }
    }

    function hideHostConclusionCopy(el) {
      if (!el || !el.style) return
      if (el.closest && el.closest('[data-cc-turn-tail="1"]')) return
      if (el.closest && el.closest('[data-cc-conclusion-hoist="1"]')) return
      if (el.closest && el.closest('[data-cc-git-deliver="1"]')) return
      if (conclusionNodeProtects(el)) return
      try {
        el.style.display = 'none'
        el.setAttribute('data-cc-dup-conclusion-hidden', '1')
      } catch (eHide) {}
    }

    /**
     * 结论检验：同一轮只能有一份，且必须对上账本正式正文。
     * 正式正文挂在 turnTail 的 data-cc-conclusion-official。
     * 对不上的（模型复述）丢掉；对得上但又多出来的也丢掉。没有正式卡时，留最后一份对得上的。
     */
    function verifyUniqueGitConclusion(turn) {
      if (!turn || !turn.querySelector) return
      var tail = turn.querySelector('[data-cc-turn-tail="1"]')
      var official = ''
      if (tail && tail.getAttribute) official = String(tail.getAttribute('data-cc-conclusion-official') || '')
      if (!official && tail) official = String(tail.textContent || '')
      var leaves = findConclusionLeaves(turn)
      var frags = []
      for (var i = 0; i < leaves.length; i++) collectHideableConclusions(leaves[i], frags)
      if (!frags.length) collectHideableConclusions(turn, frags)
      var tailReady = !!(tail && isGitConclusionBlockText(String(tail.textContent || '')))
      var keep = null
      if (!tailReady) {
        for (var k = frags.length - 1; k >= 0; k--) {
          if (!official || fragmentMatchesOfficial(frags[k].textContent, official)) {
            keep = frags[k]
            break
          }
        }
      }
      for (var a = 0; a < frags.length; a++) {
        if (frags[a] === keep) continue
        if (official && !fragmentMatchesOfficial(frags[a].textContent, official)) {
          hideHostConclusionCopy(frags[a])
          continue
        }
        if (tailReady || keep) hideHostConclusionCopy(frags[a])
      }
    }

    function dedupeGitConclusionsIn(turn) {
      verifyUniqueGitConclusion(turn)
    }

    function gitConclusionZone(tail) {
      if (!tail) return null
      var zone =
        (tail.closest && tail.closest('[data-chat-group-key]')) ||
        (tail.closest && tail.closest('[data-chat-turn]'))
      if (zone) return zone
      var n = tail.parentElement
      for (var up = 0; up < 8 && n && n !== document.body; up++) {
        zone = n
        n = n.parentElement
      }
      return zone
    }

    /** 正式结论已出现时，去掉同组里模型写的「提交已完成」复述。文件卡和正式卡留下。 */
    function hideModelGitSummariesNear(tail) {
      if (!tail || !isGitConclusionBlockText(String(tail.textContent || ''))) return
      var zone = gitConclusionZone(tail)
      if (!zone) return
      var models = []
      collectModelGitSummaries(zone, models)
      var prev = zone.previousElementSibling
      if (prev) collectModelGitSummaries(prev, models)
      for (var i = 0; i < models.length; i++) hideHostConclusionCopy(models[i])
      dedupeGitConclusionsIn(zone)
    }

    function installGitConclusionDedupe() {
      if (typeof document === 'undefined' || window.__ccGitConcDedupe) return
      window.__ccGitConcDedupe = 1
      var timer = 0
      function pass() {
        timer = 0
        var tails = document.querySelectorAll('[data-cc-turn-tail="1"]')
        for (var t = 0; t < tails.length; t++) hideModelGitSummariesNear(tails[t])
        var turns = document.querySelectorAll('[data-chat-turn]')
        for (var i = 0; i < turns.length; i++) dedupeGitConclusionsIn(turns[i])
      }
      function schedule() {
        if (timer) return
        timer = setTimeout(pass, 200)
      }
      function arm() {
        if (!document.body) return
        pass()
        try {
          var obs = new MutationObserver(schedule)
          obs.observe(document.body, { childList: true, subtree: true })
        } catch (eObs) {}
      }
      if (document.body) arm()
      else document.addEventListener('DOMContentLoaded', arm)
    }

    function hideDupConclusion(el) {
      if (!el) return
      var hoist = (el.closest && el.closest('[data-cc-conclusion-hoist="1"]')) || null
      if (!hoist && el.getAttribute && el.getAttribute('data-cc-conclusion-hoist') === '1') hoist = el
      var target = hoist || el
      if (hoist && hoist.parentElement) {
        try {
          hoist.parentElement.removeChild(hoist)
          return
        } catch (e0) {}
      }
      try {
        target.style.display = 'none'
        target.setAttribute('data-cc-dup-conclusion-hidden', '1')
      } catch (e1) {}
    }

    function pinNativeFileCard(zone, keepEl) {
      if (!zone || !keepEl || typeof findEditedCardIn !== 'function') return
      var card = findEditedCardIn(zone)
      if (!card || card === keepEl) return
      var anchor = (keepEl.closest && keepEl.closest('[data-cc-conclusion-hoist="1"]')) || keepEl
      if (!anchor || !anchor.parentElement) return
      if (anchor.contains(card)) return
      try {
        if (anchor.nextElementSibling !== card) {
          anchor.parentElement.insertBefore(card, anchor.nextSibling)
        }
      } catch (e0) {}
    }

    /** 锚点之后的结论块（本轮回复）。锚点之前的历史结论不动。 */
    function leavesAfter(zone, anchor) {
      var leaves = findConclusionLeaves(zone)
      if (!anchor || !anchor.compareDocumentPosition) return leaves
      var out = []
      for (var i = 0; i < leaves.length; i++) {
        var el = leaves[i]
        if (anchor.contains && anchor.contains(el)) continue
        var pos = anchor.compareDocumentPosition(el)
        if (pos & 4) out.push(el) // DOCUMENT_POSITION_FOLLOWING
      }
      return out
    }

    function suppressConclusionsAfter(anchor) {
      if (!anchor) return
      var zone = anchor.parentElement || anchor
      var n = zone
      for (var up = 0; up < 6 && n && n !== document.body; up++) {
        zone = n
        n = n.parentElement
      }
      var leaves = leavesAfter(zone, anchor)
      for (var i = 0; i < leaves.length; i++) hideDupConclusion(leaves[i])
    }

    /**
     * 锚点之后只留最后一份结论，并把底座「已编辑 N 个文件」卡挪到它下面。
     */
    function keepOneConclusion(zone, anchor) {
      if (!zone) return null
      var leaves = anchor ? leavesAfter(zone, anchor) : findConclusionLeaves(zone)
      if (!leaves.length) return null
      var keep = leaves[leaves.length - 1]
      for (var j = 0; j < leaves.length; j++) {
        var cur = leaves[j]
        if (cur === keep) continue
        if (keep.contains && keep.contains(cur)) continue
        if (cur.contains && cur.contains(keep)) continue
        hideDupConclusion(cur)
      }
      pinNativeFileCard(zone, keep)
      return keep
    }

    function scrubDuplicateConclusionBlocks(root, keepEl) {
      keepOneConclusion(root)
      if (keepEl) pinNativeFileCard(root, keepEl)
    }

    var CC_CONC_LS = 'dsh-cchat-conclusions-v1'

    function loadConclusionStore() {
      try {
        var raw = localStorage.getItem(CC_CONC_LS)
        var o = raw ? JSON.parse(raw) : {}
        return o && typeof o === 'object' ? o : {}
      } catch (e) {
        return {}
      }
    }

    function saveConclusionStore(store) {
      try {
        var keys = Object.keys(store || {})
        // 只留最近 60 条，避免撑爆 localStorage
        if (keys.length > 60) {
          keys
            .map(function (k) {
              return { k: k, t: Date.parse(String((store[k] && store[k].updated_at) || '')) || 0 }
            })
            .sort(function (a, b) {
              return a.t - b.t
            })
            .slice(0, keys.length - 60)
            .forEach(function (x) {
              delete store[x.k]
            })
        }
        localStorage.setItem(CC_CONC_LS, JSON.stringify(store))
      } catch (e) {}
    }

    function rememberConclusionItem(it) {
      if (!it || !it.id || !it.chat_conclusion) return
      var store = loadConclusionStore()
      store[String(it.id)] = {
        id: String(it.id),
        updated_at: it.updated_at || new Date().toISOString(),
        requirement: String(it.requirement || ''),
        chat_conclusion: String(it.chat_conclusion || ''),
        synced_files: Array.isArray(it.synced_files) ? it.synced_files : [],
        deleted_files: Array.isArray(it.deleted_files) ? it.deleted_files : [],
        review_report: it.review_report && it.review_report.rel ? it.review_report : null,
      }
      saveConclusionStore(store)
    }

    function extractPathsFromText(text) {
      var t = String(text || '')
      var out = []
      var seen = {}
      var re = /(?:^|[\s`"'（(])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)(?=$|[\s`"'）);，,])/g
      var m
      while ((m = re.exec(t))) {
        var p = String(m[1] || '').replace(/^\/+/, '')
        if (!p || seen[p]) continue
        seen[p] = true
        out.push(p)
      }
      return out
    }

    function scoreConclusionForTurn(item, turnText) {
      var score = 0
      var t = String(turnText || '')
      if (!t || !item) return 0
      var files = []
        .concat(item.synced_files || [])
        .concat(item.deleted_files || [])
      files.forEach(function (f) {
        var p = String(f || '').trim()
        if (!p) return
        if (t.indexOf(p) >= 0) score += 4
        else {
          var base = p.split('/').pop()
          if (base && t.indexOf(base) >= 0) score += 1
        }
      })
      var req = String(item.requirement || '').trim()
      if (req) {
        var tip = req.slice(0, 24)
        if (tip && t.indexOf(tip) >= 0) score += 6
        // 短诉求整段出现在用户气泡
        if (req.length <= 40 && t.indexOf(req) >= 0) score += 8
      }
      return score
    }

    function fileBasename(p) {
      var s = String(p || '').trim().replace(/\\/g, '/')
      var i = s.lastIndexOf('/')
      return (i >= 0 ? s.slice(i + 1) : s).toLowerCase()
    }

    /** 与 src/conclusionAnchor.ts 保持一致。 */
    function cardFileNames(text) {
      var out = []
      var seen = {}
      var re = /[A-Za-z0-9_.-]+\.[A-Za-z0-9]+/g
      var t = String(text || '')
      var m
      while ((m = re.exec(t))) {
        var name = String(m[0] || '').toLowerCase()
        if (name.length < 5 || seen[name]) continue
        seen[name] = true
        out.push(name)
      }
      return out
    }

    /** 与 src/conclusionAnchor.ts 保持一致。卡上 ≥3 个文件时至少重合 2 个。 */
    function pickConclusionForCard(items, cardNames) {
      var names = []
      var ni
      for (ni = 0; ni < (cardNames || []).length; ni++) {
        var one = String(cardNames[ni] || '').toLowerCase()
        if (one) names.push(one)
      }
      if (!names.length) return null
      var need = names.length === 1 ? 1 : 2
      var best = null
      var bestScore = 0
      var bestTime = -1
      var list = items || []
      for (var i = 0; i < list.length; i++) {
        var it = list[i]
        if (!it || !it.id) continue
        var body = String(it.chat_conclusion || '')
        if (body.indexOf('本轮结论') < 0) continue
        var files = []
          .concat(it.synced_files || [])
          .concat(it.deleted_files || [])
        var set = {}
        for (var fi = 0; fi < files.length; fi++) set[fileBasename(files[fi])] = true
        var score = 0
        for (var ci = 0; ci < names.length; ci++) if (set[names[ci]]) score += 1
        if (score < need) continue
        if (names.length >= 3 && score < 2) continue
        var ts = Date.parse(String(it.updated_at || '')) || 0
        if (score > bestScore || (score === bestScore && ts > bestTime)) {
          best = it
          bestScore = score
          bestTime = ts
        }
      }
      return best
    }

    function isFallbackChangesCard(el) {
      return Boolean(el && el.getAttribute && el.getAttribute('data-cc-changes-fallback') === '1')
    }

    /** 底座原生改动卡（ui-deliverables），排除本插件兜底卡 */
    function isNativeChangedFilesCard(el) {
      if (!el || !el.getAttribute) return false
      if (isFallbackChangesCard(el)) return false
      if (!el.hasAttribute('data-changed-files')) return false
      var t = String(el.textContent || '')
      // 须像真卡：标题 + 不至于整页正文误伤
      if (!/已编辑/.test(t)) return false
      if (t.length >= 8000) return false
      return true
    }

    /**
     * 同级 turnTail 列表里找底座原生卡。禁止用 previousSibling 正文模糊匹配——
     * 误判一次 skipNative 会永久关掉结论下的文件列表。
     */
    function findSiblingNativeChangesCard(host) {
      if (!host || !host.parentElement || !host.parentElement.children) return null
      try {
        var kids = host.parentElement.children
        for (var i = 0; i < kids.length; i++) {
          var el = kids[i]
          if (!el || el === host) continue
          if (isNativeChangedFilesCard(el)) return el
          if (el.querySelectorAll) {
            var marked = el.querySelectorAll('[data-changed-files]')
            for (var j = 0; j < marked.length; j++) {
              if (isNativeChangedFilesCard(marked[j])) return marked[j]
            }
          }
        }
      } catch (e0) {}
      return null
    }

    function findEditedCardIn(root) {
      if (!root || !root.querySelectorAll) return null
      try {
        var best = null
        var bestLen = Infinity
        var nodes = root.querySelectorAll('div,section,article')
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i]
          if (isFallbackChangesCard(el)) continue
          if (el.getAttribute && el.getAttribute('data-cc-conclusion-hoist') === '1') continue
          if (el.closest && el.closest('[data-cc-conclusion-hoist="1"]')) continue
          if (!isNativeChangedFilesCard(el) && !/已编辑\s*\d+\s*个文件/.test(String(el.textContent || ''))) {
            continue
          }
          if (isFallbackChangesCard(el)) continue
          var t = String(el.textContent || '')
          if (!/已编辑\s*\d+\s*个文件/.test(t)) continue
          if (t.length >= 2000) continue
          // 取最短命中：避免误抓包住整轮对话的父节点
          if (t.length < bestLen) {
            best = el
            bestLen = t.length
          }
        }
        return best
      } catch (e0) {}
      return null
    }

    /**
     * 正文结论只挂在底座 `[data-changed-files]` 前面。
     * 不从工具卡插：那张卡收在「已调用工具」里，插了也看不见。
     * 只装饰文档里最后一张改动卡，并且文件名至少重合 2 个。
     */
    var conclusionBySession = {}

    /** 同一会话 5 秒内共用一次请求；未交付的结果不缓存，避免把「结论还在路上」冻住。 */
    function loadSessionConclusion(sessionId, opts) {
      var fresh = Boolean(opts && opts.fresh)
      var now = Date.now()
      var hit = conclusionBySession[sessionId]
      if (!fresh && hit && now - hit.at < 5000) return hit.promise
      var promise = fetch(
        serviceBase() + '/api/cursor-chat/session-conclusion?session_id=' + encodeURIComponent(sessionId),
      )
        .then(function (r) {
          return r.json()
        })
        .catch(function () {
          return null
        })
        .then(function (d) {
          var cached = conclusionBySession[sessionId]
          if (cached && cached.promise === promise && (!d || !d.ok || !d.found || !d.chat_conclusion)) {
            delete conclusionBySession[sessionId]
          }
          return d
        })
      conclusionBySession[sessionId] = { at: now, promise: promise }
      return promise
    }

    /**
     * 当前底座把 turnTail 声明为 list 槽（select 被忽略）；新版宿主改为 chain，
     * 注册同时带 select 可兼容两版。结论只认已闭合轮次。
     */
    function selectConclusionTurn(owner) {
      var turn = owner && owner.turn
      var start = Number(turn && turn.start && turn.start.time) || 0
      var end = Number(turn && turn.end && turn.end.time) || 0
      if (!start || !end) return null
      return { start: start, end: end }
    }

    /**
     * Git 确认卡：进行中也要挂（工具阻塞等人审时 turn 尚未闭合）。
     * 已闭合轮次同样挂，作 toolview 收起后的兜底。
     */
    function selectGitDeliverTurn(owner) {
      var turn = owner && owner.turn
      var start = Number(turn && turn.start && turn.start.time) || 0
      if (!start) return null
      var end = Number(turn && turn.end && turn.end.time) || 0
      return { start: start, end: end || Date.now() + 120000 }
    }

    /** 服务端返回 items（每轮一条）；旧服务端只有顶层单条。 */
    function conclusionItems(payload) {
      if (!payload) return []
      if (Array.isArray(payload.items) && payload.items.length) return payload.items
      return payload.chat_conclusion ? [payload] : []
    }

    /** 按轮次时间窗挑结论；同一轮只挂一份，取交付时间最新的一条。 */
    function pickConclusionForTurn(payload, turnStart, turnEnd) {
      if (!turnStart || !turnEnd) return null
      var items = conclusionItems(payload)
      var best = null
      var bestAt = -1
      for (var i = 0; i < items.length; i++) {
        var it = items[i]
        if (!it || !it.chat_conclusion) continue
        var at = Date.parse(String(it.concluded_at || it.updated_at || '')) || 0
        if (!at) continue
        // 结论只可能在本轮开始后交付；向前留 1s 只吸收时钟取整
        if (at < turnStart - 1000 || at > turnEnd + 5000) continue
        if (at > bestAt) {
          best = it
          bestAt = at
        }
      }
      return best
    }

    /**
     * Git 交付确认卡（对话区 turnTail）：不依赖 toolview 是否挂上。
     * 工具返回后宿主常把 tool 收进「已调用工具」，用户必须在正文区看到可点的确认卡。
     */
    function GitDeliverConfirmTurnTail(props) {
      ensureCss()
      var sessionId = String((props && props.sessionId) || '').trim()
      var turn = props && props.turn
      var turnStart = Number(turn && turn.start && turn.start.time) || 0
      var turnEnd = Number(turn && turn.end && turn.end.time) || 0
      var itemState = useState(null)
      var item = itemState[0]
      var setItem = itemState[1]
      var planState = useState(null)
      var plan = planState[0]
      var setPlan = planState[1]
      var selectedState = useState({})
      var selected = selectedState[0]
      var setSelected = selectedState[1]
      var busyState = useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var errState = useState('')
      var err = errState[0]
      var setErr = errState[1]
      var doneState = useState('')
      var doneMsg = doneState[0]
      var setDoneMsg = doneState[1]

      useEffect(
        function () {
          var stopped = false
          function pick(items) {
            if (!Array.isArray(items) || !items.length) return null
            var best = null
            var bestTs = -1
            var fallback = null
            var fallbackTs = -1
            for (var i = 0; i < items.length; i++) {
              var it = items[i]
              if (!it || !it.confirm_token || !it.git_plan) continue
              if (sessionId && it.dsh_session_id && String(it.dsh_session_id) !== sessionId) continue
              var ts = Date.parse(String(it.updated_at || it.created_at || '')) || 0
              if (ts > 0 && Date.now() - ts > 30 * 60 * 1000) continue
              if (ts >= fallbackTs) {
                fallback = it
                fallbackTs = ts
              }
              // 优先落在本轮时间窗
              if (turnStart && turnEnd) {
                if (ts < turnStart - 5000 || ts > turnEnd + 180000) continue
              }
              if (ts >= bestTs) {
                best = it
                bestTs = ts
              }
            }
            // 已闭合轮禁止 30 分钟兜底：否则侧栏 begin-ui / 新轮 pending 会挂到旧「本轮结论」下
            var closed = turnEnd > 0 && turnEnd < Date.now() - 1000
            if (closed) return best
            // 进行中轮：时间窗对不齐时仍露出本会话最近待确认
            return best || fallback
          }
          function pull() {
            var base = serviceBase()
            if (!base || !sessionId) return
            // 须带 session_id：服务端不再返回跨会话 confirm_token
            var url =
              base +
              '/api/cursor-chat/git-deliver/awaiting?session_id=' +
              encodeURIComponent(sessionId)
            fetch(url)
              .then(function (r) {
                return r.json()
              })
              .then(function (d) {
                if (stopped) return
                var hit = pick(d && d.items)
                if (!hit) {
                  setItem(null)
                  return
                }
                setItem(hit)
                var g = hit.git_plan || {}
                setPlan({
                  remote_url: String(g.remote_url || ''),
                  current_branch: String(g.current_branch || ''),
                  target_branch: String(g.target_branch || g.current_branch || ''),
                  base_branch: String(g.base_branch || 'main'),
                  commit_message: String(g.commit_message || ''),
                  create_pr: g.create_pr !== false,
                  selected_files: Array.isArray(g.selected_files) ? g.selected_files : [],
                  held_sensitive_files: Array.isArray(g.held_sensitive_files)
                    ? g.held_sensitive_files
                    : [],
                  entries: Array.isArray(g.entries) ? g.entries : null,
                })
                var next = {}
                var files = Array.isArray(g.selected_files) ? g.selected_files : []
                var held = Array.isArray(g.held_sensitive_files) ? g.held_sensitive_files : []
                files.forEach(function (p) {
                  next[p] = true
                })
                held.forEach(function (p) {
                  next[p] = false
                })
                if (Array.isArray(g.entries)) {
                  g.entries.forEach(function (e) {
                    if (!e || !e.rel) return
                    next[e.rel] = e.sensitive ? false : e.selected !== false
                  })
                }
                setSelected(next)
              })
              .catch(function () {})
          }
          pull()
          var t = setInterval(pull, 1500)
          return function () {
            stopped = true
            clearInterval(t)
          }
        },
        [sessionId, turnStart, turnEnd],
      )

      if (doneMsg) {
        return h(
          'div',
          { className: 'cc-git-deliver', 'data-cc-git-deliver-tail': '1' },
          h('p', { className: 'cc-git-title' }, 'Git 交付'),
          h('p', { className: 'cc-note' }, doneMsg),
        )
      }
      if (!item || !plan) return null

      var heldSet = {}
      ;(plan.held_sensitive_files || []).forEach(function (p) {
        heldSet[p] = true
      })
      var fileKeys = Object.keys(selected || {})
      if (!fileKeys.length) {
        fileKeys = (plan.selected_files || []).concat(plan.held_sensitive_files || [])
      }

      function onConfirm() {
        setErr('')
        var token = String(item.confirm_token || '').trim()
        if (!token) {
          setErr('确认令牌缺失，请再说一次「提交代码」')
          return
        }
        var files = Object.keys(selected || {}).filter(function (p) {
          return selected[p] && !heldSet[p]
        })
        if (!files.length) {
          setErr('请至少勾选一个非敏感文件')
          return
        }
        setBusy(true)
        var base = serviceBase()
        fetch(base + '/api/hitl/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'cursor-chat.git-deliver',
            confirm_token: token,
            workspace: item.workspace,
          }),
        })
          .then(function (r) {
            return r.json()
          })
          .then(function (issued) {
            if (!issued || !issued.ok || !issued.nonce) {
              throw new Error((issued && issued.detail) || '签发失败')
            }
            return fetch(base + '/api/cursor-chat/git-deliver/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                confirm_token: token,
                nonce: issued.nonce,
                selected_files: files,
                commit_message: plan.commit_message,
                target_branch: plan.target_branch,
                base_branch: plan.base_branch,
                create_pr: plan.create_pr !== false,
              }),
            }).then(function (r2) {
              return r2.json()
            })
          })
          .then(function (d) {
            if (!d || !d.ok) throw new Error((d && d.detail) || '提交失败')
            if (d.waiting_tool || d.accepted) {
              // 确认后整卡消失，进度只看 transcript
              setItem(null)
              setPlan(null)
              setDoneMsg('')
              return
            }
            setDoneMsg(d.detail || '已提交')
            setItem(null)
          })
          .catch(function (e) {
            setErr(String(e && e.message ? e.message : e))
          })
          .finally(function () {
            setBusy(false)
          })
      }

      function onCancel() {
        setBusy(true)
        var token = String(item.confirm_token || '').trim()
        var jid = String(item.job_id || '').trim()
        fetch(serviceBase() + '/api/cursor-chat/git-deliver/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            confirm_token: token,
            job_id: jid,
            reason: '用户取消 Git 交付',
          }),
        })
          .then(function (r) {
            return r.json()
          })
          .then(function (d) {
            if (!d || !d.ok) throw new Error((d && d.detail) || '取消失败')
            setDoneMsg('已取消 Git 交付。工作区改动仍在。')
            setItem(null)
          })
          .catch(function (e) {
            setErr(String(e && e.message ? e.message : e))
          })
          .finally(function () {
            setBusy(false)
          })
      }

      return h(
        'div',
        { className: 'cc-git-deliver', 'data-cc-git-deliver-tail': '1' },
        h('p', { className: 'cc-git-title' }, '确认 Git 交付（人审）'),
        h(
          'div',
          { className: 'cc-git-row' },
          h('span', { className: 'cc-git-lab' }, '仓库'),
          h('span', { className: 'cc-git-val' }, plan.remote_url || '—'),
        ),
        h(
          'div',
          { className: 'cc-git-row' },
          h('span', { className: 'cc-git-lab' }, '当前分支'),
          h('span', { className: 'cc-git-val' }, plan.current_branch || '—'),
        ),
        h(
          'div',
          { className: 'cc-git-row' },
          h('span', { className: 'cc-git-lab' }, '提交分支'),
          h('input', {
            type: 'text',
            value: String(plan.target_branch || ''),
            onChange: function (ev) {
              var v = ev && ev.target ? ev.target.value : ''
              setPlan(function (prev) {
                return Object.assign({}, prev || {}, { target_branch: v })
              })
            },
          }),
        ),
        h(
          'div',
          { className: 'cc-git-row' },
          h('span', { className: 'cc-git-lab' }, '合并到'),
          h('input', {
            type: 'text',
            value: String(plan.base_branch || ''),
            onChange: function (ev) {
              var v = ev && ev.target ? ev.target.value : ''
              setPlan(function (prev) {
                return Object.assign({}, prev || {}, { base_branch: v })
              })
            },
          }),
        ),
        h(
          'div',
          { className: 'cc-git-row' },
          h('span', { className: 'cc-git-lab' }, '说明'),
          h('textarea', {
            value: String(plan.commit_message || ''),
            onChange: function (ev) {
              var v = ev && ev.target ? ev.target.value : ''
              setPlan(function (prev) {
                return Object.assign({}, prev || {}, { commit_message: v })
              })
            },
          }),
        ),
        h('p', { className: 'cc-note' }, '将纳入提交的文件（敏感文件默认不勾选）'),
        h(
          'div',
          { className: 'cc-git-files' },
          fileKeys.map(function (p) {
            var sens = !!heldSet[p]
            return h(
              'label',
              { key: p, className: 'cc-git-file' + (sens ? ' sens' : '') },
              h('input', {
                type: 'checkbox',
                checked: !!selected[p],
                disabled: sens || busy,
                onChange: function (ev) {
                  if (sens) return
                  var on = !!(ev && ev.target && ev.target.checked)
                  setSelected(function (prev) {
                    var next = Object.assign({}, prev)
                    next[p] = on
                    return next
                  })
                },
              }),
              h('span', { className: 'cc-git-tick', 'aria-hidden': 'true' }),
              h('span', null, p + (sens ? '（敏感·已排除）' : '')),
            )
          }),
        ),
        err ? h('p', { className: 'cc-set-msg err' }, err) : null,
        h(
          'div',
          {
            className: 'cc-git-actions',
            ref: function (el) {
              if (el) applyGitAccentVars(el.closest ? el.closest('.cc-git-deliver') || el : el)
            },
          },
          h(
            'button',
            { type: 'button', className: 'cc-set-btn', disabled: busy, onClick: onCancel },
            '取消',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'cc-set-btn primary',
              disabled: busy,
              onClick: onConfirm,
            },
            busy ? '提交中…' : '确认提交并开 PR',
          ),
        ),
      )
    }

    /**
     * 挂在底座 turnTail：「已完成」下方、原生改动卡上方。
     * 按 session_id 取账本结论，重开空白会话也能看见。
     */
    function ConclusionTurnTail(props) {
      var state = useState(null)
      var payload = state[0]
      var setPayload = state[1]
      var beLocalState = useState(null)
      var beLocal = beLocalState[0]
      var setBeLocal = beLocalState[1]
      var beBusyState = useState(false)
      var beBusy = beBusyState[0]
      var setBeBusy = beBusyState[1]
      var beErrState = useState('')
      var beErr = beErrState[0]
      var setBeErr = beErrState[1]
      var skipNativeState = useState(false)
      var skipNative = skipNativeState[0]
      var setSkipNative = skipNativeState[1]
      var sessionId = String((props && props.sessionId) || '').trim()
      var turn = props && props.turn
      var turnStart = Number(turn && turn.start && turn.start.time) || 0
      var turnEnd = Number(turn && turn.end && turn.end.time) || 0
      var item = payload ? pickConclusionForTurn(payload, turnStart, turnEnd) : null
      var md = item ? normalizeConclusionMd(String(item.chat_conclusion || '')) : ''
      var beOffer =
        beLocal && beLocal.offered
          ? beLocal
          : item && item.backend_restart && item.backend_restart.offered
            ? item.backend_restart
            : null
      var beHintText = item ? String(item.backend_restart_hint || '').trim() : ''
      var jidTail = item ? String(item.id || '').trim() : ''
      var turnRecent = turnEnd > 0 && Date.now() - turnEnd < 180000
      // Git 交付：不走写码「已编辑」卡（成功/失败/取消一律；文件清单只在结论正文）
      var hideGitChangesList = item && String(item.work_kind || '') === 'git_deliver'
      var syncedList =
        hideGitChangesList || !item
          ? []
          : [].concat(item.synced_files || [], item.files || []).filter(function (p, i, arr) {
              var s = String(p || '').trim()
              if (!s) return false
              // files 可能已含 synced+deleted，下面 deleted 再补；此处先去重
              return arr.indexOf(p) === i
            })
      // files 里可能混了删除项；仍以 deleted_files 为准展示删除标记
      var deletedList =
        hideGitChangesList || !item || !Array.isArray(item.deleted_files) ? [] : item.deleted_files
      if (deletedList.length && syncedList.length) {
        var delSet = {}
        for (var di = 0; di < deletedList.length; di++) {
          delSet[String(deletedList[di] || '').replace(/\\/g, '/')] = true
        }
        syncedList = syncedList.filter(function (p) {
          return !delSet[String(p || '').replace(/\\/g, '/')]
        })
      }

      useEffect(
        function () {
          if (!sessionId) {
            setPayload(null)
            return
          }
          var stopped = false
          var timer = 0
          var tries = 0
          var endMs = turnEnd
          var startMs = turnStart
          // 只有刚结束的轮次才轮询：历史轮次各拉一次足够，避免长会话放大请求
          var recent = endMs > 0 && Date.now() - endMs < 180000
          function fileCount(it) {
            if (!it) return 0
            var n = 0
            var a = [].concat(it.synced_files || [], it.deleted_files || [], it.files || [])
            for (var i = 0; i < a.length; i++) if (String(a[i] || '').trim()) n += 1
            return n
          }
          function pull() {
            loadSessionConclusion(sessionId, { fresh: tries > 0 }).then(function (d) {
              if (stopped) return
              var hit = d && d.ok && d.found ? pickConclusionForTurn(d, startMs, endMs) : null
              if (!hit) {
                if (recent && tries < 6) {
                  tries += 1
                  timer = setTimeout(pull, 700)
                  return
                }
                setPayload(d && d.ok ? d : null)
                return
              }
              setPayload(d)
              // 结论常先于同步落盘：文件列表仍空时短轮询，避免结论下永远没有改动卡
              if (recent && fileCount(hit) === 0 && tries < 10) {
                tries += 1
                timer = setTimeout(pull, 800)
              }
            })
          }
          pull()
          return function () {
            stopped = true
            if (timer) clearTimeout(timer)
          }
        },
        [sessionId, turnStart, turnEnd],
      )

      // 结论区兜底自动重启：进度卡折叠后仍执行一次（与进度卡共用 autoKey）
      useEffect(
        function () {
          // 前后端改由同步后的 Cursor 终端确认，结论区不再私下重启
          return
          if (!turnRecent || !beOffer || !beOffer.offered || beOffer.started_at) return
          if (!jidTail) return
          var autoKey =
            jidTail +
            '|' +
            String(beOffer.port || '') +
            '|' +
            String((beOffer.hit_files || []).join(','))
          if (beAutoKeyTaken(autoKey) || beAutoKeyTaken(autoKey + '#failed')) return
          var offerSnap = beOffer
          var t = setTimeout(function () {
            if (beAutoKeyTaken(autoKey) || beAutoKeyTaken(autoKey + '#failed')) return
            beAutoMark(autoKey)
            setBeBusy(true)
            setBeErr('')
            issueBackendRestartAndRun(jidTail)
              .then(function (out) {
                if (!out || !out.data || !out.data.ok) {
                  throw new Error((out && out.detail) || '重启失败')
                }
                setBeLocal(
                  Object.assign({}, offerSnap, {
                    started_at: new Date().toISOString(),
                    command: out.data.command || offerSnap.command || '',
                    port: out.data.port || offerSnap.port || 0,
                    cwd: out.data.cwd || offerSnap.cwd || '',
                    reason: out.data.reason || offerSnap.reason || '',
                    shell_lines: Array.isArray(out.data.shell_lines)
                      ? out.data.shell_lines
                      : offerSnap.shell_lines || [],
                    last_detail:
                      (out.term && out.term.detail) || out.detail || out.data.detail || '',
                  }),
                )
                if (!out.ok) {
                  setBeErr(
                    String(out.detail || '未能写入应用终端') +
                      '。请打开右侧「终端」查看或粘贴执行。',
                  )
                }
                loadSessionConclusion(sessionId, { fresh: true }).then(function (d) {
                  if (d && d.ok) setPayload(d)
                })
              })
              .catch(function (e) {
                beAutoMark(autoKey + '#failed')
                setBeErr(String(e && e.message ? e.message : e))
              })
              .finally(function () {
                setBeBusy(false)
              })
          }, 600)
          return function () {
            clearTimeout(t)
          }
        },
        [jidTail, beOffer && beOffer.port, beOffer && beOffer.started_at, turnRecent, sessionId],
      )

      useEffect(
        function () {
          var jid = String(jidTail || '').trim()
          if (!jid || typeof document === 'undefined') {
            setSkipNative(false)
            return
          }
          var host = document.querySelector(
            '[data-cc-turn-tail="1"][data-cc-job-id="' + jid.replace(/"/g, '') + '"]',
          )
          if (!host) {
            setSkipNative(false)
            return
          }
          // 文件卡与预览一律留底座原生「已编辑」。禁止自绘，也禁止把原生卡 display:none。
          // 仅当同级已有底座原生卡时跳过兜底；误判会永久吃掉文件列表，禁止扫正文模糊匹配
          var native = findSiblingNativeChangesCard(host)
          setSkipNative(Boolean(native))
        },
        [jidTail, syncedList.length, deletedList.length, md, item && item.work_kind, item && item.status],
      )

      if (!payload || !item) return null
      // 按 work_kind 分流：写码只挂「本轮结论」，提交代码只挂「Git 交付结论」
      var kindTail = String(item.work_kind || '')
      md = concludeMdForWorkKind(md, kindTail)
      if (!md) return null
      if (kindTail === 'git_deliver') {
        if (md.indexOf('Git 交付结论') < 0) return null
      } else if (md.indexOf('本轮结论') < 0) {
        return null
      }
      ensureCss()
      // Git 交付：永不套写码「已编辑」卡（不影响 code/ops）
      var hideGitChanges = kindTail === 'git_deliver'
      // 路径清单不进正文：优先底座原生「已编辑」卡；沙箱写码通常无原生 deliverables，结论下必须兜底
      var showChangesFallback =
        !hideGitChanges &&
        !skipNative &&
        (syncedList.length > 0 || deletedList.length > 0)

      function runTailRestartManual() {
        if (!jidTail || !beOffer || beOffer.started_at || beBusy) return
        var autoKey =
          jidTail +
          '|' +
          String(beOffer.port || '') +
          '|' +
          String((beOffer.hit_files || []).join(','))
        var offerSnap = beOffer
        setBeBusy(true)
        setBeErr('')
        issueBackendRestartAndRun(jidTail)
          .then(function (out) {
            if (!out || !out.data || !out.data.ok) {
              throw new Error((out && out.detail) || '重启失败')
            }
            beAutoMark(autoKey)
            setBeLocal(
              Object.assign({}, offerSnap, {
                started_at: new Date().toISOString(),
                command: out.data.command || offerSnap.command || '',
                port: out.data.port || offerSnap.port || 0,
                cwd: out.data.cwd || offerSnap.cwd || '',
                reason: out.data.reason || offerSnap.reason || '',
                shell_lines: Array.isArray(out.data.shell_lines)
                  ? out.data.shell_lines
                  : offerSnap.shell_lines || [],
                last_detail: (out.term && out.term.detail) || out.detail || out.data.detail || '',
              }),
            )
            if (!out.ok) {
              setBeErr(
                String(out.detail || '未能写入应用终端') +
                  '。请打开右侧「终端」查看或粘贴执行。',
              )
            }
            loadSessionConclusion(sessionId, { fresh: true }).then(function (d) {
              if (d && d.ok) setPayload(d)
            })
          })
          .catch(function (e) {
            setBeErr(String(e && e.message ? e.message : e))
          })
          .finally(function () {
            setBeBusy(false)
          })
      }

      return h(
        'div',
        {
          className: 'cc-conclusion-hoist',
          'data-cc-conclusion-hoist': '1',
          'data-cc-job-id': String(item.id || ''),
          'data-cc-turn-tail': '1',
          'data-cc-conclusion-official': kindTail === 'git_deliver' ? md : '',
        },
        h('div', { className: 'cc-conclusion' }, lightMdNodes(md)),
        beOffer
          ? h(
              'div',
              { className: 'cc-be-restart cc-be-hoist' },
              h(
                'p',
                { className: 'cc-be-title' },
                beOffer.started_at && beOffer.executed !== false
                  ? '后端已自动重启（本机已新开终端执行）'
                  : beBusy
                    ? '正在自动重启后端…'
                    : '后端将由本机自动重启以加载新接口',
              ),
              h(
                'p',
                { className: 'cc-be-reason' },
                String(beOffer.reason || '') +
                  (beOffer.port ? '（端口 ' + beOffer.port + '）' : ''),
              ),
              h('p', { className: 'cc-be-cmd' }, String(beOffer.command || '')),
              h(
                'div',
                { className: 'cc-set-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'cc-set-btn primary',
                    disabled: beBusy || Boolean(beOffer.started_at),
                    onClick: runTailRestartManual,
                  },
                  beOffer.started_at && beOffer.executed !== false
                    ? '本机已执行重启'
                    : beBusy
                      ? '执行中…'
                      : '若未自动执行可点此重启',
                ),
              ),
              beOffer.last_detail
                ? h('p', { className: 'cc-note' }, String(beOffer.last_detail))
                : null,
              beErr ? h('p', { className: 'cc-set-msg err' }, beErr) : null,
            )
          : beHintText
            ? h(
                'div',
                { className: 'cc-be-restart cc-be-hoist' },
                h('p', { className: 'cc-be-title' }, '后端需按工程方式重启'),
                h('p', { className: 'cc-be-reason' }, beHintText),
              )
            : null,
        // 结论下方：无底座原生卡时补「已编辑 N 个文件」（行可点 → 右侧工作区）
        showChangesFallback
          ? renderChangesFallbackCard(syncedList, deletedList, {
              openFile: props && props.openFile,
              sessionId: sessionId,
            })
          : null,
      )
    }

    function displayRelPath(p) {
      var s = String(p || '').replace(/\\/g, '/')
      var m = s.match(/\/sandboxes\/[^/]+\/(.+)$/)
      return m ? m[1] : s
    }

    /** 编码 dsh-resource://file/session/<id>/<path> 的一段 */
    function encodeFileAddrSegment(segment) {
      return encodeURIComponent(String(segment || '')).replace(/%3A/gi, ':')
    }

    /**
     * 在右侧工作区打开相对路径。
     * 优先 turnTail.openFile；没有则直接 sidebarRight.openResource（本机实测 props.openFile 常缺）。
     */
    function openWorkspaceRel(relPath, opts) {
      var path = String(relPath || '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .trim()
      if (!path) return false
      // 拒绝逃逸：.. / 绝对盘符 / ~ / 空字节
      if (
        path.indexOf('\0') >= 0 ||
        path.indexOf('~') >= 0 ||
        path.indexOf(':') >= 0 ||
        path.charAt(0) === '/' ||
        path.split('/').indexOf('..') >= 0
      ) {
        return false
      }
      var openFile = opts && opts.openFile
      if (typeof openFile === 'function') {
        try {
          openFile(path)
          return true
        } catch (e0) {
          /* fall through */
        }
      }
      var sid = String((opts && opts.sessionId) || '').trim()
      var ctx = hostCtxRef && hostCtxRef.ctx
      if (!sid || !ctx) return false
      try {
        var sidebar = ctx.sidebarRight
        if ((!sidebar || typeof sidebar.openResource !== 'function') && typeof ctx.get === 'function') {
          try {
            sidebar = ctx.get('sidebarRight')
          } catch (e1) {
            sidebar = null
          }
        }
        if (!sidebar || typeof sidebar.openResource !== 'function') return false
        var encPath = path
          .split('/')
          .map(encodeFileAddrSegment)
          .join('/')
        var url =
          'dsh-resource://file/session/' + encodeFileAddrSegment(sid) + '/' + encPath
        sidebar.openResource(url)
        return true
      } catch (e2) {
        return false
      }
    }

    /** 对齐底座「已编辑 N 个文件」外观；仅兜底。点击走 openWorkspaceRel。 */
    function renderChangesFallbackCard(synced, deleted, openOpts) {
      var syncedArr = Array.isArray(synced) ? synced : []
      var deletedArr = Array.isArray(deleted) ? deleted : []
      var sid = String((openOpts && openOpts.sessionId) || '').trim()
      var hasOpenFn = openOpts && typeof openOpts.openFile === 'function'
      // sessionId 在即可走 sidebar 兜底，不依赖 openFile 是否注入
      var canOpen = hasOpenFn || Boolean(sid)
      var seen = {}
      var rows = []
      for (var i = 0; i < syncedArr.length; i++) {
        var p = String(syncedArr[i] || '').trim().replace(/\\/g, '/')
        if (!p || seen[p]) continue
        seen[p] = true
        rows.push({ path: p, kind: 'edit' })
      }
      for (var j = 0; j < deletedArr.length; j++) {
        var d = String(deletedArr[j] || '').trim().replace(/\\/g, '/')
        if (!d || seen[d]) continue
        seen[d] = true
        rows.push({ path: d, kind: 'del' })
      }
      if (!rows.length) return null
      var base0 = displayRelPath(rows[0].path).split('/').pop() || rows[0].path
      var title = rows.length === 1 ? '已编辑 ' + base0 : '已编辑 ' + rows.length + ' 个文件'
      return h(
        'div',
        {
          className: 'cc-changes-card',
          'data-cc-changes-fallback': '1',
          'data-changed-files': '1',
          'data-cc-openable': canOpen ? '1' : '0',
          'aria-label': title,
        },
        h(
          'div',
          { className: 'cc-changes-head' },
          h('div', { className: 'cc-changes-ico', 'aria-hidden': 'true' }, '📄'),
          h(
            'div',
            { className: 'cc-changes-meta' },
            h('p', { className: 'cc-changes-title' }, title),
            h(
              'div',
              { className: 'cc-changes-stats' },
              syncedArr.length
                ? h('span', { className: 'plus' }, '+' + syncedArr.length)
                : null,
              deletedArr.length
                ? h('span', { className: 'minus' }, '-' + deletedArr.length)
                : null,
            ),
          ),
        ),
        h(
          'div',
          { className: 'cc-changes-list' },
          rows.map(function (row, idx) {
            var shown = displayRelPath(row.path) || row.path
            var tip = shown + (canOpen ? '（点击在右侧工作区打开）' : '')
            return h(
              canOpen ? 'button' : 'div',
              {
                key: row.path + '-' + idx,
                type: canOpen ? 'button' : undefined,
                className: 'cc-changes-row' + (canOpen ? ' is-clickable' : ''),
                title: tip,
                'aria-label': canOpen ? '在工作区打开 ' + shown : shown,
                onClick: canOpen
                  ? function (ev) {
                      if (ev && ev.preventDefault) ev.preventDefault()
                      if (ev && ev.stopPropagation) ev.stopPropagation()
                      openWorkspaceRel(row.path, openOpts || {})
                    }
                  : undefined,
              },
              h('span', { className: 'path' }, shown),
              h(
                'span',
                { className: 'tag' + (row.kind === 'del' ? ' del' : ' add') },
                row.kind === 'del' ? '删除' : '改动',
              ),
            )
          }),
        ),
      )
    }

    function installGlobalConclusionPublisher() {
      // 禁止再改宿主对话 DOM。往「已编辑」卡前 insertBefore、再对 document.body 做
      // MutationObserver，会把 React 管的节点挪走，其它已完成会话打开后正文变空白。
      return
      if (typeof window === 'undefined' || window.__ccConclusionPub) return
      window.__ccConclusionPub = true
      var cacheItems = []
      var ANCHOR_MS = 3 * 60 * 60 * 1000

      function nativeCards() {
        var out = []
        try {
          var marked = document.querySelectorAll('[data-changed-files]')
          for (var i = 0; i < marked.length; i++) out.push(marked[i])
        } catch (e0) {}
        if (out.length) return out
        var fb = findEditedCardIn(document)
        return fb ? [fb] : []
      }

      function streamInto(host, text) {
        var jobId = host.getAttribute('data-cc-job-id') || ''
        window.__ccStreamed = window.__ccStreamed || {}
        if (window.__ccStreamed[jobId]) {
          host.innerHTML = '<div class="cc-conclusion">' + lightMdHtml(text) + '</div>'
          host.setAttribute('data-cc-streamed', '1')
          return
        }
        host.setAttribute('data-cc-streaming', '1')
        var lines = String(text).split('\n')
        var shown = 0
        host.innerHTML = '<div class="cc-conclusion"></div>'
        var box = host.firstChild
        var tick = setInterval(function () {
          if (!document.getElementById(host.id)) {
            clearInterval(tick)
            return
          }
          shown = Math.min(lines.length, shown + 2)
          try {
            box.innerHTML = lightMdHtml(lines.slice(0, shown).join('\n'))
          } catch (eRd) {}
          if (shown >= lines.length) {
            clearInterval(tick)
            host.setAttribute('data-cc-streamed', '1')
            host.removeAttribute('data-cc-streaming')
            window.__ccStreamed[jobId] = 1
          }
        }, 45)
      }

      function placeLatest() {
        if (typeof document === 'undefined') return
        if (document.querySelector('[data-chat-running]')) return
        var cards = nativeCards()
        if (!cards.length) return
        var card = cards[cards.length - 1]
        var names = cardFileNames(String(card.textContent || ''))
        var now = Date.now()
        var fresh = cacheItems.filter(function (it) {
          var ts = Date.parse(String(it && it.updated_at || '')) || 0
          return ts > 0 && now - ts < ANCHOR_MS && now - ts >= 0
        })
        var item = pickConclusionForCard(fresh, names)
        if (!item) return
        var text = normalizeConclusionMd(String(item.chat_conclusion || ''))
        if (!text || text.indexOf('本轮结论') < 0) return
        var hoistId = 'cc-hoist-' + String(item.id).replace(/[^\w.-]+/g, '_')
        var parent = card.parentElement
        if (!parent) return
        var prev = card.previousElementSibling
        if (prev && prev.id === hoistId) return
        ensureCss()
        var host = document.getElementById(hoistId)
        if (!host) {
          host = document.createElement('div')
          host.id = hoistId
          host.className = 'cc-conclusion-hoist'
          host.setAttribute('data-cc-conclusion-hoist', '1')
          host.setAttribute('data-cc-job-id', String(item.id))
        }
        try {
          parent.insertBefore(host, card)
        } catch (eIns) {
          return
        }
        var extras = document.querySelectorAll('[data-cc-conclusion-hoist="1"]')
        for (var ei = 0; ei < extras.length; ei++) {
          if (extras[ei] !== host && extras[ei].parentElement) {
            try {
              extras[ei].parentElement.removeChild(extras[ei])
            } catch (eEx) {}
          }
        }
        if (host.getAttribute('data-cc-streamed') === '1' || host.getAttribute('data-cc-streaming') === '1') return
        streamInto(host, text)
      }

      function tick() {
        try {
          var base = serviceBase()
          if (!base) {
            placeLatest()
            return
          }
          fetch(base + '/api/cursor-chat/recent-conclusions?limit=8')
            .then(function (r) {
              return r.json()
            })
            .then(function (d) {
              if (d && d.ok && Array.isArray(d.items)) {
                cacheItems = d.items.filter(function (it) {
                  return it && it.id && it.chat_conclusion
                })
              }
              placeLatest()
            })
            .catch(function () {
              placeLatest()
            })
        } catch (e) {
          try {
            placeLatest()
          } catch (e2) {}
        }
      }

      setTimeout(tick, 400)
      setInterval(tick, 1500)
      try {
        var mo = new MutationObserver(function () {
          if (window.__ccConcHydrateTimer) clearTimeout(window.__ccConcHydrateTimer)
          window.__ccConcHydrateTimer = setTimeout(placeLatest, 80)
        })
        mo.observe(document.body, { childList: true, subtree: true })
      } catch (eMo) {}
    }

    /** 宿主 Context：可选 remote.terminal / sidebar，用于自动/手工写入应用终端 */
    var hostCtxRef = { ctx: null }

    /** 进度卡与结论 turnTail 共用：避免重复签发、重渲染丢定时器后永不重试 */
    function beAutoKeyStore() {
      if (typeof window === 'undefined') return { keys: {} }
      if (!window.__ccBeAutoKeys) window.__ccBeAutoKeys = { keys: {} }
      return window.__ccBeAutoKeys
    }
    function beAutoKeyTaken(key) {
      var k = String(key || '')
      if (!k) return false
      return Boolean(beAutoKeyStore().keys[k])
    }
    function beAutoMark(key) {
      var k = String(key || '')
      if (!k) return
      beAutoKeyStore().keys[k] = 1
    }

    /**
     * 签发 HITL + 写入应用终端。进度卡与结论区共用，保证折叠后仍能自动重启。
     * @returns {Promise<{ok:boolean, detail?:string, data?:object}>}
     */
    function issueBackendRestartAndRun(jobId) {
      var jid = String(jobId || '').trim()
      if (!jid) {
        return Promise.resolve({ ok: false, detail: '缺少 job_id' })
      }
      var api = serviceBase()
      if (!api) {
        return Promise.resolve({ ok: false, detail: '写码服务未就绪' })
      }
      return fetch(api + '/api/hitl/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cursor-chat.restart-backend', job_id: jid }),
      })
        .then(function (r) {
          return r.json()
        })
        .then(function (issued) {
          if (!issued || !issued.ok || !issued.nonce) {
            throw new Error((issued && issued.detail) || '签发重启 HITL 失败')
          }
          return fetch(api + '/api/cursor-chat/jobs/' + encodeURIComponent(jid) + '/restart-backend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nonce: issued.nonce }),
          }).then(function (r2) {
            return r2.json().then(function (d) {
              return { status: r2.status, data: d }
            })
          })
        })
        .then(function (out) {
          if (!out.data || !out.data.ok) {
            throw new Error((out.data && out.data.detail) || '重启准备失败 HTTP ' + out.status)
          }
          var lines = Array.isArray(out.data.shell_lines) ? out.data.shell_lines : []
          return runBackendRestartInAppTerminal(lines).then(function (term) {
            return {
              ok: Boolean(term && term.ok),
              detail: (term && term.detail) || out.data.detail || '',
              data: out.data,
              term: term,
            }
          })
        })
        .catch(function (e) {
          return { ok: false, detail: String(e && e.message ? e.message : e) }
        })
    }

    function currentSessionId(ctx) {
      try {
        var sessions = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : null
        if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== 'function') return ''
        return String(sessions.list.getSnapshot().current || '').trim()
      } catch (e) {
        return ''
      }
    }

    function openSidebarTerminal(ctx) {
      try {
        var sidebar = ctx && typeof ctx.get === 'function' ? ctx.get('sidebarRight') : null
        if (sidebar && typeof sidebar.openTab === 'function') {
          sidebar.openTab('terminal')
          return true
        }
      } catch (e) {}
      return false
    }

    /**
     * 可选：把重启命令镜像到「当前已存在」的应用终端，方便对照。
     * 禁止 create 新终端——会留下「此终端已不存在」空页，且 cmd 跑不了旧版多行 PS。
     * 真正重启由本机服务 executeBackendRestart（新开 PowerShell）完成。
     */
    function runBackendRestartInAppTerminal(lines) {
      var script = (Array.isArray(lines) ? lines : []).filter(Boolean).join('\n')
      if (!script) {
        return Promise.resolve({ ok: false, detail: '无镜像脚本' })
      }
      var ctx = hostCtxRef.ctx
      if (!ctx) {
        return Promise.resolve({ ok: false, detail: '宿主上下文未就绪（不影响本机已执行的重启）' })
      }
      try {
        openSidebarTerminal(ctx)
      } catch (eOpen) {}
      var payload = script + '\r'

      try {
        var web = typeof ctx.get === 'function' ? ctx.get('webTerminals') : null
        if (web) {
          var view =
            (typeof web.activeView === 'function' && web.activeView()) ||
            (typeof web.view === 'function' && web.view()) ||
            null
          if (view && typeof view.write === 'function') {
            view.write(payload)
            return Promise.resolve({ ok: true, detail: '已镜像到当前应用终端（webTerminals）' })
          }
          if (typeof web.write === 'function') {
            web.write(payload)
            return Promise.resolve({ ok: true, detail: '已镜像到当前应用终端（webTerminals.write）' })
          }
        }
      } catch (eWeb) {}

      // 不再 remote.terminal.create：避免幽灵终端「已不存在」
      return Promise.resolve({
        ok: false,
        detail: '未镜像到侧栏终端（可忽略；本机 PowerShell 窗才是实际执行处）',
      })
    }

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') {
        console.error('[cursor-chat] 无 slots，无法注册设置页')
        return
      }
      hostCtxRef.ctx = ctx
      // 可选：预热 remote / sidebar（缺失时不阻断插件加载）
      try {
        if (typeof ctx.inject === 'function') {
          ctx.inject(['remote', 'sidebarRight', 'sessions', 'webTerminals'], function () {
            hostCtxRef.ctx = ctx
          })
        }
      } catch (eInj) {}
      installGlobalConclusionPublisher()
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          {
            name: 'settings.section',
            id: 'cursor-chat',
            order: 8,
            label: 'AI写码',
          },
          CursorCodingSettingsSection,
        )
      })
      installGitConclusionDedupe()
      // 「已完成」下方：Git 确认卡（先于结论），再挂本轮结论
      ctx.slots.inject('conversation.chat.turnTail', function () {
        return ctx.slots.register(
          {
            name: 'conversation.chat.turnTail',
            id: '@zhongruan/dsh-cursor-chat/git-deliver',
            order: -30,
            select: selectGitDeliverTurn,
          },
          GitDeliverConfirmTurnTail,
        )
      })
      ctx.slots.inject('conversation.chat.turnTail', function () {
        return ctx.slots.register(
          {
            name: 'conversation.chat.turnTail',
            id: '@zhongruan/dsh-cursor-chat/conclusion',
            order: -20,
            select: selectConclusionTurn,
          },
          ConclusionTurnTail,
        )
      })
      // 写码/续改/Git 交付共用进度卡；用 select 兼容 key 匹配失败的宿主
      ;['zr_cchat_begin', 'zr_cchat_continue', 'zr_cchat_git_deliver'].forEach(function (toolKey) {
        ctx.slots.inject('tool.call.toolview', function () {
          return ctx.slots.register(
            { name: 'tool.call.toolview', key: toolKey },
            CursorCodingBeginCard,
          )
        })
      })
      ctx.slots.inject('tool.call.toolview', function () {
        return ctx.slots.register(
          {
            name: 'tool.call.toolview',
            id: '@zhongruan/dsh-cursor-chat/git-deliver-view',
            order: -5,
            select: function (props) {
              var n = ''
              try {
                var b = props && props.block
                n = String((b && (b.name || b.toolName || b.tool_name)) || (props && props.key) || '').trim()
              } catch (e0) {}
              return n === 'zr_cchat_git_deliver' || /zr_cchat_git_deliver$/.test(n)
            },
          },
          CursorCodingBeginCard,
        )
      })
      console.log('[cursor-chat] 已注册设置页 + 写码进度卡 + Git 交付确认 + turnTail 结论')
    }

    module.exports = { inject: ['slots'], apply: apply }
    return module.exports
  },
})
