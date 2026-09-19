/**
 * 左侧栏「专家·技能·连接器」：与设置/知识库/自动化并列。
 */
window.__ModuleLoader__.load({
  id: '@zhongruan/dsh-esc',
  factory: (require) => {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect

    var PLUGIN_ID = '@zhongruan/dsh-esc'
    var WORKSPACE_EVENT = '@lemoncat7/dsh-plugin-ui/workspace-activate'

    function servicePort() {
      try {
        var p = localStorage.getItem('dsh-esc-port')
        if (p && /^\d+$/.test(p)) return p
      } catch (e) {}
      return '18786'
    }
    function serviceBase() {
      return 'http://127.0.0.1:' + servicePort()
    }
    function rememberPort(port) {
      try {
        if (port) localStorage.setItem('dsh-esc-port', String(port))
      } catch (e) {}
    }
    function fetchJson(url, opts) {
      opts = opts || {}
      return fetch(url, Object.assign({ cache: 'no-store', signal: AbortSignal.timeout(30000) }, opts)).then(function (r) {
        return r.text().then(function (text) {
          var d = {}
          try {
            d = text ? JSON.parse(text) : {}
          } catch (e) {
            d = { ok: false, detail: text.slice(0, 200) || '非 JSON' }
          }
          return { http: r.status, ok: r.ok && d && d.ok !== false, d: d }
        })
      })
    }

    var ESC_CSS =
      ':has(> .esc-launcher),:has(> div > .esc-launcher){flex-wrap:wrap}' +
      ':has(> .esc-launcher--rail),:has(> div > .esc-launcher--rail){flex-direction:column;align-items:center}' +
      '.esc-launcher{display:flex;flex:0 0 calc(100% + 4px);order:-1;min-width:0;gap:4px;width:calc(100% + 4px);margin:4px -2px;box-sizing:border-box}' +
      '.esc-launcher--rail{flex:none;width:36px;margin:8px 0 10px;flex-direction:column;align-items:center}' +
      '.esc-trigger{position:relative;flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:8px;height:36px;margin:0;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:14px;line-height:22px;white-space:nowrap}' +
      '.esc-trigger:hover{background:var(--surface-hover,rgba(127,127,127,.12))}' +
      '.esc-trigger.is-active{background:var(--surface-hover,rgba(127,127,127,.16))}' +
      '.esc-trigger--rail{width:36px;height:36px;padding:0;justify-content:center;border-radius:50%}' +
      '.esc-root{--esc-bg:#fff;--esc-bg2:#f3f4f6;--esc-text:#111827;--esc-text2:#6b7280;--esc-text3:#9ca3af;--esc-border:#eceff3;--esc-brand:#111827;--esc-radius:16px;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--esc-bg2);color:var(--esc-text);font-family:system-ui,"PingFang SC","Noto Sans SC",sans-serif;font-size:13px;line-height:1.5}' +
      '.esc-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px 10px;background:var(--esc-bg);border-bottom:1px solid var(--esc-border);flex-shrink:0}' +
      '.esc-tabs{display:flex;gap:18px;align-items:center}' +
      '.esc-tab{padding:6px 0;border:none;background:transparent;color:var(--esc-text2);cursor:pointer;font:inherit;font-size:14px;position:relative}' +
      '.esc-tab.on{color:var(--esc-text);font-weight:600}' +
      '.esc-tab.on:after{content:"";position:absolute;left:0;right:0;bottom:-10px;height:2px;background:#111827;border-radius:1px}' +
      '.esc-search{flex:1;max-width:280px;height:34px;border:1px solid var(--esc-border);border-radius:18px;padding:0 12px;font:inherit;background:#f9fafb}' +
      '.esc-body{flex:1;overflow:auto;padding:16px 20px 32px}' +
      '.esc-banner{padding:10px 12px;border-radius:10px;background:#fff;color:var(--esc-text2);margin-bottom:14px;border:1px solid var(--esc-border)}' +
      '.esc-error{padding:10px 12px;border-radius:8px;background:#fef2f2;color:#dc2626;margin-bottom:16px}' +
      '.esc-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}' +
      '.esc-chip{border:1px solid var(--esc-border);background:#fff;border-radius:16px;padding:4px 12px;font:inherit;cursor:pointer;color:var(--esc-text2)}' +
      '.esc-chip.on{background:#111827;color:#fff;border-color:#111827}' +
      '.esc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start}' +
      '.esc-card{text-align:left;padding:16px;border:1px solid var(--esc-border);border-radius:var(--esc-radius);background:#fff;display:flex;flex-direction:column;gap:8px;min-height:0}' +
      '.esc-card-skill{gap:0;padding:14px 16px;cursor:pointer}' +
      '.esc-card-skill:hover{border-color:#d1d5db}' +
      '.esc-card-conn{height:200px;box-sizing:border-box;gap:6px}' +
      '.esc-card-extra{flex:1;min-height:0;overflow:hidden}' +
      '.esc-card-conn .esc-hint{margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      '.esc-card-conn .esc-actions{margin-top:auto}' +
      '.esc-card-conn .esc-field{gap:4px}' +
      '.esc-card-conn .esc-field input{padding:6px 10px}' +
      '.esc-card-hd{display:flex;gap:12px;align-items:flex-start}' +
      '.esc-avatar{width:44px;height:44px;border-radius:50%;object-fit:cover;background:#e5e7eb;flex-shrink:0}' +
      '.esc-avatar.sq{border-radius:12px}' +
      '.esc-card h3{margin:0;font-size:15px;font-weight:650}' +
      '.esc-muted{margin:0;color:var(--esc-text2);font-size:12px}' +
      '.esc-desc{margin:0;color:var(--esc-text3);font-size:12px;line-height:1.55;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      '.esc-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto}' +
      '.esc-tag{font-size:11px;padding:2px 8px;border-radius:999px;background:#f3f4f6;color:#4b5563}' +
      '.esc-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:auto}' +
      '.esc-summon{border:0;border-radius:16px;padding:6px 14px;background:#111827;color:#fff;cursor:pointer;font:inherit;font-size:12px;font-weight:600}' +
      '.esc-summon.on{background:#166534;color:#fff}' +
      '.esc-banner{margin:0 0 12px;padding:10px 12px;border-radius:10px;background:#ecfdf3;color:#14532d;font-size:13px;font-weight:600}' +
      '.esc-plus{width:28px;height:28px;border:0;border-radius:8px;background:#f3f4f6;cursor:pointer;font:inherit;font-size:18px;line-height:1;color:#374151}' +
      '.esc-plus.on{background:#dcfce7;color:#166534}' +
      '.esc-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:14px 16px;border:1px solid var(--esc-border);border-radius:var(--esc-radius);background:#fff;margin-bottom:10px}' +
      '.esc-btn{padding:7px 12px;border-radius:8px;border:1px solid var(--esc-border);background:#fff;cursor:pointer;font:inherit}' +
      '.esc-btn.primary{background:#111827;border-color:transparent;color:#fff}' +
      '.esc-btn:disabled{opacity:.5;cursor:not-allowed}' +
      '.esc-field{display:flex;flex-direction:column;gap:6px;margin:0}' +
      '.esc-field input,.esc-field select{padding:8px 10px;border-radius:8px;border:1px solid var(--esc-border);font:inherit}' +
      '.esc-hint{font-size:12px;color:var(--esc-text3);margin:0 0 12px}' +
      '.esc-toast{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483000;padding:8px 14px;border-radius:8px;background:#111827;color:#fff}' +
      '.esc-card.summoned{outline:2px solid #86efac}' +
      '.esc-toast.ok{background:#166534}' +
      '.esc-toast.err{background:#991b1b}' +
      '.esc-toolbar{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0 0 12px}' +
      '.esc-issue{margin:6px 0 0;padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.5}' +
      '.esc-issue.err{background:#fef2f2;color:#991b1b}' +
      '.esc-issue.warn{background:#fffbeb;color:#92400e}' +
      '.esc-modal{position:fixed;inset:0;z-index:2147483001;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px}' +
      '.esc-dialog{width:min(560px,100%);max-height:86vh;overflow:auto;background:#fff;border-radius:16px;padding:18px;color:#111}' +
      '.esc-detail{position:relative;width:min(520px,100%);max-height:86vh;overflow:auto;background:#fff;border-radius:24px;padding:22px 24px 24px;color:#111}' +
      '.esc-detail-close{position:absolute;top:16px;right:16px;width:32px;height:32px;border:0;border-radius:50%;background:transparent;cursor:pointer;font-size:20px;line-height:1;color:#6b7280}' +
      '.esc-detail-close:hover{background:#f3f4f6}' +
      '.esc-detail-hd{display:flex;gap:14px;align-items:center;padding-right:36px}' +
      '.esc-detail-hd .esc-avatar{width:56px;height:56px;border-radius:16px}' +
      '.esc-detail h2{margin:0;font-size:22px;font-weight:700}' +
      '.esc-detail-install{margin:14px 0 0;border:0;border-radius:22px;padding:8px 18px;background:#111827;color:#fff;cursor:pointer;font:inherit;font-size:14px;font-weight:650}' +
      '.esc-detail-install.on{background:#dcfce7;color:#166534}' +
      '.esc-detail-lead{margin:14px 0 0;color:#4b5563;font-size:14px;line-height:1.65}' +
      '.esc-detail-sec{margin:22px 0 8px;display:flex;align-items:center;gap:8px;color:#6b7280;font-size:13px;font-weight:600}' +
      '.esc-detail-pill{margin:0;padding:10px 14px;border-radius:12px;background:#f3f4f6;color:#111827;font-size:13px}' +
      '.esc-detail-tags{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}' +
      '.esc-detail-sop{margin:8px 0 0;padding:12px 14px;border-radius:12px;background:#f9fafb;white-space:pre-wrap;font-size:12px;line-height:1.65;max-height:36vh;overflow:auto}' +
      '.esc-check{display:flex;align-items:flex-start;gap:8px;margin:6px 0;font-size:13px}' +
      '.esc-scene-chip-wrap{position:relative;display:inline-flex}' +
      '.esc-scene-chip{height:28px;max-width:176px;border:1px solid var(--border, #e5e7eb);border-radius:8px;padding:0 10px;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.esc-scene-chip.on{background:#ecfdf3;border-color:#86efac;color:#14532d}' +
      '.esc-scene-chip-menu{position:absolute;bottom:34px;left:0;z-index:50;width:280px;max-height:min(380px,70vh);overflow:auto;background:var(--dialog-surface,#fff);color:var(--text,#111);border:1px solid var(--border,#e5e7eb);border-radius:16px;box-shadow:0 12px 32px rgba(0,0,0,.14);padding:8px}' +
      '.esc-scene-chip-search{display:flex;align-items:center;gap:8px;margin:2px 4px 8px;padding:8px 10px;border-radius:10px;background:rgba(127,127,127,.1)}' +
      '.esc-scene-chip-search input{border:0;outline:0;background:transparent;width:100%;min-width:0;color:inherit;font:inherit;font-size:13px}' +
      '.esc-scene-chip-search input::placeholder{color:var(--text-tertiary,#9ca3af)}' +
      '.esc-scene-chip-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:8px 10px;border-radius:10px;cursor:pointer;font:inherit;font-size:14px}' +
      '.esc-scene-chip-row:hover,.esc-scene-chip-row.on{background:rgba(127,127,127,.12)}' +
      '.esc-scene-chip-ava{width:32px;height:32px;border-radius:50%;object-fit:cover;flex:none;background:#e5e7eb}' +
      '.esc-scene-chip-ava.letter{display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700}' +
      '.esc-scene-chip-empty{padding:16px 10px;font-size:13px;color:var(--text-tertiary,#9ca3af)}' +
      '.esc-scene-chip-foot{margin-top:4px;padding-top:6px;border-top:1px solid var(--border,#e5e7eb)}' +
      '.esc-scene-chip-more{color:var(--text-secondary,#6b7280);font-size:13px}' +
      '@media (max-width:900px){.esc-grid{grid-template-columns:1fr}}'

    function ensureCss() {
      if (typeof document === 'undefined') return
      var style = document.getElementById('esc-ui-css')
      if (!style) {
        style = document.createElement('style')
        style.id = 'esc-ui-css'
        document.head.appendChild(style)
      }
      style.textContent = ESC_CSS
    }

    function svgEl(attrs, children) {
      return React.createElement.apply(React, ['svg', attrs].concat(children || []))
    }
    function EscIcon(size) {
      size = size || 16
      return svgEl({ width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, [
        h('circle', { cx: '6', cy: '6', r: '2.2', stroke: 'currentColor', strokeWidth: '1.2' }),
        h('rect', { x: '9.2', y: '8.8', width: '4.4', height: '4.4', rx: '1', stroke: 'currentColor', strokeWidth: '1.2' }),
        h('path', { d: 'M8 6h3.5M6 8v3', stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round' }),
      ])
    }

    function activatePluginWorkspace(pluginId) {
      window.dispatchEvent(new CustomEvent(WORKSPACE_EVENT, { detail: { pluginId: pluginId } }))
    }
    function observePluginWorkspace(pluginId, close) {
      function onActivate(event) {
        var detail = event.detail
        if (!detail || detail.pluginId !== pluginId) close()
      }
      window.addEventListener(WORKSPACE_EVENT, onActivate)
      return function () {
        window.removeEventListener(WORKSPACE_EVENT, onActivate)
      }
    }
    function registerMainPanel(ctx, id, priority, render, onHidden) {
      var layout = ctx.layout
      if (!layout || typeof layout.selectPanel !== 'function') {
        return ctx.slots.register({ name: 'conversation', priority: priority }, render)
      }
      var disposed = false
      var generation = 0
      function Body() {
        useEffect(function () {
          var current = ++generation
          return function () {
            queueMicrotask(function () {
              if (!disposed && generation === current && typeof onHidden === 'function') onHidden()
            })
          }
        }, [])
        return render()
      }
      var remove = ctx.slots.register({ name: 'main', key: id }, Body)
      var dispose = function () {
        if (disposed) return
        disposed = true
        remove()
      }
      try {
        layout.selectPanel(id)
      } catch (err) {
        dispose()
        throw err
      }
      return dispose
    }

    function Toast(props) {
      if (!props.text) return null
      return h('div', { className: 'esc-toast' + (props.ok ? ' ok' : props.ok === false ? ' err' : '') }, props.text)
    }

    function EscView() {
      var tabState = useState('scenes')
      var tab = tabState[0]
      var setTab = tabState[1]
      var qState = useState('')
      var q = qState[0]
      var setQ = qState[1]
      var chipState = useState('全部')
      var chip = chipState[0]
      var setChip = chipState[1]
      var dataState = useState(null)
      var data = dataState[0]
      var setData = dataState[1]
      var errState = useState('')
      var err = errState[0]
      var setErr = errState[1]
      var toastState = useState(null)
      var toast = toastState[0]
      var setToast = toastState[1]
      var busyState = useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var draftsState = useState({})
      var drafts = draftsState[0]
      var setDrafts = draftsState[1]
      var createState = useState(null)
      var create = createState[0]
      var setCreate = createState[1]
      var skillDetailState = useState(null)
      var skillDetailId = skillDetailState[0]
      var setSkillDetailId = skillDetailState[1]
      var reviewState = useState(null)
      var liveReview = reviewState[0]
      var setLiveReview = reviewState[1]

      function toastMsg(ok, text) {
        setToast({ ok: ok, text: text })
        setTimeout(function () {
          setToast(null)
        }, 3600)
      }

      function loadAll() {
        return Promise.all([
          fetchJson(serviceBase() + '/api/catalog'),
          fetchJson(serviceBase() + '/api/session-state'),
          fetchJson(serviceBase() + '/health'),
        ]).then(function (rows) {
          if (!rows[0].ok) throw new Error(rows[0].d.detail || '目录加载失败')
          var catalog = rows[0].d
          var state = (rows[1].ok && rows[1].d.state) || {}
          if (rows[2].ok && rows[2].d.view && rows[2].d.view.port) rememberPort(rows[2].d.view.port)
          setData({ catalog: catalog, state: state, health: rows[2].ok ? rows[2].d : null, draft: rows[1].ok ? rows[1].d.draft : null })
          setDrafts(Object.assign({}, state.connectors || {}))
          setErr('')
        }).catch(function (e) {
          setErr(String(e.message || e) + '。请确认宿主已加载插件，本机 18786 在听。')
          throw e
        })
      }

      useEffect(function () {
        loadAll()
      }, [])

      useEffect(
        function () {
          if (!create) {
            setLiveReview(null)
            return
          }
          var cancelled = false
          fetchJson(serviceBase() + '/api/scenes/review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              expertId: create.expertId,
              skillIds: create.skillIds,
              connectorIds: create.connectorIds,
            }),
          }).then(function (r) {
            if (!cancelled) setLiveReview(r.d.review || null)
          })
          return function () {
            cancelled = true
          }
        },
        [create && create.expertId, create && (create.skillIds || []).join(','), create && (create.connectorIds || []).join(',')],
      )

      function run(fn, okText) {
        setBusy(true)
        return Promise.resolve()
          .then(fn)
          .then(function () {
            return loadAll()
          })
          .then(function () {
            setBusy(false)
            if (okText) toastMsg(true, okText)
          })
          .catch(function (e) {
            setBusy(false)
            toastMsg(false, String(e.message || e))
          })
      }

      if (!data) {
        return h('div', { className: 'esc-root' }, [
          h('div', { className: 'esc-body' }, err ? h('div', { className: 'esc-error' }, err) : '正在连接本机服务…'),
        ])
      }

      var catalog = data.catalog
      var state = data.state || {}
      var expertId = state.sessionExpertId || state.activeExpertId || ''
      var summonedIds = (state.summonedSceneIds || []).slice()
      var summonedExpertIds = (state.summonedExpertIds || []).slice()
      var skills = state.skills || {}
      var connectors = state.connectors || {}
      var limits = catalog.limits || { maxSkills: 3, maxConnectors: 3 }

      function issueList(review) {
        if (!review) return null
        var items = [].concat(review.errors || [], review.warnings || [])
        if (!items.length) return h('p', { className: 'esc-hint' }, '组合可用：1 位专家，技能/连接器未超限，必选连接器已齐。')
        return items.map(function (it, i) {
          return h('div', { key: it.code + i, className: 'esc-issue ' + (it.level === 'error' ? 'err' : 'warn') }, it.message)
        })
      }

      function toggleId(list, id, max) {
        var has = list.indexOf(id) >= 0
        if (has) return list.filter(function (x) { return x !== id })
        if (list.length >= max) return list
        return list.concat([id])
      }

      function openCreate(prefill) {
        setCreate({
          title: (prefill && prefill.title) || '',
          expertId: (prefill && prefill.expertId) || expertId || ((catalog.experts[0] && catalog.experts[0].id) || ''),
          skillIds: (prefill && prefill.skillIds) || [],
          connectorIds: (prefill && prefill.connectorIds) || [],
        })
      }

      function saveCreate() {
        if (!create) return
        run(function () {
          return fetchJson(serviceBase() + '/api/scenes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(create),
          }).then(function (r) {
            if (!r.ok) {
              setLiveReview(r.d.review || null)
              throw new Error(r.d.detail || '创建失败')
            }
            setCreate(null)
          })
        }, '已保存场景卡')
      }

      function removeScene(id) {
        if (!window.confirm('删除这张自建场景卡？')) return
        run(function () {
          return fetchJson(serviceBase() + '/api/scenes/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (r) {
            if (!r.ok) throw new Error(r.d.detail || '删除失败')
          })
        }, '已删除')
      }

      function toggleSummon(id, title, summoned) {
        run(function () {
          return fetchJson(serviceBase() + (summoned ? '/api/scenes/unsummon' : '/api/scenes/summon'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneId: id }),
          }).then(function (r) {
            if (!r.ok) throw new Error(r.d.detail || (summoned ? '取消召唤失败' : '召唤失败'))
          })
        }, summoned ? '已取消召唤「' + (title || id) + '」' : '已召唤「' + (title || id) + '」，可在对话中选用')
      }

      function toggleSummonExpert(id, title, summoned) {
        run(function () {
          return fetchJson(serviceBase() + (summoned ? '/api/experts/unsummon' : '/api/experts/summon'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expertId: id }),
          }).then(function (r) {
            if (!r.ok) throw new Error(r.d.detail || (summoned ? '取消召唤失败' : '召唤失败'))
          })
        }, summoned ? '已取消召唤「' + (title || id) + '」' : '已召唤「' + (title || id) + '」')
      }

      function toggleSkill(id, enabled) {
        run(function () {
          return fetchJson(serviceBase() + '/api/session-state', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skillId: id, enabled: enabled }),
          }).then(function (r) {
            if (!r.ok) throw new Error(r.d.detail || '更新失败')
          })
        })
      }

      function saveConnector(id) {
        run(function () {
          var draft = drafts[id] || {}
          return fetchJson(serviceBase() + '/api/connectors/' + id + '/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft),
          }).then(function (r) {
            if (!r.ok) throw new Error(r.d.detail || '保存失败')
            toastMsg(true, '已保存 ' + id)
          })
        })
      }

      function testConnector(id) {
        run(function () {
          return fetchJson(serviceBase() + '/api/connectors/' + id + '/test', { method: 'POST' }).then(function (r) {
            var detail = (r.d.result && r.d.result.detail) || r.d.detail || ''
            if (!r.ok) throw new Error(detail || '测通失败')
            toastMsg(true, detail || '连通')
          })
        })
      }

      function hit(text) {
        var needle = (q || '').trim().toLowerCase()
        if (!needle) return true
        return String(text || '').toLowerCase().indexOf(needle) >= 0
      }

      function Avatar(src, letter, sq) {
        if (src) {
          return h('img', {
            className: 'esc-avatar' + (sq ? ' sq' : ''),
            src: src,
            alt: '',
            referrerPolicy: 'no-referrer',
          })
        }
        return h(
          'div',
          { className: 'esc-avatar' + (sq ? ' sq' : ''), style: { display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 } },
          letter || '·',
        )
      }

      var tabs = [
        { id: 'scenes', label: '精选场景' },
        { id: 'experts', label: '专家' },
        { id: 'skills', label: '技能' },
        { id: 'connectors', label: '连接器' },
      ]

      var body
      if (tab === 'scenes') {
        body = h('div', null, [
          h('div', { className: 'esc-toolbar' }, [
            h('p', { className: 'esc-hint', style: { margin: 0 } }, '可以同时召唤多张，再点一次「已召唤」即可取消。对话输入框旁从已召唤的里面选用。'),
            h('button', { type: 'button', className: 'esc-btn primary', disabled: busy, onClick: function () { openCreate(null) } }, '创建场景卡'),
          ]),
          h(
            'div',
            { className: 'esc-grid' },
            (catalog.scenes || [])
              .filter(function (s) {
                return hit(s.title + s.description)
              })
              .map(function (s) {
                var summoned = summonedIds.indexOf(s.id) >= 0
                var userCard = s.source === 'user'
                return h('div', { key: s.id, className: 'esc-card' + (summoned ? ' summoned' : '') }, [
                  h('h3', null, s.title + (userCard ? ' · 自建' : '')),
                  h('p', { className: 'esc-desc' }, s.description),
                  h('div', { className: 'esc-tags' }, [
                    h('span', { className: 'esc-tag' }, '1 专家'),
                    h('span', { className: 'esc-tag' }, (s.skillIds || []).length + ' 技能'),
                    h('span', { className: 'esc-tag' }, (s.connectorIds || []).length + ' 连接器'),
                  ]),
                  h('div', { className: 'esc-actions' }, [
                    userCard
                      ? h(
                          'button',
                          { type: 'button', className: 'esc-btn', disabled: busy, onClick: function () { removeScene(s.id) } },
                          '删除',
                        )
                      : null,
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'esc-summon' + (summoned ? ' on' : ''),
                        disabled: busy,
                        title: summoned ? '点击取消召唤' : '召唤后可在对话中选用',
                        onClick: function () {
                          toggleSummon(s.id, s.title, summoned)
                        },
                      },
                      summoned ? '已召唤' : '召唤',
                    ),
                  ]),
                ])
              }),
          ),
        ])
      } else if (tab === 'experts') {
        body = h(
          'div',
          { className: 'esc-grid' },
          (catalog.experts || [])
            .filter(function (x) {
              return hit([x.title, x.role, x.author, (x.tags || []).join(' '), x.preview].join(' '))
            })
            .map(function (x) {
              var summoned = summonedExpertIds.indexOf(x.id) >= 0
              return h('div', { key: x.id, className: 'esc-card' + (summoned ? ' summoned' : '') }, [
                h('div', { className: 'esc-card-hd' }, [
                  Avatar(x.avatar, (x.title || '?').slice(0, 1), false),
                  h('div', null, [
                    h('h3', null, x.title),
                    h('p', { className: 'esc-muted' }, (x.author || x.role || '公司预制') + (x.role ? ' · ' + x.role : '')),
                  ]),
                ]),
                h('p', { className: 'esc-desc' }, x.preview || ''),
                h(
                  'div',
                  { className: 'esc-tags' },
                  (x.tags || []).map(function (t) {
                    return h('span', { key: t, className: 'esc-tag' }, t)
                  }),
                ),
                h('div', { className: 'esc-actions' }, [
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'esc-summon' + (summoned ? ' on' : ''),
                      disabled: busy,
                      title: summoned ? '点击取消召唤' : '召唤该专家',
                      onClick: function () {
                        toggleSummonExpert(x.id, x.title, summoned)
                      },
                    },
                    summoned ? '已召唤' : '召唤',
                  ),
                ]),
              ])
            }),
        )
      } else if (tab === 'skills') {
        var cats = ['全部']
        ;(catalog.skills || []).forEach(function (s) {
          var c = s.category || '全部'
          if (cats.indexOf(c) < 0) cats.push(c)
        })
        var skillRows = (catalog.skills || []).filter(function (s) {
          if (chip !== '全部' && (s.category || '全部') !== chip) return false
          return hit(s.name + s.description + (s.triggers || []).join(' '))
        })
        body = h('div', null, [
          h(
            'div',
            { className: 'esc-chips' },
            cats.map(function (c) {
              return h(
                'button',
                {
                  key: c,
                  type: 'button',
                  className: 'esc-chip' + (chip === c ? ' on' : ''),
                  onClick: function () {
                    setChip(c)
                  },
                },
                c,
              )
            }),
          ),
          h(
            'div',
            { className: 'esc-grid' },
            skillRows.map(function (s) {
              var on = !!(skills[s.id] && skills[s.id].enabled)
              return h(
                'div',
                {
                  key: s.id,
                  className: 'esc-card esc-card-skill' + (on ? ' summoned' : ''),
                  role: 'button',
                  tabIndex: 0,
                  title: '查看技能详情',
                  onClick: function () {
                    setSkillDetailId(s.id)
                  },
                  onKeyDown: function (ev) {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault()
                      setSkillDetailId(s.id)
                    }
                  },
                },
                [
                  h('div', { className: 'esc-card-hd' }, [
                    Avatar(s.icon, (s.name || '?').slice(0, 1), true),
                    h('div', { style: { flex: 1, minWidth: 0 } }, [
                      h('h3', null, s.name),
                      h('p', { className: 'esc-desc' }, s.description),
                    ]),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'esc-plus' + (on ? ' on' : ''),
                        disabled: busy,
                        title: on ? '停用' : '启用',
                        onClick: function (ev) {
                          ev.stopPropagation()
                          toggleSkill(s.id, !on)
                        },
                      },
                      on ? '✓' : '+',
                    ),
                  ]),
                ],
              )
            }),
          ),
        ])
      } else {
        body = h('div', null, [
          h('p', { className: 'esc-hint' }, '连接器默认关闭。MES / 企微 / 飞书读系统配置；图表与网页阅读免费不必填密钥。定时推送仍走自动化。'),
          h(
            'div',
            { className: 'esc-grid' },
            (catalog.connectors || [])
              .filter(function (c) {
                return hit(c.title + c.summary + (c.marketplace || '') + (c.mcpServer || ''))
              })
              .map(function (c) {
                var live = connectors[c.id] || {}
                var draft = drafts[c.id] || {}
                var on = !!live.enabled
                return h('div', { key: c.id, className: 'esc-card esc-card-conn' }, [
                  h('div', { className: 'esc-card-hd' }, [
                    Avatar(c.avatar, (c.title || '?').slice(0, 1), true),
                    h('div', { style: { flex: 1, minWidth: 0 } }, [
                      h('h3', null, c.title),
                      h('p', { className: 'esc-muted' }, [c.marketplace || c.vendor || '', c.kind === 'mcp' ? 'MCP' : '']
                        .filter(Boolean)
                        .join(' · ')),
                      h('p', { className: 'esc-desc' }, c.summary),
                    ]),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'esc-plus' + (on ? ' on' : ''),
                        disabled: busy,
                        onClick: function () {
                          run(function () {
                            return fetchJson(serviceBase() + '/api/connectors/' + c.id + '/config', {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ enabled: !on }),
                            }).then(function (r) {
                              if (!r.ok) throw new Error(r.d.detail || '更新失败')
                            })
                          })
                        },
                      },
                      on ? '✓' : '+',
                    ),
                  ]),
                  h(
                    'div',
                    { className: 'esc-card-extra' },
                    c.id === 'dify'
                      ? h('div', { className: 'esc-field' }, [
                          h('input', {
                            value: draft.datasetId || '',
                            placeholder: 'datasetId',
                            onChange: function (ev) {
                              setDrafts(Object.assign({}, drafts, { [c.id]: Object.assign({}, draft, { datasetId: ev.target.value }) }))
                            },
                          }),
                        ])
                      : h(
                          'p',
                          { className: 'esc-hint' },
                          c.id === 'mes'
                            ? live.mesFromWorkbuddy
                              ? '已从系统配置读取 MES ' + (live.mesWorkbuddyBaseUrl || '')
                              : '未读到系统配置 MES。可 mock 演示，或到 WorkBuddy 系统配置填写访问地址。'
                            : c.id === 'mcp-chart'
                              ? '默认对接 AntV GPT-Vis，不必再填密钥。'
                              : c.id === 'mcp-wecom'
                                ? live.wecomFromWorkbuddy
                                  ? '已从系统配置读取企微群机器人。测通不往群里发消息。'
                                  : '未读到企微 Webhook。请到 WorkBuddy 系统配置 → 自动化推送填写。'
                                : c.id === 'mcp-feishu'
                                  ? live.feishuFromWorkbuddy
                                    ? '已从系统配置读取飞书应用。写入时需知识库 /wiki/ 链接。'
                                    : '未读到飞书 App。请到 WorkBuddy 系统配置 → 自动化推送填写 App ID/Secret。'
                                  : c.id === 'mcp-web-read'
                                    ? '免费 Jina Reader，不必填密钥。只读公开 URL，不访问内网。'
                                    : '',
                        ),
                  ),
                  h('div', { className: 'esc-actions' }, [
                    c.id === 'dify'
                      ? h('button', { type: 'button', className: 'esc-btn primary', disabled: busy, onClick: function () { saveConnector(c.id) } }, '保存')
                      : null,
                    h('button', { type: 'button', className: 'esc-btn', disabled: busy, onClick: function () { testConnector(c.id) } }, '测通'),
                  ]),
                ])
              }),
          ),
        ])
      }

      return h('div', { className: 'esc-root' }, [
        h('div', { className: 'esc-header' }, [
          h(
            'div',
            { className: 'esc-tabs' },
            tabs.map(function (t) {
              return h(
                'button',
                {
                  key: t.id,
                  type: 'button',
                  className: 'esc-tab' + (tab === t.id ? ' on' : ''),
                  onClick: function () {
                    setTab(t.id)
                  },
                },
                t.label,
              )
            }),
          ),
          h('input', {
            className: 'esc-search',
            placeholder: '搜索' + (tab === 'experts' ? '专家' : tab === 'skills' ? '技能' : tab === 'connectors' ? '连接器' : '场景'),
            value: q,
            onChange: function (ev) {
              setQ(ev.target.value)
            },
          }),
        ]),
        h('div', { className: 'esc-body' }, [
          tab === 'scenes'
            ? h(
                'div',
                { className: 'esc-banner' },
                summonedIds.length
                  ? '已召唤 ' + summonedIds.length + ' 张场景卡。回对话输入框旁选用即可。'
                  : '还没召唤场景卡。点下面一张召唤，再回对话选用。',
              )
            : tab === 'experts'
              ? h(
                  'div',
                  { className: 'esc-banner' },
                  summonedExpertIds.length
                    ? '已召唤 ' + summonedExpertIds.length + ' 位专家。可同时召唤多位，再点一次「已召唤」即可取消。'
                    : '还没召唤专家。点下面一位召唤，可同时召多位。',
                )
              : null,
          err ? h('div', { className: 'esc-error' }, err) : null,
          body,
        ]),
        h(Toast, toast || {}),
        create
          ? h('div', { className: 'esc-modal', onClick: function () { setCreate(null) } }, [
              h(
                'div',
                {
                  className: 'esc-dialog',
                  onClick: function (ev) {
                    ev.stopPropagation()
                  },
                },
                [
                  h('h3', { style: { marginTop: 0 } }, '创建场景卡'),
                  h('p', { className: 'esc-hint' }, '必须 1 位专家；技能、连接器各最多 ' + limits.maxSkills + ' 个。缺必选连接器不能保存。'),
                  h('div', { className: 'esc-field' }, [
                    h('label', null, '名称'),
                    h('input', {
                      value: create.title,
                      placeholder: '例如 夜班 OEE 看板',
                      onChange: function (ev) {
                        setCreate(Object.assign({}, create, { title: ev.target.value }))
                      },
                    }),
                  ]),
                  h('div', { className: 'esc-field' }, [
                    h('label', null, '专家（必选 1 个）'),
                    (catalog.experts || []).map(function (x) {
                      return h('label', { key: x.id, className: 'esc-check' }, [
                        h('input', {
                          type: 'radio',
                          name: 'esc-expert',
                          checked: create.expertId === x.id,
                          onChange: function () {
                            setCreate(Object.assign({}, create, { expertId: x.id }))
                          },
                        }),
                        x.title,
                      ])
                    }),
                  ]),
                  h('div', { className: 'esc-field' }, [
                    h('label', null, '技能（最多 ' + limits.maxSkills + '）'),
                    (catalog.skills || []).map(function (s) {
                      var on = create.skillIds.indexOf(s.id) >= 0
                      return h('label', { key: s.id, className: 'esc-check' }, [
                        h('input', {
                          type: 'checkbox',
                          checked: on,
                          disabled: !on && create.skillIds.length >= limits.maxSkills,
                          onChange: function () {
                            setCreate(Object.assign({}, create, { skillIds: toggleId(create.skillIds, s.id, limits.maxSkills) }))
                          },
                        }),
                        s.name,
                      ])
                    }),
                  ]),
                  h('div', { className: 'esc-field' }, [
                    h('label', null, '连接器 / MCP（最多 ' + limits.maxConnectors + '）'),
                    (catalog.connectors || []).map(function (c) {
                      var on = create.connectorIds.indexOf(c.id) >= 0
                      return h('label', { key: c.id, className: 'esc-check' }, [
                        h('input', {
                          type: 'checkbox',
                          checked: on,
                          disabled: !on && create.connectorIds.length >= limits.maxConnectors,
                          onChange: function () {
                            setCreate(Object.assign({}, create, { connectorIds: toggleId(create.connectorIds, c.id, limits.maxConnectors) }))
                          },
                        }),
                        c.title || c.id,
                      ])
                    }),
                  ]),
                  issueList(liveReview),
                  h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 } }, [
                    h('button', { type: 'button', className: 'esc-btn', onClick: function () { setCreate(null) } }, '取消'),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'esc-btn primary',
                        disabled: busy || !create.title.trim() || (liveReview && liveReview.ok === false),
                        onClick: saveCreate,
                      },
                      '保存',
                    ),
                  ]),
                ],
              ),
            ])
          : null,
        (function () {
          var detail = skillDetailId
            ? (catalog.skills || []).filter(function (x) {
                return x.id === skillDetailId
              })[0]
            : null
          if (!detail) return null
          var on = !!(skills[detail.id] && skills[detail.id].enabled)
          var connIds = [].concat(detail.requiredConnectorIds || [], detail.optionalConnectorIds || [])
          var connNames = connIds.map(function (id) {
            var hit = (catalog.connectors || []).filter(function (c) {
              return c.id === id
            })[0]
            return hit ? hit.title : id
          })
          return h('div', { className: 'esc-modal', onClick: function () { setSkillDetailId(null) } }, [
            h(
              'div',
              {
                className: 'esc-detail',
                onClick: function (ev) {
                  ev.stopPropagation()
                },
              },
              [
                h(
                  'button',
                  { type: 'button', className: 'esc-detail-close', title: '关闭', onClick: function () { setSkillDetailId(null) } },
                  '×',
                ),
                h('div', { className: 'esc-detail-hd' }, [
                  Avatar(detail.icon, (detail.name || '?').slice(0, 1), true),
                  h('h2', null, detail.name),
                ]),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'esc-detail-install' + (on ? ' on' : ''),
                    disabled: busy,
                    onClick: function () {
                      toggleSkill(detail.id, !on)
                    },
                  },
                  on ? '已启用' : '启用',
                ),
                h('p', { className: 'esc-detail-lead' }, detail.description || ''),
                h('div', { className: 'esc-detail-sec' }, '基本信息'),
                h('p', { className: 'esc-detail-pill' }, '版本  v' + (catalog.pluginVersion || '0')),
                h('div', { className: 'esc-detail-tags' }, [
                  h('span', { className: 'esc-tag' }, detail.category || '技能'),
                  connNames.length
                    ? h('span', { className: 'esc-tag' }, '连接器 ' + connNames.join('、'))
                    : h('span', { className: 'esc-tag' }, '不依赖连接器'),
                ]),
                (detail.triggers || []).length
                  ? h('div', { className: 'esc-detail-tags' }, [
                      h('span', { className: 'esc-muted' }, '触发：'),
                    ].concat(
                      (detail.triggers || []).map(function (t) {
                        return h('span', { key: t, className: 'esc-tag' }, t)
                      }),
                    ))
                  : null,
                detail.sop
                  ? [
                      h('div', { className: 'esc-detail-sec' }, '技能手册'),
                      h('pre', { className: 'esc-detail-sop' }, detail.sop),
                    ]
                  : null,
              ],
            ),
          ])
        })(),
      ])
    }

    function EscFooterAction(props) {
      ensureCss()
      var wide = !!props.wide
      var workspace = props.workspace
      var openState = useState(workspace.isOpen())
      var open = openState[0]
      var setOpen = openState[1]
      useEffect(
        function () {
          return workspace.subscribe(function () {
            setOpen(workspace.isOpen())
          })
        },
        [workspace],
      )
      return h(
        'div',
        { className: 'esc-launcher' + (wide ? '' : ' esc-launcher--rail'), role: 'group', 'aria-label': '专家技能连接器入口' },
        h(
          'button',
          {
            type: 'button',
            className: 'esc-trigger' + (wide ? '' : ' esc-trigger--rail') + (open ? ' is-active' : ''),
            'aria-label': open ? '返回对话' : '打开专家·技能·连接器',
            'aria-pressed': open,
            title: open ? '返回对话' : '专家·技能·连接器',
            onClick: function () {
              workspace.toggle()
            },
          },
          [EscIcon(wide ? 16 : 18), wide ? h('span', null, '专家·技能·连接器') : null],
        ),
      )
    }

    function createWorkspace(ctx) {
      var listeners = new Set()
      var disposeWorkspace
      function notify() {
        listeners.forEach(function (fn) {
          fn()
        })
      }
      var controller
      function close() {
        if (disposeWorkspace === undefined) return
        var dispose = disposeWorkspace
        disposeWorkspace = undefined
        dispose()
        notify()
      }
      function open() {
        if (disposeWorkspace !== undefined) return
        activatePluginWorkspace(PLUGIN_ID)
        disposeWorkspace = registerMainPanel(
          ctx,
          PLUGIN_ID,
          -1,
          function () {
            return h(EscView)
          },
          close,
        )
        notify()
      }
      controller = {
        isOpen: function () {
          return disposeWorkspace !== undefined
        },
        open: open,
        toggle: function () {
          if (disposeWorkspace !== undefined) return close()
          open()
        },
        close: close,
        subscribe: function (listener) {
          listeners.add(listener)
          return function () {
            listeners.delete(listener)
          }
        },
      }
      return controller
    }

    function SceneComposerChip(props) {
      ensureCss()
      var sessionId = String((props && props.sessionId) || (props && props.session && props.session.id) || '')
      var workspace = props && props.workspace
      var openState = useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var qState = useState('')
      var q = qState[0]
      var setQ = qState[1]
      var packState = useState(null)
      var pack = packState[0]
      var setPack = packState[1]
      var busyState = useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      function refresh() {
        if (!sessionId) return
        Promise.all([
          fetchJson(serviceBase() + '/api/catalog'),
          fetchJson(serviceBase() + '/api/session-state?sessionId=' + encodeURIComponent(sessionId)),
        ]).then(function (rows) {
          if (!rows[0].ok) return
          setPack({ catalog: rows[0].d, state: (rows[1].ok && rows[1].d.state) || {} })
        })
      }
      useEffect(
        function () {
          refresh()
        },
        [sessionId],
      )
      useEffect(
        function () {
          if (!open) return
          function onDoc() {
            setOpen(false)
          }
          var t = setTimeout(function () {
            document.addEventListener('click', onDoc)
          }, 0)
          return function () {
            clearTimeout(t)
            document.removeEventListener('click', onDoc)
          }
        },
        [open],
      )
      if (!sessionId) return null
      var catalog = (pack && pack.catalog) || {}
      var summonedIds = ((pack && pack.state && pack.state.summonedSceneIds) || []).slice()
      var byId = {}
      ;(catalog.scenes || []).forEach(function (s) {
        byId[s.id] = s
      })
      var scenes = []
      summonedIds.forEach(function (id) {
        if (byId[id]) scenes.push(byId[id])
      })
      var needle = (q || '').trim().toLowerCase()
      if (needle) {
        scenes = scenes.filter(function (s) {
          return String(s.title || '').toLowerCase().indexOf(needle) >= 0
        })
      }
      var boundId = pack && pack.state ? pack.state.sessionSceneId : ''
      var bound = null
      ;(catalog.scenes || []).forEach(function (s) {
        if (s.id === boundId) bound = s
      })
      function expertOf(scene) {
        var list = catalog.experts || []
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === scene.expertId) return list[i]
        }
        return null
      }
      function rowAvatar(scene) {
        var ex = expertOf(scene)
        if (ex && ex.avatar) {
          return h('img', { className: 'esc-scene-chip-ava', src: ex.avatar, alt: '', referrerPolicy: 'no-referrer' })
        }
        var letter = ((ex && ex.title) || scene.title || '场').slice(0, 1)
        return h('div', { className: 'esc-scene-chip-ava letter' }, letter)
      }
      function bind(id) {
        setBusy(true)
        fetchJson(serviceBase() + '/api/scenes/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneId: id, sessionId: sessionId }),
        })
          .then(function (r) {
            if (!r.ok) throw new Error(r.d.detail || '添加失败')
            setOpen(false)
            setQ('')
            refresh()
          })
          .catch(function () {})
          .then(function () {
            setBusy(false)
          })
      }
      function clear() {
        setBusy(true)
        fetchJson(serviceBase() + '/api/session-scene/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId }),
        })
          .then(function () {
            setOpen(false)
            refresh()
          })
          .then(function () {
            setBusy(false)
          })
      }
      function openPanel() {
        setOpen(false)
        if (workspace && typeof workspace.open === 'function') workspace.open()
      }
      return h(
        'div',
        {
          className: 'esc-scene-chip-wrap',
          onClick: function (ev) {
            ev.stopPropagation()
          },
        },
        [
          h(
            'button',
            {
              type: 'button',
              className: 'esc-scene-chip' + (bound ? ' on' : ''),
              disabled: busy,
              title: bound ? '本会话场景卡：' + bound.title : '选用已召唤的场景卡',
              onClick: function () {
                setOpen(!open)
                if (!open) refresh()
              },
            },
            bound ? bound.title : '选用场景卡',
          ),
          open
            ? h('div', { className: 'esc-scene-chip-menu' }, [
                h('div', { className: 'esc-scene-chip-search' }, [
                  svgEl({ width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, [
                    h('circle', { cx: '7', cy: '7', r: '4.2', stroke: 'currentColor', strokeWidth: '1.4' }),
                    h('path', { d: 'M10.2 10.2L13 13', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
                  ]),
                  h('input', {
                    type: 'text',
                    value: q,
                    placeholder: '搜索场景卡',
                    onChange: function (ev) {
                      setQ(ev.target.value)
                    },
                  }),
                ]),
                scenes.length
                  ? scenes.map(function (s) {
                      return h(
                        'button',
                        {
                          key: s.id,
                          type: 'button',
                          className: 'esc-scene-chip-row' + (s.id === boundId ? ' on' : ''),
                          disabled: busy,
                          onClick: function () {
                            bind(s.id)
                          },
                        },
                        [rowAvatar(s), h('span', null, s.title)],
                      )
                    })
                  : h(
                      'div',
                      { className: 'esc-scene-chip-empty' },
                      summonedIds.length ? '没有匹配的场景卡' : '还没有召唤过的场景卡',
                    ),
                h('div', { className: 'esc-scene-chip-foot' }, [
                  bound
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'esc-scene-chip-row esc-scene-chip-more',
                          disabled: busy,
                          onClick: clear,
                        },
                        '卸下本会话场景卡',
                      )
                    : null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'esc-scene-chip-row esc-scene-chip-more',
                      disabled: busy,
                      onClick: openPanel,
                    },
                    '↗  召唤更多场景卡',
                  ),
                ]),
              ])
            : null,
        ],
      )
    }

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') {
        console.error('[esc] 无 slots，无法注册侧栏入口')
        return
      }
      ensureCss()
      var workspace = createWorkspace(ctx)
      if (typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return observePluginWorkspace(PLUGIN_ID, function () {
            workspace.close()
          })
        }, 'dsh-esc: exclusive workspace')
        ctx.effect(function () {
          return function () {
            workspace.close()
          }
        }, 'dsh-esc: workspace lifecycle')
      }
      ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'esc', order: -7 },
          function EscFooter(props) {
            return h(EscFooterAction, { wide: props && props.wide, workspace: workspace })
          },
        )
      })
      ctx.slots.inject('conversation.input.left', function () {
        return ctx.slots.register(
          { name: 'conversation.input.left', id: 'esc-scene', order: 40, label: '场景卡' },
          function EscSceneChip(props) {
            return h(SceneComposerChip, Object.assign({}, props, { workspace: workspace }))
          },
        )
      })
      console.log('[esc] 已注册侧栏「专家·技能·连接器」与对话栏场景卡')
    }

    module.exports = { inject: ['slots', 'layout'], apply: apply }
    return module.exports
  },
})
