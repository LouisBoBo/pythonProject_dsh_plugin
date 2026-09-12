/**
 * DSH 客户端面：设置页「Cursor 写码」+ zr_cursor_begin / continue 交互卡。
 * 挂官方插槽 settings.section / tool.call.toolview；不自造壳。
 * 阶段 0：确认 → HITL → confirm → SSE；不调用 Cursor 改盘。
 */
window.__ModuleLoader__.load({
  id: '@zhongruan/dsh-cursor-coding',
  factory: (require) => {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useRef = React.useRef

    var SECRET_MASK = '••••••••••••'
    var LS_PORT = 'dsh-cursor-coding-port'
    var LS_HOST = 'dsh-cursor-coding-host'

    function servicePort() {
      try {
        var p = localStorage.getItem(LS_PORT)
        if (p && /^\d+$/.test(p)) return p
      } catch (e) {}
      return '18788'
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
        '.cc-card h4{margin:0 0 8px;font-size:14px}' +
        '.cc-card .cc-banner{padding:8px 10px;border-radius:8px;margin:0 0 10px;background:rgba(47,111,237,.08)}' +
        '.cc-card .cc-banner.warn{background:rgba(207,34,46,.08)}' +
        '.cc-stream{max-height:180px;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:pre-wrap;border:1px solid var(--color-border,rgba(127,127,127,.3));border-radius:8px;padding:8px;margin-top:8px}' +
        '.cc-phase{opacity:.75;font-size:12px;margin:0 0 8px}' +
        '.cc-review{margin-top:10px;border-top:1px solid var(--color-border,rgba(127,127,127,.3));padding-top:10px;max-height:240px;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}' +
        '.cc-review h5{margin:0 0 6px;font-size:13px}' +
        '.cc-check{display:flex;align-items:flex-start;gap:8px;margin:4px 0;font-size:12px}' +
        '.cc-check input{margin-top:2px}' +
        '.cc-check .tag{opacity:.65;margin-left:4px}' +
        '.cc-expand{margin-top:8px}' +
        '.cc-tabs{display:flex;gap:4px;flex-wrap:wrap;margin:10px 0 8px}' +
        '.cc-tab{padding:5px 10px;border-radius:7px;border:1px solid var(--color-border,rgba(127,127,127,.4));background:transparent;cursor:pointer;color:inherit;font:inherit;font-size:12px}' +
        '.cc-tab.active{background:var(--color-primary,#2f6fed);border-color:transparent;color:#fff}' +
        '.cc-body-wrap{margin-top:4px}' +
        '.cc-body-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin:0 0 6px;font-size:12px;opacity:.8}' +
        '.cc-body{max-height:min(50vh,420px);min-height:160px;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;border:1px solid var(--color-border,rgba(127,127,127,.35));border-radius:8px;padding:10px 12px;background:var(--color-bg-subtle,rgba(127,127,127,.06))}' +
        '.cc-body.empty{opacity:.55;font-style:italic}' +
        '.cc-quote{margin:4px 0 10px;padding:8px 10px;border:1px solid var(--color-border,rgba(127,127,127,.35));border-radius:8px;background:var(--color-bg-subtle,rgba(127,127,127,.06));font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;max-height:72px;overflow:auto}' +
        '.cc-quote.empty{opacity:.65;font-style:italic;max-height:none;min-height:0}' +
        '.cc-set-btn.primary:disabled{opacity:.45;cursor:not-allowed}' +
        '.cc-tools{max-height:280px;overflow:auto;margin-top:4px}' +
        '.cc-tool-row{display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border-bottom:1px solid var(--color-border,rgba(127,127,127,.2));font-size:12px}' +
        '.cc-tool-row .k{flex:0 0 auto;opacity:.65;min-width:64px}' +
        '.cc-tool-row .v{flex:1;word-break:break-all}' +
        '.cc-note{font-size:12px;opacity:.75;margin:6px 0 0}' +
        '.cc-dialog{height:min(52vh,480px);max-height:min(52vh,480px);min-height:180px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;border:1px solid var(--color-border,rgba(127,127,127,.3));border-radius:10px;padding:10px;background:var(--color-bg-subtle,rgba(127,127,127,.04));margin-top:6px;position:relative}' +
        '.cc-dialog::-webkit-scrollbar{width:8px}' +
        '.cc-dialog::-webkit-scrollbar-thumb{background:rgba(127,127,127,.45);border-radius:4px}' +
        '.cc-bubble{margin:0 0 12px;padding:0}' +
        '.cc-bubble .role{font-size:11px;opacity:.65;margin:0 0 4px;letter-spacing:.02em}' +
        '.cc-bubble.user .role{color:#2f6fed}' +
        '.cc-bubble.thinking details{border:1px dashed var(--color-border,rgba(127,127,127,.45));border-radius:8px;padding:6px 8px;background:rgba(127,127,127,.05)}' +
        '.cc-bubble.thinking summary{cursor:pointer;font-size:12px;opacity:.85}' +
        '.cc-bubble.thinking .body{margin-top:6px;white-space:pre-wrap;font-size:12px;line-height:1.5;opacity:.9;max-height:240px;overflow:auto;overscroll-behavior:contain}' +
        '.cc-bubble.assistant .body{white-space:pre-wrap;font-size:13px;line-height:1.55}' +
        '.cc-bubble.assistant .body h3{font-size:13px;margin:10px 0 4px}' +
        '.cc-bubble.tool{display:flex;gap:8px;align-items:flex-start;font-size:12px;padding:6px 8px;border-radius:8px;background:rgba(47,111,237,.06)}' +
        '.cc-bubble.tool .ico{opacity:.7}' +
        '.cc-bubble.status{font-size:12px;opacity:.85;margin:6px 0;display:flex;align-items:flex-start;gap:8px;line-height:1.45}' +
        '.cc-bubble.status.is-live{padding:8px 10px;border-radius:8px;background:rgba(47,111,237,.07);border:1px solid rgba(47,111,237,.18)}' +
        '.cc-spin{display:inline-block;width:12px;height:12px;border:2px solid rgba(47,111,237,.25);border-top-color:#2f6fed;border-radius:50%;animation:ccspin .7s linear infinite;flex:0 0 auto;margin-top:3px}' +
        '.cc-live-bar{display:flex;align-items:center;gap:10px;margin:0 0 8px;padding:8px 10px;border-radius:8px;background:rgba(47,111,237,.08);border:1px solid rgba(47,111,237,.2);font-size:12.5px}' +
        '.cc-live-bar .cc-spin{margin-top:0}' +
        '.cc-tool-desc{display:block;font-size:12px;line-height:1.45}' +
        '.cc-tool-desc .why{opacity:.9}' +
        '.cc-tool-desc .meta{opacity:.65;font-size:11px;margin-top:2px}' +
        '.cc-bubble.thinking.is-stream details{border-color:rgba(47,111,237,.45);background:rgba(47,111,237,.05)}' +
        '.cc-bubble.thinking.is-stream summary{color:#2f6fed}' +
        '.cc-steer{margin-top:10px;border-top:1px solid var(--color-border,rgba(127,127,127,.3));padding-top:10px}' +
        '.cc-done-panel{margin-top:12px;border-top:1px solid var(--color-border,rgba(127,127,127,.3));padding-top:12px}' +
        '.cc-done-panel h5{margin:0 0 8px;font-size:13px}' +
        '.cc-conclusion{white-space:pre-wrap;font-size:13px;line-height:1.55;padding:10px 12px;border-radius:8px;border:1px solid var(--color-border,rgba(127,127,127,.3));background:var(--color-bg-subtle,rgba(127,127,127,.05));max-height:280px;overflow:auto;overscroll-behavior:contain}' +
        '.cc-follow-hint{margin:10px 0 0;padding:8px 10px;border-radius:8px;background:rgba(47,111,237,.08);font-size:12.5px;line-height:1.5}' +
        '.cc-cursor{display:inline-block;width:7px;height:1em;background:currentColor;margin-left:2px;animation:ccblink 1s step-end infinite;vertical-align:text-bottom}' +
        '@keyframes ccblink{50%{opacity:0}}' +
        '@keyframes ccspin{to{transform:rotate(360deg)}}'
      if (!style) {
        style = document.createElement('style')
        style.id = 'cc-set-css'
        document.head.appendChild(style)
      }
      style.setAttribute('data-cc-css', '0.6.7')
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
        port: '18788',
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
          localStorage.setItem(LS_PORT, String(draft.port || '18788').trim())
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
              port: String(c.port || 18788),
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
              port: String(c.port || 18788),
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
        fetch(base() + '/api/cursor-coding/jobs/' + encodeURIComponent(jid))
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
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).then(
            function () {
              setJobMeta((jobMeta || '') + ' · 已复制')
            },
            function () {},
          )
        }
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
          '独立插件：在 DSH 聊天里确认后由 Cursor Local 改本机工程。过程与结论以工具结果正文回传（无确认卡）。可在下方按 job 回看。',
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
          h('p', { className: 'cc-set-hint' }, '密钥只存本机 ~/.zhongruan/cursor-coding/config.json（权限 600），不进项目仓库。'),
        ),
        h(
          'div',
          { className: 'cc-set-card' },
          h('h3', null, '2 · 本机服务'),
          field('监听端口', {
            value: draft.port,
            onChange: function (e) {
              setDraft(Object.assign({}, draft, { port: e.target.value }))
            },
          }),
          field('默认可写范围（可选，每行一个相对前缀）', {
            multiline: true,
            rows: 3,
            value: draft.writeScopeText,
            placeholder: '例如\nsrc/\napps/',
            onChange: function (e) {
              setDraft(Object.assign({}, draft, { writeScopeText: e.target.value }))
            },
          }),
          h(
            'p',
            { className: 'cc-set-hint' },
            '建议写目录前缀并以 / 结尾。只填单个文件时沙箱会自动加只读锚点/同级文件，同步仍仅限写范围内。',
          ),
          draft.dataRoot ? h('p', { className: 'cc-set-hint' }, '数据目录：' + draft.dataRoot) : null,
        ),
        h(
          'div',
          { className: 'cc-set-card' },
          h('h3', null, '3 · 回看 Cursor 正文（对照 IDE）'),
          field('job_id', {
            value: jobIdDraft,
            placeholder: '例如 ccj-20260911-201421-fb75',
            onChange: function (e) {
              setJobIdDraft(e.target.value)
            },
          }),
          h(
            'div',
            { className: 'cc-set-actions' },
            h(
              'button',
              { type: 'button', className: 'cc-set-btn primary', disabled: busy, onClick: loadJobBody },
              '加载正文',
            ),
            h(
              'button',
              { type: 'button', className: 'cc-set-btn', disabled: busy || !jobBody, onClick: copyJobBody },
              '复制全文',
            ),
          ),
          jobMeta ? h('p', { className: 'cc-set-hint' }, jobMeta) : null,
          h(
            'div',
            { className: 'cc-body' + (jobBody ? '' : ' empty') },
            jobBody || '加载后显示 Cursor SDK 返回的完整 assistant 正文（原样，非模型复述）。',
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
        if (value && value.cursor_coding_ui) return value.cursor_coding_ui
        if (props && props.result && props.result.cursor_coding_ui) return props.result.cursor_coding_ui
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

    /** 从 tool call argsRaw 取出 message */
    function toolArgsMessage(block) {
      if (!block) return ''
      var raw = ''
      if (typeof block.argsRaw === 'string') raw = block.argsRaw
      else if (block.call && typeof block.call.argsRaw === 'string') raw = block.call.argsRaw
      else if (block.arguments && typeof block.arguments === 'object') {
        return String(block.arguments.message || block.arguments.requirement || '').trim()
      }
      if (!raw) return ''
      try {
        var o = JSON.parse(raw)
        return String((o && (o.message || o.requirement)) || '').trim()
      } catch (e) {
        return ''
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
        var ui0 = readUiFromProps(props) || {}
        if (ui0.kind === 'await_ask_user' || ui0.kind === 'clarify') return true
        var block = props && props.block
        var value = block && (block.result || block.value || block.output)
        if (value && (value.need_clarify === true || value.need_clarify === 'true')) return true
        if (props && props.result && props.result.need_clarify) return true
      } catch (e) {}
      return false
    }

    function CursorCodingBeginCard(props) {
      ensureCss()
      var ui = readUiFromProps(props) || {}
      // 未澄清时不展示误导性等待卡（应走 ask_user_question）；若仍进到此分支则极简提示
      if (readAwaitAskUser(props) || ui.kind === 'await_ask_user' || ui.kind === 'clarify') {
        return null
      }
      var initialWs = resolveDshCwd(props) || String(ui.workspace || '').trim()
      var wsState = useState(initialWs)
      var workspace = wsState[0]
      var setWorkspace = wsState[1]
      var reqState = useState(initialRequirement(props, ui))
      var requirement = reqState[0]
      var setRequirement = reqState[1]
      var parentState = useState(String(ui.parent_job_id || ''))
      var parentJobId = parentState[0]
      var tokenState = useState(String(ui.confirm_token || ''))
      var confirmToken = tokenState[0]
      var setConfirmToken = tokenState[1]
      // pending_review 在自动同步时也是中间态，默认当 running，勿进人工审
      var phaseState = useState(ui.job_id ? 'running' : 'form')
      var phase = phaseState[0]
      var setPhase = phaseState[1]
      var busyState = useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var errState = useState('')
      var err = errState[0]
      var setErr = errState[1]
      var jobState = useState(String(ui.job_id || ''))
      var jobId = jobState[0]
      var setJobId = jobState[1]
      var streamState = useState('')
      var streamText = streamState[0]
      var setStreamText = streamState[1]
      var transcriptState = useState([])
      var transcript = transcriptState[0]
      var setTranscript = transcriptState[1]
      var statusLabelState = useState(
        ui.job_id ? (ui.status === 'pending_review' ? '自动同步中' : '写码中') : '',
      )
      var statusLabel = statusLabelState[0]
      var setStatusLabel = statusLabelState[1]
      var reviewState = useState({ inScope: [], deleted: [], deferred: [] })
      var review = reviewState[0]
      var setReview = reviewState[1]
      var selectedState = useState({})
      var selected = selectedState[0]
      var setSelected = selectedState[1]
      var expandState = useState('')
      var expandText = expandState[0]
      var setExpandText = expandState[1]
      var steerState = useState('')
      var steerText = steerState[0]
      var setSteerText = steerState[1]
      var reviewReadyRef = useRef(false)
      var esRef = useRef(null)
      var stickBottomRef = useRef(true)

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

      // 仅贴底时才跟随新内容；用户往上翻时不强制滚回
      useEffect(
        function () {
          try {
            var el = document.getElementById('cc-dialog-' + (jobId || 'x'))
            if (!el) return
            if (!stickBottomRef.current) return
            el.scrollTop = el.scrollHeight
          } catch (e) {}
        },
        [transcript, phase, jobId],
      )

      function onDialogScroll(e) {
        try {
          var el = e && e.currentTarget
          if (!el) return
          var gap = el.scrollHeight - el.scrollTop - el.clientHeight
          stickBottomRef.current = gap < 48
        } catch (err) {}
      }

      // begin 阻塞等待确认时：result 尚未返回，轮询 pending-latest 取 confirm_token
      useEffect(
        function () {
          if (phase !== 'form') return
          if (ui && ui.confirm_token) {
            setConfirmToken(String(ui.confirm_token))
            return
          }
          var ws = String(resolveDshCwd(props) || workspace || '').trim()
          if (!ws) return
          var stopped = false
          function pull() {
            if (stopped) return
            fetch(serviceBase() + '/api/cursor-coding/pending-latest?workspace=' + encodeURIComponent(ws))
              .then(function (r) {
                return r.json()
              })
              .then(function (d) {
                if (!d || !d.pending) return
                if (d.pending.confirm_token) setConfirmToken(String(d.pending.confirm_token))
                if (d.pending.requirement && !String(requirement || '').trim()) {
                  setRequirement(String(d.pending.requirement))
                }
                if (d.pending.job_id) {
                  setJobId(String(d.pending.job_id))
                  setPhase('running')
                  setStatusLabel('写码中')
                }
              })
              .catch(function () {})
          }
          pull()
          var t = setInterval(pull, 1200)
          return function () {
            stopped = true
            clearInterval(t)
          }
        },
        [phase, workspace, ui && ui.confirm_token],
      )

      // begin 已开工：挂 SSE 进度（不二次确认）
      useEffect(
        function () {
          var jid = String(jobId || (ui && ui.job_id) || '').trim()
          if (!jid) return
          if (esRef.current) return
          if (phase === 'form') {
            setPhase('running')
            setStatusLabel(String((ui && ui.status) || '') === 'pending_review' ? '自动同步中' : '写码中')
          }
          openStream(jid)
        },
        [jobId || (ui && ui.job_id)],
      )

      function applyJobSnapshot(job) {
        if (!job) return
        var st = String(job.status || '')
        if (st === 'succeeded' || st === 'failed' || st === 'cancelled') {
          setPhase('done')
          setStatusLabel(st === 'succeeded' ? '已完成' : st === 'failed' ? '失败' : '已取消')
        } else if (st === 'pending_review') {
          setPhase('running')
          setStatusLabel('自动同步中')
        } else if (st === 'running' || st === 'queued' || st === 'syncing') {
          setPhase('running')
          setStatusLabel(st === 'syncing' ? '自动同步中' : '写码中')
        }
        if (Array.isArray(job.transcript) && job.transcript.length) {
          setTranscript(job.transcript)
        }
      }

      function reconcileJob(jid) {
        var id = String(jid || jobId || '').trim()
        if (!id) return
        fetch(base() + '/api/cursor-coding/jobs/' + encodeURIComponent(id))
          .then(function (r) {
            return r.json()
          })
          .then(function (j) {
            if (j && (j.id || j.job_id || j.status)) applyJobSnapshot(j)
          })
          .catch(function () {})
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
        var url = base() + '/api/cursor-coding/jobs/' + encodeURIComponent(jid) + '/stream'
        var es = new EventSource(url)
        esRef.current = es
        es.onmessage = function (ev) {
          try {
            var data = JSON.parse(ev.data)
            if (data.type === 'hello') return
            if (data.type === 'snapshot') {
              if (Array.isArray(data.transcript)) {
                setTranscript(
                  data.transcript.map(function (it) {
                    if (!it || it.kind !== 'tool') return it
                    var st = String(it.tool_status || '').toLowerCase()
                    if (st === 'completed' || st === 'done' || st === 'success') {
                      return Object.assign({}, it, { tool_status: 'completed', streaming: false })
                    }
                    return it
                  }),
                )
              }
              if (data.status === 'pending_review') {
                // 自动同步中：保持 running，不要进人工审 UI
                setPhase('running')
                setStatusLabel('自动同步中')
                if (data.review_in_scope || data.review_deleted || data.review_deferred) {
                  setReview({
                    inScope: data.review_in_scope || [],
                    deleted: data.review_deleted || [],
                    deferred: data.review_deferred || [],
                  })
                }
              } else if (data.status === 'running' || data.status === 'queued' || data.status === 'syncing') {
                setPhase('running')
                setStatusLabel(data.status === 'syncing' ? '自动同步中' : '写码中')
              } else if (data.status === 'succeeded' || data.status === 'failed' || data.status === 'cancelled') {
                setPhase('done')
                setStatusLabel(
                  data.status === 'succeeded' ? '已完成' : data.status === 'failed' ? '失败' : '已取消',
                )
              } else if (data.status) {
                setStatusLabel(String(data.status))
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
            if (data.type === 'status' && data.message && String(data.message).indexOf('【本轮结论】') === 0) {
              appendStream(data.message)
              return
            }
            if (data.type === 'done') {
              var dst = String(data.status || 'done')
              appendStream('— 流结束：' + dst)
              if (dst === 'succeeded' || dst === 'failed' || dst === 'cancelled') {
                setPhase('done')
                setStatusLabel(dst === 'succeeded' ? '已完成' : dst === 'failed' ? '失败' : '已取消')
              } else {
                // done 事件状态异常时主动对账，避免卡在「自动同步中」
                reconcileJob(jid)
              }
              try {
                es.close()
              } catch (e2) {}
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

      // 运行中定期对账，防止 SSE 丢终态导致永远「同步中」
      useEffect(
        function () {
          if (phase !== 'running' || !jobId) return
          var t = setInterval(function () {
            reconcileJob(jobId)
          }, 4000)
          return function () {
            clearInterval(t)
          }
        },
        [phase, jobId],
      )

      function togglePath(path) {
        setSelected(function (prev) {
          var copy = Object.assign({}, prev)
          copy[path] = !copy[path]
          return copy
        })
      }

      function copyDialog() {
        var parts = []
        ;(transcript || []).forEach(function (it) {
          if (it.kind === 'thinking') parts.push('【Thinking】\n' + (it.text || ''))
          else if (it.kind === 'assistant') parts.push('【Assistant】\n' + (it.text || ''))
          else if (it.kind === 'user') parts.push('【You】\n' + (it.text || ''))
          else if (it.kind === 'tool')
            parts.push('【Tool】' + (it.name || '') + ' ' + (it.tool_status || '') + ' ' + (it.path || ''))
        })
        var t = parts.join('\n\n')
        if (t && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).catch(function () {})
        }
      }

      function renderMd(text) {
        var raw = String(text || '')
        // 极轻量：转义后还原 ** ` ##
        var esc = raw
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
        esc = esc.replace(/^##\s+(.+)$/gm, '<h3>$1</h3>')
        esc = esc.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        esc = esc.replace(/`([^`]+)`/g, '<code>$1</code>')
        return esc
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
          body: JSON.stringify({ action: 'cursor-coding.steer', job_id: jid }),
        })
          .then(function (r) {
            return r.json()
          })
          .then(function (issued) {
            if (!issued || !issued.ok || !issued.nonce) {
              throw new Error((issued && issued.detail) || '签发 steer HITL 失败')
            }
            return fetch(base() + '/api/cursor-coding/jobs/' + encodeURIComponent(jid) + '/steer', {
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
          body: JSON.stringify({ action: 'cursor-coding.apply', job_id: jid }),
        })
          .then(function (r) {
            return r.json()
          })
          .then(function (issued) {
            if (!issued || !issued.ok || !issued.nonce) {
              throw new Error((issued && issued.detail) || '签发 apply HITL 失败')
            }
            return fetch(base() + '/api/cursor-coding/jobs/' + encodeURIComponent(jid) + '/apply', {
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
            setPhase('done')
            if (esRef.current && typeof esRef.current.close === 'function') {
              try {
                esRef.current.close()
              } catch (e4) {}
            }
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
            action: 'cursor-coding.confirm',
            workspace: ws,
            requirement: req,
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
            return fetch(base() + '/api/cursor-coding/confirm', {
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
            setJobId(jid)
            setPhase('running')
            setStreamText('')
            setTranscript([])
            setSteerText('')
            reviewReadyRef.current = false
            setStatusLabel('写码中')
            appendStream('已确认 ' + jid)
            openStream(jid)
            // 过程开始后先把确认卡滚入视口；结束后再滚到正文结论
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
        try {
          var card = document.querySelector('.cc-card')
          if (!card) return
          var node = card.parentElement
          var scrolled = false
          while (node && node !== document.body) {
            var st = window.getComputedStyle(node)
            var oy = st && st.overflowY
            if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && node.scrollHeight > node.clientHeight + 8) {
              if (force || stickBottomRef.current) {
                node.scrollTop = node.scrollHeight
                scrolled = true
              }
            }
            node = node.parentElement
          }
          if (!scrolled && force) {
            try {
              card.scrollIntoView({ block: 'end', behavior: 'smooth' })
            } catch (e2) {}
          }
        } catch (e) {}
      }

      // 终态后持续把聊天滚到下方，确保 finish 输出的「本轮结论」可见
      useEffect(
        function () {
          if (phase !== 'done') return
          scrollChatTowardBottom(true)
          var n = 0
          var t = setInterval(function () {
            n += 1
            scrollChatTowardBottom(true)
            if (n >= 20) clearInterval(t)
          }, 800)
          return function () {
            clearInterval(t)
          }
        },
        [phase],
      )

      var kind = (ui && ui.kind) || 'live'
      var title =
        (ui && ui.job_id) || phase === 'running' || phase === 'review' || phase === 'done'
          ? 'Cursor 写码 · 进度'
          : kind === 'continue'
            ? 'Cursor 写码 · 续改'
            : 'Cursor 写码 · 确认'
      var canStart = Boolean(String(workspace || '').trim() && String(requirement || '').trim())

      var statusZh = (function () {
        var s = String(statusLabel || phase || '')
        if (s === 'running' || s === 'queued') return '写码中'
        if (s === 'pending_review' || s === '待审同步') return '待审同步'
        if (s === 'succeeded' || s === 'done' || s === '已完成') return '已完成'
        if (s === 'failed') return '失败'
        if (s === 'cancelled') return '已取消'
        return s || '准备中'
      })()

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

      function toolExplain(name, path, status) {
        var n = String(name || '').toLowerCase()
        var p = shortPath(path)
        var st = String(status || '').toLowerCase()
        var done = st === 'completed' || st === 'done' || st === 'success'
        var why = done ? '已调用工具' : '正在调用工具'
        if (n === 'glob' || n.indexOf('glob') >= 0) why = done ? '已搜索工程文件' : '正在按文件名模式搜索工程文件'
        else if (n === 'grep' || n === 'rg' || n.indexOf('search') >= 0)
          why = done ? '已搜索代码内容' : '正在搜索代码内容，定位相关实现'
        else if (n === 'read' || n === 'readfile' || n.indexOf('read') >= 0)
          why = done ? '已阅读文件' : '正在阅读文件，理解现有写法'
        else if (n === 'write' || n === 'edit' || n.indexOf('write') >= 0 || n.indexOf('strreplace') >= 0)
          why = done ? '已修改/写入代码' : '正在修改/写入代码'
        else if (n === 'shell' || n === 'bash' || n === 'terminal')
          why = done ? '已执行终端命令' : '正在执行终端命令'
        else if (n === 'task' || n.indexOf('task') >= 0)
          why = done ? '已完成子任务摸底' : '正在拆分子任务，并行摸清结构'
        else if (n === 'ls' || n === 'list' || n.indexOf('dir') >= 0)
          why = done ? '已查看目录结构' : '正在查看目录结构'
        else if (n.indexOf('delete') >= 0 || n === 'rm') why = done ? '已删除文件' : '正在删除文件'
        var stZh = done ? '已完成' : st === 'running' || st === 'in_progress' ? '进行中' : st === 'error' || st === 'failed' ? '失败' : st || ''
        return { why: why, path: p, statusZh: stZh, done: done }
      }

      function renderTranscript() {
        if (!transcript || !transcript.length) {
          return h(
            'div',
            { className: 'cc-live-bar' },
            h('span', { className: 'cc-spin', 'aria-hidden': 'true' }),
            h('span', null, '正在连接 Cursor 并准备写码，请稍候…'),
          )
        }
        return transcript.map(function (it) {
          if (it.kind === 'user') {
            return h(
              'div',
              { key: it.id, className: 'cc-bubble user' },
              h('div', { className: 'role' }, '你'),
              h('div', { className: 'body' }, it.text || ''),
            )
          }
          if (it.kind === 'thinking') {
            var streaming = !!it.streaming
            return h(
              'div',
              { key: it.id, className: 'cc-bubble thinking' + (streaming ? ' is-stream' : '') },
              h(
                'details',
                { open: streaming },
                h(
                  'summary',
                  null,
                  (streaming ? '思考中…' : '思考过程') +
                    (it.thinking_duration_ms ? ' · ' + Math.round(it.thinking_duration_ms / 1000) + '秒' : '') +
                    (streaming ? '' : '（点击展开）'),
                ),
                h('div', { className: 'body' }, it.text || ''),
              ),
            )
          }
          if (it.kind === 'tool') {
            var info = toolExplain(it.name, it.path, it.tool_status)
            var live = !info.done && String(it.tool_status || '').toLowerCase() === 'running'
            return h(
              'div',
              { key: it.id, className: 'cc-bubble tool' },
              live ? h('span', { className: 'cc-spin', 'aria-hidden': 'true' }) : h('span', { className: 'ico' }, '⚙'),
              h(
                'span',
                { className: 'cc-tool-desc' },
                h('span', { className: 'why' }, info.why + (info.statusZh ? ' · ' + info.statusZh : '')),
                info.path || it.name
                  ? h('div', { className: 'meta' }, (it.name || 'tool') + (info.path ? ' · ' + info.path : ''))
                  : null,
              ),
            )
          }
          if (it.kind === 'assistant') {
            // 卡片只保留过程；说明方案/结论只在聊天正文（finish）输出
            return null
          }
          if (it.kind === 'status') {
            var msg = String(it.text || '')
            if (/【本轮结论】|^##\s*本轮结论|说明方案/.test(msg)) return null
            if (/^RUNNING$/i.test(msg.trim())) msg = 'Cursor 运行中，请稍候…'
            var busy =
              /启动|改码|准备|沙箱|RUNNING|running|同步|Cursor|请稍候/i.test(msg) &&
              phase !== 'done'
            return h(
              'div',
              { key: it.id, className: 'cc-bubble status' + (busy ? ' is-live' : '') },
              busy ? h('span', { className: 'cc-spin', 'aria-hidden': 'true' }) : null,
              h('span', null, msg),
            )
          }
          return null
        })
      }

      return h(
        'div',
        { className: 'cc-card' },
        h('h4', null, title),
        h(
          'p',
          { className: 'cc-phase' },
          (ui && ui.job_id) || phase === 'running' || phase === 'review' || phase === 'done'
            ? '本卡只展示过程（思考/工具）。完整结论与追问引导会在对话正文中给出。'
            : '请确认工作区与诉求。点确认前不会写码；点「确认并用 Cursor 开写」后才开始。',
        ),
        phase === 'running' && (statusZh === '写码中' || statusZh === '自动同步中' || statusZh === '准备中')
          ? h(
              'div',
              { className: 'cc-live-bar' },
              h('span', { className: 'cc-spin', 'aria-hidden': 'true' }),
              h(
                'span',
                null,
                statusZh === '自动同步中'
                  ? '正在自动同步并刷新前端，请稍候…'
                  : 'Cursor 仍在处理（' + statusZh + '），过程见下方，请勿关闭本页…',
              ),
            )
          : null,
        ui.stage
          ? h('div', { className: 'cc-banner' }, '服务：' + base() + ' · stage=' + ui.stage)
          : null,
        phase === 'form'
          ? h(
              'div',
              null,
              h(
                'div',
                { className: 'cc-set-field' },
                h('label', null, '工作区（当前会话）'),
                h(
                  'p',
                  {
                    className: 'cc-set-hint',
                    style: { margin: '4px 0 10px', wordBreak: 'break-all', opacity: workspace ? 1 : 0.75 },
                  },
                  workspace || '未绑定——请先在侧栏打开工程目录',
                ),
              ),
              h(
                'div',
                { className: 'cc-set-field' },
                h('label', null, '写码诉求（你的原话）'),
                h(
                  'div',
                  { className: 'cc-quote' + (requirement ? '' : ' empty') },
                  requirement || '（空——请在对话里说明要改什么，或新开一轮让助手带上原话）',
                ),
              ),
              parentJobId ? h('p', { className: 'cc-set-hint' }, '续改 parent：' + parentJobId) : null,
              err ? h('p', { className: 'cc-set-msg err' }, err) : null,
              !canStart && !err
                ? h(
                    'p',
                    { className: 'cc-set-msg err' },
                    !workspace
                      ? '当前会话没有工作区，请先在侧栏打开工程。'
                      : '诉求为空，按钮已禁用。请再说一句写码需求，或硬刷新后重试。',
                  )
                : null,
              h(
                'div',
                { className: 'cc-set-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'cc-set-btn primary',
                    disabled: busy || !canStart,
                    onClick: onConfirm,
                  },
                  busy ? '提交中…' : '确认并用 Cursor 开写',
                ),
              ),
            )
          : null,
        phase === 'running' || phase === 'review' || phase === 'done'
          ? h(
              'div',
              null,
              h(
                'div',
                { className: 'cc-body-meta' },
                h(
                  'span',
                  null,
                  '任务 ' +
                    (jobId || '—') +
                    ' · ' +
                    statusZh +
                    ' · 片段 ' +
                    String((transcript || []).length),
                ),
                h(
                  'button',
                  { type: 'button', className: 'cc-set-btn', onClick: copyDialog },
                  '复制对话',
                ),
              ),
              h('div', {
                className: 'cc-dialog',
                id: 'cc-dialog-' + (jobId || 'x'),
                onScroll: onDialogScroll,
              }, renderTranscript()),
              phase === 'done'
                ? h(
                    'div',
                    { className: 'cc-done-panel' },
                    h(
                      'p',
                      { className: 'cc-note' },
                      '本卡过程已结束。结论正在输出到下方对话正文，请向下查看；如需调整，直接在对话框回复即可。',
                    ),
                    err ? h('p', { className: 'cc-set-msg err' }, err) : null,
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
              h('details', null, h('summary', null, '任务日志'), h('div', { className: 'cc-stream' }, streamText || '—')),
            )
          : null,
      )
    }

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') {
        console.error('[cursor-coding] 无 slots，无法注册设置页')
        return
      }
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          {
            name: 'settings.section',
            id: 'cursor-coding',
            order: 7,
            label: 'Cursor 写码',
          },
          CursorCodingSettingsSection,
        )
      })
      ctx.slots.inject('tool.call.toolview', function () {
        return ctx.slots.register(
          { name: 'tool.call.toolview', key: 'zr_cursor_begin' },
          CursorCodingBeginCard,
        )
      })
      ctx.slots.inject('tool.call.toolview', function () {
        return ctx.slots.register(
          { name: 'tool.call.toolview', key: 'zr_cursor_continue' },
          CursorCodingBeginCard,
        )
      })
      console.log('[cursor-coding] 已注册设置页 + 写码进度工具卡')
    }

    module.exports = { inject: ['slots'], apply: apply }
    return module.exports
  },
})
