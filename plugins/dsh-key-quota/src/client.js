/**
 * 用量统计页。版式对齐工作助手用量页：个人/企业、按日按月、分时段、模型分项、员工条。
 */
window.__ModuleLoader__.load({
  id: '@zhongruan/dsh-key-quota',
  factory: (require) => {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect

    var PLUGIN_ID = '@zhongruan/dsh-key-quota'
    var PANEL_ID = 'key-quota'
    var WORKSPACE_EVENT = '@lemoncat7/dsh-plugin-ui/workspace-activate'
    var LLM_PAL = { fill: '#93c5fd', stroke: '#3b82f6', hit: '#93c5fd', miss: '#3b82f6', out: '#1d4ed8' }
    var CODE_PAL = { fill: '#99f6e4', stroke: '#14b8a6', hit: '#99f6e4', miss: '#14b8a6', out: '#0f766e' }

    function ensureCss() {
      if (typeof document === 'undefined') return
      var cssVersion = '9'
      var old = document.getElementById('kq-css')
      if (old && old.getAttribute('data-v') === cssVersion) return
      if (old && old.parentNode) old.parentNode.removeChild(old)
      var style = document.createElement('style')
      style.id = 'kq-css'
      style.setAttribute('data-v', cssVersion)
      style.textContent = [
        '.kq-root{height:100%;overflow:auto;background:#fff;color:#0f172a}',
        '.kq-root .wb-usage-view{box-sizing:border-box;display:flex;flex-direction:column;width:100%;max-width:920px;margin:0 auto;background:#fff}',
        '.kq-root .wb-usage-view-head{display:flex;align-items:center;gap:12px;padding:12px 20px 10px;border-bottom:1px solid #eef0f3}',
        '.kq-root .wb-usage-tabs{display:inline-table;border-collapse:separate;border-spacing:0;border:1px solid #c5ced9;border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 0 0 1px #c5ced9}',
        '.kq-root .wb-usage-tabs td{padding:0;border-right:1px solid #c5ced9}',
        '.kq-root .wb-usage-tabs td:last-child{border-right:none}',
        '.kq-root .wb-usage-tabs button{cursor:pointer;border:none;background:transparent;padding:7px 14px;font:inherit;font-size:13px;font-weight:500;color:#64748b;min-width:88px}',
        '.kq-root .wb-usage-tabs td.active{background:rgba(15,23,42,.06)}',
        '.kq-root .wb-usage-tabs td.active button{color:#111827;font-weight:600}',
        '.kq-root .wb-usage-view-body{padding:0 20px 28px}',
        '.kq-root .wb-usage-page{padding-top:0;font:13px/1.5 -apple-system,PingFang SC,Microsoft YaHei,sans-serif}',
        '.kq-root .kq-sticky{position:sticky;top:0;z-index:8;background:#fff;margin:0 -20px 12px;padding:12px 20px 10px;border-bottom:1px solid #e8edf2}',
        '.kq-root .kq-title-row{display:flex;align-items:center;gap:16px;margin-bottom:12px}',
        '.kq-root .kq-title-row .kq-page-title{margin:0}',
        '.kq-root .kq-sticky .wb-usage-filter{margin:0}',
        '.kq-root .kq-keyline{margin:0 0 10px;color:#64748b;font-size:12px}',
        '.kq-root .kq-token{font-family:ui-monospace,monospace;word-break:break-all;background:#f8fafc;border-radius:8px;padding:8px 10px;margin:4px 0 10px}',
        '.kq-root .kq-setup p{margin:6px 0;color:#475569;font-size:12px}',
        '.kq-root .kq-table{width:100%;border-collapse:collapse;margin-top:8px}',
        '.kq-root .kq-table th,.kq-root .kq-table td{text-align:left;padding:8px 6px;border-bottom:1px solid #e6ece7}',
        '.kq-root .kq-table input{width:120px;border:1px solid #d5dfd7;border-radius:8px;padding:4px 8px}',
        '.kq-root .kq-btn{border:1px solid #d0d9e6;background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer}',
        '.kq-root .kq-add{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}',
        '.kq-root .kq-add input,.kq-root .kq-add select,.kq-root .kq-table select{border:1px solid #d1d5db;border-radius:8px;padding:6px 10px;font:13px inherit;background:#fff}',
        '.kq-root .kq-add input.kq-key{flex:1 1 460px;min-width:360px;max-width:100%}',
        '.kq-root .kq-limit{min-width:148px}',
        '.kq-root .kq-actions{display:flex;gap:6px;justify-content:flex-end}',
        '.kq-root .kq-task{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.kq-root .kq-detail-scroll{overflow-x:auto;max-width:100%}',
        '.kq-root .kq-table.kq-grid{width:100%;border-collapse:separate;border-spacing:0;margin-top:4px}',
        '.kq-root .kq-table.kq-grid th,.kq-root .kq-table.kq-grid td{padding:10px 14px;border-bottom:1px solid #eef2f6;white-space:nowrap;vertical-align:middle}',
        '.kq-root .kq-table.kq-grid th{background:#f8fafc;color:#64748b;font-size:12px;font-weight:600}',
        '.kq-root .kq-table.kq-grid tbody tr:last-child td{border-bottom:none}',
        '.kq-root .kq-table.kq-grid tbody tr:hover td{background:#f8fafc}',
        '.kq-root .kq-table.kq-grid th.num,.kq-root .kq-table.kq-grid td.num{text-align:right;font-variant-numeric:tabular-nums}',
        '.kq-root .kq-detail-scroll .kq-table.kq-grid{width:max-content;min-width:100%}',
        '.kq-root .wb-set-card .body .kq-detail-scroll{margin:6px -16px 0}',
        '.kq-root .kq-table.kq-grid th:first-child,.kq-root .kq-table.kq-grid td:first-child{padding-left:16px}',
        '.kq-root .kq-table.kq-grid th:last-child,.kq-root .kq-table.kq-grid td:last-child{padding-right:16px}',
        '.kq-root .kq-id{max-width:148px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px}',
        '.kq-root .kq-table.kq-grid .kq-session{max-width:none;min-width:0;white-space:nowrap;word-break:normal;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px}',
        '.kq-root .kq-table.kq-grid .kq-dialogue{white-space:nowrap;min-width:0}',
        '.kq-root .kq-table.kq-grid .kq-keymask{font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;letter-spacing:.02em;color:#0f172a}',
        '.kq-root .kq-pager{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:4px 0 2px;padding:10px 16px 6px;color:#94a3b8;font-size:13px}',
        '.kq-root .kq-pager-total{white-space:nowrap;flex:0 0 auto}',
        '.kq-root .kq-pager-right{display:flex;align-items:center;gap:8px;flex:0 0 auto}',
        '.kq-root .kq-pager-size{position:relative;flex:0 0 112px;width:112px}',
        '.kq-root .kq-pager-size-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:space-between;width:112px;min-width:112px;max-width:112px;height:32px;min-height:32px;padding:0 10px;gap:6px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;color:#334155;font:13px/1 -apple-system,PingFang SC,Microsoft YaHei,sans-serif;cursor:pointer;white-space:nowrap;flex:0 0 112px}',
        '.kq-root .kq-pager-caret{display:inline-block;flex:0 0 auto;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid #94a3b8}',
        '.kq-root .kq-pager-size-btn.open .kq-pager-caret{border-top:none;border-bottom:5px solid #94a3b8}',
        '.kq-root .kq-pager-menu{position:absolute;right:0;bottom:calc(100% + 6px);width:112px;min-width:112px;box-sizing:border-box;padding:6px;border-radius:12px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.12);z-index:6}',
        '.kq-root .kq-pager-menu button{display:block;width:100%;border:none;background:transparent;text-align:left;padding:8px 12px;border-radius:8px;font:inherit;font-size:13px;color:#334155;cursor:pointer;white-space:nowrap}',
        '.kq-root .kq-pager-menu button.on,.kq-root .kq-pager-menu button:hover{background:#f1f5f9}',
        '.kq-root .kq-pager-arrow,.kq-root .kq-pager-num{box-sizing:border-box;width:32px;min-width:32px;height:32px;min-height:32px;flex:0 0 32px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;color:#334155;display:inline-flex;align-items:center;justify-content:center;font:13px/1 -apple-system,PingFang SC,Microsoft YaHei,sans-serif;font-size:16px}',
        '.kq-root .kq-pager-arrow{padding:0;cursor:pointer}',
        '.kq-root .kq-pager-arrow:disabled{opacity:.35;cursor:default}',
        '.kq-root .kq-pager-num{font-size:13px;font-variant-numeric:tabular-nums}',
        '.kq-root .kq-page-title{margin:2px 0 14px;font-size:18px;font-weight:700;color:#0f172a;line-height:1.3}',
        '.kq-root .wb-usage-filter{display:flex;align-items:center;gap:8px;margin:0 0 12px;flex-wrap:wrap}',
        '.kq-root .kq-corner{margin-left:auto;display:flex;align-items:center;gap:8px}',
        '.kq-root .kq-corner .wb-set-msg{margin-right:0}',
        '.kq-root .wb-usage-filter label{font-size:12px;color:#64748b;font-weight:600}',
        '.kq-root .wb-usage-filter input,.kq-root .wb-usage-filter select{border:1px solid #d1d5db;border-radius:8px;padding:6px 10px;font:13px inherit;color:#111827;background:#fff}',
        '.kq-root .wb-usage-kpis{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 18px}',
        '.kq-root .wb-usage-kpi{border:1px solid #e5e7eb;border-radius:14px;padding:12px 14px;background:#fff}',
        '.kq-root .wb-usage-kpi .k{font-size:12px;font-weight:600;color:#64748b;margin:0 0 8px}',
        '.kq-root .wb-usage-kpi .row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:3px 0}',
        '.kq-root .wb-usage-kpi .t{font-size:12px;color:#64748b}',
        '.kq-root .wb-usage-kpi .n{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;color:#111827}',
        '.kq-root .wb-set-card{border:1px solid #e2e8f0;border-radius:12px;background:#fff;margin:0 0 8px;box-shadow:0 1px 2px rgba(15,23,42,.03)}',
        '.kq-root .wb-set-card h3{margin:0;padding:14px 16px 4px;font-size:16px;font-weight:700;color:#0f172a}',
        '.kq-root .wb-set-card .body{padding:2px 16px 14px}',
        '.kq-root .wb-usage-hour-sub{font-size:12px;color:#64748b;margin:0 0 10px}',
        '.kq-root .wb-usage-legend{display:flex;flex-wrap:wrap;gap:6px 12px;margin:6px 0 8px;font-size:11px;color:#64748b}',
        '.kq-root .wb-usage-legend i,.kq-root .wb-usage-hbar-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}',
        '.kq-root .wb-usage-hour-plot{position:relative;height:200px;cursor:crosshair;background:#f5f6f8;border-radius:14px}',
        '.kq-root .wb-usage-hour-plot svg{display:block;width:100%;height:200px}',
        '.kq-root .wb-usage-hour-guide{position:absolute;width:0;border-left:1px dashed #c5cad3;pointer-events:none;transform:translateX(-50%)}',
        '.kq-root .wb-usage-hour-tip{position:absolute;top:10px;transform:translateX(-50%);background:#fff;color:#111827;font-size:12px;border-radius:12px;padding:8px 14px;pointer-events:none;z-index:2;white-space:nowrap;box-shadow:0 8px 24px rgba(15,23,42,.12);display:flex;align-items:center;gap:8px 12px}',
        '.kq-root .wb-usage-hour-tip .r{color:#64748b}',
        '.kq-root .wb-usage-hour-tip .v{font-weight:700}',
        '.kq-root .wb-usage-hour-tip .v.llm{color:#ea580c}',
        '.kq-root .wb-usage-hour-tip .v.cur{color:#0f766e}',
        '.kq-root .wb-usage-hour-tip .c{color:#94a3b8;font-size:11px}',
        '.kq-root .wb-usage-meter{margin:22px 0}',
        '.kq-root .wb-usage-meter-title,.kq-root .wb-usage-people-title{font-size:14px;font-weight:700;margin:0 0 2px}',
        '.kq-root .wb-usage-meter-sub,.kq-root .wb-usage-people-sub{font-size:12px;color:#64748b;margin:4px 0 10px}',
        '.kq-root .wb-usage-meter-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
        '.kq-root .wb-usage-chart{border:1px solid #e5e7eb;border-radius:14px;padding:12px 12px 8px;background:#fff;min-width:0}',
        '.kq-root .wb-usage-chart-head{display:flex;align-items:baseline;gap:8px;margin-bottom:4px}',
        '.kq-root .wb-usage-chart-head .t{font-size:12px;color:#64748b}',
        '.kq-root .wb-usage-chart-head .n{font-size:16px;font-weight:700}',
        '.kq-root .wb-usage-chart-plot{position:relative;height:150px;cursor:crosshair}',
        '.kq-root .wb-usage-chart svg{display:block;width:100%;height:150px}',
        '.kq-root .wb-usage-guide{position:absolute;width:1px;background:currentColor;opacity:.35;pointer-events:none;transform:translateX(-50%)}',
        '.kq-root .wb-usage-dot{position:absolute;width:9px;height:9px;border-radius:50%;background:#fff;border:2px solid currentColor;transform:translate(-50%,-50%);box-sizing:border-box;pointer-events:none}',
        '.kq-root .wb-usage-tip{position:absolute;top:6px;background:#1f2937;color:#fff;font-size:11px;line-height:1.35;border-radius:8px;padding:6px 8px;pointer-events:none;z-index:2;white-space:nowrap}',
        '.kq-root .wb-usage-hbar{border:1px solid #e5e7eb;border-radius:14px;padding:12px 14px;background:#fff}',
        '.kq-root .wb-usage-hbar-legend{display:flex;gap:14px;margin:0 0 10px;font-size:11px;color:#64748b}',
        '.kq-root .wb-usage-hbar-person{margin:0 0 14px;padding-bottom:12px;border-bottom:1px solid #f1f5f9}',
        '.kq-root .wb-usage-hbar-person:last-child{margin:0;padding:0;border:none}',
        '.kq-root .wb-usage-hbar-head{display:flex;justify-content:space-between;margin:0 0 8px}',
        '.kq-root .wb-usage-hbar-name{font-size:13px;font-weight:600;color:#334155}',
        '.kq-root .wb-usage-hbar-total{font-size:12px;font-weight:700}',
        '.kq-root .wb-usage-hbar-row{display:grid;grid-template-columns:72px 1fr 72px;gap:8px;align-items:center;margin:0 0 6px}',
        '.kq-root .wb-usage-hbar-lab{font-size:11px;color:#64748b;font-weight:600}',
        '.kq-root .wb-usage-hbar-track{height:14px;border-radius:7px;background:#f1f5f9;overflow:hidden}',
        '.kq-root .wb-usage-hbar-fill{height:100%;border-radius:7px;min-width:2px}',
        '.kq-root .wb-usage-hbar-fill.llm{background:linear-gradient(90deg,#93c5fd,#3b82f6)}',
        '.kq-root .wb-usage-hbar-fill.cursor{background:linear-gradient(90deg,#99f6e4,#14b8a6)}',
        '.kq-root .wb-usage-hbar-val{font-size:11px;font-weight:700;text-align:right}',
        '.kq-root .wb-set-bar{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0}',
        '.kq-root .wb-set-btn{border:1px solid #d0d9e6;background:#fff;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;color:#0f172a}',
        '.kq-root .wb-set-msg{margin-right:auto;font-size:12px;color:#64748b}',
        '.kq-root .wb-set-msg.ok{color:#047857}',
        '.kq-root .wb-set-msg.err{color:#b91c1c}',
        '@media (max-width:720px){.kq-root .wb-usage-kpis,.kq-root .wb-usage-meter-grid{grid-template-columns:1fr}}',
      ].join('')
      document.head.appendChild(style)
    }

    function portOf() {
      try { return localStorage.getItem('dsh-key-quota-port') || '18790' } catch (err) { return '18790' }
    }

    function api(path, options) {
      var init = Object.assign({ cache: 'no-store' }, options || {})
      function read(res) {
        var type = (res.headers && res.headers.get('content-type')) || ''
        if (type.indexOf('json') < 0) throw new Error('not-json')
        return res.json()
      }
      return fetch('/key-quota' + path, init).then(read).catch(function () {
        return fetch('http://127.0.0.1:' + portOf() + path, init).then(read)
      })
    }

    function usageTodayYmd() {
      try { return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10) }
      catch (err) { return new Date().toISOString().slice(0, 10) }
    }

    function fmtTokens(n) {
      var x = Number(n) || 0
      if (x >= 1000000) return (x / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M'
      if (x >= 1000) return (x / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
      return String(Math.round(x))
    }

    function fmtFull(n) {
      return Math.round(Number(n) || 0).toLocaleString('zh-CN')
    }

    function niceMax(v) {
      v = Number(v) || 0
      if (v <= 0) return 1
      if (v <= 10) return 10
      var exp = Math.pow(10, Math.floor(Math.log10(v)))
      return Math.ceil(v / exp) * exp
    }

    function mdLabel(date) {
      var s = String(date || '')
      return s.length >= 10 ? s.slice(5).replace('-', '/') : s
    }

    function monthLabel(ym) {
      var s = String(ym || '')
      if (s.length >= 7) return s.slice(0, 4) + '年' + String(Number(s.slice(5, 7))) + '月'
      return ''
    }

    function showTick(i, n, label, axis) {
      if (axis === 'hour') return n <= 8 || i === 0 || i === 8 || i === 15 || i === n - 1
      if (n <= 8 || i === 0 || i === n - 1) return true
      var dd = String(label || '')
      dd = dd.length >= 2 ? dd.slice(-2) : ''
      return dd === '01' || dd === '08' || dd === '15' || dd === '22'
    }

    function plotBox(n) {
      var L = 40, R = 28, T = 8, B = 26, H = 150
      var W = Math.max(340, (n || 1) * 44)
      return { W: W, H: H, L: L, R: R, T: T, B: B, iw: W - L - R, ih: H - T - B }
    }

    function tipShift(xPct) {
      if (xPct >= 82) return 'translateX(-100%)'
      if (xPct <= 18) return 'translateX(0)'
      return 'translateX(-50%)'
    }

    function statusText(data) {
      if (!data || !data.usage) return ''
      var month = data.usage.grain === 'month'
      var ent = data.scope === 'enterprise'
      if (!data.loaded) return '还没有读到用量。'
      if (month && ent) return '已加载企业整月用量'
      if (month) return '已加载个人整月用量'
      if (ent) return '已加载企业总用量'
      return '已从引擎加载'
    }

    function UsageCurveChart(props) {
      var hoverState = useState(-1)
      var hover = hoverState[0]
      var setHover = hoverState[1]
      var values = props.values || []
      var labels = props.labels || []
      var axis = props.axis === 'hour' ? 'hour' : 'day'
      var n = values.length || 1
      var box = plotBox(n)
      var max = niceMax(Math.max.apply(null, [0].concat(values)))
      function xAt(i) { return box.L + (n <= 1 ? box.iw / 2 : (i * box.iw) / (n - 1)) }
      function yAt(v) { return box.T + box.ih - (max ? (v / max) * box.ih : 0) }
      var d = ''
      values.forEach(function (v, i) {
        d += (i ? ' L ' : 'M ') + xAt(i).toFixed(2) + ' ' + yAt(v).toFixed(2)
      })
      var base = (box.T + box.ih).toFixed(2)
      var area = d ? d + ' L ' + xAt(n - 1).toFixed(2) + ' ' + base + ' L ' + xAt(0).toFixed(2) + ' ' + base + ' Z' : ''
      var gid = 'uc' + String(props.gid || 'g').replace(/[^a-zA-Z0-9]/g, '')
      var grid = [0, 0.5, 1].map(function (f) {
        var yy = yAt(max * f)
        var label = f === 0 ? '0' : String(Math.round(max * f))
        return '<line x1="' + box.L + '" x2="' + (box.W - box.R) + '" y1="' + yy + '" y2="' + yy + '" stroke="#e5e7eb"/>' +
          '<text x="' + (box.L - 6) + '" y="' + (yy + 3) + '" text-anchor="end" font-size="10" fill="#94a3b8">' + label + '</text>'
      }).join('')
      var xlabs = labels.map(function (lb, i) {
        if (!showTick(i, n, lb, axis)) return ''
        var anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle')
        return '<text x="' + xAt(i) + '" y="' + (box.H - 8) + '" text-anchor="' + anchor + '" font-size="10" fill="#94a3b8">' + lb + '</text>'
      }).join('')
      var svg = '<svg viewBox="0 0 ' + box.W + ' ' + box.H + '" width="100%" height="150" preserveAspectRatio="none">' +
        '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + props.stroke + '" stop-opacity="0.38"/><stop offset="100%" stop-color="' + props.stroke + '" stop-opacity="0.04"/></linearGradient></defs>' +
        grid + '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
        '<path d="' + d + '" fill="none" stroke="' + props.stroke + '" stroke-width="2"/>' + xlabs + '</svg>'
      function onMove(ev) {
        var rect = ev.currentTarget.getBoundingClientRect()
        var x = ((ev.clientX - rect.left) * (box.W / rect.width) - box.L) / Math.max(1, box.iw)
        var i = Math.round(Math.max(0, Math.min(1, x)) * (n - 1))
        setHover(i)
      }
      var xPct = (xAt(hover) / box.W) * 100
      var tip = hover >= 0 && hover < n
      return h('div', { className: 'wb-usage-chart-plot', style: { color: props.stroke }, onMouseMove: onMove, onMouseLeave: function () { setHover(-1) } },
        h('div', { dangerouslySetInnerHTML: { __html: svg } }),
        tip ? h('div', { className: 'wb-usage-guide', style: { left: xPct + '%', top: ((box.T / box.H) * 100) + '%', height: ((box.ih / box.H) * 100) + '%' } }) : null,
        tip ? h('div', { className: 'wb-usage-dot', style: { left: xPct + '%', top: ((yAt(values[hover] || 0) / box.H) * 100) + '%' } }) : null,
        tip ? h('div', { className: 'wb-usage-tip', style: { left: xPct + '%', transform: tipShift(xPct) } },
          h('div', null, String(labels[hover] || '')),
          '请求 ' + String(values[hover] || 0),
        ) : null,
      )
    }

    function UsageStackChart(props) {
      var hoverState = useState(-1)
      var hover = hoverState[0]
      var setHover = hoverState[1]
      var rows = props.rows || []
      var axis = props.axis === 'hour' ? 'hour' : 'day'
      var n = rows.length || 1
      var box = plotBox(n)
      var totals = rows.map(function (r) { return (r.hit || 0) + (r.miss || 0) + (r.out || 0) })
      var max = niceMax(Math.max.apply(null, [0].concat(totals)))
      var slot = box.iw / n
      var bw = Math.max(2, slot * 0.58)
      var bars = rows.map(function (r, i) {
        var cx = box.L + (i + 0.5) * slot
        var x0 = cx - bw / 2
        var y = box.T + box.ih
        var segs = [[r.out, props.colors.out], [r.miss, props.colors.miss], [r.hit, props.colors.hit]]
        var rects = segs.map(function (seg) {
          var hh = max ? (seg[0] / max) * box.ih : 0
          y -= hh
          if (hh <= 0.4) return ''
          return '<rect x="' + x0.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hh.toFixed(1) + '" fill="' + seg[1] + '"/>'
        }).join('')
        var lab = showTick(i, n, r.label, axis)
          ? '<text x="' + cx + '" y="' + (box.H - 8) + '" text-anchor="middle" font-size="10" fill="#94a3b8">' + r.label + '</text>'
          : ''
        return rects + lab
      }).join('')
      var grid = [0, 0.5, 1].map(function (f) {
        var yy = box.T + box.ih - f * box.ih
        var label = f === 0 ? '0' : fmtTokens(max * f)
        return '<line x1="' + box.L + '" x2="' + (box.W - box.R) + '" y1="' + yy + '" y2="' + yy + '" stroke="#e5e7eb"/>' +
          '<text x="' + (box.L - 6) + '" y="' + (yy + 3) + '" text-anchor="end" font-size="10" fill="#94a3b8">' + label + '</text>'
      }).join('')
      var svg = '<svg viewBox="0 0 ' + box.W + ' ' + box.H + '" width="100%" height="150" preserveAspectRatio="none">' + grid + bars + '</svg>'
      function onMove(ev) {
        var rect = ev.currentTarget.getBoundingClientRect()
        var x = ((ev.clientX - rect.left) * (box.W / rect.width) - box.L) / Math.max(1, box.iw)
        setHover(Math.floor(Math.max(0, Math.min(0.999, x)) * n))
      }
      var row = hover >= 0 && hover < n ? rows[hover] : null
      var xPct = ((box.L + (hover + 0.5) * slot) / box.W) * 100
      return h('div', { className: 'wb-usage-chart-plot', onMouseMove: onMove, onMouseLeave: function () { setHover(-1) } },
        h('div', { dangerouslySetInnerHTML: { __html: svg } }),
        row ? h('div', { className: 'wb-usage-tip', style: { left: xPct + '%', transform: tipShift(xPct) } },
          h('div', null, String(row.label || '')),
          h('div', null, '合计 ' + fmtTokens((row.hit || 0) + (row.miss || 0) + (row.out || 0))),
          h('div', null, '命中缓存 ' + fmtTokens(row.hit)),
          h('div', null, '未命中 ' + fmtTokens(row.miss)),
          h('div', null, '输出 ' + fmtTokens(row.out)),
        ) : null,
      )
    }

    function dualRows(series, monthMode) {
      if (monthMode) {
        return (series || []).map(function (r) {
          var date = String(r.date || '').slice(0, 10)
          return {
            range: mdLabel(date) || date,
            tick: mdLabel(date),
            llm_tokens: Number(r.llm_tokens) || 0,
            llm_calls: Number(r.llm_calls) || 0,
            cursor_tokens: Number(r.cursor_tokens) || 0,
            cursor_calls: Number(r.cursor_calls) || 0,
          }
        })
      }
      var byH = {}
      ;(series || []).forEach(function (r) { byH[Number(r.hour)] = r })
      var out = []
      for (var hour = 0; hour < 24; hour++) {
        var r = byH[hour] || {}
        var next = hour >= 23 ? '24:00' : ((hour + 1) < 10 ? '0' : '') + (hour + 1) + ':00'
        var a = (hour < 10 ? '0' : '') + hour + ':00'
        out.push({
          range: a + '～' + next,
          tick: hour,
          llm_tokens: Number(r.llm_tokens) || 0,
          llm_calls: Number(r.llm_calls) || 0,
          cursor_tokens: Number(r.cursor_tokens) || 0,
          cursor_calls: Number(r.cursor_calls) || 0,
        })
      }
      return out
    }

    function UsageDualChart(props) {
      var hoverState = useState(-1)
      var hover = hoverState[0]
      var setHover = hoverState[1]
      var rows = props.rows || []
      var n = Math.max(1, rows.length)
      var W = 560, H = 200, L = 48, R = 14, T = 16, B = 30
      var iw = W - L - R, ih = H - T - B
      var llm = rows.map(function (r) { return r.llm_tokens || 0 })
      var cur = rows.map(function (r) { return r.cursor_tokens || 0 })
      var max = niceMax(Math.max.apply(null, [0].concat(llm, cur)))
      var slot = iw / n
      var pairW = Math.max(4, slot - Math.max(1.5, slot * 0.18))
      var bw = pairW / 2
      var marks = { 0: '00:00', 8: '08:00', 15: '15:00', 23: '23:00' }
      var bars = ''
      for (var j = 0; j < n; j++) {
        var cx = L + j * slot + slot / 2
        var xL = cx - pairW / 2
        var hL = max ? (llm[j] / max) * ih : 0
        var hC = max ? (cur[j] / max) * ih : 0
        if (hL > 0.6) bars += '<rect x="' + xL.toFixed(1) + '" y="' + (T + ih - hL).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hL.toFixed(1) + '" fill="#ff5a1f"/>'
        if (hC > 0.6) bars += '<rect x="' + (xL + bw).toFixed(1) + '" y="' + (T + ih - hC).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hC.toFixed(1) + '" fill="#14b8a6"/>'
        var tick = props.axis === 'day' ? (showTick(j, n, rows[j] && rows[j].tick, 'day') ? rows[j].tick : '') : (marks[j] || '')
        if (tick) bars += '<text x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="#94a3b8">' + tick + '</text>'
      }
      var grid = [0, 0.5, 1].map(function (f) {
        var yy = T + ih - f * ih
        var label = f === 0 ? '0' : fmtTokens(max * f)
        return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="#eceef2"/>' +
          '<text x="' + (L - 8) + '" y="' + (yy + 3) + '" text-anchor="end" font-size="10" fill="#94a3b8">' + label + '</text>'
      }).join('')
      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="200" preserveAspectRatio="none">' + grid + bars + '</svg>'
      function onMove(ev) {
        var rect = ev.currentTarget.getBoundingClientRect()
        var x = ((ev.clientX - rect.left) * (W / rect.width) - L) / Math.max(1, iw)
        setHover(Math.floor(Math.max(0, Math.min(0.999, x)) * n))
      }
      var row = hover >= 0 && hover < rows.length ? rows[hover] : null
      var left = row ? Math.max(14, Math.min(86, ((L + (hover + 0.5) * (iw / n)) / W) * 100)) : 0
      return h('div', { className: 'wb-usage-hour-plot', onMouseMove: onMove, onMouseLeave: function () { setHover(-1) } },
        h('div', { dangerouslySetInnerHTML: { __html: svg } }),
        row ? h('div', { className: 'wb-usage-hour-guide', style: { left: left + '%', top: ((T / H) * 100) + '%', height: ((ih / H) * 100) + '%' } }) : null,
        row ? h('div', { className: 'wb-usage-hour-tip', style: { left: left + '%' } },
          h('span', { className: 'r' }, String(row.range || '')),
          h('span', { className: 'v llm' }, 'LLM ' + fmtTokens(row.llm_tokens)),
          h('span', { className: 'c' }, String(row.llm_calls || 0) + ' 次'),
          h('span', { className: 'v cur' }, '写码 ' + fmtTokens(row.cursor_tokens)),
          h('span', { className: 'c' }, String(row.cursor_calls || 0) + ' 次'),
        ) : null,
      )
    }

    function meterNode(title, subtitle, series, prefix, palette, axis) {
      var rows = series || []
      if (axis === 'hour') {
        var byH = {}
        rows.forEach(function (r) { byH[Number(r.hour)] = r })
        rows = []
        for (var hr = 0; hr < 24; hr++) rows.push(byH[hr] || { hour: hr })
      }
      var calls = rows.map(function (d) { return Number(d[prefix + 'calls']) || 0 })
      var labels = rows.map(function (d, i) {
        if (axis === 'hour') {
          var hh = d.hour != null ? Number(d.hour) : i
          return (hh < 10 ? '0' : '') + hh + ':00'
        }
        return mdLabel(d.date)
      })
      var stacks = rows.map(function (d, i) {
        return {
          label: labels[i],
          hit: Number(d[prefix + 'cache_hit']) || 0,
          miss: Number(d[prefix + 'cache_miss']) || 0,
          out: Number(d[prefix + 'output']) || 0,
        }
      })
      var sumCalls = calls.reduce(function (a, b) { return a + b }, 0)
      var sumTok = rows.reduce(function (a, d) { return a + (Number(d[prefix + 'tokens']) || 0) }, 0)
      return h('section', { className: 'wb-usage-meter' },
        h('div', { className: 'wb-usage-meter-title' }, title),
        h('div', { className: 'wb-usage-meter-sub' }, subtitle),
        h('div', { className: 'wb-usage-meter-grid' },
          h('div', { className: 'wb-usage-chart' },
            h('div', { className: 'wb-usage-chart-head' }, h('span', { className: 't' }, 'API 请求次数'), h('span', { className: 'n' }, String(sumCalls))),
            h(UsageCurveChart, { values: calls, labels: labels, fill: palette.fill, stroke: palette.stroke, gid: prefix, axis: axis }),
          ),
          h('div', { className: 'wb-usage-chart' },
            h('div', { className: 'wb-usage-chart-head' }, h('span', { className: 't' }, 'Tokens'), h('span', { className: 'n', title: fmtFull(sumTok) }, fmtTokens(sumTok))),
            h(UsageStackChart, { rows: stacks, colors: palette, axis: axis }),
            h('div', { className: 'wb-usage-legend' },
              h('span', null, h('i', { style: { background: palette.hit } }), '输入（命中缓存）'),
              h('span', null, h('i', { style: { background: palette.miss } }), '输入（未命中缓存）'),
              h('span', null, h('i', { style: { background: palette.out } }), '输出'),
            ),
          ),
        ),
      )
    }

    var PAGE_SIZES = [10, 50, 100]

    function pageSizeOf(size) {
      return size === 50 || size === 100 ? size : 10
    }

    function pageWindow(total, page, size) {
      var pageSize = pageSizeOf(size)
      var pages = Math.max(1, Math.ceil((total || 0) / pageSize))
      var current = page < 1 ? 1 : (page > pages ? pages : page)
      var start = (current - 1) * pageSize
      return { pages: pages, current: current, start: start, end: Math.min(total || 0, start + pageSize), pageSize: pageSize }
    }

    function Pager(props) {
      var openState = useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var total = props.total || 0
      useEffect(function () {
        if (!open) return undefined
        function close() { setOpen(false) }
        document.addEventListener('click', close)
        return function () { document.removeEventListener('click', close) }
      }, [open])
      if (!total) return null
      var win = pageWindow(total, props.page, props.pageSize)
      return h('div', { className: 'kq-pager' },
        h('span', { className: 'kq-pager-total' }, '共 ' + total + ' 条数据'),
        h('div', { className: 'kq-pager-right' },
          h('div', { className: 'kq-pager-size' },
            h('button', {
              type: 'button',
              className: 'kq-pager-size-btn' + (open ? ' open' : ''),
              onClick: function (event) {
                event.stopPropagation()
                setOpen(!open)
              },
            }, String(win.pageSize) + '条/页', h('i', { className: 'kq-pager-caret', 'aria-hidden': 'true' })),
            open ? h('div', {
              className: 'kq-pager-menu',
              onClick: function (event) { event.stopPropagation() },
            }, PAGE_SIZES.map(function (n) {
              return h('button', {
                type: 'button',
                key: String(n),
                className: n === win.pageSize ? 'on' : '',
                onClick: function () {
                  setOpen(false)
                  if (n !== win.pageSize) {
                    props.setPageSize(n)
                    props.setPage(1)
                  }
                },
              }, n + '条/页')
            })) : null,
          ),
          h('button', {
            type: 'button',
            className: 'kq-pager-arrow',
            disabled: win.current <= 1,
            onClick: function () { props.setPage(win.current - 1) },
          }, '‹'),
          h('span', { className: 'kq-pager-num' }, String(win.current)),
          h('button', {
            type: 'button',
            className: 'kq-pager-arrow',
            disabled: win.current >= win.pages,
            onClick: function () { props.setPage(win.current + 1) },
          }, '›'),
        ),
      )
    }

    function providerKeyMask(provider, keys) {
      if (!keys) return ''
      var name = String(provider || '')
      if (/deepseek/i.test(name)) return keys.deepseek || ''
      if (/zhipu|bigmodel|vision/i.test(name)) return keys.zhipu || ''
      if (/cursor/i.test(name)) return keys.cursor || ''
      return ''
    }

    function modelTable(usage, isAdmin, providerKeys, page, setPage, pageSize, setPageSize) {
      var llm = (usage && usage.llm && usage.llm.models) || []
      var cursor = (usage && usage.cursor && usage.cursor.models) || []
      var rows = llm.map(function (r) {
        return { provider: r.provider || '', model: r.model || '', side: 'LLM', calls: r.calls || 0, tokens: r.tokens || 0 }
      }).concat(cursor.map(function (r) {
        return { provider: r.provider || '', model: r.model || '', side: '写码', calls: r.calls || 0, tokens: r.tokens || 0 }
      }))
      var win = pageWindow(rows.length, page, pageSize)
      var slice = rows.slice(win.start, win.end)
      var head = [h('th', null, '供应商')]
      if (isAdmin) head.push(h('th', { title: '系统配置里该供应商的 Key，只显示前几位和后四位' }, 'Key'))
      head.push(
        h('th', null, '模型'),
        h('th', null, '用途'),
        h('th', { className: 'num' }, '次数'),
        h('th', { className: 'num' }, 'Token'),
      )
      var table = h('table', { className: 'kq-table kq-grid' },
        h('thead', null, h.apply(null, ['tr', null].concat(head))),
        h('tbody', null, slice.map(function (r, i) {
          var cells = [h('td', null, r.provider || '—')]
          if (isAdmin) {
            var mask = providerKeyMask(r.provider, providerKeys) || '—'
            cells.push(h('td', {
              className: 'kq-keymask',
              title: mask === '—' ? '系统配置里没有读到这把 Key' : '系统配置里该供应商的 Key，只显示前几位和后四位',
            }, mask))
          }
          cells.push(
            h('td', null, r.model || '—'),
            h('td', null, r.side),
            h('td', { className: 'num' }, String(r.calls)),
            h('td', { className: 'num', title: fmtFull(r.tokens) }, fmtTokens(r.tokens)),
          )
          return h.apply(null, ['tr', { key: r.provider + '\0' + r.model + '\0' + r.side + i }].concat(cells))
        })),
      )
      return h('div', { className: 'wb-set-card' },
        h('h3', null, '各模型'),
        h('div', { className: 'body' },
          rows.length ? h('div', { className: 'kq-detail-scroll' }, table) : h('p', null, '这一天还没有读到模型调用。'),
          h(Pager, { total: rows.length, page: page, setPage: setPage, pageSize: pageSize, setPageSize: setPageSize }),
        ),
      )
    }

    function shortWhen(ts) {
      var text = String(ts || '')
      return text.length >= 16 ? text.slice(5, 16).replace('T', ' ') : text
    }

    function pushUnique(list, value) {
      var text = String(value || '')
      if (!text || list.indexOf(text) >= 0) return
      list.push(text)
    }

    function formatDialogues(items) {
      var by = {}
      var order = []
      items.forEach(function (item) {
        var turn = Number(item && item.turn)
        if (!turn || turn !== Math.floor(turn) || turn <= 0) return
        if (!by[turn]) { by[turn] = []; order.push(turn) }
        var step = Number(item && item.step)
        if (step && step === Math.floor(step) && step > 0 && by[turn].indexOf(step) < 0) by[turn].push(step)
      })
      if (!order.length) return ''
      return order.map(function (turn) {
        var steps = by[turn].slice().sort(function (a, b) { return a - b })
        if (!steps.length) return '第' + turn + '轮'
        if (steps.length === 1) return '第' + turn + '轮第' + steps[0] + '步'
        var consecutive = steps.every(function (value, index) { return index === 0 || value === steps[index - 1] + 1 })
        if (consecutive) return '第' + turn + '轮第' + steps[0] + '–' + steps[steps.length - 1] + '步'
        return '第' + turn + '轮第' + steps.join('、') + '步'
      }).join('；')
    }

    function taskRows(rows, admin) {
      var map = {}
      var order = []
      rows.forEach(function (row) {
        var task = row.task || ''
        var key = admin ? (task + '|' + (row.sessionId || '')) : task
        var bucket = map[key]
        if (!bucket) {
          bucket = { task: task, tokens: 0, calls: 0, providers: [], models: [], first: row.ts || '', last: row.ts || '' }
          if (admin) {
            bucket.users = []
            bucket.sessionIds = []
            bucket.dialogues = []
            bucket.input = 0
            bucket.cacheRead = 0
            bucket.cacheWrite = 0
            bucket.output = 0
          }
          map[key] = bucket
          order.push(key)
        }
        bucket.tokens += Number(row.tokens) || 0
        bucket.calls += 1
        if (row.provider && bucket.providers.indexOf(row.provider) < 0) bucket.providers.push(row.provider)
        if (row.model && bucket.models.indexOf(row.model) < 0) bucket.models.push(row.model)
        if (row.ts && (!bucket.first || row.ts < bucket.first)) bucket.first = row.ts
        if (row.ts && row.ts > bucket.last) bucket.last = row.ts
        if (admin) {
          pushUnique(bucket.users, row.userName || row.userId)
          pushUnique(bucket.sessionIds, row.sessionId)
          if (row.turn) bucket.dialogues.push({ turn: row.turn, step: row.step })
          bucket.input += Number(row.input) || 0
          bucket.cacheRead += Number(row.cacheRead) || 0
          bucket.cacheWrite += Number(row.cacheWrite) || 0
          bucket.output += Number(row.output) || 0
        }
      })
      return order.map(function (task) { return map[task] }).sort(function (a, b) {
        return a.last < b.last ? 1 : a.last > b.last ? -1 : 0
      })
    }

    function tokenCell(n) {
      return h('td', { className: 'num', title: fmtFull(n) }, fmtTokens(n))
    }

    function detailTable(usage, page, setPage, pageSize, setPageSize, admin) {
      var raw = (usage && usage.detail) || []
      var rows = taskRows(raw, admin)
      var win = pageWindow(rows.length, page, pageSize)
      var slice = rows.slice(win.start, win.end)
      var head = [
        h('th', null, '时间'),
        h('th', null, '任务名称'),
      ]
      if (admin) {
        head.push(
          h('th', null, '用户'),
          h('th', null, '会话ID'),
          h('th', null, '对话'),
        )
      }
      head.push(
        h('th', null, '供应商'),
        h('th', null, '模型'),
        h('th', { className: 'num' }, '次数'),
      )
      if (admin) {
        head.push(
          h('th', { className: 'num' }, '输入'),
          h('th', { className: 'num' }, '缓存读取'),
          h('th', { className: 'num' }, '缓存写入'),
          h('th', { className: 'num' }, '输出'),
          h('th', { className: 'num' }, '总用量'),
        )
      } else {
        head.push(h('th', null, 'Token'))
      }
      var table = h('table', { className: 'kq-table kq-grid' },
        h('thead', null, h.apply(null, ['tr', null].concat(head))),
        h('tbody', null, slice.map(function (r, i) {
          var begin = shortWhen(r.first)
          var end = shortWhen(r.last)
          var when = begin === end ? begin : (begin.slice(0, 6) === end.slice(0, 6) ? begin + '–' + end.slice(6) : begin + '–' + end)
          var task = r.task || '—'
          var cells = [
            h('td', null, when),
            h('td', { className: 'kq-task', title: task }, task),
          ]
          if (admin) {
            var sessions = (r.sessionIds || []).join('\n') || '—'
            var dialogue = formatDialogues(r.dialogues || []) || '—'
            var users = (r.users || []).join('、') || '—'
            cells.push(
              h('td', { className: 'kq-id', title: users }, users),
              h('td', { className: 'kq-session', title: sessions }, sessions),
              h('td', { className: 'kq-dialogue', title: dialogue }, dialogue),
            )
          }
          cells.push(
            h('td', null, r.providers.join('、') || '—'),
            h('td', null, r.models.join('、') || '—'),
            h('td', { className: 'num' }, String(r.calls)),
          )
          if (admin) {
            cells.push(tokenCell(r.input), tokenCell(r.cacheRead), tokenCell(r.cacheWrite), tokenCell(r.output), tokenCell(r.tokens))
          } else {
            cells.push(tokenCell(r.tokens))
          }
          return h.apply(null, ['tr', { key: task + (win.start + i) }].concat(cells))
        })),
      )
      return h('div', { className: 'wb-set-card' },
        h('h3', null, '调用明细'),
        h('div', { className: 'body' },
          rows.length ? h('div', { className: 'kq-detail-scroll' }, table) : h('p', null, '这一天还没有调用明细。'),
          h(Pager, { total: rows.length, page: page, setPage: setPage, pageSize: pageSize, setPageSize: setPageSize }),
          raw.length >= 200 ? h('p', null, admin
            ? '只列出最近 200 条调用，再按任务合并。上面的次数和总用量仍是全部合计。'
            : '只列出最近 200 条调用，再按任务合并。上面的次数和 Token 仍是全部合计。') : null,
        ),
      )
    }

    function peopleNode(title, subtitle, rows) {
      var list = (rows || []).slice().sort(function (a, b) {
        var ta = (Number(a.llm_tokens) || 0) + (Number(a.cursor_tokens) || 0)
        var tb = (Number(b.llm_tokens) || 0) + (Number(b.cursor_tokens) || 0)
        return tb - ta
      })
      var maxTok = 0
      list.forEach(function (r) {
        maxTok = Math.max(maxTok, Number(r.llm_tokens) || 0, Number(r.cursor_tokens) || 0)
      })
      function pct(n) {
        if (maxTok <= 0 || !n) return 0
        return Math.max(2, Math.round((n / maxTok) * 100))
      }
      return h('section', { className: 'wb-usage-people' },
        h('div', { className: 'wb-usage-people-title' }, title),
        h('div', { className: 'wb-usage-people-sub' }, subtitle),
        list.length ? h('div', { className: 'wb-usage-hbar' },
          h('div', { className: 'wb-usage-hbar-legend' },
            h('span', null, h('i', { style: { background: '#3b82f6' } }), 'LLM Token'),
            h('span', null, h('i', { style: { background: '#14b8a6' } }), '写码 Token'),
          ),
          list.map(function (r, idx) {
            var name = r.display_name || r.username || '—'
            var llmTok = Number(r.llm_tokens) || 0
            var curTok = Number(r.cursor_tokens) || 0
            return h('div', { className: 'wb-usage-hbar-person', key: String(r.user_id || name) + idx },
              h('div', { className: 'wb-usage-hbar-head' },
                h('div', { className: 'wb-usage-hbar-name' }, name),
                h('div', { className: 'wb-usage-hbar-total' }, '合计 ' + fmtTokens(llmTok + curTok)),
              ),
              h('div', { className: 'wb-usage-hbar-row' },
                h('div', { className: 'wb-usage-hbar-lab' }, 'LLM'),
                h('div', { className: 'wb-usage-hbar-track' }, h('div', { className: 'wb-usage-hbar-fill llm', style: { width: pct(llmTok) + '%' } })),
                h('div', { className: 'wb-usage-hbar-val' }, fmtTokens(llmTok)),
              ),
              h('div', { className: 'wb-usage-hbar-row' },
                h('div', { className: 'wb-usage-hbar-lab' }, '写码'),
                h('div', { className: 'wb-usage-hbar-track' }, h('div', { className: 'wb-usage-hbar-fill cursor', style: { width: pct(curTok) + '%' } })),
                h('div', { className: 'wb-usage-hbar-val' }, fmtTokens(curTok)),
              ),
            )
          }),
        ) : h('p', { className: 'wb-usage-people-sub' }, '暂无员工账号。'),
      )
    }

    var LIMIT_OPTIONS = [
      { value: '', label: '不限' },
      { value: '10000', label: '1万' },
      { value: '50000', label: '5万' },
      { value: '100000', label: '10万' },
      { value: '200000', label: '20万' },
      { value: '500000', label: '50万' },
      { value: '1000000', label: '100万' },
      { value: '2000000', label: '200万' },
      { value: '5000000', label: '500万' },
      { value: '10000000', label: '1000万' },
      { value: '20000000', label: '2000万' },
      { value: '50000000', label: '5000万' },
    ]

    function limitChoices(current) {
      var value = current == null || current === '' ? '' : String(current)
      var options = LIMIT_OPTIONS.slice()
      if (value && !options.some(function (item) { return item.value === value })) {
        options.push({ value: value, label: value })
      }
      return options
    }

    function LimitSelect(props) {
      var value = props.value == null || props.value === '' ? '' : String(props.value)
      return h('select', {
        className: 'kq-limit',
        value: value,
        onChange: function (e) { props.onChange(e.target.value) },
      }, limitChoices(value).map(function (item) {
        return h('option', { key: item.value || 'none', value: item.value }, item.label)
      }))
    }

    function KeyLimit(props) {
      var row = props.row
      var limitState = useState(row.limitTokens == null ? '' : String(row.limitTokens))
      return h('tr', null,
        h('td', null, row.assigneeName || '未分配'),
        h('td', null, row.ready === false ? row.tail + ' · 待重新保存' : row.tail),
        h('td', null, fmtTokens(row.used)),
        h('td', null, h(LimitSelect, { value: limitState[0], onChange: limitState[1] })),
        h('td', null, h('div', { className: 'kq-actions' },
          h('button', {
            type: 'button',
            className: 'kq-btn',
            onClick: function () { props.onSave(row, limitState[0]) },
          }, '保存'),
          h('button', {
            type: 'button',
            className: 'kq-btn',
            onClick: function () { props.onDelete(row) },
          }, '删除'),
        )),
      )
    }

    function KeyAdmin(props) {
      var colleagues = props.colleagues || []
      var keyState = useState('')
      var whoState = useState('')
      var limitState = useState('')
      var who = whoState[0] || (colleagues[0] && colleagues[0].id) || ''
      return h('div', null,
        h('p', null, '把 DeepSeek Key 分给平台上的同事。登录哪个账号，对话就用哪一把。系统配置里的 Key 可以留空。'),
        colleagues.length ? h('div', { className: 'kq-add' },
          h('input', {
            className: 'kq-key',
            type: 'password',
            autoComplete: 'off',
            placeholder: 'DeepSeek Key',
            value: keyState[0],
            onChange: function (e) { keyState[1](e.target.value) },
          }),
          h('select', { value: who, onChange: function (e) { whoState[1](e.target.value) } },
            colleagues.map(function (person) {
              return h('option', { key: person.id, value: person.id }, person.displayName || person.id)
            }),
          ),
          h(LimitSelect, { value: limitState[0], onChange: limitState[1] }),
          h('button', {
            type: 'button',
            className: 'kq-btn',
            onClick: function () {
              var secret = keyState[0]
              keyState[1]('')
              props.onAdd(secret, who, limitState[0])
            },
          }, '添加'),
        ) : h('p', null, '还没有读到平台上的同事。'),
        Array.isArray(props.keys) ? h('table', { className: 'kq-table' },
          h('thead', null, h('tr', null,
            h('th', null, '同事'),
            h('th', null, '尾号'),
            h('th', null, '本月已用'),
            h('th', null, '上限'),
            h('th', null, ''),
          )),
          h('tbody', null, props.keys.map(function (row) {
            return h(KeyLimit, { key: row.keyId, row: row, onSave: props.onSave, onDelete: props.onDelete })
          })),
        ) : null,
      )
    }

    function Panel() {
      var dataState = useState(null)
      var data = dataState[0]
      var setData = dataState[1]
      var errState = useState('')
      var err = errState[0]
      var setErr = errState[1]
      var busyState = useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var dateState = useState(usageTodayYmd())
      var onDate = dateState[0]
      var setOnDate = dateState[1]
      var grainState = useState('day')
      var grain = grainState[0]
      var setGrain = grainState[1]
      var scopeState = useState('personal')
      var scope = scopeState[0]
      var setScope = scopeState[1]
      var detailPageState = useState(1)
      var detailPage = detailPageState[0]
      var setDetailPage = detailPageState[1]
      var modelPageState = useState(1)
      var modelPage = modelPageState[0]
      var setModelPage = modelPageState[1]
      var detailSizeState = useState(10)
      var detailPageSize = detailSizeState[0]
      var setDetailPageSize = detailSizeState[1]
      var modelSizeState = useState(10)
      var modelPageSize = modelSizeState[0]
      var setModelPageSize = modelSizeState[1]

      function reload() {
        return load(onDate, grain, scope)
      }

      function limitBody(limitText) {
        var text = String(limitText || '').trim()
        if (!text || text === '不限') return null
        return Number(text)
      }

      function saveLimit(row, limitText) {
        return api('/v1/local/keys/' + encodeURIComponent(row.keyId), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ limitTokens: limitBody(limitText) }),
        }).then(reload)
      }

      function removeKey(row) {
        return api('/v1/local/keys/' + encodeURIComponent(row.keyId), { method: 'DELETE' }).then(reload)
      }

      function addKey(secret, assigneeUserId, limitText) {
        return api('/v1/local/keys', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            apiKey: secret,
            assigneeUserId: assigneeUserId,
            limitTokens: limitBody(limitText),
          }),
        }).then(reload)
      }

      function load(day, nextGrain, nextScope) {
        var d = day || onDate
        var g = nextGrain || grain
        var sc = nextScope || scope
        setBusy(true)
        return api('/v1/local/panel?on=' + encodeURIComponent(d) + '&grain=' + encodeURIComponent(g) + '&scope=' + encodeURIComponent(sc))
          .then(function (body) {
            setData(body)
            setErr('')
            return true
          })
          .catch(function () {
            setErr('本机限额面板没有连上。聊天不受影响。')
            return false
          })
          .then(function (ok) { setBusy(false); return ok })
      }

      useEffect(function () {
        var timer = 0
        var stopped = false
        var tries = 0
        function tick() {
          load(onDate, grain, scope).then(function (ok) {
            if (stopped || ok) return
            tries += 1
            if (tries >= 8) return
            timer = setTimeout(tick, 1000)
          })
        }
        tick()
        return function () { stopped = true; clearTimeout(timer) }
      }, [onDate, grain, scope])

      useEffect(function () { setDetailPage(1); setModelPage(1) }, [onDate, grain, scope])

      var usage = (data && data.usage) || null
      var monthMode = grain === 'month'
      var isAdmin = Boolean(data && ((data.viewer && data.viewer.admin) || data.viewerAdmin))
      var view = isAdmin ? scope : 'personal'
      var showKeys = view === 'keys'
      var isEnt = view === 'enterprise'
      var series = monthMode ? ((usage && usage.monthly) || []) : ((usage && usage.hourly) || [])
      var axis = monthMode ? 'day' : 'hour'
      var rows = dualRows(series, monthMode)
      var sumLlmTok = rows.reduce(function (a, r) { return a + r.llm_tokens }, 0)
      var sumCurTok = rows.reduce(function (a, r) { return a + r.cursor_tokens }, 0)
      var sumLlmCalls = rows.reduce(function (a, r) { return a + r.llm_calls }, 0)
      var sumCurCalls = rows.reduce(function (a, r) { return a + r.cursor_calls }, 0)
      var when = (usage && usage.on) || onDate
      var monthLab = monthLabel((usage && usage.month) || onDate)
      var dayLab = monthMode
        ? ((isEnt ? '全员 · ' : '') + (monthLab || String(onDate).slice(0, 7)))
        : ((when === usageTodayYmd() ? '今日 ' + mdLabel(when) : mdLabel(when)))
      if (isEnt && !monthMode) dayLab = '全员 · ' + dayLab
      var llmModel = (usage && usage.llm && usage.llm.models && usage.llm.models[0] && usage.llm.models[0].model) || '暂无调用'
      var codeModel = (usage && usage.cursor && usage.cursor.models && usage.cursor.models[0] && usage.cursor.models[0].model) || '暂无调用'
      var stamp = monthMode ? (monthLab || '') : when
      var today = (usage && usage.today) || {}
      var people = (data && data.people) || []
      var msg = err || statusText(data)

      return h('div', { className: 'kq-root' },
        h('div', { className: 'wb-usage-view' },
          h('div', { className: 'wb-usage-view-body' },
            h('div', { className: 'wb-usage-page' },
              h('div', { className: 'kq-sticky' },
                h('div', { className: 'kq-title-row' },
                  h('h2', { className: 'kq-page-title' }, '用量统计'),
                  isAdmin ? h('table', { className: 'wb-usage-tabs', role: 'tablist' },
                    h('tbody', null, h('tr', null,
                      h('td', { className: view === 'personal' ? 'active' : '' },
                        h('button', { type: 'button', onClick: function () { setScope('personal') } }, '个人用量')),
                      h('td', { className: view === 'enterprise' ? 'active' : '' },
                        h('button', { type: 'button', onClick: function () { setScope('enterprise') } }, '企业用量')),
                    )),
                  ) : null,
                ),
                showKeys ? null : h('div', { className: 'wb-usage-filter' },
                  h('label', null, monthMode ? '月份' : '日期'),
                  h('input', {
                    type: monthMode ? 'month' : 'date',
                    value: monthMode ? String(onDate).slice(0, 7) : onDate,
                    onChange: function (ev) {
                      var v = ev.target.value
                      if (!v) return
                      setOnDate(v.length === 7 ? v + '-01' : v)
                    },
                  }),
                  h('label', null, '统计粒度'),
                  h('select', {
                    value: grain,
                    onChange: function (ev) { setGrain(ev.target.value === 'month' ? 'month' : 'day') },
                  },
                    h('option', { value: 'day' }, '按日'),
                    h('option', { value: 'month' }, '按月'),
                  ),
                  h('div', { className: 'kq-corner' },
                    h('button', {
                      type: 'button',
                      className: 'wb-set-btn',
                      disabled: busy,
                      onClick: function () { load(onDate, grain, scope) },
                    }, busy ? '刷新中…' : '刷新'),
                    msg ? h('span', { className: 'wb-set-msg' + (err ? ' err' : ' ok') }, msg) : null,
                  ),
                ),
              ),
              showKeys ? h('div', { className: 'wb-set-card kq-setup' },
                h('div', { className: 'body' },
                  data && data.viewer
                    ? h(KeyAdmin, { colleagues: data.colleagues || [], keys: data.keys || [], onAdd: addKey, onSave: saveLimit, onDelete: removeKey })
                    : h('p', null, '请先用平台账号登录。'),
                ),
              ) : null,
              showKeys ? null : h('div', null,
              h('div', { className: 'wb-usage-kpis' },
                h('div', { className: 'wb-usage-kpi' },
                  h('div', { className: 'k' }, dayLab + ' · LLM'),
                  h('div', { className: 'row' }, h('span', { className: 't' }, 'API 请求次数'), h('span', { className: 'n' }, String((today.llm && today.llm.calls) || 0))),
                  h('div', { className: 'row' }, h('span', { className: 't' }, 'Token 消耗'), h('span', { className: 'n', title: fmtFull(today.llm && today.llm.tokens) }, fmtTokens(today.llm && today.llm.tokens))),
                ),
                h('div', { className: 'wb-usage-kpi' },
                  h('div', { className: 'k' }, dayLab + ' · 写码'),
                  h('div', { className: 'row' }, h('span', { className: 't' }, 'API 请求次数'), h('span', { className: 'n' }, String((today.cursor && today.cursor.calls) || 0))),
                  h('div', { className: 'row' }, h('span', { className: 't' }, 'Token 消耗'), h('span', { className: 'n', title: fmtFull(today.cursor && today.cursor.tokens) }, fmtTokens(today.cursor && today.cursor.tokens))),
                ),
              ),
              h('div', { className: 'wb-set-card' },
                h('h3', null, monthMode ? (isEnt ? '各日用量（全员）' : '各日用量') : (isEnt ? '各时段用量（全员）' : '各时段用量')),
                h('div', { className: 'body' },
                  h('div', { className: 'wb-usage-hour-sub' },
                    (monthMode ? (monthLab + ' 逐日') : (when + ' 00:00–24:00')) +
                    ' · LLM ' + sumLlmCalls + ' 次 / ' + fmtTokens(sumLlmTok) +
                    ' · 写码 ' + sumCurCalls + ' 次 / ' + fmtTokens(sumCurTok),
                  ),
                  h('div', { className: 'wb-usage-legend' },
                    h('span', null, h('i', { style: { background: '#ff5a1f' } }), 'LLM'),
                    h('span', null, h('i', { style: { background: '#14b8a6' } }), '写码'),
                  ),
                  h(UsageDualChart, { rows: rows, axis: axis }),
                ),
              ),
              meterNode(isEnt ? 'LLM（全员）' : 'LLM', llmModel + (stamp ? ' · ' + stamp : ''), series, 'llm_', LLM_PAL, axis),
              meterNode(isEnt ? '写码（全员）' : '写码', codeModel + (stamp ? ' · ' + stamp : ''), series, 'cursor_', CODE_PAL, axis),
              isEnt ? peopleNode(
                '员工用量（LLM + 写码）',
                (monthMode ? '按月' : '按日') + ' · ' + (monthMode ? ((usage && usage.month) || String(onDate).slice(0, 7)) : when) +
                  ' · 按合计 Token 从高到低 · 含全部账号（含管理员）· 共 ' + String(people.length) + ' 人',
                people,
              ) : null,
              modelTable(usage, isAdmin, data && data.providerKeys, modelPage, setModelPage, modelPageSize, setModelPageSize),
              detailTable(usage, detailPage, setDetailPage, detailPageSize, setDetailPageSize, isAdmin),
              ),
            ),
          ),
        ),
      )
    }

    function supportsDockedPanels(ctx) {
      return !!(ctx && ctx.layout && typeof ctx.layout.selectPanel === 'function')
    }

    function Icon(props) {
      var size = (props && props.size) || 18
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M5 19V10M12 19V5M19 19v-7', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round' }),
      )
    }

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') return
      ensureCss()
      if (!supportsDockedPanels(ctx)) {
        ctx.slots.inject('sidebar.footer.action', function () {
          return ctx.slots.register({ name: 'sidebar.footer.action', id: PANEL_ID, order: -4 }, function () {
            return h('button', { type: 'button' }, '用量统计')
          })
        })
        return
      }
      ctx.slots.inject('main', function () {
        return ctx.slots.register({ name: 'main', key: PANEL_ID }, function QuotaMain() {
          return h(Panel)
        })
      })
      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: -4,
          label: function () { return '用量统计' },
        }, function QuotaIcon(props) { return h(Icon, { size: (props && props.size) || 18 }) })
      })
      if (typeof ctx.effect === 'function') {
        ctx.effect(function () {
          function onActivate(event) {
            var detail = event && event.detail
            if (!detail || detail.pluginId === PLUGIN_ID) return
            try { if (ctx.layout && ctx.layout.current === PANEL_ID) ctx.layout.selectPanel('session') } catch (err) { /* 交给宿主 */ }
          }
          window.addEventListener(WORKSPACE_EVENT, onActivate)
          return function () { window.removeEventListener(WORKSPACE_EVENT, onActivate) }
        }, 'key-quota: leave panel')
      }
    }

    module.exports = { inject: ['slots', 'layout'], apply: apply }
    return module.exports
  },
})
