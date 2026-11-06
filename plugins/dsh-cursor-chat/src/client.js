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
      var markers = [/##\s*说明方案/, /##\s*本轮结论/, /【本轮结论】/]
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
      if (/##\s*说明方案/.test(t) || /##\s*本轮结论/.test(t) || /【本轮结论】/.test(t)) return ''
      return t
    }

    function normalizeStatusDisplayClient(message) {
      var msg = String(message || '').trim()
      if (!msg) return ''
      if (/^RUNNING$/i.test(msg)) return 'Cursor 运行中，请稍候…'
      return String(message || '')
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
      return normalizeConclusionMd(ready)
    }

    /** 同一段 md 里若被刷了两遍「## 本轮结论」，只留第一份完整三段式 */
    function normalizeConclusionMd(md) {
      var t = String(md || '').trim()
      if (!t) return ''
      // 不用 \b：中文后 word-boundary 在 JS 不可靠
      var parts = t.split(/\n(?=##\s*本轮结论)/)
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
      if (s === 'cancelled') return '已取消'
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

    function ensureCss() {
      if (typeof document === 'undefined') return
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
        '.cc-plan{display:flex;align-items:center;gap:8px;margin:10px 0 2px;font-size:13px;opacity:.55;line-height:1.4}' +
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
        /* Cursor 式：思考过程 = 弱化可展开链接，无胶囊 */ +
        '.cc-bubble.thinking{margin:2px 0 10px}' +
        '.cc-bubble.thinking details{border:none;padding:0;background:transparent}' +
        '.cc-bubble.thinking summary{cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:4px;font-size:13px;line-height:1.4;padding:0;border-radius:0;background:transparent;color:inherit;opacity:.48;user-select:none;font-weight:400}' +
        '.cc-bubble.thinking summary::-webkit-details-marker{display:none}' +
        '.cc-bubble.thinking summary .cc-chev{display:inline-block;transition:transform .15s ease;opacity:.7;font-size:12px}' +
        '.cc-bubble.thinking details[open] summary .cc-chev{transform:rotate(90deg)}' +
        '.cc-bubble.thinking .body{margin-top:6px;padding:0;white-space:pre-wrap;font-size:12.5px;line-height:1.65;opacity:.62;max-height:none;overflow:visible;background:transparent}' +
        '.cc-bubble.thinking.is-stream summary{opacity:.7}' +
        /* 仅终态且用户未点展开时才裁切；进行中绝不裁切，避免结论未出先空白 */ +
        '.cc-bubble.thinking.is-done:not(.is-hold) .body{max-height:8.5em;overflow:hidden}' +
        '.cc-bubble.thinking details[open].is-full .body,.cc-bubble.thinking.is-hold .body{max-height:none!important;overflow:visible!important}' +
        '.cc-hold{min-height:48px;margin:6px 0 10px;padding:10px 0;font-size:13px;opacity:.62;line-height:1.5}' +
        '.cc-dialog:empty::after{content:"正在准备过程…";display:block;padding:12px 0;opacity:.55;font-size:13px}' +
        '.cc-think-more{display:inline-block;margin-top:4px;border:0;background:transparent;padding:0;font-size:12px;opacity:.5;cursor:pointer}' +
        '.cc-think-more:hover{opacity:.8}' +
        '.cc-bubble.thought{display:inline-flex;align-items:center;gap:6px;margin:2px 0 10px;font-size:13px;opacity:.48}' +
        '.cc-bubble.thought .ico{opacity:.7}' +
        /* 正文叙事：主视觉，专业可读 */ +
        '.cc-bubble.assistant{margin:0 0 14px}' +
        '.cc-bubble.assistant .body{white-space:pre-wrap;font-size:14px;line-height:1.7;color:inherit;letter-spacing:.01em}' +
        '.cc-bubble.assistant .body h3{font-size:13.5px;font-weight:600;margin:14px 0 6px;opacity:.95}' +
        '.cc-bubble.assistant .body strong{font-weight:600}' +
        '.cc-bubble.assistant .body .cc-li{margin:3px 0 3px 2px;padding-left:0}' +
        '.cc-bubble.assistant .body .cc-ol{margin:3px 0 3px 2px}' +
        '.cc-bubble.assistant .body code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;padding:1px 6px;border-radius:5px;background:rgba(127,127,127,.16)}' +
        '.cc-bubble.assistant .body pre.cc-md-code{margin:10px 0;padding:12px 14px;border-radius:10px;background:rgba(24,24,27,.92);color:#e4e4e7;overflow:auto;max-height:none;border:1px solid rgba(255,255,255,.06);position:relative}' +
        '.cc-bubble.assistant .body pre.cc-md-code code{padding:0;background:transparent;color:inherit;font-size:12px;line-height:1.55;white-space:pre}' +
        /* 工具汇总行：安静、可展开 */ +
        '.cc-bubble.tool-group{margin:2px 0 10px}' +
        '.cc-bubble.tool-group details{border:none;padding:0;background:transparent}' +
        '.cc-bubble.tool-group summary{cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:4px;font-size:13px;line-height:1.45;opacity:.48;user-select:none;padding:0;background:transparent}' +
        '.cc-bubble.tool-group summary::-webkit-details-marker{display:none}' +
        '.cc-bubble.tool-group summary .cc-chev{display:inline-block;transition:transform .15s ease;font-size:12px;opacity:.7}' +
        '.cc-bubble.tool-group details[open] summary .cc-chev{transform:rotate(90deg)}' +
        '.cc-bubble.tool-group .cc-tool-list{margin:6px 0 0 2px;padding:0;display:flex;flex-direction:column;gap:4px}' +
        '.cc-bubble.tool-group .cc-tool-line{font-size:12px;line-height:1.45;opacity:.55;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
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
        '.cc-bubble.tool-live{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px;margin:2px 0 10px;font-size:13px;opacity:.62;line-height:1.45}' +
        '.cc-bubble.tool-live .meta{opacity:.55;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}' +
        '.cc-bubble.tool-live .cc-cmd{flex:1 1 100%;margin-top:2px;opacity:1}' +
        '.cc-bubble.status{font-size:12.5px;opacity:.55;margin:2px 0 8px;display:flex;align-items:flex-start;gap:8px;line-height:1.45;padding:0;background:transparent;border:none}' +
        '.cc-bubble.status.is-live{opacity:.7}' +
        '.cc-spin{display:inline-block;width:11px;height:11px;border:1.5px solid rgba(127,127,127,.28);border-top-color:rgba(127,127,127,.85);border-radius:50%;animation:ccspin .65s linear infinite;flex:0 0 auto}' +
        '.cc-live-bar{display:flex;align-items:center;gap:10px;margin:0 0 10px;padding:0;border-radius:0;background:transparent;border:none;font-size:13px;opacity:.62}' +
        '.cc-live-bar .cc-spin{margin-top:0}' +
        '.cc-steer{margin-top:10px;border-top:1px solid var(--color-border,rgba(127,127,127,.3));padding-top:10px}' +
        '.cc-done-panel{margin-top:12px;padding-top:4px;border-top:none}' +
        '.cc-done-panel h5{margin:0 0 8px;font-size:13px;opacity:.7;font-weight:500}' +
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
        '.cc-conclusion hr{margin:10px 0 6px;border:none;border-top:1px dashed rgba(127,127,127,.35)}' +
        '.cc-conclusion pre.cc-md-code{margin:6px 0;padding:10px 12px;border-radius:8px;background:rgba(24,24,27,.92);color:#e4e4e7;overflow:auto;max-height:none;border:1px solid rgba(255,255,255,.06)}' +
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
        '.cc-changes-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 14px;font-size:12.5px;line-height:1.35}' +
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
      style.setAttribute('data-cc-css', '1.3.30-changes-card')
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
        var body = {
          listen: '127.0.0.1',
          port: draft.port,
          writeScopeText: draft.writeScopeText,
        }
        if (key && key !== SECRET_MASK && !/^•+$/.test(key)) {
          body.cursorApiKey = key
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
          '独立插件：立刻开工出进度卡（无确认卡）→ Cursor 流式改码 → 同步 → 正文结论。',
        ),
        h(
          'div',
          { className: 'cc-set-card' },
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
        s +=
          '|' +
          String(it.id || i) +
          ':' +
          String(it.kind || '') +
          ':' +
          String(it.text || '').length +
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

    function CursorCodingBeginCard(props) {
      ensureCss()
      var uiRaw = readUiFromProps(props) || {}
      var argsMsg = toolArgsMessage(props && props.block)
      var lastUser = lastUserUtterance(props)
      var detached = detachStaleJobUi(uiRaw, argsMsg, lastUser)
      var ui = detached.ui
      var staleReuse = detached.stale
      // 须澄清：只认「本跳已终态」的 need_clarify / await_ask_user。进行中的 begin 必须出确认卡。
      if (readAwaitAskUser(props)) {
        return null
      }
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
      // 与 cardBootstrap.resolveCardBoot 同口径（改一处必须改两处 + 自测）
      var boot = (function () {
        if (abortedInit) {
          return { phase: 'done', statusLabel: '已停止', sealedStatus: 'cancelled', cancelled: true }
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
              (p === 'review' ? '待审同步' : '写码中'),
            sealedStatus: '',
            cancelled: false,
          }
        }
        if (!hostLive0) {
          return { phase: 'done', statusLabel: '已停止', sealedStatus: 'cancelled', cancelled: true }
        }
        if (viewPhase0 === 'start' || viewPhase0 === 'preparing') {
          return { phase: 'running', statusLabel: '写码中', sealedStatus: '', cancelled: false }
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
        setJobId('')
        setPhase('form')
        setBusy(false)
        setErr('')
        setCopyFlash('')
        setStreamText('')
        setTranscript([])
        setStatusLabel('')
        setConclusionMd('')
        setReview({ inScope: [], deleted: [], deferred: [] })
        setSelected({})
        setConfirmToken('')
        setParentJobId('')
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
          function attach(jid) {
            if (!jid || stopped) return
            setJobId(String(jid))
            setPhase('running')
            setStatusLabel('写码中')
            reconcileJob(String(jid))
            if (!esRef.current) openStream(String(jid))
          }
          function pull() {
            if (stopped || jobIdRef.current) return
            var base = serviceBase()
            fetch(base + '/api/cursor-chat/jobs-by-call?call_id=' + encodeURIComponent(callId))
              .then(function (r) {
                return r.json().then(function (d) {
                  return { status: r.status, d: d }
                })
              })
              .then(function (pack) {
                if (stopped || jobIdRef.current) return null
                var d = pack && pack.d
                if (d && d.found && d.job_id) {
                  attach(String(d.job_id))
                  return null
                }
                // 404/未知路径 → pending-latest
                if (!ws) return null
                return fetch(
                  base +
                    '/api/cursor-chat/pending-latest?workspace=' +
                    encodeURIComponent(ws) +
                    '&call_id=' +
                    encodeURIComponent(callId),
                ).then(function (r2) {
                  return r2.json()
                })
              })
              .then(function (d2) {
                if (!d2 || !d2.pending || !d2.pending.job_id) return
                if (d2.pending.call_id && String(d2.pending.call_id) !== callId) return
                attach(String(d2.pending.job_id))
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
        dialogPinRef.current = false
        stickBottomRef.current = false
        try {
          if (esRef.current && typeof esRef.current.close === 'function') esRef.current.close()
        } catch (e0) {}
        var jid = String(jobId || (ui && ui.job_id) || '').trim()
        if (!jid) return
        fetch(base() + '/api/hitl/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cursor-chat.cancel', job_id: jid }),
        })
          .then(function (r) {
            return r.json()
          })
          .then(function (issued) {
            if (!issued || !issued.ok || !issued.nonce) {
              throw new Error((issued && issued.detail) || '签发取消令牌失败')
            }
            return fetch(base() + '/api/cursor-chat/jobs/' + encodeURIComponent(jid) + '/cancel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nonce: issued.nonce }),
            })
          })
          .then(function (r) {
            return r.json()
          })
          .then(function (d) {
            if (d && d.job && Array.isArray(d.job.transcript)) {
              setTranscript(sealTranscriptItems(d.job.transcript))
            }
            setPhase('done')
            setStatusLabel('已取消')
          })
          .catch(function () {})
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
          dialogPinRef.current = false
          stickBottomRef.current = false
          return
        }
        var detail = String(job.detail || '')
        var inScopeLen = Array.isArray(job.review_in_scope) ? job.review_in_scope.length : -1
        var reviewGate = job.review_gate || null
        var nextPhase = phaseFromJobStatus(st, detail, inScopeLen, reviewGate)
        var nextLabel = labelFromJobStatus(st, detail, inScopeLen, reviewGate)
        if (TERMINAL_JOB[st]) sealedStatusRef.current = st
        var phaseOut = nextPhase
        var labelOut = nextLabel
        if (nextPhase === 'done') {
          phaseOut = 'done'
          labelOut = nextLabel || '已完成'
          dialogPinRef.current = false
          stickBottomRef.current = false
        } else if (nextPhase === 'review') {
          phaseOut = 'review'
          labelOut = nextLabel || '待审同步'
          dialogPinRef.current = true
          stickBottomRef.current = true
          if (job.review_in_scope || job.review_deferred) {
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
        } else if (st === 'running' || st === 'queued' || st === 'syncing') {
          phaseOut = 'running'
          labelOut = st === 'syncing' ? '自动同步中' : nextLabel || '写码中'
          dialogPinRef.current = true
          stickBottomRef.current = true
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
        var syncedNow = job.synced_files || job.last_synced_files || job.review_in_scope || []
        var deletedNow = job.deleted_files || job.review_deleted || []
        if ((syncedNow && syncedNow.length) || (deletedNow && deletedNow.length)) {
          setChangedFiles({
            synced: Array.isArray(syncedNow) ? syncedNow : [],
            deleted: Array.isArray(deletedNow) ? deletedNow : [],
          })
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
                assistant_text: data.assistant_text,
                chat_conclusion: data.chat_conclusion,
                synced_files: data.synced_files,
                transcript: Array.isArray(data.transcript)
                  ? data.transcript.map(function (it) {
                      if (!it || it.kind !== 'tool') return it
                      var st = String(it.tool_status || '').toLowerCase()
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
              if (data.status === 'pending_review') {
                var inN = Array.isArray(data.review_in_scope) ? data.review_in_scope.length : 0
                var snapPhase = phaseFromJobStatus(
                  data.status,
                  data.detail,
                  inN,
                  data.review_gate,
                )
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
            if (data.type === 'status') appendStream(data.message || '')
          } catch (e) {
            appendStream(String(ev.data || ''))
          }
        }
        es.onerror = function () {
          appendStream('（SSE 异常，正在对账任务状态…）')
          reconcileJob(jid)
        }
      }

      // 运行中低频对账即可（SSE 已推）；过勤会跟 snapshot 打架闪烁
      useEffect(
        function () {
          if (phase !== 'running' || !jobId) return
          var t = setInterval(function () {
            reconcileJob(jobId)
          }, 5000)
          return function () {
            clearInterval(t)
          }
        },
        [phase, jobId],
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
      var title =
        parentJobId || kind === 'continue'
          ? 'Cursor 对话写码 · 续改进度'
          : phase === 'done' || visiblePhase === 'done'
            ? 'Cursor 对话写码 · 本轮结论'
            : 'Cursor 对话写码 · 进度'

      var statusZh = (function () {
        var s = String(visibleLabel || '')
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
          if (md.indexOf('本轮结论') < 0 && md.indexOf('结果：') < 0 && md.indexOf('任务结果') < 0) return
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

      function renderCmdCard(cmd) {
        var text = String(cmd || '').trim()
        if (!text) return null
        return h(
          'div',
          {
            className: 'cc-cmd',
            'aria-label': '命令',
            style: { background: '#0d1117', color: '#e6edf3', border: '1px solid #30363d' },
          },
          h('div', { className: 'cc-cmd-head', style: { background: '#161b22' } }, 'Terminal'),
          h('pre', { style: { background: '#0d1117', color: '#e6edf3' } }, text),
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
        var block = cmd
          ? renderCmdCard(cmd)
          : snip
            ? renderDiffCard(path || (it && it.path) || '', snip, it && it.id)
            : null
        return h('div', { key: it.id, className: 'cc-bubble tool-rich' }, block)
      }

      function renderToolGroupNode(tools, key) {
        var title = formatToolGroupSummary(tools)
        var lines = (tools || []).map(function (t, i) {
          var meta = toolMetaLine(t)
          var label = String(t.name || 'tool')
          return h(
            'div',
            { key: (t.id || i) + '', className: 'cc-tool-line', title: meta || label },
            label + (meta ? ' · ' + meta : ''),
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

        function flushTools() {
          if (!toolBuf.length) return
          var key = 'tg-' + (toolBuf[0].id || nodes.length)
          nodes.push(renderToolGroupNode(toolBuf.slice(), key))
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
                h('span', null, toolLiveWhy(it.name)),
                metaLive && !liveCmd && !liveSnip
                  ? h('span', { className: 'meta' }, metaLive)
                  : null,
                liveCmd ? renderCmdCard(liveCmd) : null,
                !liveCmd && liveSnip
                  ? renderDiffCard(shortPath(it.path) || it.path || '', liveSnip, it.id)
                  : null,
              ),
            )
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
                  h('span', null, 'Thought'),
                  h('span', { className: 'cc-cursor', 'aria-hidden': 'true' }),
                ),
              )
              return
            }
            var thinkLabel =
              streaming || stillRevealing || holdThought
                ? 'Thought'
                : 'Thought' + (durSec ? ' ' + durSec + 's' : '')
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
                h('div', {
                  className: 'body',
                  dangerouslySetInnerHTML: { __html: renderMd(shown) },
                }),
              ),
            )
            return
          }
          if (it.kind === 'status') {
            var msg = normalizeStatusDisplayClient(it.text || '')
            if (/【本轮结论】|^##\s*本轮结论|说明方案/.test(msg)) return
            if (!msg) return
            // 沙箱/启动细节：进行中改写为友好占位，禁止静默丢掉导致大块空白
            if (
              /准备沙箱|稀疏拷贝|沙箱就绪|启动 Cursor|正在启动|Mock Cursor|已入队|确认入队|写范围|只读上下文/i.test(
                msg,
              )
            ) {
              if (!streamActive) return
              msg = '正在准备写码环境…'
            }
            var busy = streamActive && /同步|请稍候|失败|错误|准备|连接/i.test(msg)
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
                    !conclusionMd
                      ? h(
                          'div',
                          { className: 'cc-hold' },
                          h('span', { className: 'cc-spin', 'aria-hidden': 'true' }),
                          h('span', null, '写码已结束，正在汇总本轮结论…'),
                        )
                      : h('p', { className: 'cc-note' }, '本轮结论见下方正文'),
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
                  )
                : null,
              !isDoneView
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
                      h('summary', null, '本轮过程（Thought / Diff）'),
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
              showLiveChrome
                ? h(
                    'div',
                    { className: 'cc-plan' },
                    h('span', { className: 'cc-spin', 'aria-hidden': 'true' }),
                    h('span', null, planLabel),
                  )
                : null,
              phase === 'review'
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

    function lightMdInline(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    }

    /** 按行排版（对齐图二：标签：正文 / • 列表 / 段间空行） */
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
        if (/^[•·]\s+/.test(t) || /^[-*]\s+/.test(t)) {
          out.push('<div class="cc-li">' + lightMdInline(t.replace(/^[•·\-*]\s+/, '')) + '</div>')
          continue
        }
        if (/^\d+\.\s+/.test(t)) {
          out.push('<div class="cc-ol">' + lightMdInline(t) + '</div>')
          continue
        }
        // 结果：… / 改动： / 涉及文件： / 验收：
        var lm = t.match(/^([^：:]{1,16})([：:])\s*(.*)$/)
        if (lm) {
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

    /** 最小块：同时含「本轮结论」和「结果：」，且不再套一层同样的块。过程卡内部不算。 */
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
          if (!/本轮结论/.test(t)) continue
          if (!/结果：/.test(t)) continue
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

    function findEditedCardIn(root) {
      if (!root || !root.querySelectorAll) return null
      try {
        var best = null
        var bestLen = Infinity
        var nodes = root.querySelectorAll('div,section,article')
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i]
          if (el.getAttribute && el.getAttribute('data-cc-changes-fallback') === '1') continue
          if (el.getAttribute && el.getAttribute('data-cc-conclusion-hoist') === '1') continue
          if (el.closest && el.closest('[data-cc-conclusion-hoist="1"]')) continue
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
     * 注册同时带 select 可兼容两版。只认已闭合、有起止时间的轮次。
     */
    function selectConclusionTurn(owner) {
      var turn = owner && owner.turn
      var start = Number(turn && turn.start && turn.start.time) || 0
      var end = Number(turn && turn.end && turn.end.time) || 0
      if (!start || !end) return null
      return { start: start, end: end }
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
     * 挂在底座 turnTail：「已完成」下方、原生改动卡上方。
     * 按 session_id 取账本结论，重开空白会话也能看见。
     */
    function ConclusionTurnTail(props) {
      var state = useState(null)
      var payload = state[0]
      var setPayload = state[1]
      var sessionId = String((props && props.sessionId) || '').trim()
      useEffect(
        function () {
          if (!sessionId) {
            setPayload(null)
            return
          }
          var stopped = false
          var timer = 0
          var tries = 0
          var t = props && props.turn
          var endMs = Number(t && t.end && t.end.time) || 0
          var startMs = Number(t && t.start && t.start.time) || 0
          // 只有刚结束的轮次才轮询：历史轮次各拉一次足够，避免长会话放大请求
          var recent = endMs > 0 && Date.now() - endMs < 180000
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
            })
          }
          pull()
          return function () {
            stopped = true
            if (timer) clearTimeout(timer)
          }
        },
        [sessionId],
      )
      if (!payload) return null
      var turn = props && props.turn
      var turnStart = Number(turn && turn.start && turn.start.time) || 0
      var turnEnd = Number(turn && turn.end && turn.end.time) || 0
      // 只挂结论所属的那一轮；同一会话历史轮次不得重复挂同一份
      var item = pickConclusionForTurn(payload, turnStart, turnEnd)
      if (!item) return null
      ensureCss()
      var md = normalizeConclusionMd(String(item.chat_conclusion || ''))
      if (!md || md.indexOf('本轮结论') < 0) return null
      var files = []
        .concat(item.synced_files || [])
        .concat(item.deleted_files || [])
        .concat(item.files || [])
      var seen = {}
      var uniq = []
      for (var i = 0; i < files.length; i++) {
        var f = String(files[i] || '').trim()
        if (!f || seen[f]) continue
        seen[f] = true
        uniq.push(f)
      }
      var extra = ''
      if (uniq.length) {
        extra =
          '\n\n涉及文件：\n' +
          uniq
            .map(function (p) {
              return '• `' + p + '`'
            })
            .join('\n')
      }
      return h(
        'div',
        {
          className: 'cc-conclusion-hoist',
          'data-cc-conclusion-hoist': '1',
          'data-cc-job-id': String(item.id || ''),
          'data-cc-turn-tail': '1',
        },
        h('div', {
          className: 'cc-conclusion',
          dangerouslySetInnerHTML: { __html: lightMdHtml(md + extra) },
        }),
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

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') {
        console.error('[cursor-chat] 无 slots，无法注册设置页')
        return
      }
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
      // 「已完成」下方、原生改动卡之前：挂回本轮结论（不改宿主 DOM）
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
      // 只挂 begin/continue：wait 用宿主通用行展示 chat_body，禁止再挂 form「正在开工」卡
      ;['zr_cchat_begin', 'zr_cchat_continue'].forEach(function (toolKey) {
        ctx.slots.inject('tool.call.toolview', function () {
          return ctx.slots.register(
            { name: 'tool.call.toolview', key: toolKey },
            CursorCodingBeginCard,
          )
        })
      })
      console.log('[cursor-chat] 已注册设置页 + 写码进度卡 + turnTail 结论')
    }

    module.exports = { inject: ['slots'], apply: apply }
    return module.exports
  },
})
