/**
 * 任务上下文右侧栏：只读聚合写码 Job / Git 摘要 / ESC 状态；提交走 begin-ui → 对话确认卡。
 * BUILD_MARK: acontext-0.1.67-launch-301
 */
window.__ModuleLoader__.load({
  id: '@zhongruan/dsh-agent-context',
  factory: (require) => {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useRef = React.useRef

    // 独立 kind，避免与终端 / 知识库 / 宿主内置 tab 撞名
    var TAB_ID = '@zhongruan/dsh-agent-context/rail'
    /** 历史可见文案；界面不再展示，仅用于识别/清残留 */
    var TAB_TITLE_LEGACY = '任务上下文'
    /** strip / 输入栏展示标题：空（红框「任务上下文」已去掉） */
    var TAB_TITLE = ''
    var TAB_ARIA = '会话侧栏'
    var LS_CC_PORT = 'dsh-cursor-chat-port'
    var LS_CC_HOST = 'dsh-cursor-chat-host'
    var LS_ESC_PORT = 'dsh-esc-port'
    var CSS_VER = '0.1.68'
    /** 右栏宽度：每次启动回到默认 300；运行中由用户拖拽说了算（不再跨启动沿用） */
    var RAIL_MIN_W = 300
    var RAIL_DEFAULT_W = 300
    var RAIL_MAX_W = 720
    var LS_RAIL_W = 'dsh-agent-context-rail-w'
    /** 对话正文/输入区最大宽度：40rem 窄栏，宽屏居中留白 */
    var CHAT_CONTENT_MAX_W = 640

    function lsGet(key, fallback) {
      try {
        var v = localStorage.getItem(key)
        if (v) return v
      } catch (e) {}
      return fallback
    }

    function cursorBase() {
      var host = lsGet(LS_CC_HOST, '127.0.0.1')
      var port = lsGet(LS_CC_PORT, '18791')
      if (!/^\d+$/.test(port)) port = '18791'
      if (port === '80') return 'http://' + host
      return 'http://' + host + ':' + port
    }

    function escBase() {
      var port = lsGet(LS_ESC_PORT, '')
      if (!/^\d+$/.test(port)) return ''
      return 'http://127.0.0.1:' + port
    }

    function ensureCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-acontext="' + CSS_VER + '"]')) return
      try {
        document.querySelectorAll('style[data-acontext]').forEach(function (n) {
          n.remove()
        })
      } catch (e) {}
      var style = document.createElement('style')
      style.setAttribute('data-acontext', CSS_VER)
      style.textContent =
        /* 严格对标 Qode 右侧任务上下文：窄条、扁平分区、圆角图标行 */
        '.acx-root{display:flex;flex-direction:column;width:100%;min-width:0;height:100%;min-height:0;box-sizing:border-box;' +
        'padding:12px 12px 16px;gap:16px;font-size:13px;line-height:1.45;' +
        'color:var(--text,#1f1f1f);background:#f5f5f7;overflow:auto}' +
        'body[data-ds-dark-theme] .acx-root{color:var(--text,#e8e8e8);background:var(--surface,#1a1a1a)}' +
        /* 图二：叶标+⋯+更新于+跨轮摘要正文；长文限高渐变+圆形箭头 */
        '.acx-summary{position:relative;min-width:0;box-sizing:border-box;' +
        'background:#fff;border-radius:12px;padding:12px 12px 10px;' +
        'box-shadow:0 1px 3px rgba(0,0,0,.06),0 6px 18px rgba(0,0,0,.04)}' +
        '.acx-summary.has-toggle{padding-bottom:18px;margin-bottom:10px}' +
        'body[data-ds-dark-theme] .acx-summary{background:#2c2c2e;' +
        'box-shadow:0 1px 3px rgba(0,0,0,.35)}' +
        '.acx-summary-hd{display:flex;align-items:center;gap:8px;margin-bottom:2px}' +
        '.acx-leaf{width:20px;height:20px;color:#34c759;flex:0 0 auto}' +
        /* 插件内重复入口一律隐藏；系统侧栏只走宿主 strip 红框开关 */
        '.acx-sys-open,.acx-chrome,.acx-summary-actions,.acx-more{display:none!important}' +
        '.acx-updated{font-size:12px;color:#8e8e93;margin:0 0 8px}' +
        '.acx-summary-body{margin:0;color:#3a3a3c;font-size:13px;line-height:1.55;' +
        'white-space:pre-wrap;word-break:break-word}' +
        /* 折叠态仅限高；淡出交给卡片 ::after，勿在两段字符串 + 之间插注释（会变成一元 + 得到 NaN） */
        '.acx-summary-body.is-collapsed{max-height:8.6em;overflow:hidden;position:relative}' +
        '.acx-summary.has-toggle:not(.is-expanded)::after{content:"";position:absolute;left:12px;right:12px;bottom:0;' +
        'height:64px;pointer-events:none;z-index:1;' +
        'background:linear-gradient(to bottom,rgba(255,255,255,0) 0%,rgba(255,255,255,.4) 35%,#fff 100%)}' +
        'body[data-ds-dark-theme] .acx-summary-body{color:#d1d1d6}' +
        'body[data-ds-dark-theme] .acx-summary.has-toggle:not(.is-expanded)::after{' +
        'background:linear-gradient(to bottom,rgba(44,44,46,0) 0%,rgba(44,44,46,.4) 35%,#2c2c2e 100%)}' +
        /* 参考图：圆形箭头压在卡片底边正中 */
        '.acx-summary-fab{appearance:none;position:absolute;left:50%;bottom:-14px;transform:translateX(-50%);' +
        'width:28px;height:28px;border-radius:999px;border:0;padding:0;cursor:pointer;z-index:3;' +
        'background:#fff;color:#c7c7cc;box-shadow:0 1px 4px rgba(0,0,0,.1),0 0 0 1px rgba(0,0,0,.06);' +
        'display:inline-flex;align-items:center;justify-content:center}' +
        '.acx-summary-fab:hover{color:#8e8e93;box-shadow:0 2px 8px rgba(0,0,0,.14)}' +
        '.acx-summary-fab svg{width:14px;height:14px;display:block}' +
        'body[data-ds-dark-theme] .acx-summary-fab{background:#3a3a3c;color:#8e8e93;' +
        'box-shadow:0 2px 10px rgba(0,0,0,.4)}' +
        '.acx-block{display:flex;flex-direction:column;gap:6px}' +
        '.acx-block-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;' +
        'font-size:12px;font-weight:500;color:#8e8e93;padding:2px 0}' +
        '.acx-block-hd .acx-plus{appearance:none;border:0;background:transparent;color:#8e8e93;' +
        'width:22px;height:22px;border-radius:6px;font-size:16px;line-height:1;cursor:pointer;' +
        'padding:0;display:inline-flex;align-items:center;justify-content:center}' +
        '.acx-block-hd .acx-plus:hover{color:#1f1f1f;background:rgba(127,127,127,.1)}' +
        '.acx-block-bd{display:flex;flex-direction:column;gap:2px}' +
        '.acx-item{appearance:none;border:0;background:transparent;width:100%;display:flex;align-items:center;' +
        'gap:10px;padding:6px 8px;border-radius:8px;text-align:left;color:inherit;font:inherit;cursor:default;' +
        'box-shadow:none;outline:0;min-height:36px;box-sizing:border-box}' +
        'button.acx-item{cursor:pointer}' +
        'button.acx-item:hover,.acx-item.is-active{background:rgba(127,127,127,.1)}' +
        'button.acx-item:disabled{opacity:.45;cursor:default}' +
        'button.acx-item:disabled:hover{background:transparent}' +
        '.acx-ico{flex:0 0 auto;width:28px;height:28px;min-width:28px;min-height:28px;' +
        'border-radius:7px;background:#ebebf0;overflow:hidden;border:0;' +
        'display:inline-flex;align-items:center;justify-content:center;color:#3a3a3c}' +
        'body[data-ds-dark-theme] .acx-ico{background:#2c2c2e;color:#d1d1d6}' +
        '.acx-ico svg{width:16px!important;height:16px!important;max-width:16px;max-height:16px;display:block;flex:none}' +
        '.acx-root svg{max-width:20px;max-height:20px}' +
        '.acx-ico.file-html{background:#fff3e6;color:#ff9500}' +
        '.acx-ico.file-img{background:#eaf8ef;color:#34c759}' +
        '.acx-ico.file-md{background:#e8f1ff;color:#0a84ff}' +
        '.acx-item-label{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
        'font-size:13px;color:#1f1f1f;font-weight:400}' +
        'body[data-ds-dark-theme] .acx-item-label{color:#e8e8e8}' +
        '.acx-item-file:hover{background:rgba(127,127,127,.1)}' +
        '.acx-item-main{appearance:none;border:0;background:transparent;flex:1;min-width:0;display:flex;' +
        'align-items:center;gap:10px;padding:0;margin:0;color:inherit;font:inherit;text-align:left;' +
        'cursor:pointer;min-height:24px}' +
        '.acx-item-dl{appearance:none;border:0;background:transparent;color:inherit;flex:0 0 auto;' +
        'height:24px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;' +
        'gap:4px;padding:0 8px;font-size:12px;line-height:1;opacity:.7;white-space:nowrap}' +
        '.acx-item-dl:hover{background:rgba(127,127,127,.15);opacity:1}' +
        '.acx-item-dl svg{width:13px!important;height:13px!important;display:block}' +
        '.acx-diff{font-variant-numeric:tabular-nums;font-weight:600;font-size:13px;letter-spacing:0}' +
        '.acx-diff .plus{color:#34c759}' +
        '.acx-diff .minus{color:#ff3b30;margin-left:6px}' +
        '.acx-empty{font-size:12px;color:#8e8e93;padding:4px 4px 2px}' +
        '.acx-err{color:#ff3b30;font-size:12px;padding:0 4px}' +
        '.acx-ok{color:#34c759;font-size:12px;padding:0 4px}' +
        /* 对标 Qode：会话淡入；绝不拆宿主 strip（PanelChrome 收起/全屏开关在 strip-fill） */
        '.acx-root{animation:acx-fade-in .18s ease-out}' +
        '@keyframes acx-fade-in{from{opacity:0;transform:translateX(6px)}to{opacity:1;transform:none}}' +
        '[data-sidebar-right-panel]:has(.acx-root) [data-dockkit-strip]{' +
        'min-height:36px!important;height:auto!important;max-height:none!important;' +
        'opacity:1!important;pointer-events:auto!important;overflow:visible!important;' +
        'display:flex!important;align-items:center!important}' +
        /* 只藏会话 tab 的关闭钮，保留芯片与 strip-fill 系统开关 */
        '[data-sidebar-right-panel]:has(.acx-root) [data-dockkit-strip-tabs] button[aria-label*="关闭"],' +
        '[data-sidebar-right-panel]:has(.acx-root) [data-dockkit-strip-tabs] button[title*="关闭"],' +
        '[data-sidebar-right-panel]:has(.acx-root) [data-dockkit-strip-tabs] [data-dockkit-close]{' +
        'display:none!important}' +
        '[data-sidebar-right-panel]:has(.acx-root) [data-dockkit-strip-fill],' +
        '[data-sidebar-right-panel]:has(.acx-root) [data-sidebar-right-toggle],' +
        '[data-sidebar-right-panel]:has(.acx-root) [data-sidebar-right-mode]{' +
        'display:inline-flex!important;opacity:1!important;visibility:visible!important;' +
        'pointer-events:auto!important}' +
        '[data-sidebar-right-panel]:has(.acx-root) [data-dockkit-host],' +
        '[data-sidebar-right-panel]:has(.acx-root) [data-dockkit-pane]{min-height:0;height:100%}' +
        '.acx-fallback-rail{display:none!important}' +
        '.acx-chip{display:none!important}' +
        /* 兜底：任何仍露出的「任务上下文」芯片文案藏掉 */
        '[data-acx-hide-label="1"]{font-size:0!important;line-height:0!important;color:transparent!important;' +
        'width:0!important;min-width:0!important;max-width:0!important;padding:0!important;margin:0!important;' +
        'overflow:hidden!important;border:0!important;opacity:0!important;pointer-events:none!important}'
      document.head.appendChild(style)
    }

    function fmtComma(n) {
      return String(Math.max(0, Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    function basename(p) {
      var s = String(p || '').replace(/\\/g, '/')
      var i = s.lastIndexOf('/')
      return i >= 0 ? s.slice(i + 1) : s
    }

    function fileKind(name) {
      var n = String(name || '').toLowerCase()
      if (/\.(png|jpe?g|gif|webp|svg|bmp)$/.test(n)) return 'img'
      if (/\.(html?|htm)$/.test(n)) return 'html'
      if (/\.(md|markdown|mdx)$/.test(n)) return 'md'
      return 'file'
    }

    function svgIcon(children, view) {
      // 必须带 width/height，避免 CSS 未命中时 SVG 默认 300×150 撑爆面板
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: view || '0 0 24 24',
          width: 16,
          height: 16,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.8',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        children,
      )
    }

    function IcoLeaf() {
      return h(
        'svg',
        {
          className: 'acx-leaf',
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: 20,
          height: 20,
          fill: 'currentColor',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', {
          d: 'M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66C7.23 18.05 9 13 17 12V8m0-2a6 6 0 0 0-6-6C7 4 4 8 4 12c0 2 .5 3.5 1.5 5L17 6Z',
        }),
      )
    }

    function IcoGit() {
      // 参考图：网络/变更图（三节点连线）
      return svgIcon([
        h('circle', { cx: '12', cy: '5', r: '2.1', fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: '5.5', cy: '18', r: '2.1', fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: '18.5', cy: '18', r: '2.1', fill: 'currentColor', stroke: 'none' }),
        h('path', { d: 'M12 7.2v4.8M12 12l-6.5 4.2M12 12l6.5 4.2' }),
      ])
    }

    function IcoMonitor() {
      return svgIcon([
        h('rect', { x: '3', y: '4', width: '18', height: '12', rx: '2' }),
        h('path', { d: 'M8 20h8M12 16v4' }),
      ])
    }

    function IcoBranch() {
      return svgIcon([
        h('circle', { cx: '6', cy: '6', r: '2', fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: '18', cy: '6', r: '2', fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: '6', cy: '18', r: '2', fill: 'currentColor', stroke: 'none' }),
        h('path', { d: 'M6 8v8M8 6h6a4 4 0 0 1 4 4' }),
      ])
    }

    function IcoCommit() {
      // 参考图：提交点（竖线 + 中心节点）
      return svgIcon([
        h('path', { d: 'M12 3v6M12 15v6' }),
        h('circle', { cx: '12', cy: '12', r: '3.2' }),
      ])
    }

    function IcoSkill() {
      // 锤子图标（对标参考图技能行）
      return svgIcon([
        h('path', { d: 'M14 5l5 5-3 1-4-4 2-2z' }),
        h('path', { d: 'M11 8L5 14l3 3 6-6' }),
        h('path', { d: 'M5 19l2-1' }),
      ])
    }

    function IcoFile(kind) {
      if (kind === 'img') {
        return svgIcon([
          h('rect', { x: '3', y: '5', width: '18', height: '14', rx: '2' }),
          h('circle', { cx: '9', cy: '10', r: '1.6', fill: 'currentColor', stroke: 'none' }),
          h('path', { d: 'M21 16l-5-5-4 4-2-2-5 5' }),
        ])
      }
      if (kind === 'html') {
        // 简化 HTML5 盾牌感
        return svgIcon([
          h('path', { d: 'M5 3h14l-1.2 16.2L12 21l-5.8-1.8L5 3z' }),
          h('path', { d: 'M8.5 8.5h7l-.3 3.2H12v2.2h2.8l-.25 2.6L12 17.2l-2.5-.6' }),
        ])
      }
      if (kind === 'md') {
        return svgIcon([
          h('path', { d: 'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' }),
          h('path', { d: 'M8 15V9l2.5 4L13 9v6M15.5 12.5h2' }),
        ])
      }
      return svgIcon([
        h('path', { d: 'M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z' }),
        h('path', { d: 'M14 3v5h5' }),
      ])
    }

    function IcoGlobe() {
      return svgIcon([
        h('circle', { cx: '12', cy: '12', r: '9' }),
        h('path', { d: 'M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18' }),
      ])
    }

    function IcoDownload() {
      return svgIcon([
        h('path', { d: 'M12 4v10' }),
        h('path', { d: 'M7.5 10.2 12 14.7l4.5-4.5' }),
        h('path', { d: 'M5 19h14' }),
      ])
    }

    function IcoMore() {
      return svgIcon([
        h('circle', { cx: '6', cy: '12', r: '1.4', fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: '12', cy: '12', r: '1.4', fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: '18', cy: '12', r: '1.4', fill: 'currentColor', stroke: 'none' }),
      ])
    }

    function tile(ico, className) {
      return h('span', { className: 'acx-ico' + (className ? ' ' + className : ''), 'aria-hidden': 'true' }, ico)
    }

    function itemRow(opts) {
      var tag = opts.onClick ? 'button' : 'div'
      var props = {
        className: 'acx-item' + (opts.active ? ' is-active' : ''),
        title: opts.title || (typeof opts.label === 'string' ? opts.label : undefined),
      }
      if (opts.key != null) props.key = opts.key
      if (opts.onClick) {
        props.type = 'button'
        props.onClick = opts.onClick
        if (opts.disabled) props.disabled = true
      }
      return h(tag, props, tile(opts.ico, opts.icoClass), h('span', { className: 'acx-item-label' }, opts.label))
    }

    function copyText(text) {
      var t = String(text || '').trim()
      if (!t) return Promise.resolve(false)
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          return navigator.clipboard.writeText(t).then(
            function () {
              return true
            },
            function () {
              return false
            },
          )
        }
      } catch (e) {}
      return Promise.resolve(false)
    }

    function scrollToBlock(title) {
      try {
        var root = document.querySelector('.acx-root')
        if (!root) return
        var heads = root.querySelectorAll('.acx-block-hd span')
        for (var i = 0; i < heads.length; i++) {
          if (String(heads[i].textContent || '').trim() === title) {
            var sec = heads[i].closest('.acx-block')
            if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            return
          }
        }
      } catch (e) {}
    }

    function block(title, body, trailing) {
      return h(
        'section',
        { className: 'acx-block' },
        h('div', { className: 'acx-block-hd' }, h('span', null, title), trailing || null),
        h('div', { className: 'acx-block-bd' }, body),
      )
    }

    function resolveSessionTitle(props, ctx, sessionId) {
      var sid = String(sessionId || '').trim()
      try {
        if (props && typeof props.useSessions === 'function') {
          var t0 = props.useSessions(function (s) {
            var row = s && s.current
            return (row && (row.title || row.name || row.topic)) || ''
          })
          if (t0) return String(t0).trim()
        }
      } catch (e) {}
      try {
        var sessions = ctx && ctx.get && ctx.get('sessions')
        var snap = sessions && sessions.list && sessions.list.getSnapshot && sessions.list.getSnapshot()
        var cur = sid || (snap && snap.current)
        var list = (snap && (snap.sessions || snap.items || snap.list)) || null
        var row = null
        if (list && !Array.isArray(list) && cur != null) row = list[cur] || list[String(cur)]
        if (!row && Array.isArray(list)) {
          for (var i = 0; i < list.length; i++) {
            var it = list[i]
            if (it && String(it.id || it.sessionId || '') === String(cur)) {
              row = it
              break
            }
          }
        }
        var t1 = row && (row.title || row.name || row.topic)
        if (t1) return String(t1).trim()
      } catch (e2) {}
      try {
        var doc = String((typeof document !== 'undefined' && document.title) || '').trim()
        if (doc) {
          var cut = doc.split(/\s*[—–|\-]\s*/)[0].trim()
          if (cut && cut.length >= 2 && !/DeepSeek|Harness|dsh/i.test(cut)) return cut
        }
      } catch (e3) {}
      return ''
    }

    function isHollowHighlight(text) {
      var t = String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!t) return true
      t = t
        .replace(/^结果[：:]\s*/, '')
        .replace(/^[✅❌⚠ℹ⏹⏸]\s*/, '')
        .replace(/已完成[。．]?/g, '')
        .replace(/^[,，。．、:\s]+/, '')
        .trim()
      if (!t) return true
      if (/^已同步\s*\d+\s*个文件/.test(t)) return true
      if (/^已删除\s*\d+\s*个文件/.test(t)) return true
      if (/^已改动并同步相关文件/.test(t)) return true
      if (/^写码流程已结束/.test(t)) return true
      if (/^见上方结果说明/.test(t)) return true
      if (/^本轮未改代码/.test(t)) return true
      if (/^开发操作已结束/.test(t)) return true
      return false
    }

    function tidyHighlight(raw, maxLen) {
      var max = maxLen || 72
      var hit = String(raw || '')
        .replace(/^结果[：:]\s*/, '')
        .replace(/^[✅❌⚠ℹ⏹⏸]\s*/, '')
        .replace(/已完成[。．]?/g, '')
        .replace(/^[,，。．、:\s]+/, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!hit) return ''
      var first = hit.split(/[；;]/)[0].trim()
      hit = first || hit
      if (/^[。．]/.test(hit)) hit = hit.replace(/^[。．]+/, '').trim()
      if (isHollowHighlight(hit)) return ''
      if (hit.length > max) hit = hit.slice(0, max - 2) + '…'
      return hit
    }

    function extractUrls(raw) {
      var s = String(raw || '')
      var re = /https?:\/\/[^\s)\]"'<>]+|127\.0\.0\.1:\d+[^\s)\]"'<>]*/g
      var out = []
      var seen = {}
      var m
      while ((m = re.exec(s))) {
        var u = String(m[0] || '').replace(/[.,;:]+$/, '')
        if (!u || seen[u]) continue
        seen[u] = true
        out.push(u)
      }
      return out
    }

    function shortUrlLabel(u) {
      var s = String(u || '')
      try {
        if (/^https?:\/\//i.test(s)) {
          var url = new URL(s)
          var path = (url.pathname || '/') + (url.search || '')
          if (path === '/' || path === '') return url.host
          return url.host + (path.length > 28 ? path.slice(0, 26) + '…' : path)
        }
      } catch (e) {}
      return s.length > 42 ? s.slice(0, 40) + '…' : s
    }

    function formatClock(ts) {
      try {
        var d = ts ? new Date(ts) : new Date()
        if (isNaN(d.getTime())) d = new Date()
        var hh = String(d.getHours()).padStart(2, '0')
        var mm = String(d.getMinutes()).padStart(2, '0')
        return hh + ':' + mm
      } catch (e) {
        return ''
      }
    }

    function IcoChevron(up) {
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '2.2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', { d: up ? 'M6 14l6-6 6 6' : 'M6 10l6 6 6-6' }),
      )
    }
    // note: call as IcoChevron(bool), not h(IcoChevron, …)

    /** 图二摘要卡：叶标 + ⋯ + 更新于 + 跨轮正文；过长则渐变+圆形箭头 */
    function SummaryCard(props) {
      var text = String(props.text || '')
      var updated = String(props.updated || '')
      var expandedState = useState(false)
      var expanded = expandedState[0]
      var setExpanded = expandedState[1]
      var overflowState = useState(false)
      var overflow = overflowState[0]
      var setOverflow = overflowState[1]
      var bodyRef = useRef(null)

      useEffect(
        function () {
          setExpanded(false)
        },
        [text],
      )

      useEffect(
        function () {
          var el = bodyRef.current
          if (!el) return
          var measure = function () {
            if (expanded) {
              el.classList.add('is-collapsed')
              var over = el.scrollHeight > el.clientHeight + 2
              el.classList.remove('is-collapsed')
              setOverflow(over)
              return
            }
            setOverflow(el.scrollHeight > el.clientHeight + 2)
          }
          measure()
          var t = setTimeout(measure, 60)
          return function () {
            clearTimeout(t)
          }
        },
        [text, expanded],
      )

      return h(
        'div',
        {
          className:
            'acx-summary' +
            (overflow ? ' has-toggle' : '') +
            (expanded ? ' is-expanded' : ''),
        },
        h('div', { className: 'acx-summary-hd' }, h(IcoLeaf)),
        h('p', { className: 'acx-updated' }, updated ? '更新于 ' + updated : ''),
        h(
          'div',
          {
            ref: bodyRef,
            className: 'acx-summary-body' + (expanded ? '' : ' is-collapsed'),
          },
          text,
        ),
        overflow
          ? h(
              'button',
              {
                type: 'button',
                className: 'acx-summary-fab',
                title: expanded ? '收起摘要' : '展开摘要',
                'aria-label': expanded ? '收起摘要' : '展开摘要',
                onClick: function () {
                  setExpanded(!expanded)
                },
              },
              IcoChevron(expanded),
            )
          : null,
      )
    }

    var slimHold = 0

    function setSlimRightbar(on) {
      try {
        if (on) slimHold += 1
        else slimHold = Math.max(0, slimHold - 1)
      } catch (e) {}
    }

    /**
     * 清掉覆盖层时代留下的 margin/padding（中间空白的直接原因）。
     * 注意：不要周期性 remove 宿主 rightbar 的 width，否则和 React 分栏打架。
     */
    /** 会话面板在场时强制露出宿主 strip-fill（收起右侧栏开关） */
    function ensureHostStripChrome() {
      try {
        var panel = hostRightPanelEl()
        if (!panel || !panel.querySelector('.acx-root')) return
        var strip = panel.querySelector('[data-dockkit-strip]')
        if (strip) {
          if (strip.style) {
            strip.style.removeProperty('height')
            strip.style.removeProperty('max-height')
            strip.style.removeProperty('min-height')
            strip.style.removeProperty('opacity')
            strip.style.removeProperty('pointer-events')
            strip.style.removeProperty('overflow')
            strip.style.setProperty('min-height', '36px')
            strip.style.setProperty('display', 'flex')
            strip.style.setProperty('align-items', 'center')
            strip.style.setProperty('opacity', '1')
            strip.style.setProperty('pointer-events', 'auto')
          }
        }
        var fill = panel.querySelector('[data-dockkit-strip-fill]')
        if (fill && fill.style) {
          fill.style.setProperty('display', 'inline-flex')
          fill.style.setProperty('opacity', '1')
          fill.style.setProperty('visibility', 'visible')
          fill.style.setProperty('pointer-events', 'auto')
        }
        var toggles = panel.querySelectorAll(
          '[data-sidebar-right-toggle], [data-sidebar-right-mode]',
        )
        for (var i = 0; i < toggles.length; i++) {
          var btn = toggles[i]
          if (!btn || !btn.style) continue
          btn.style.setProperty('display', 'inline-flex')
          btn.style.setProperty('opacity', '1')
          btn.style.setProperty('visibility', 'visible')
          btn.style.setProperty('pointer-events', 'auto')
        }
      } catch (e) {}
    }

    /**
     * 只清本插件自己写过的痕迹；宿主 rightbar 的 width / grid 一律不碰。
     * 宽度归宿主拖拽把手所有，系统侧栏与会话侧栏共用同一列。
     */
    function scrubFrameWidthDamage() {
      try {
        document.documentElement.classList.remove('acx-slim-right', 'acx-session-rail-on')
        document.documentElement.style.removeProperty('--acx-rail-w')
        document.documentElement.style.removeProperty('--acx-titlebar-h')
        var frames = document.querySelectorAll('[data-acx-frame], [data-acx-rail-w], .acx-fallback-rail')
        for (var f = 0; f < frames.length; f++) {
          var frame = frames[f]
          if (!frame) continue
          if (frame.classList && frame.classList.contains('acx-fallback-rail')) {
            // 旧版兜底窄条会占住对话区宽度，直接移除
            try {
              frame.remove()
            } catch (eRm) {}
            continue
          }
          if (frame.style) {
            frame.style.removeProperty('grid-template-columns')
          }
          try {
            frame.removeAttribute('data-acx-frame')
            frame.removeAttribute('data-acx-rail-w')
          } catch (eAttr) {}
        }
      } catch (e) {}
    }

    function scrubLayoutDamage() {
      try {
        scrubFrameWidthDamage()
        document.querySelectorAll('style[data-acontext]').forEach(function (n) {
          var varAttr = n.getAttribute('data-acontext') || ''
          if (varAttr && varAttr !== CSS_VER) n.remove()
        })
        ensureHostStripChrome()
        scrubVisibleTaskContextLabels()
      } catch (e) {}
    }

    function hostRightPanelEl() {
      return document.querySelector('[data-sidebar-right-panel]')
    }

    function normalizeStripText(el) {
      return String((el && el.innerText) || '')
        .replace(/\s+/g, ' ')
        .replace(/[×✕xX]/g, '')
        .trim()
    }

    /** 宿主 strip 是否只剩旧版「任务上下文」tab（可关闭顶栏的元凶） */
    function isStaleAcxHostTabOnly() {
      try {
        var panel = hostRightPanelEl()
        if (!panel) return false
        var strip = panel.querySelector('[data-dockkit-strip]')
        var text = normalizeStripText(strip)
        if (text === TAB_TITLE_LEGACY) return true
        var nodes = panel.querySelectorAll('.acx-root')
        for (var i = 0; i < nodes.length; i++) {
          if (!nodes[i].closest || !nodes[i].closest('[data-acx-rail]')) return true
        }
        return false
      } catch (e) {
        return false
      }
    }

    /** 宿主右栏是否展开（宽度是最可靠信号，属性只作补充） */
    function isHostRightSidebarOpen() {
      try {
        var panel = hostRightPanelEl()
        if (!panel) return false
        if (panel.getAttribute('aria-hidden') === 'true') return false
        var w = panel.getBoundingClientRect ? panel.getBoundingClientRect().width : 0
        if (w >= 80) return true
        if (panel.hasAttribute('data-sidebar-right-open')) return true
        return !!panel.querySelector('.acx-root')
      } catch (e) {
        return false
      }
    }

    function getLayoutApi(ctx) {
      try {
        // 须 inject: layout；优先 ctx.layout（与其它插件一致）
        if (ctx && ctx.layout) return ctx.layout
        if (ctx && typeof ctx.get === 'function') return ctx.get('layout') || null
      } catch (e) {}
      return null
    }

    function tryCloseHostRightbar(ctx) {
      try {
        var layout = getLayoutApi(ctx)
        if (!layout) return false
        if (typeof layout.closeRightbar === 'function') {
          layout.closeRightbar()
          return true
        }
        if (layout.panels && typeof layout.panels.closeRightbar === 'function') {
          layout.panels.closeRightbar()
          return true
        }
        if (layout.actions && typeof layout.actions.closeRightbar === 'function') {
          layout.actions.closeRightbar()
          return true
        }
      } catch (e) {}
      return false
    }

    /** 打开宿主系统右栏（标题栏原开关被挡时的保底入口） */
    function tryOpenHostRightbar(ctx) {
      try {
        var layout = getLayoutApi(ctx)
        if (!layout) return false
        var open =
          (typeof layout.openRightbar === 'function' && layout.openRightbar) ||
          (layout.panels && typeof layout.panels.openRightbar === 'function' && layout.panels.openRightbar) ||
          (layout.actions && typeof layout.actions.openRightbar === 'function' && layout.actions.openRightbar)
        if (!open) return false
        // 只打开，不改宽度。rightbar 已有值时宿主不会重置。
        open.call(layout.panels || layout.actions || layout, true, false)
        return true
      } catch (e) {
        return false
      }
    }

    /** 设置宿主右栏宽度；仅在会话首开时调用一次，之后宽度归宿主拖拽 */
    function setRightbarWidth(ctx, px) {
      try {
        var layout = getLayoutApi(ctx)
        if (!layout) return false
        var face = layout.panels || layout.actions || layout
        if (face && typeof face.setRightbar === 'function') {
          face.setRightbar(px)
          return true
        }
        if (typeof layout.setRightbar === 'function') {
          layout.setRightbar(px)
          return true
        }
      } catch (e) {}
      return false
    }

    function getSidebarRightApi(ctx) {
      try {
        if (ctx && typeof ctx.get === 'function') {
          var viaGet = ctx.get('sidebarRight')
          if (viaGet) return viaGet
        }
      } catch (e) {}
      try {
        if (ctx && ctx.sidebarRight) return ctx.sidebarRight
      } catch (e2) {}
      return null
    }

    /** 点 strip 里任意非本插件的 tab（不依赖宿主 tab id 命名） */
    function clickHostSystemTab() {
      try {
        var panel = hostRightPanelEl()
        if (!panel) return false
        var strip = panel.querySelector('[data-dockkit-strip-tabs]')
        if (!strip) return false
        var tabs = strip.querySelectorAll('button, [role="tab"], a')
        for (var i = 0; i < tabs.length; i++) {
          var b = tabs[i]
          if (!b || b.disabled) continue
          if (b.getAttribute('aria-selected') === 'true') continue
          if (b.closest && b.closest('.acx-root')) continue
          var label = String(
            b.getAttribute('aria-label') || b.getAttribute('title') || b.innerText || '',
          )
            .replace(/\s+/g, ' ')
            .trim()
          if (!label || label.indexOf(TAB_TITLE_LEGACY) >= 0) continue
          // strip 的动作钮（关闭/收起/浮动）不是 tab
          if (/关闭|收起|展开|浮动|停靠/.test(label)) continue
          b.click()
          return true
        }
      } catch (e) {}
      return false
    }

    /** 切到系统侧栏：优先点宿主系统 tab，其次 openRightbar / terminal */
    function openSystemSidebar(ctx) {
      var ok = clickHostSystemTab()
      if (ok) return ok
      try {
        var sidebar = getSidebarRightApi(ctx)
        if (sidebar && typeof sidebar.openTab === 'function') {
          sidebar.openTab('terminal')
          ok = true
        }
      } catch (eGuide) {}
      if (!ok && tryOpenHostRightbar(ctx)) ok = true
      return ok
    }

    function isAcxTabKind(kind) {
      var k = String(kind || '')
      return k.indexOf('dsh-agent-context') >= 0 || k === TAB_ID
    }

    /** 从任意 layout JSON 里抠掉本插件 tab */
    function stripAcxTabsFromValue(v) {
      var changed = false
      if (!v || typeof v !== 'object') return false
      if (Array.isArray(v)) {
        for (var i = v.length - 1; i >= 0; i--) {
          var item = v[i]
          if (item && typeof item === 'object') {
            if (
              isAcxTabKind(item.kind) ||
              isAcxTabKind(item.id) ||
              item.title === TAB_TITLE_LEGACY ||
              item.title === '任务上下文'
            ) {
              v.splice(i, 1)
              changed = true
              continue
            }
            if (stripAcxTabsFromValue(item)) changed = true
          }
        }
        return changed
      }
      Object.keys(v).forEach(function (k) {
        if (stripAcxTabsFromValue(v[k])) changed = true
      })
      if (v.expanded === true) {
        var tabs = v.tabs
        if (Array.isArray(tabs) && tabs.length === 0) {
          v.expanded = false
          changed = true
        }
      }
      return changed
    }

    /** 页面上残留的「任务上下文」可见文案（strip / 输入栏）一律抹掉 */
    function scrubVisibleTaskContextLabels() {
      try {
        var needle = TAB_TITLE_LEGACY
        if (!document.body) return

        var hideEl = function (el) {
          if (!el || el.nodeType !== 1) return
          try {
            el.setAttribute('data-acx-hide-label', '1')
            el.setAttribute('aria-label', '')
            el.setAttribute('title', '')
          } catch (eHide) {}
          try {
            for (var c = el.childNodes, j = c.length - 1; j >= 0; j--) {
              if (c[j].nodeType === 3 && String(c[j].textContent || '').indexOf(needle) >= 0) {
                c[j].textContent = ''
              }
            }
            var raw = String(el.textContent || '')
              .replace(/\s+/g, ' ')
              .replace(/[×✕xX]/g, '')
              .trim()
            if (raw === needle) el.textContent = ''
          } catch (eTxt) {}
        }

        var matchesNeedle = function (s) {
          var t = String(s || '')
            .replace(/\s+/g, ' ')
            .replace(/[×✕xX]/g, '')
            .trim()
          return t === needle
        }

        // 1) 文本节点精确命中
        try {
          var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
          var textNodes = []
          while (walker.nextNode()) textNodes.push(walker.currentNode)
          for (var ti = 0; ti < textNodes.length; ti++) {
            var tn = textNodes[ti]
            if (!matchesNeedle(tn.textContent)) continue
            tn.textContent = ''
            var p = tn.parentElement
            if (!p) continue
            var chip =
              (p.closest &&
                (p.closest('[data-dockkit-strip-tabs] *') ||
                  p.closest('button') ||
                  p.closest('[role="tab"]') ||
                  p.closest('[class*="chip"]'))) ||
              p
            // strip 内：藏掉整颗标题芯片；输入栏同理
            if (p.closest && p.closest('[data-dockkit-strip-tabs]')) {
              hideEl(chip)
            } else if (p.closest && (p.closest('[class*="InputBar"]') || p.closest('[class*="composer"]'))) {
              hideEl(chip)
            }
          }
        } catch (eWalk) {}

        // 2) 元素级兜底（含 strip / 输入区）
        var nodes = document.querySelectorAll(
          '[data-dockkit-strip-tabs] button, [data-dockkit-strip-tabs] a, [data-dockkit-strip-tabs] span, [data-dockkit-strip-tabs] div, [class*="InputBar"] button, [class*="composer"] button',
        )
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i]
          if (matchesNeedle(el.textContent)) hideEl(el)
        }
      } catch (e) {}
    }

    /** 清掉宿主 localStorage 里旧 openTab 留下的可关闭「任务上下文」 */
    function purgeOwnTabFromSidebarStorage() {
      try {
        if (typeof localStorage === 'undefined') return
        for (var i = localStorage.length - 1; i >= 0; i--) {
          var key = localStorage.key(i)
          if (!key || key.indexOf('dsh.sidebar-right.v1.') !== 0) continue
          var raw = localStorage.getItem(key)
          if (!raw) continue
          if (
            raw.indexOf('dsh-agent-context') < 0 &&
            raw.indexOf(TAB_ID) < 0 &&
            raw.indexOf(TAB_TITLE_LEGACY) < 0 &&
            raw.indexOf('任务上下文') < 0
          ) {
            continue
          }
          try {
            var data = JSON.parse(raw)
            if (stripAcxTabsFromValue(data)) localStorage.setItem(key, JSON.stringify(data))
          } catch (eParse) {
            try {
              localStorage.removeItem(key)
            } catch (eDel) {}
          }
        }
      } catch (e) {}
    }

    /**
     * 旧版 openTab 会把可关闭 tab 写进宿主右栏并持久化。
     * 每次同步都清 storage + 关掉「仅任务上下文」的宿主栏，避免用户还能点 ×。
     */
    function dismissStaleDockedAcx(ctx) {
      purgeOwnTabFromSidebarStorage()
      try {
        if (isStaleAcxHostTabOnly()) tryCloseHostRightbar(ctx)
      } catch (e) {}
    }

    function clampRailWidth(px) {
      var max = Math.min(RAIL_MAX_W, Math.round(window.innerWidth * 0.7))
      var n = Math.round(Number(px) || RAIL_DEFAULT_W)
      if (n < RAIL_MIN_W) n = RAIL_MIN_W
      if (n > max) n = max
      return n
    }

    function readStoredRailWidth() {
      try {
        var v = localStorage.getItem(LS_RAIL_W)
        if (v && /^\d+$/.test(v)) return clampRailWidth(Number(v))
      } catch (e) {}
      return RAIL_DEFAULT_W
    }

    function persistRailWidth(px) {
      var w = clampRailWidth(px)
      try {
        localStorage.setItem(LS_RAIL_W, String(w))
      } catch (e) {}
      return w
    }

    /** 旧版铺满逻辑留下的内联宽度：撤销，交还宿主自己的居中布局 */
    function releaseWidened(el) {
      if (!el || !el.getAttribute || !el.getAttribute('data-acx-fill')) return false
      try {
        el.style.removeProperty('max-width')
        el.style.removeProperty('width')
        el.style.removeProperty('box-sizing')
        el.style.removeProperty('margin-left')
        el.style.removeProperty('margin-right')
        el.removeAttribute('data-acx-fill')
        return true
      } catch (e) {}
      return false
    }

    function fillChatGutter() {
      // 主流阅读宽度：宽屏居中留白，窄屏随容器收缩；不再铺满到右栏左缘
      var cssW = 'min(' + CHAT_CONTENT_MAX_W + 'px, 100%)'
      try {
        document.documentElement.style.setProperty('--dsh-chat-content-width', cssW, 'important')
      } catch (eRoot) {}
      var roots = document.querySelectorAll('[data-conversation-content]')
      for (var i = 0; i < roots.length; i++) {
        roots[i].style.setProperty('--dsh-chat-content-width', cssW, 'important')
      }
      var released = 0
      var widened = document.querySelectorAll('[data-acx-fill]')
      for (var j = 0; j < widened.length; j++) {
        if (releaseWidened(widened[j])) released += 1
      }
      // 切会话/切 tab 会重建节点：每次应用后把观察器重新挂到最新节点
      bindChatFillTargets()
      try {
        console.info('[agent-context][width]', cssW, 'released=' + released)
      } catch (eLog) {}
      return { width: cssW, released: released }
    }

    var fillTimer = null
    var fillObserver = null
    var observed = []

    function scheduleFillChat(delay) {
      if (fillTimer) clearTimeout(fillTimer)
      fillTimer = setTimeout(function () {
        fillTimer = null
        fillChatGutter()
      }, typeof delay === 'number' ? delay : 120)
    }

    function bindChatFillTargets() {
      if (!fillObserver) return
      var next = []
      var sels = [
        '[data-conversation-content]',
        '[data-conversation-scroll]',
        '[data-sidebar-right-panel]',
      ]
      for (var i = 0; i < sels.length; i++) {
        var ns = document.querySelectorAll(sels[i])
        for (var j = 0; j < ns.length; j++) next.push(ns[j])
      }
      var anchor = document.querySelector('[data-acx-composer-anchor]')
      if (anchor && anchor.parentElement) next.push(anchor.parentElement)
      var same = next.length === observed.length
      if (same) {
        for (var k = 0; k < next.length; k++) {
          if (next[k] !== observed[k]) {
            same = false
            break
          }
        }
      }
      if (same) return
      for (var o = 0; o < observed.length; o++) {
        try {
          fillObserver.unobserve(observed[o])
        } catch (e0) {}
      }
      observed = next
      for (var n = 0; n < observed.length; n++) {
        try {
          fillObserver.observe(observed[n], { box: 'border-box' })
        } catch (e1) {}
      }
    }

    /** 拖宿主把手、切 tab 时都会触发尺寸变化；消抖后补一次，不再轮询写样式 */
    function watchChatFill() {
      if (typeof ResizeObserver === 'undefined') return
      if (!fillObserver) {
        fillObserver = new ResizeObserver(function () {
          scheduleFillChat(120)
        })
      }
      bindChatFillTargets()
    }

    function stopChatFillWatch() {
      if (fillTimer) {
        clearTimeout(fillTimer)
        fillTimer = null
      }
      try {
        if (fillObserver) fillObserver.disconnect()
      } catch (e) {}
      fillObserver = null
      observed = []
    }

    function applyRailWidth(px) {
      return persistRailWidth(px)
    }
    function setSessionRailClass(on) {
      try {
        if (on) persistRailWidth(readStoredRailWidth())
      } catch (e) {}
    }

    /** 量标题栏高度，避免固定薄栏盖住右上角「打开系统侧栏」按钮 */
    function applyTitlebarSafeTop() {
      try {
        var h = 52
        var candidates = document.querySelectorAll(
          '[data-windows-titlebar], [class*="titleBar"], [class*="TitleBar"], [class*="titlebar"]',
        )
        for (var i = 0; i < candidates.length; i++) {
          var r = candidates[i].getBoundingClientRect()
          if (r.top <= 2 && r.height >= 28 && r.height <= 72 && r.width > 200) {
            h = Math.max(h, Math.round(r.bottom))
          }
        }
        // 右上角可点控件（系统侧栏开关）底边也计入
        var btns = document.querySelectorAll('button, [role="button"]')
        for (var j = 0; j < btns.length; j++) {
          var b = btns[j]
          var br = b.getBoundingClientRect()
          if (br.top > 8 || br.height < 18 || br.height > 44) continue
          if (br.right < window.innerWidth - 120) continue
          h = Math.max(h, Math.round(br.bottom + 4))
        }
        document.documentElement.style.setProperty('--acx-titlebar-h', h + 'px')
      } catch (e) {}
    }

    function expandHomePath(raw, home) {
      var s = String(raw || '').trim()
      if (!s) return ''
      if (s === '~') return String(home || '').trim() || s
      if (s.indexOf('~/') === 0 || s.indexOf('~\\') === 0) {
        var h0 = String(home || '').trim().replace(/[\\/]+$/, '')
        if (!h0) return s
        return h0 + s.slice(1).replace(/\\/g, '/')
      }
      return s
    }

    function sessionRowCwd(row) {
      if (!row || typeof row !== 'object') return ''
      var c = row.cwd || (row.header && row.header.cwd) || ''
      return String(c || '').trim()
    }

    /** 与写码插件 resolveDshCwd 对齐：cwd 在 sessions.byId[sessionId]，不是 s.current */
    function resolveSessionCwd(props, ctx, sessionIdHint) {
      var home = props && props.home
      var sid = String(sessionIdHint || (props && props.sessionId) || '').trim()
      var direct = String((props && props.cwd) || '').trim()
      if (direct) return expandHomePath(direct, home)
      try {
        if (props && typeof props.useSessions === 'function' && sid) {
          var cwd = props.useSessions(function (s) {
            var row = s && s.byId && s.byId[sid]
            return sessionRowCwd(row)
          })
          if (cwd) return expandHomePath(cwd, home)
        }
      } catch (e) {}
      try {
        var bag = ctx || (props && props.ctx) || null
        var sessions = bag && bag.get && bag.get('sessions')
        var snap = sessions && sessions.list && sessions.list.getSnapshot && sessions.list.getSnapshot()
        if (snap) {
          var cur = sid || (snap.current != null ? String(snap.current) : '')
          var byId = snap.byId || snap.sessions || null
          var row = null
          if (byId && cur) row = byId[cur] || byId[String(cur)]
          if (!row && Array.isArray(snap.items)) {
            for (var i = 0; i < snap.items.length; i++) {
              var it = snap.items[i]
              if (it && String(it.id || it.sessionId || '') === String(cur)) {
                row = it
                break
              }
            }
          }
          var c2 = sessionRowCwd(row)
          if (c2) return expandHomePath(c2, home)
        }
      } catch (e2) {}
      return ''
    }

    function pickWorkspaceFromJobs(jobList) {
      var items = jobList || []
      for (var i = 0; i < items.length; i++) {
        var j = items[i]
        if (!j) continue
        var w = String(j.workspace || '').trim()
        if (w) return w
      }
      return ''
    }

    function mergeChangePaths(gitRels, jobSynced, jobDeleted) {
      var map = {}
      var order = []
      function push(raw, source) {
        var path = String(raw || '')
          .trim()
          .replace(/\\/g, '/')
        if (!path) return
        if (!map[path]) {
          map[path] = { path: path, source: source }
          order.push(path)
          return
        }
        if (map[path].source !== source) map[path].source = 'both'
      }
      ;(gitRels || []).forEach(function (p) {
        push(p, 'git')
      })
      ;(jobSynced || []).forEach(function (p) {
        push(p, 'job')
      })
      ;(jobDeleted || []).forEach(function (p) {
        push(p, 'job')
      })
      return order
        .map(function (p) {
          return map[p]
        })
        .sort(function (a, b) {
          return a.path.localeCompare(b.path, 'en')
        })
    }

    function formatShortstat(stat) {
      var add = Math.max(0, Number((stat && stat.add) || 0) || 0)
      var del = Math.max(0, Number((stat && stat.del) || 0) || 0)
      return { add: add, del: del, label: '+' + add + ' -' + del }
    }

    function truncateMid(s, max) {
      var t = String(s || '')
      if (t.length <= max) return t
      return '…' + t.slice(-(max - 1))
    }

    /** 对齐宿主 encodeSegment：encodeURIComponent 后还原盘符冒号 */
    function encodeFileAddrSegment(segment) {
      return encodeURIComponent(String(segment || '')).replace(/%3A/gi, ':')
    }

    function encodeFileAddrPath(path) {
      return String(path || '')
        .replace(/\\/g, '/')
        .split('/')
        .map(encodeFileAddrSegment)
        .join('/')
    }

    function getSidebarRight(ctx) {
      var sidebar = null
      try {
        if (ctx && typeof ctx.get === 'function') sidebar = ctx.get('sidebarRight')
      } catch (e0) {}
      if ((!sidebar || typeof sidebar.openResource !== 'function') && ctx && ctx.sidebarRight) {
        sidebar = ctx.sidebarRight
      }
      return sidebar && typeof sidebar.openResource === 'function' ? sidebar : null
    }

    /**
     * 打开工作区文件。
     * 优先 dsh-resource://file/absolute/…（不依赖 workspaceFileScope / session cwd）；
     * 否则退回 file/session/<sessionId>/…（与写码 turnTail 一致）。
     */
    function openWorkspaceFile(ctx, sessionId, workspace, relPath) {
      var sid = String(sessionId || '').trim()
      var ws = String(workspace || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/\/+$/, '')
      var raw = String(relPath || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
      if (!raw || raw.indexOf('\0') >= 0 || raw.split('/').indexOf('..') >= 0) return false

      var abs = ''
      if (raw.charAt(0) === '/' || /^[a-zA-Z]:\//.test(raw)) {
        abs = raw
      } else if (ws) {
        abs = ws + '/' + raw.replace(/^\//, '')
      }

      var sidebar = getSidebarRight(ctx)
      if (!sidebar) return false

      // 1) 绝对路径：绕过 session workspaceFileScope（侧栏场景常解析失败）
      if (abs && (abs.charAt(0) === '/' || /^[a-zA-Z]:\//.test(abs))) {
        try {
          var absBody = abs.replace(/^\/+/, '')
          var absUri = 'dsh-resource://file/absolute/' + encodeFileAddrPath(absBody)
          sidebar.openResource(absUri)
          return true
        } catch (eAbs) {}
      }

      // 2) session 相对路径兜底
      var rel = raw
      if (ws && (rel === ws || rel.indexOf(ws + '/') === 0)) {
        rel = rel === ws ? '' : rel.slice(ws.length + 1)
      }
      if (!rel || rel.charAt(0) === '/' || /^[a-zA-Z]:\//.test(rel) || rel.indexOf('~') >= 0) {
        return false
      }
      if (!sid) return false
      try {
        var sessUri =
          'dsh-resource://file/session/' + encodeFileAddrSegment(sid) + '/' + encodeFileAddrPath(rel)
        sidebar.openResource(sessUri)
        return true
      } catch (eSess) {}
      return false
    }

    function createDockedPanel(ctx, id, title, render) {
      // 对齐 @zhongruan/dsh-knowledge/docked-panel-compat：等 sidebarRight 服务就绪后注册 tab。
      var records = new Map()
      var sidebar
      var disposed = false
      var pending
      var frame
      var ready = false

      function Body(props) {
        var tabInfo = props.useTabInfo
          ? props.useTabInfo()
          : {
              tab: {
                visible: true,
                id: 'x',
                signal: { addEventListener: function () {}, removeEventListener: function () {} },
                actions: {},
              },
            }
        var tab = tabInfo.tab
        var sessionId = String(props.sessionId || '')
        useEffect(
          function () {
            var entries = records.get(sessionId)
            if (!entries) {
              entries = new Map()
              records.set(sessionId, entries)
            }
            var entry = {
              visible: tab.visible,
              close: function () {
                try {
                  tab.actions && tab.actions.close && tab.actions.close()
                } catch (e) {}
              },
            }
            entries.set(tab.id, entry)
            var remove = function () {
              if (entries.get(tab.id) !== entry) return
              entries.delete(tab.id)
              if (entries.size === 0) records.delete(sessionId)
            }
            tab.signal && tab.signal.addEventListener && tab.signal.addEventListener('abort', remove, { once: true })
            return function () {
              try {
                tab.signal && tab.signal.removeEventListener && tab.signal.removeEventListener('abort', remove)
              } catch (e2) {}
              remove()
            }
          },
          [sessionId, tab.id, tab.visible, tab.signal],
        )
        if (!tab.visible) return null
        return render(props)
      }

      function resolveSidebar() {
        if (sidebar && typeof sidebar.openTab === 'function') return sidebar
        try {
          var viaGet = ctx.get && ctx.get('sidebarRight')
          if (viaGet && typeof viaGet.openTab === 'function') {
            sidebar = viaGet
            return sidebar
          }
        } catch (e0) {}
        try {
          if (ctx.sidebarRight && typeof ctx.sidebarRight.openTab === 'function') {
            sidebar = ctx.sidebarRight
            return sidebar
          }
        } catch (e1) {}
        return null
      }

      var fiber = ctx.inject(['sidebarRight', 'sidebarRightTabs'], function (child) {
        sidebar = child.get('sidebarRight')
        var registry = child.get('sidebarRightTabs')
        var slots = child.slots
        // 与 knowledge 相同：只增量 register 自己的 kind；失败则降级，不拖垮右侧栏其它 tab
        child.effect(function () {
          try {
            return registry.register({
              id: id,
              kind: id,
              title: function () {
                return title
              },
            })
          } catch (eReg) {
            console.warn('[agent-context] tab type 注册跳过（可能已注册，保持并存）', eReg)
            return function () {}
          }
        }, id + ': tab type')
        child.effect(function () {
          return slots.inject('sidebar.right.pane.tab', function () {
            return slots.register({ name: 'sidebar.right.pane.tab', key: id }, Body)
          })
        }, id + ': tab body')
        child.effect(function () {
          return function () {
            sidebar = undefined
            ready = false
          }
        }, id + ': tab service')
        ready = true
        console.log('[agent-context] sidebarRight ready, tab registered:', id)
      })

      return {
        isReady: function () {
          return ready && !!resolveSidebar()
        },
        open: function (sessionId) {
          // 对齐 knowledge：主面板切换会重挂 conversation seat，勿对过期 session 强开
          pending = sessionId
          var attempts = 0
          var reveal = function () {
            frame = undefined
            if (disposed || pending !== sessionId) return
            try {
              var sessions = ctx.get && ctx.get('sessions')
              var cur =
                sessions && sessions.list && sessions.list.getSnapshot && sessions.list.getSnapshot().current
              if (cur != null && String(cur) !== String(sessionId)) {
                pending = undefined
                return
              }
            } catch (eSess) {}
            try {
              var face = resolveSidebar()
              if (!face) throw new Error('Right sidebar is not ready')
              face.openTab(id)
              pending = undefined
              // 宽度、拖拽都归宿主；这里只补一次对话列铺满
              scheduleFillChat(200)
              console.log('[agent-context] opened right tab', id, 'for', sessionId)
            } catch (error) {
              if (++attempts < 45) frame = window.requestAnimationFrame(reveal)
              else {
                pending = undefined
                console.warn(title + ': could not open right sidebar (shell unchanged)', error)
              }
            }
          }
          frame = window.requestAnimationFrame(reveal)
        },
        dispose: function () {
          disposed = true
          ready = false
          if (frame !== undefined) window.cancelAnimationFrame(frame)
          try {
            fiber && fiber.dispose && fiber.dispose()
          } catch (e) {}
        },
      }
    }

    function resolveSessionId(props, ctx) {
      var direct = String((props && props.sessionId) || '').trim()
      if (direct) return direct
      try {
        var sessions = ctx && ctx.get && ctx.get('sessions')
        var snap = sessions && sessions.list && sessions.list.getSnapshot && sessions.list.getSnapshot()
        if (snap && snap.current) return String(snap.current)
      } catch (e) {}
      try {
        var el = document.querySelector('[data-sidebar-right-session]')
        var fromDom = el && el.getAttribute('data-sidebar-right-session')
        if (fromDom) return String(fromDom)
      } catch (e2) {}
      return ''
    }

    function FallbackRail(props) {
      ensureCss()
      var widthState = useState(function () {
        return readStoredRailWidth()
      })
      var railW = widthState[0]
      var setRailW = widthState[1]
      var resizingState = useState(false)
      var resizing = resizingState[0]
      var setResizing = resizingState[1]
      var dragRef = useRef(null)

      useEffect(
        function () {
          setSlimRightbar(true)
          setSessionRailClass(true)
          applyRailWidth(railW)
          applyTitlebarSafeTop()
          scheduleFillChat(160)
          var onResize = function () {
            applyTitlebarSafeTop()
            setRailW(function (prev) {
              return applyRailWidth(prev)
            })
          }
          window.addEventListener('resize', onResize)
          var t = setInterval(applyTitlebarSafeTop, 1000)
          return function () {
            window.removeEventListener('resize', onResize)
            clearInterval(t)
            setSlimRightbar(false)
            setSessionRailClass(false)
            try {
              document.documentElement.style.removeProperty('--acx-titlebar-h')
            } catch (e) {}
          }
        },
        [props.ctx],
      )

      useEffect(
        function () {
          applyRailWidth(railW)
        },
        [railW],
      )

      useEffect(
        function () {
          if (!resizing) return
          var onMove = function (ev) {
            var w = clampRailWidth(window.innerWidth - ev.clientX)
            setRailW(w)
            applyRailWidth(w)
          }
          var onUp = function () {
            setResizing(false)
            dragRef.current = null
            try {
              document.body.style.removeProperty('cursor')
              document.body.style.removeProperty('user-select')
            } catch (e) {}
            setRailW(function (prev) {
              return persistRailWidth(prev)
            })
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
          window.addEventListener('pointercancel', onUp)
          try {
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
          } catch (e2) {}
          return function () {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onUp)
          }
        },
        [resizing],
      )

      // 无顶栏、无关闭；左缘拖宽（≥300）；系统侧栏只走宿主 strip，不挂插件内重复开关
      return h(
          'aside',
          {
            className: 'acx-fallback-rail' + (resizing ? ' is-resizing' : ''),
            'data-acx-rail': '1',
            role: 'complementary',
            'aria-label': TAB_ARIA,
            style: { width: railW + 'px' },
          },
          h('div', {
            className: 'acx-fallback-resizer',
            title: '拖拽调整宽度（最小 ' + RAIL_MIN_W + 'px）',
            onPointerDown: function (ev) {
              try {
                ev.preventDefault()
                ev.stopPropagation()
                dragRef.current = true
                setResizing(true)
                if (ev.currentTarget && ev.currentTarget.setPointerCapture) {
                  ev.currentTarget.setPointerCapture(ev.pointerId)
                }
              } catch (e) {}
            },
          }),
          h(
            'div',
            { className: 'acx-fallback-body' },
            h(PanelBody, { ctx: props.ctx, sessionId: props.sessionId, slimManaged: true }),
          ),
      )
    }

    function PanelBody(props) {
      ensureCss()
      var ctx = props.ctx
      var sessionId = resolveSessionId(props, ctx)
      var workspaceState = useState('')
      var workspace = workspaceState[0]
      var setWorkspace = workspaceState[1]
      var summaryState = useState(null)
      var summary = summaryState[0]
      var setSummary = summaryState[1]
      var jobsState = useState([])
      var jobs = jobsState[0]
      var setJobs = jobsState[1]
      var escState = useState(null)
      var esc = escState[0]
      var setEsc = escState[1]
      // 资料库产出：zr_mom_save 落盘的分析报告（MES 等）
      var momDocsState = useState([])
      var momDocs = momDocsState[0]
      var setMomDocs = momDocsState[1]
      var ccReadyState = useState(null)
      var ccReady = ccReadyState[0]
      var setCcReady = ccReadyState[1]
      var busyState = useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var msgState = useState('')
      var msg = msgState[0]
      var setMsg = msgState[1]
      var errState = useState('')
      var err = errState[0]
      var setErr = errState[1]
      var tickRef = useRef(0)

      // 面板在场期间维持 Qode 窄条；FallbackRail 已托管时不重复计数
      useEffect(
        function () {
          if (props.slimManaged) return
          setSlimRightbar(true)
          watchChatFill()
          scheduleFillChat(160)
          return function () {
            setSlimRightbar(false)
          }
        },
        [ctx, props.slimManaged],
      )

      useEffect(
        function () {
          var ws = resolveSessionCwd(props, ctx, sessionId)
          if (ws && ws !== workspace) setWorkspace(ws)
        },
        [props && props.cwd, props && props.sessionId, props && props.home, sessionId, ctx],
      )

      useEffect(
        function () {
          var stopped = false
          var timer

          function applySummary(ws, d) {
            if (stopped) return
            if (!d || !d.ok) return
            setCcReady(true)
            setSummary(d)
            var abs = String(d.workspace || ws || '').trim()
            if (abs && abs !== workspace) setWorkspace(abs)
          }

          function fetchSummary(ws) {
            if (!ws) return
            var base = cursorBase()
            fetch(
              base +
                '/api/cursor-chat/workspace-summary?workspace=' +
                encodeURIComponent(ws) +
                '&session_id=' +
                encodeURIComponent(sessionId),
            )
              .then(function (r) {
                return r.json()
              })
              .then(function (d) {
                applySummary(ws, d)
              })
              .catch(function () {})
          }

          function pull() {
            if (stopped || !sessionId) return
            var ws = resolveSessionCwd(props, ctx, sessionId) || workspace
            if (ws && ws !== workspace) setWorkspace(ws)
            var base = cursorBase()
            var escB = escBase()

            // 写码健康检查
            fetch(base + '/health')
              .then(function (r) {
                return r.ok
                  ? r.json().catch(function () {
                      return { ok: true }
                    })
                  : Promise.reject()
              })
              .then(function () {
                if (!stopped) setCcReady(true)
              })
              .catch(function () {
                if (!stopped) {
                  setCcReady(false)
                  setSummary(null)
                }
              })

            if (ws) fetchSummary(ws)

            fetch(
              base +
                '/api/cursor-chat/jobs?session_id=' +
                encodeURIComponent(sessionId) +
                '&limit=40',
            )
              .then(function (r) {
                return r.json()
              })
              .then(function (d) {
                if (stopped) return
                if (d && d.ok && Array.isArray(d.items)) {
                  setJobs(d.items)
                  // 分支只认「会话 cwd」的 git branch --show-current。
                  // Job.workspace 可能是别的工程/交付分支（如 dsh/时间戳-提交代码），禁止覆盖。
                  if (!ws && !workspace) {
                    var fromJob = pickWorkspaceFromJobs(d.items)
                    if (fromJob) {
                      setWorkspace(fromJob)
                      fetchSummary(fromJob)
                    }
                  }
                }
              })
              .catch(function () {})

            if (escB) {
              fetch(escB + '/api/session-state?sessionId=' + encodeURIComponent(sessionId))
                .then(function (r) {
                  return r.json()
                })
                .then(function (d) {
                  if (stopped) return
                  if (d && d.ok && d.state) setEsc(d.state)
                  else setEsc(null)
                })
                .catch(function () {
                  if (!stopped) setEsc(null)
                })
            } else if (!stopped) {
              setEsc(null)
            }

            // 本会话落盘资料库的报告（MES 分析等），作为「产出」的一种
            if (ws) {
              fetch('/mom-docs/v1/files?directory=' + encodeURIComponent(ws), {
                headers: { 'x-dsh-mom-client': 'library' },
                cache: 'no-store',
              })
                .then(function (r) {
                  return r.json()
                })
                .then(function (d) {
                  if (stopped) return
                  var groups = (d && d.ok && d.workspaces) || []
                  var flat = []
                  groups.forEach(function (g) {
                    if (!g || String(g.directory || '') !== String(ws)) return
                    ;(g.days || []).forEach(function (day) {
                      ;((day && day.items) || []).forEach(function (it) {
                        if (!it || !it.fileName) return
                        flat.push({
                          date: String((day && day.date) || ''),
                          fileName: String(it.fileName),
                          title: String(it.title || ''),
                          savedAt: String(it.savedAt || ''),
                          mtimeMs: Number(it.mtimeMs || 0),
                        })
                      })
                    })
                  })
                  setMomDocs(flat)
                })
                .catch(function () {
                  if (!stopped) setMomDocs([])
                })
            } else if (!stopped) {
              setMomDocs([])
            }
          }

          pull()
          timer = setInterval(function () {
            tickRef.current += 1
            pull()
          }, 4000)
          return function () {
            stopped = true
            if (timer) clearInterval(timer)
          }
        },
        [sessionId, workspace],
      )

      var gitRels = (summary && summary.entries ? summary.entries : []).map(function (e) {
        return e && e.rel
      })
      var latestJob = null
      for (var i = 0; i < jobs.length; i++) {
        var j = jobs[i]
        if (!j) continue
        if (j.work_kind === 'git_deliver') continue
        latestJob = j
        break
      }
      var changes = mergeChangePaths(
        gitRels,
        (latestJob && latestJob.synced_files) || [],
        (latestJob && latestJob.deleted_files) || [],
      )
      var stat = formatShortstat(summary && summary.shortstat)
      // 仅真实分支名；无分支则整行不渲染（禁止 … / 占位文案）
      var branchName = ''
      if (summary && summary.is_git) {
        branchName = String(summary.current_branch || '').trim()
        if (!branchName && summary.head_detached) branchName = '（detached HEAD）'
      }
      // 仅 running/queued 算「提交进行中」。pending_review 是等人审，不是进行中；
      // 否则旧 begin-ui 残留会把侧栏永远锁成「提交进行中…」。
      var deliverRunning = (jobs || []).some(function (j) {
        return (
          j &&
          j.work_kind === 'git_deliver' &&
          (j.status === 'running' || j.status === 'queued')
        )
      })
      var deliverBusy = busy || deliverRunning
      var canDeliver =
        ccReady &&
        summary &&
        summary.is_git &&
        summary.dirty &&
        workspace &&
        sessionId &&
        !deliverBusy

      function cancelStaleGitPending() {
        var base = cursorBase()
        return fetch(
          base +
            '/api/cursor-chat/git-deliver/awaiting?session_id=' +
            encodeURIComponent(sessionId),
        )
          .then(function (r) {
            return r.json()
          })
          .then(function (d) {
            var items = (d && d.items) || []
            return Promise.all(
              items.map(function (it) {
                if (!it || !it.confirm_token) return null
                return fetch(base + '/api/cursor-chat/git-deliver/cancel', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    confirm_token: String(it.confirm_token || ''),
                    job_id: String(it.job_id || it.id || ''),
                    reason: '侧栏新开提交流程，取消残留待确认',
                  }),
                })
                  .then(function (r2) {
                    return r2.json().catch(function () {
                      return {}
                    })
                  })
                  .catch(function () {
                    return null
                  })
              }),
            )
          })
          .catch(function () {
            return null
          })
      }

      function onDeliver() {
        if (!canDeliver) return
        setBusy(true)
        setErr('')
        setMsg('')
        // 必须新开一轮对话：往当前会话 prompt「提交代码」，由模型调用 zr_cchat_git_deliver。
        // 禁止只调 begin-ui——那会把确认卡挂到上一轮 turnTail（旧结论下方），看起来像没新开对话。
        var text = '提交代码'
        var prompted = false
        try {
          var sessions = ctx && ctx.get && ctx.get('sessions')
          var binding = sessions && sessions.binding && sessions.binding(sessionId)
          var face = binding && binding.session
          if (face && typeof face.prompt === 'function') {
            prompted = true
            // 先清掉历史 begin-ui / 无人认领的 pending，避免侧栏一直「提交进行中」
            cancelStaleGitPending()
              .then(function () {
                return face.prompt([{ type: 'text', text: text }], 'queue')
              })
              .then(function (res) {
                if (res && res.ok === false) {
                  setErr(
                    String(
                      (res.error && (res.error.message || res.error.detail)) ||
                        '无法新开提交流程，请在输入框发送「提交代码」',
                    ),
                  )
                  return
                }
                setMsg('已新开一轮，请在对话区确认 Git 交付')
              })
              .catch(function (e) {
                setErr(
                  '无法新开提交流程：' +
                    String((e && e.message) || e || '').slice(0, 120) +
                    '；请在输入框发送「提交代码」',
                )
              })
              .finally(function () {
                setBusy(false)
              })
          }
        } catch (ePrompt) {
          prompted = false
        }
        if (prompted) return
        setBusy(false)
        setErr('会话接口不可用，请在对话输入框发送「提交代码」以新开一轮交付')
      }

      var updatedAt =
        (latestJob && (latestJob.updated_at || latestJob.finished_at || latestJob.created_at)) ||
        (summary && summary.checked_at) ||
        Date.now()
      /** 图二：跨轮自然语言摘要；优先改动要点/需求，跳过「已同步 N 个文件」空壳 */
      function extractHighlight(raw) {
        var clean = String(raw || '')
          .replace(/\r\n/g, '\n')
          .replace(/#+\s*/g, '')
          .replace(/[*_`]+/g, '')
          .replace(/\u2022/g, '·')
        var lines = clean
          .split('\n')
          .map(function (line) {
            return line.replace(/[ \t]+/g, ' ').trim()
          })
          .filter(Boolean)
        var changeHits = []
        var inChange = false
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i]
          if (/^改动[：:]/.test(line) || line === '改动') {
            inChange = true
            var inline = line.replace(/^改动[：:]\s*/, '').trim()
            if (inline && !/^[·•]/.test(inline)) {
              var t0 = tidyHighlight(inline)
              if (t0) changeHits.push(t0)
            }
            continue
          }
          if (/^(结果|需求|接口|落盘|审计|完成度|说明|请你验收|范围外|安全拦截)[：:]?/.test(line)) {
            inChange = false
            continue
          }
          if (inChange && /^[·•]/.test(line)) {
            var t1 = tidyHighlight(line.replace(/^[·•]\s*/, ''))
            if (t1) changeHits.push(t1)
          }
        }
        if (changeHits.length) return changeHits[0]
        for (var a = 0; a < lines.length; a++) {
          if (/^需求[：:]/.test(lines[a])) {
            var t2 = tidyHighlight(lines[a].replace(/^需求[：:]\s*/, ''))
            if (t2) return t2
          }
        }
        for (var b = 0; b < lines.length; b++) {
          if (/^结果[：:]/.test(lines[b])) {
            var t3 = tidyHighlight(lines[b].replace(/^结果[：:]\s*/, ''))
            if (t3) return t3
          }
        }
        for (var c = 0; c < lines.length; c++) {
          var ln = lines[c]
          if (ln === '本轮结论' || ln === 'Git 交付结论') continue
          if (/^(需求|改动|结果|接口|落盘|审计|完成度|说明|请你验收)/.test(ln)) continue
          if (/^[·•]/.test(ln)) {
            var t4 = tidyHighlight(ln.replace(/^[·•]\s*/, ''))
            if (t4) return t4
            continue
          }
          var t5 = tidyHighlight(ln)
          if (t5) return t5
        }
        return ''
      }
      function buildSessionProse() {
        if (err) {
          var e = String(err).trim()
          return e.length > 100 ? e.slice(0, 98) + '…' : e
        }
        if (ccReady === false) return '写码插件未就绪，环境信息暂不可用。'
        var title = resolveSessionTitle(props, ctx, sessionId)
        var coding = (jobs || []).filter(function (j) {
          return j && String(j.work_kind || '') !== 'git_deliver'
        })
        var ordered = coding.slice().reverse()
        var highlights = []
        var seen = {}
        var activeN = 0
        function pushHi(raw) {
          var hi = tidyHighlight(raw, 72)
          if (!hi || seen[hi] || /本轮结论|落盘[：:]|完成度/.test(hi)) return
          seen[hi] = true
          highlights.push(hi)
        }
        ordered.forEach(function (j) {
          var st = String(j.status || '').trim()
          if (
            st === 'running' ||
            st === 'queued' ||
            st === 'pending_review' ||
            st === 'awaiting_user' ||
            st === 'steering'
          ) {
            activeN += 1
          }
          var req = String(j.requirement || '')
            .replace(/\s+/g, ' ')
            .trim()
          if (req) pushHi(req)
          var fromConc = extractHighlight(String(j.chat_conclusion || ''))
          if (fromConc) pushHi(fromConc)
          else {
            var det = String(j.detail || '')
              .replace(/\s+/g, ' ')
              .trim()
            if (det && !isHollowHighlight(det)) pushHi(det)
          }
        })
        var text = ''
        if (title && highlights.length) {
          text =
            '围绕「' +
            title +
            '」已推进：' +
            highlights.slice(0, 4).join('；') +
            (highlights.length > 4 ? '…' : '') +
            '。'
        } else if (highlights.length) {
          text = highlights.slice(0, 4).join('；') + (highlights.length > 4 ? '…' : '') + '。'
        } else if (title) {
          text = '围绕「' + title + '」继续，等待可展示的任务进展。'
        } else if (msg) {
          text = String(msg).trim()
        } else {
          text = '等待本会话任务摘要…'
        }
        if (activeN) text += '另有任务进行中。'
        if (summary && summary.is_git && summary.dirty) text += '工作区仍有未提交改动。'
        text = text.replace(/\s+/g, ' ').replace(/。{2,}/g, '。').trim()
        if (text.length > 320) text = text.slice(0, 318) + '…'
        return text
      }
      var bubbleText = buildSessionProse()

      // 技能与 MCP：本任务实际用过的写码 + ESC 调用；禁止只列「已启用未调用」造成空喊
      var skillRows = []
      var skillSeen = {}
      function pushSkillRow(row) {
        var key = String(row.kind || '') + ':' + String(row.id || '')
        if (!row.id || skillSeen[key]) return
        skillSeen[key] = true
        skillRows.push(row)
      }
      if ((jobs || []).some(function (j) {
        return j && typeof j === 'object'
      })) {
        pushSkillRow({
          id: 'cursor-chat',
          kind: 'coding',
          label: '写码（Cursor）',
          source: 'used',
        })
      }
      var usedSkillIds = (esc && esc.sessionUsedSkillIds) || []
      var usedConnectorIds = (esc && esc.sessionUsedConnectorIds) || []
      var skillTitles = (esc && esc.sessionSkillTitles) || {}
      var connectorTitles = (esc && esc.sessionConnectorTitles) || {}
      usedSkillIds.forEach(function (id0) {
        var id = String(id0 || '').trim()
        if (!id) return
        pushSkillRow({
          id: id,
          kind: 'skill',
          label: String(skillTitles[id] || id),
          source: 'used',
        })
      })
      usedConnectorIds.forEach(function (id0) {
        var id = String(id0 || '').trim()
        if (!id) return
        pushSkillRow({
          id: id,
          kind: 'connector',
          label: String(connectorTitles[id] || id),
          source: 'used',
        })
      })

      var outputRows = []
      var synced = (latestJob && latestJob.synced_files) || []
      synced.slice(0, 12).forEach(function (p) {
        var name = basename(p)
        if (name) outputRows.push({ name: name, path: p, kind: fileKind(name) })
      })
      var gitJob = jobs.find(function (j) {
        return j && j.work_kind === 'git_deliver' && (j.pr_url || j.commit_short)
      })
      if (gitJob && gitJob.commit_short) {
        outputRows.push({ name: 'commit ' + gitJob.commit_short, kind: 'file' })
      }
      if (gitJob && gitJob.pr_url) {
        var prHref = String(gitJob.pr_url || '').trim()
        // 只把 http(s) 当可打开链接；旧任务落盘的裸文本不给 href
        var prOpenable = /^https?:\/\//i.test(prHref)
        outputRows.push(
          prOpenable
            ? { name: prHref, kind: 'file', href: prHref }
            : { name: prHref, kind: 'file' },
        )
      }

      // 来源：只列用户上传/附图。禁止改动文件、审码报告、产出路径冒充。
      var sourceRows = []
      var sourceSeen = {}
      function isNonUserSourcePath(pathOrName) {
        var s = String(pathOrName || '').replace(/\\/g, '/').toLowerCase()
        if (!s) return false
        if (s.indexOf('/.dsh-cursor-chat/') >= 0 || s.indexOf('.dsh-cursor-chat/') === 0) return true
        if (/审码报告/.test(String(pathOrName || ''))) return true
        return false
      }
      function pushSource(row) {
        var name = String((row && row.name) || '').trim()
        if (!name) return
        var path = String((row && row.path) || '').trim()
        if (isNonUserSourcePath(path) || isNonUserSourcePath(name)) return
        var key = path + '|' + name
        if (sourceSeen[key]) return
        sourceSeen[key] = true
        sourceRows.push({
          name: name,
          path: path || name,
          kind: row.kind === 'image' ? 'image' : 'file',
          abs: path || '',
        })
      }
      ;(jobs || []).forEach(function (j) {
        if (!j || !Array.isArray(j.images)) return
        j.images.forEach(function (img) {
          if (!img) return
          var p = String(img.path || '').trim()
          var n = String(img.name || '').trim() || basename(p)
          if (!n) return
          pushSource({ name: n, path: p, kind: 'image' })
        })
      })
      // 宿主会话：仅用户消息里「像上传」的附件块（有 attachment/mime/uploads 特征）
      var sessionStartMs = 0
      try {
        var sessBag = ctx && ctx.get && ctx.get('sessions')
        var snap =
          sessBag && sessBag.list && sessBag.list.getSnapshot && sessBag.list.getSnapshot()
        var byId = (snap && snap.byId) || (sessBag && sessBag.byId) || null
        var sessRow = byId && sessionId ? byId[sessionId] || byId[String(sessionId)] : null
        var events =
          sessRow && typeof sessRow.snapshotEvents === 'function'
            ? sessRow.snapshotEvents()
            : null
        if (Array.isArray(events)) {
          events.forEach(function (ev) {
            var t0 = Number(ev && ev.time)
            if (t0 > 0 && (!sessionStartMs || t0 < sessionStartMs)) sessionStartMs = t0
          })
          events.forEach(function (ev) {
            if (!ev || String(ev.type || '') !== 'user/message') return
            var data = ev.data && typeof ev.data === 'object' ? ev.data : null
            if (!data) return
            var message =
              data.message && typeof data.message === 'object' ? data.message : data
            var source = message.source && typeof message.source === 'object' ? message.source : null
            if (!source || String(source.kind) !== 'user') return
            var content = message.content
            if (!Array.isArray(content)) return
            content.forEach(function (block) {
              if (!block || typeof block !== 'object') return
              var typ = String(block.type || block.kind || '').toLowerCase()
              var isImage = typ === 'image' || typ === 'image_url' || typ === 'input_image'
              var isFile =
                typ === 'file' ||
                typ === 'attachment' ||
                typ === 'file_attachment' ||
                typ === 'input_file'
              if (!isImage && !isFile) return
              var att =
                block.attachment && typeof block.attachment === 'object' ? block.attachment : null
              var p = String(
                block.path ||
                  block.filePath ||
                  block.localPath ||
                  block.uri ||
                  (att && (att.path || att.uri)) ||
                  '',
              ).trim()
              var n = String(
                block.name ||
                  block.filename ||
                  block.fileName ||
                  (att && (att.name || att.filename)) ||
                  '',
              ).trim()
              if (!n) n = basename(p)
              if (!n) return
              var mime = String(
                block.mimeType || block.media_type || block.mime || (att && (att.mimeType || att.mediaType)) || '',
              )
                .trim()
                .toLowerCase()
              var aid = String(block.id || (att && att.id) || block.attachmentId || '').trim()
              var pl = p.replace(/\\/g, '/').toLowerCase()
              var looksUploaded =
                !!att ||
                !!aid ||
                !!mime ||
                pl.indexOf('/attachments/') >= 0 ||
                pl.indexOf('/uploads/') >= 0 ||
                /^data:image\//.test(pl) ||
                isImage
              if (!looksUploaded) return
              pushSource({ name: n, path: p, kind: isImage ? 'image' : 'file' })
            })
          })
        }
      } catch (eSrc) {}

      // 资料库报告：只算本会话开始后保存的；拿不到会话起始时间则退化为只看当天
      var momToday = ''
      try {
        momToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(
          new Date(),
        )
      } catch (eDay) {}
      var momSeen = {}
      ;(momDocs || []).forEach(function (it) {
        if (!it || !it.fileName) return
        var momKey = it.date + '/' + it.fileName
        if (momSeen[momKey]) return
        var savedMs = Date.parse(String(it.savedAt || ''))
        if (!(savedMs > 0)) savedMs = Number(it.mtimeMs || 0)
        if (sessionStartMs > 0) {
          if (!(savedMs >= sessionStartMs - 60000)) return
        } else if (momToday && it.date !== momToday) {
          return
        }
        momSeen[momKey] = true
        outputRows.push({
          name: it.title || it.fileName,
          path:
            (workspace ? String(workspace).replace(/\/+$/, '') + '/' : '') +
            'MOM/' +
            it.date +
            '/' +
            it.fileName,
          kind: fileKind(it.fileName),
          mom: { date: it.date, fileName: it.fileName, title: it.title },
        })
      })

      function downloadMomDoc(it) {
        var dir = String(workspace || '').trim()
        if (!dir || !it || !it.fileName) {
          setErr('下载失败：缺少资料库路径')
          return
        }
        var q =
          '/mom-docs/v1/file?directory=' +
          encodeURIComponent(dir) +
          '&date=' +
          encodeURIComponent(it.date || '') +
          '&name=' +
          encodeURIComponent(it.fileName)
        fetch(q, { headers: { 'x-dsh-mom-client': 'library' }, cache: 'no-store' })
          .then(function (r) {
            return r.json()
          })
          .then(function (d) {
            if (!d || d.ok !== true) throw new Error((d && d.message) || '读取失败')
            var name = /\.txt$/i.test(it.fileName) ? 'text/plain' : 'text/markdown'
            var blob = new Blob([String(d.content || '')], { type: name + ';charset=utf-8' })
            var url = URL.createObjectURL(blob)
            var a = document.createElement('a')
            a.href = url
            a.download = it.fileName
            a.style.display = 'none'
            document.body.appendChild(a)
            a.click()
            setTimeout(function () {
              try {
                a.remove()
                URL.revokeObjectURL(url)
              } catch (e) {}
            }, 1000)
            setErr('')
            setMsg('已下载：' + it.fileName)
          })
          .catch(function (e) {
            setMsg('')
            setErr('下载失败：' + String((e && e.message) || '').slice(0, 60))
          })
      }

      // 资料库报告行：点击打开预览，右侧下载到本机
      function momReportRow(row, idx) {
        return h(
          'div',
          { key: 'out-' + idx + '-' + row.name, className: 'acx-item acx-item-file', title: row.path },
          h(
            'button',
            {
              type: 'button',
              className: 'acx-item-main',
              onClick: function () {
                if (!openWorkspaceFile(ctx, sessionId, workspace, row.path)) {
                  setErr('无法打开文件（需绑定会话工作区）')
                }
              },
            },
            tile(IcoFile(row.kind), fileIcoClass(row.kind)),
            h('span', { className: 'acx-item-label' }, row.name),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'acx-item-dl',
              title: '下载到本机',
              'aria-label': '下载 ' + row.mom.fileName,
              onClick: function (ev) {
                try {
                  ev.stopPropagation()
                } catch (e) {}
                downloadMomDoc(row.mom)
              },
            },
            IcoDownload(),
            h('span', null, '下载'),
          ),
        )
      }

      function refreshAll() {
        tickRef.current += 1
        setMsg('')
        setErr('')
        var base = cursorBase()
        var ws = resolveSessionCwd(props, ctx, sessionId) || workspace
        function applyWsSummary(path, d) {
          if (!(d && d.ok)) return
          setSummary(d)
          var abs = String(d.workspace || path || '').trim()
          if (abs && abs !== workspace) setWorkspace(abs)
        }
        if (ws) {
          fetch(
            base +
              '/api/cursor-chat/workspace-summary?workspace=' +
              encodeURIComponent(ws) +
              '&session_id=' +
              encodeURIComponent(sessionId),
          )
            .then(function (r) {
              return r.json()
            })
            .then(function (d) {
              applyWsSummary(ws, d)
            })
            .catch(function () {})
        }
        fetch(
          base +
            '/api/cursor-chat/jobs?session_id=' +
            encodeURIComponent(sessionId) +
            '&limit=40',
        )
          .then(function (r) {
            return r.json()
          })
          .then(function (d) {
            if (!(d && d.ok && Array.isArray(d.items))) return
            setJobs(d.items)
            // 仅当会话 cwd 仍空时才用 Job.workspace 兜底；有会话路径则绝不改分支来源
            if (!ws) {
              var fromJob = pickWorkspaceFromJobs(d.items)
              if (!fromJob) return
              setWorkspace(fromJob)
              fetch(
                base +
                  '/api/cursor-chat/workspace-summary?workspace=' +
                  encodeURIComponent(fromJob) +
                  '&session_id=' +
                  encodeURIComponent(sessionId),
              )
                .then(function (r2) {
                  return r2.json()
                })
                .then(function (d2) {
                  applyWsSummary(fromJob, d2)
                })
                .catch(function () {})
            }
          })
          .catch(function () {})
      }

      // 对标参考图：始终彩色 +N / -M（含 0）
      var changeLabel = h(
        'span',
        { className: 'acx-diff' },
        h('span', { className: 'plus' }, '+' + fmtComma(stat.add)),
        h('span', { className: 'minus' }, '-' + fmtComma(stat.del)),
      )

      function fileIcoClass(kind) {
        if (kind === 'html') return 'file-html'
        if (kind === 'img') return 'file-img'
        if (kind === 'md') return 'file-md'
        return ''
      }

      return h(
        'div',
        { className: 'acx-root', 'data-session': sessionId, 'data-qode-ui': CSS_VER },
        h(SummaryCard, {
          text: bubbleText,
          updated: formatClock(updatedAt),
        }),
        msg && !err ? h('div', { className: 'acx-ok' }, msg) : null,
        err ? h('div', { className: 'acx-err' }, err) : null,

        block(
          '环境信息',
          ccReady === false
            ? h('div', { className: 'acx-empty' }, '写码插件未就绪')
            : h(
                React.Fragment,
                null,
                itemRow({
                  ico: IcoGit(),
                  label: changeLabel,
                  title:
                    (stat.add || stat.del
                      ? '工作区相对 HEAD：+' + fmtComma(stat.add) + ' / -' + fmtComma(stat.del) + '；点击刷新'
                      : '工作区相对 HEAD 无行变更；点击刷新'),
                  onClick: function () {
                    refreshAll()
                  },
                }),
                itemRow({
                  ico: IcoMonitor(),
                  label: '本地',
                  active: true,
                  title: workspace ? '本地工作区：' + workspace + '（点击复制路径）' : '本地工作区',
                  onClick: function () {
                    if (!workspace) {
                      setMsg('当前无工作区路径')
                      return
                    }
                    copyText(workspace).then(function (ok) {
                      setMsg(ok ? '已复制工作区路径' : '无法复制：' + workspace)
                      setErr('')
                    })
                  },
                }),
                branchName
                  ? itemRow({
                      ico: IcoBranch(),
                      label: branchName,
                      title: '当前本机项目分支（点击复制）',
                      onClick: function () {
                        copyText(branchName).then(function (ok) {
                          setMsg(ok ? '已复制分支名' : '无法复制分支名')
                          setErr('')
                        })
                      },
                    })
                  : null,
                itemRow({
                  ico: IcoCommit(),
                  label: deliverBusy ? '提交进行中…' : '提交或推送',
                  disabled: !canDeliver,
                  onClick: onDeliver,
                  title: canDeliver
                    ? '打开对话区 Git 确认卡（确认前不会 commit）'
                    : deliverBusy
                      ? '提交进行中'
                      : summary && summary.is_git && !summary.dirty
                        ? '工作区干净，无需提交'
                        : '当前不可提交',
                }),
              ),
        ),

        block(
          '技能与 MCP',
          skillRows.length
            ? skillRows.map(function (row) {
                var kindLabel =
                  row.kind === 'coding' ? '写码' : row.kind === 'connector' ? '连接器' : '技能'
                return itemRow({
                  key: row.kind + ':' + row.id,
                  ico: IcoSkill(),
                  label: row.label || row.id,
                  title: kindLabel + ' · 本任务已使用 · ' + row.id,
                })
              })
            : h(
                'div',
                { className: 'acx-empty' },
                '本任务尚未使用写码、技能或连接器',
              ),
        ),

        block(
          '产出',
          outputRows.length
            ? outputRows.map(function (row, idx) {
                if (row.mom) return momReportRow(row, idx)
                return itemRow({
                  key: 'out-' + idx + '-' + row.name,
                  ico: IcoFile(row.kind),
                  icoClass: fileIcoClass(row.kind),
                  label: row.name,
                  title: row.path || row.name,
                  onClick: row.href
                    ? function () {
                        try {
                          window.open(row.href, '_blank', 'noopener,noreferrer')
                        } catch (e) {}
                      }
                    : row.path
                      ? function () {
                          if (!openWorkspaceFile(ctx, sessionId, workspace, row.path)) {
                            setErr('无法打开文件（需绑定会话工作区）')
                          }
                        }
                      : undefined,
                })
              })
            : h('div', { className: 'acx-empty' }, '本会话暂无产出'),
        ),

        block(
          '来源',
          sourceRows.length
            ? sourceRows.map(function (row) {
                var isImg = row.kind === 'image'
                var fk = isImg ? 'img' : fileKind(row.name)
                return itemRow({
                  key: 'src-' + row.path,
                  ico: IcoFile(fk),
                  icoClass: fileIcoClass(fk),
                  label: row.name,
                  title: '用户输入 · ' + (row.abs || row.path || row.name),
                  onClick: row.abs
                    ? function () {
                        if (!openWorkspaceFile(ctx, sessionId, workspace, row.abs)) {
                          setErr('无法打开该附件（仅支持当前会话工作区内的路径）')
                        }
                      }
                    : undefined,
                })
              })
            : h('div', { className: 'acx-empty' }, '本会话暂无用户输入的附件'),
          h(
            'button',
            {
              type: 'button',
              className: 'acx-plus',
              title: '刷新来源',
              'aria-label': '刷新来源',
              onClick: refreshAll,
            },
            '+',
          ),
        ),
      )
    }

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') {
        console.error('[agent-context] 无 slots，无法注册右侧任务上下文')
        return
      }
      ensureCss()
      // 启动清一次历史残留；之后只在卸载时再清，不做周期扫描
      scrubFrameWidthDamage()
      scrubLayoutDamage()

      /**
       * 系统侧栏 / 会话侧栏是宿主右栏里的两个 tab：
       * - 宽度归宿主：会话首开时按记忆值（默认 300）设置一次，之后拖拽说了算
       * - 会话首挂时右栏若未展开，自动替用户展开一次；同一会话被关掉后不再抢回
       * - 右栏开着且被系统 tab 占用时不抢（本次自动展开的除外）；空白时才补挂会话 tab
       */
      var dock = null
      try {
        // strip 不展示「任务上下文」文案；无障碍名仍用 TAB_TITLE
        dock = createDockedPanel(ctx, TAB_ID, '', function (props) {
          return h(PanelBody, Object.assign({}, props, { ctx: ctx }))
        })
      } catch (eDock) {
        console.warn('[agent-context] 宿主右侧 tab 注册失败', eDock)
      }

      var openTimer = null
      var lastOpenState = null
      /** 会话首挂自动展开一次：undefined=未处理，pending=正在自动展开，done=已结束 */
      var railAutoState = Object.create(null)
      var railAutoTries = Object.create(null)
      var RAIL_AUTO_MAX_TRIES = 6
      /**
       * 右栏默认宽度（300）只在本次启动内播种一次：
       * 宿主可能先恢复上次的宽布局，所以设完还要复核，被覆盖就再设（有界重试）。
       * 用户一旦碰分栏把手就交还控制权，本次启动不再干预。
       */
      var widthSeeded = false
      var seedTries = 0
      var seedOk = 0
      var seedTimer = null
      var SEED_TARGET = RAIL_DEFAULT_W

      function seedDefaultWidth() {
        if (widthSeeded) return
        try {
          var panel = hostRightPanelEl()
          if (!panel || !isHostRightSidebarOpen()) return
          var cur = Math.round(panel.getBoundingClientRect().width)
          if (!(cur > 0)) return
          var want = clampRailWidth(SEED_TARGET)
          if (Math.abs(cur - want) <= 8) {
            // 多次、跨时刻确认同值，才认为宿主没再恢复旧布局
            seedOk += 1
            if (seedOk >= 3) widthSeeded = true
            return
          }
          seedOk = 0
          if (seedTries >= 5) {
            widthSeeded = true
            return
          }
          seedTries += 1
          if (!setRightbarWidth(ctx, want)) {
            widthSeeded = true
            return
          }
          console.info('[agent-context] 默认右栏宽度', cur, '→', want, 'try=' + seedTries)
          scheduleFillChat(160)
          if (seedTimer) clearTimeout(seedTimer)
          seedTimer = setTimeout(function () {
            seedTimer = null
            seedDefaultWidth()
          }, 350)
        } catch (e) {}
      }

      function stopSeeding() {
        widthSeeded = true
        if (seedTimer) {
          clearTimeout(seedTimer)
          seedTimer = null
        }
      }

      function hasSessionPanel() {
        try {
          return !!document.querySelector('[data-sidebar-right-panel] .acx-root')
        } catch (e) {
          return false
        }
      }

      /** 右栏已展开且被系统 tab / 文件预览占用 */
      function isPanelOccupiedByOther() {
        try {
          var panel = hostRightPanelEl()
          if (!panel) return false
          if (panel.querySelector('.acx-root')) return false
          var tabs = panel.querySelector('[data-dockkit-strip-tabs]')
          if (tabs && tabs.querySelector('button, a, [role="tab"]')) return true
          return String(panel.innerText || '').trim().length > 0
        } catch (e) {
          return false
        }
      }

      function openSessionDock(sid) {
        if (!dock || !sid) return false
        if (!(dock.isReady && dock.isReady())) return false
        // 右栏已关就尊重用户；不再替用户展开
        if (!isHostRightSidebarOpen()) return false
        if (hasSessionPanel()) return true
        try {
          dock.open(sid)
          setTimeout(seedDefaultWidth, 150)
          setTimeout(seedDefaultWidth, 600)
          return true
        } catch (e) {
          return false
        }
      }

      function scheduleOpenSession(sid) {
        if (openTimer) clearTimeout(openTimer)
        openTimer = setTimeout(function () {
          openTimer = null
          if (!isHostRightSidebarOpen()) return
          if (hasSessionPanel() || isPanelOccupiedByOther()) return
          openSessionDock(sid)
        }, 120)
      }

      /** 首次挂载时右栏是关的：替用户展开一次；有界重试，之后主循环接管挂 tab */
      function tryAutoOpenRail(sid) {
        var key = String(sid)
        var tries = railAutoTries[key] || 0
        if (tries >= RAIL_AUTO_MAX_TRIES) {
          railAutoState[key] = 'done'
          return
        }
        railAutoTries[key] = tries + 1
        if (!tryOpenHostRightbar(ctx)) {
          // 保底：点一次宿主右栏开关（未展开时宿主自己负责展开）
          try {
            var btn = document.querySelector('[data-sidebar-right-toggle]')
            if (btn && typeof btn.click === 'function') btn.click()
          } catch (e) {}
        }
      }

      function syncHostSession(props) {
        var sid = resolveSessionId(props || {}, ctx)
        if (!sid) return false
        var key = String(sid)

        var open = isHostRightSidebarOpen()
        if (open !== lastOpenState) {
          var wasOpen = lastOpenState
          lastOpenState = open
          scheduleFillChat(120)
          if (open) seedDefaultWidth()
          // 展开过又被关掉：视为用户主动关闭，本次会话不再抢回
          else if (wasOpen && railAutoState[key] === 'pending') railAutoState[key] = 'done'
        }
        syncTogglePressed()

        if (!open) {
          // 新会话首挂时自动展开一次；展开后由下一次 tick 挂上会话 tab
          if (railAutoState[key] === undefined) railAutoState[key] = 'pending'
          if (railAutoState[key] === 'pending') tryAutoOpenRail(sid)
          return false
        }
        // 宽度归宿主列：只要右栏开着就先保证默认 300，再决定挂哪个 tab
        seedDefaultWidth()
        if (hasSessionPanel()) {
          railAutoState[key] = 'done'
          return true
        }
        if (railAutoState[key] === 'pending') {
          // 本次是我们自动展开的：宿主可能恢复系统 tab，这里切回会话 tab
          if (openSessionDock(sid)) railAutoState[key] = 'done'
          else if ((railAutoTries[key] || 0) >= RAIL_AUTO_MAX_TRIES) railAutoState[key] = 'done'
          return true
        }
        // 用户自己开着的右栏：不抢现有 tab，也不在关掉后再自动展开
        if (railAutoState[key] === undefined) railAutoState[key] = 'done'
        if (isPanelOccupiedByOther()) return false
        scheduleOpenSession(sid)
        return true
      }

      try {
        ctx.slots.inject('conversation.input.left', function () {
          return ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: 'agent-context-open',
              order: 55,
              label: '',
            },
            function AcxSessionHost(props) {
              ensureCss()
              var sid = resolveSessionId(props, ctx)
              useEffect(
                function () {
                  function tick() {
                    syncHostSession(props)
                  }
                  tick()
                  // 只观测状态；open 有去抖，避免切换/拖拽过程被轮询打断
                  var iv = setInterval(tick, 900)
                  return function () {
                    clearInterval(iv)
                    if (openTimer) {
                      clearTimeout(openTimer)
                      openTimer = null
                    }
                  }
                },
                [sid, props && props.sessionId],
              )
              watchChatFill()
              scheduleFillChat(160)
              // 输入栏不展示文案/按钮；只留一个不可见锚点，供对话列铺满时定位
              return h('span', {
                'data-acx-composer-anchor': '1',
                'aria-hidden': 'true',
                style: { display: 'none' },
              })
            },
          )
        })
      } catch (eChip) {
        console.warn('[agent-context] conversation.input.left 未挂上', eChip)
      }

      try {
        window.__dshAgentContextOpen = function () {
          var sid = resolveSessionId({}, ctx)
          if (!sid) return
          if (!isHostRightSidebarOpen()) tryOpenHostRightbar(ctx)
          if (dock && dock.open) dock.open(sid)
          setTimeout(seedDefaultWidth, 150)
          scheduleFillChat(200)
        }
        // 联调入口：手动触发一次默认宽度播种
        window.__dshAgentContextSeed = seedDefaultWidth
      } catch (eWin) {}

      /**
       * 宿主开关：右栏展开时用它做「系统 ↔ 会话」互切；收起动作仍交还宿主。
       * 状态只认当前真实 DOM，不再用 lastSysActive 这种粘滞标记。
       */
      function syncTogglePressed() {
        try {
          var on = isHostRightSidebarOpen() && !hasSessionPanel()
          var nodes = document.querySelectorAll('[data-sidebar-right-toggle]')
          for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i]
            if (!el) continue
            el.setAttribute('aria-pressed', on ? 'true' : 'false')
            el.setAttribute('data-acx-sys-on', on ? '1' : '0')
            el.setAttribute(
              'title',
              on ? '切到会话侧栏' : '切到系统侧栏',
            )
          }
        } catch (ePress) {}
      }

      function onHostToggleClick(ev) {
        try {
          var t = ev && ev.target
          if (!t || !t.closest) return
          var btn = t.closest('[data-sidebar-right-toggle]')
          if (!btn) return
          // 右栏未展开时交给宿主 ExpandButton
          if (!isHostRightSidebarOpen()) return

          var sid = resolveSessionId({}, ctx)
          if (!sid || !dock) return

          try {
            ev.preventDefault()
            ev.stopPropagation()
            if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation()
          } catch (eStop) {}

          if (hasSessionPanel()) {
            // 会话 → 系统
            openSystemSidebar(ctx)
            scheduleFillChat(160)
            setTimeout(seedDefaultWidth, 150)
          } else {
            // 系统/空白 → 会话
            if (openTimer) {
              clearTimeout(openTimer)
              openTimer = null
            }
            openSessionDock(sid)
          }
          setTimeout(syncTogglePressed, 80)
          setTimeout(syncTogglePressed, 280)
        } catch (eClick) {}
      }

      /** 宿主 strip 切 tab 后补一次铺满（点击不改变右栏宽度，ResizeObserver 不一定会触发） */
      function onPanelInteraction(ev) {
        try {
          var t = ev && ev.target
          if (!t || !t.closest || !t.closest('[data-sidebar-right-panel]')) return
        } catch (e0) {
          return
        }
        scheduleFillChat(160)
        setTimeout(function () {
          scheduleFillChat(0)
        }, 420)
      }

      document.addEventListener('click', onHostToggleClick, true)
      document.addEventListener('click', onPanelInteraction, true)

      /** 用户拖分栏把手 = 宽度交给用户；本次启动不再回写默认值 */
      var dragFromW = null
      function onSplitPointerDown(ev) {
        try {
          var panel = hostRightPanelEl()
          if (!panel || !isHostRightSidebarOpen()) return
          var r = panel.getBoundingClientRect()
          if (r.left > 120 && Math.abs(ev.clientX - r.left) <= 12) {
            dragFromW = r.width
            stopSeeding()
          }
        } catch (e) {}
      }
      function onSplitPointerUp() {
        if (dragFromW == null) return
        scheduleFillChat(120)
        dragFromW = null
      }
      document.addEventListener('pointerdown', onSplitPointerDown, true)
      document.addEventListener('pointerup', onSplitPointerUp, true)

      // 启动清一次历史布局损伤
      scrubLayoutDamage()
      scrubVisibleTaskContextLabels()
      syncTogglePressed()

      console.log(
        '[agent-context] 每次启动右栏回到默认宽度 300；拖拽只在本次运行内生效',
        'BUILD acontext-0.1.67-launch-301',
      )
      watchChatFill()
      // 首屏/恢复布局/会话晚挂载各补一次；有界重试，不是轮询
      var fillRetries = [120, 500, 1200, 2400]
      fillRetries.forEach(function (ms) {
        setTimeout(function () {
          seedDefaultWidth()
          scheduleFillChat(0)
        }, ms)
      })
      return function () {
        try {
          document.removeEventListener('click', onHostToggleClick, true)
          document.removeEventListener('click', onPanelInteraction, true)
          document.removeEventListener('pointerdown', onSplitPointerDown, true)
          document.removeEventListener('pointerup', onSplitPointerUp, true)
        } catch (eUnbind) {}
        try {
          if (window.__dshAgentContextOpen) delete window.__dshAgentContextOpen
          if (window.__dshAgentContextSeed) delete window.__dshAgentContextSeed
        } catch (eDel) {}
        try {
          if (dock) dock.dispose()
        } catch (e) {}
        if (openTimer) clearTimeout(openTimer)
        if (seedTimer) {
          clearTimeout(seedTimer)
          seedTimer = null
        }
        stopChatFillWatch()
        scrubLayoutDamage()
      }
    }

    module.exports = {
      inject: ['slots', 'sessions', 'layout'],
      apply: apply,
      // 联调/自检入口：控制台可手动触发一次对话列铺满
      _fillChatGutter: fillChatGutter,
    }
    return module.exports
  },
})
