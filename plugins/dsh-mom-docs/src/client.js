/**
 * 左侧栏「资料库」：列出所有保存过的工作区 MOM 文件。
 * 分组标题是工作目录名，不占用知识库或其它插件的面板 id。
 */
window.__ModuleLoader__.load({
  id: '@zhongruan/dsh-mom-docs',
  factory: (require) => {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useMemo = React.useMemo

    var PLUGIN_ID = '@zhongruan/dsh-mom-docs'
    var PANEL_ID = 'mom-docs'
    var WORKSPACE_EVENT = '@lemoncat7/dsh-plugin-ui/workspace-activate'
    var STAR_KEY = 'dsh-mom-docs-stars'

    function ensureCss() {
      if (typeof document === 'undefined') return
      var old = document.getElementById('mom-lib-css')
      if (old && old.getAttribute('data-v') === '3') return
      if (old && old.parentNode) old.parentNode.removeChild(old)
      var style = document.createElement('style')
      style.id = 'mom-lib-css'
      style.setAttribute('data-v', '3')
      style.textContent = [
        '.mom-lib-root{position:relative;height:100%;min-height:0;display:flex;flex-direction:column;background:#f4f7f4;color:#243028;font-size:13px}',
        '.mom-lib-top{display:flex;align-items:center;gap:8px;padding:14px 16px 8px}',
        '.mom-lib-back{border:1px solid #d9e2da;background:#fff;color:#243028;border-radius:8px;padding:6px 10px;cursor:pointer}',
        '.mom-lib-back:hover{background:#f7faf7}',
        '.mom-lib-tools{display:flex;align-items:center;gap:10px;padding:4px 16px 12px;flex-wrap:wrap}',
        '.mom-lib-select,.mom-lib-search{border:1px solid #d7e0d8;background:#fff;border-radius:999px;padding:6px 12px;color:#243028}',
        '.mom-lib-search{min-width:220px;flex:1;max-width:360px}',
        '.mom-lib-check{display:inline-flex;align-items:center;gap:6px;color:#4d5b52}',
        '.mom-lib-body{flex:1;min-height:0;display:flex}',
        '.mom-lib-list{flex:1;min-width:0;overflow:auto;padding:0 8px 24px}',
        '.mom-lib-head,.mom-lib-file{box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1fr) 52px 64px 88px 72px;column-gap:12px;align-items:center;width:100%;margin:0;padding:8px 16px}',
        '.mom-lib-head{color:#7d8a80;font-size:12px;border-bottom:1px solid #e1e8e2}',
        '.mom-lib-head>span,.mom-lib-cell{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}',
        '.mom-lib-group{width:100%;display:flex;align-items:center;gap:8px;border:0;background:transparent;text-align:left;padding:12px 8px 6px;cursor:pointer}',
        '.mom-lib-workspace{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.mom-lib-badge{flex:none;background:#e5f6ea;color:#2f7d45;border-radius:999px;padding:2px 8px;font-size:12px}',
        '.mom-lib-day{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 28px;color:#3c4a41}',
        '.mom-lib-file{border:0;background:transparent;cursor:pointer;border-radius:8px}',
        '.mom-lib-file:hover,.mom-lib-file.on{background:#fff}',
        '.mom-lib-name{display:flex;align-items:center;gap:8px;min-width:0;padding-left:36px}',
        '.mom-lib-name strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
        '.mom-lib-mark{width:18px;height:18px;border-radius:4px;background:#1aa6a6;color:#fff;font-size:11px;display:inline-flex;align-items:center;justify-content:center;flex:none}',
        '.mom-lib-mark.txt{background:#5b7c99}',
        '.mom-lib-star{border:0;background:transparent;cursor:pointer;color:#c5cec6;font-size:16px;line-height:1}',
        '.mom-lib-star.on{color:#e2b340}',
        '.mom-lib-cell{color:#66736b;font-size:12px}',
        '.mom-lib-float{position:absolute;top:16px;right:16px;bottom:16px;width:min(640px,72%);background:#fff;border:1px solid #e3ebe4;border-radius:12px;box-shadow:0 16px 48px rgba(24,36,28,.18);display:flex;flex-direction:column;overflow:hidden;z-index:20}',
        '.mom-lib-preview-bar{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #e6ece7}',
        '.mom-lib-preview-bar strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.mom-lib-x{border:0;background:transparent;cursor:pointer;font-size:18px;color:#66736b}',
        '.mom-lib-article{overflow:auto;padding:8px 28px 40px;line-height:1.75}',
        '.mom-lib-article h1{font-size:22px;margin:12px 0}',
        '.mom-lib-article h2{font-size:18px;margin:16px 0 8px}',
        '.mom-lib-article h3{font-size:15px;margin:14px 0 6px}',
        '.mom-lib-article p{margin:0 0 14px;white-space:pre-wrap}',
        '.mom-lib-empty{padding:28px 16px;color:#7d8a80}',
        '.mom-lib-error{margin:8px 16px;color:#9b3b3b}',
      ].join('')
      document.head.appendChild(style)
    }

    function sessionCwd(row) {
      var path = row && (row.cwd || (row.header && row.header.cwd))
      return typeof path === 'string' ? path : ''
    }

    function readWorkspaces(client) {
      try {
        var list = client && client.sessions && client.sessions.list
        if (!list || typeof list.getSnapshot !== 'function') return []
        var state = list.getSnapshot() || {}
        var byId = state.byId || {}
        var seen = {}
        var paths = []
        function add(path) {
          if (!path || seen[path]) return
          seen[path] = true
          paths.push(path)
        }
        Object.keys(byId).forEach(function (id) { add(sessionCwd(byId[id])) })
        if (state.current) add(sessionCwd(byId[state.current]))
        return paths
      } catch (err) {
        return []
      }
    }

    function workspaceName(path) {
      var text = String(path || '').replace(/[\\/]+$/, '')
      var parts = text.split(/[\\/]/)
      var name = parts.length ? parts[parts.length - 1] : ''
      return name || text
    }

    function fileKey(directory, date, fileName) {
      return directory + '\n' + date + '\n' + fileName
    }

    function loadStars() {
      try {
        var raw = JSON.parse(localStorage.getItem(STAR_KEY) || '[]')
        return Array.isArray(raw) ? raw.filter(function (item) { return typeof item === 'string' }) : []
      } catch (err) {
        return []
      }
    }

    function relativeTime(ms) {
      var stamp = Number(ms)
      if (!stamp) return ''
      var delta = Date.now() - stamp
      if (delta < 60000) return '刚刚'
      var minutes = Math.floor(delta / 60000)
      if (minutes < 60) return minutes + '分钟前'
      var hours = Math.floor(minutes / 60)
      if (hours < 24) return hours + '小时前'
      var days = Math.floor(hours / 24)
      if (days < 30) return days + '天前'
      try {
        return new Date(stamp).toLocaleDateString('zh-CN')
      } catch (err) {
        return ''
      }
    }

    function formatSize(bytes) {
      var n = Number(bytes) || 0
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB'
      return (n / (1024 * 1024)).toFixed(1) + ' MB'
    }

    function previewBlocks(text) {
      var lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
      var blocks = []
      var para = []
      function flush() {
        if (!para.length) return
        blocks.push({ type: 'p', text: para.join('\n') })
        para = []
      }
      lines.forEach(function (line) {
        var heading = /^(#{1,3})\s+(.*)$/.exec(line)
        if (heading) {
          flush()
          blocks.push({ type: 'h' + heading[1].length, text: heading[2] })
          return
        }
        if (!line.trim()) {
          flush()
          return
        }
        para.push(line)
      })
      flush()
      return blocks
    }

    function momFetch(path) {
      return fetch(path, {
        headers: { 'x-dsh-mom-client': 'library' },
        cache: 'no-store',
      }).then(function (res) {
        return res.json().then(function (body) {
          return { status: res.status, body: body }
        })
      })
    }

    function LibraryView(props) {
      var client = props.client
      var workspace = props.workspace
      var dirsState = useState(function () { return readWorkspaces(client) })
      var directories = dirsState[0]
      var setDirectories = dirsState[1]
      var dataState = useState(null)
      var data = dataState[0]
      var setData = dataState[1]
      var errorState = useState('')
      var error = errorState[0]
      var setError = errorState[1]
      var queryState = useState('')
      var query = queryState[0]
      var setQuery = queryState[1]
      var kindState = useState('all')
      var kind = kindState[0]
      var setKind = kindState[1]
      var starOnlyState = useState(false)
      var starOnly = starOnlyState[0]
      var setStarOnly = starOnlyState[1]
      var starsState = useState(loadStars)
      var stars = starsState[0]
      var setStars = starsState[1]
      var closedState = useState({})
      var closed = closedState[0]
      var setClosed = closedState[1]
      var selectedState = useState(null)
      var selected = selectedState[0]
      var setSelected = selectedState[1]
      var articleState = useState('')
      var article = articleState[0]
      var setArticle = articleState[1]

      useEffect(function () {
        var list = client && client.sessions && client.sessions.list
        if (!list || typeof list.subscribe !== 'function') return undefined
        function pull() { setDirectories(readWorkspaces(client)) }
        pull()
        return list.subscribe(pull)
      }, [client])

      useEffect(function () {
        var stopped = false
        function load() {
          var query = directories.map(function (dir) {
            return 'directory=' + encodeURIComponent(dir)
          }).join('&')
          var path = '/mom-docs/v1/files' + (query ? '?' + query : '')
          momFetch(path).then(function (res) {
            if (stopped) return
            if (!res.body || res.body.ok !== true) {
              setError((res.body && res.body.message) || '读取资料库失败')
              setData(null)
              return
            }
            setError('')
            setData(res.body)
          }).catch(function () {
            if (!stopped) setError('读取资料库失败')
          })
        }
        load()
        var timer = setInterval(load, 5000)
        return function () {
          stopped = true
          clearInterval(timer)
        }
      }, [directories.join('\n')])

      useEffect(function () {
        if (!selected || !selected.directory) {
          setArticle('')
          return undefined
        }
        var stopped = false
        var path = '/mom-docs/v1/file?directory=' + encodeURIComponent(selected.directory) +
          '&date=' + encodeURIComponent(selected.date) +
          '&name=' + encodeURIComponent(selected.fileName)
        momFetch(path).then(function (res) {
          if (stopped) return
          if (!res.body || res.body.ok !== true) {
            setArticle((res.body && res.body.message) || '打不开这份文件')
            return
          }
          setArticle(String(res.body.content || ''))
        }).catch(function () {
          if (!stopped) setArticle('打不开这份文件')
        })
        return function () { stopped = true }
      }, [selected && selected.directory, selected && selected.date, selected && selected.fileName])

      var shown = useMemo(function () {
        var groups = (data && data.workspaces) || []
        var q = query.trim().toLocaleLowerCase('zh-CN')
        return groups.map(function (group) {
          var days = (group.days || []).map(function (day) {
            var items = day.items.filter(function (item) {
              if (kind !== 'all' && item.kind !== kind) return false
              var key = fileKey(group.directory, day.date, item.fileName)
              if (starOnly && stars.indexOf(key) < 0) return false
              if (!q) return true
              return (item.fileName + ' ' + (item.title || '')).toLocaleLowerCase('zh-CN').indexOf(q) >= 0
            })
            return { date: day.date, items: items }
          }).filter(function (day) { return day.items.length > 0 })
          return { directory: group.directory, days: days }
        }).filter(function (group) { return group.days.length > 0 })
      }, [data, query, kind, starOnly, stars])

      function toggleStar(event, key) {
        event.stopPropagation()
        var next = stars.indexOf(key) >= 0 ? stars.filter(function (item) { return item !== key }) : stars.concat([key])
        setStars(next)
        try { localStorage.setItem(STAR_KEY, JSON.stringify(next)) } catch (err) {}
      }

      var blocks = previewBlocks(article)

      return h('div', { className: 'mom-lib-root' },
        h('div', { className: 'mom-lib-top' },
          h('button', {
            type: 'button',
            className: 'mom-lib-back',
            onClick: function () { if (workspace && workspace.close) workspace.close() },
          }, '‹ 返回资料库'),
        ),
        h('div', { className: 'mom-lib-tools' },
          h('select', {
            className: 'mom-lib-select',
            'aria-label': '全部类型',
            value: kind,
            onChange: function (event) { setKind(event.target.value) },
          },
            h('option', { value: 'all' }, '全部类型'),
            h('option', { value: 'md' }, 'Markdown'),
            h('option', { value: 'txt' }, '纯文本'),
          ),
          h('input', {
            className: 'mom-lib-search',
            placeholder: '搜索文件',
            'aria-label': '搜索文件',
            value: query,
            onChange: function (event) { setQuery(event.target.value) },
          }),
          h('label', { className: 'mom-lib-check' },
            h('input', {
              type: 'checkbox',
              checked: starOnly,
              onChange: function (event) { setStarOnly(event.target.checked) },
            }),
            '我的收藏',
          ),
        ),
        error ? h('div', { className: 'mom-lib-error' }, error) : null,
        h('div', { className: 'mom-lib-body' },
          h('div', { className: 'mom-lib-list' },
            h('div', { className: 'mom-lib-head' },
              h('span', null, '名称'),
              h('span', null, '类型'),
              h('span', null, '更新人'),
              h('span', null, '更新时间'),
              h('span', null, '大小'),
            ),
            shown.length === 0
              ? h('div', { className: 'mom-lib-empty' }, query.trim() || starOnly || kind !== 'all'
                ? '没有符合条件的文件。'
                : '还没有保存过文件。')
              : h('div', null, shown.map(function (group) {
                  var open = !closed[group.directory]
                  var count = group.days.reduce(function (sum, day) { return sum + day.items.length }, 0)
                  return h('div', { key: group.directory },
                  h('button', {
                    type: 'button',
                    className: 'mom-lib-group',
                    onClick: function () {
                      setClosed(function (prev) {
                        var next = Object.assign({}, prev)
                        if (next[group.directory]) delete next[group.directory]
                        else next[group.directory] = true
                        return next
                      })
                    },
                  },
                    h('span', null, open ? '▾' : '▸'),
                    h('span', { className: 'mom-lib-workspace', title: group.directory }, workspaceName(group.directory)),
                    h('span', { className: 'mom-lib-badge' }, count + ' 个文件'),
                  ),
                  open ? group.days.map(function (day) {
                    return h('div', { key: group.directory + '\n' + day.date },
                      h('div', { className: 'mom-lib-day' }, day.date),
                      day.items.map(function (item) {
                        var key = fileKey(group.directory, day.date, item.fileName)
                        var picked = { directory: group.directory, date: day.date, fileName: item.fileName, title: item.title }
                        var on = selected && selected.directory === group.directory && selected.date === day.date && selected.fileName === item.fileName
                        return h('div', {
                          key: key,
                          role: 'button',
                          tabIndex: 0,
                          className: 'mom-lib-file' + (on ? ' on' : ''),
                          onClick: function () { setSelected(picked) },
                          onKeyDown: function (event) {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setSelected(picked)
                            }
                          },
                        },
                          h('span', { className: 'mom-lib-name' },
                            h('span', { className: 'mom-lib-mark' + (item.kind === 'txt' ? ' txt' : '') }, item.kind === 'txt' ? 'T' : 'M'),
                            h('strong', { title: item.fileName }, item.fileName),
                            h('span', {
                              className: 'mom-lib-star' + (stars.indexOf(key) >= 0 ? ' on' : ''),
                              role: 'button',
                              'aria-label': '收藏',
                              onClick: function (event) { toggleStar(event, key) },
                            }, '★'),
                          ),
                          h('span', { className: 'mom-lib-cell' }, item.kind === 'txt' ? '文本' : '文档'),
                          h('span', { className: 'mom-lib-cell' }, '—'),
                          h('span', { className: 'mom-lib-cell' }, relativeTime(item.mtimeMs)),
                          h('span', { className: 'mom-lib-cell' }, formatSize(item.bytes)),
                        )
                      }),
                    )
                  }) : null,
                  )
                })),
          ),
        ),
        selected ? h('section', {
            className: 'mom-lib-float',
            role: 'dialog',
            'aria-label': selected.fileName,
          },
            h('div', { className: 'mom-lib-preview-bar' },
              h('span', { className: 'mom-lib-mark' + (selected.fileName.toLowerCase().endsWith('.txt') ? ' txt' : '') }, selected.fileName.toLowerCase().endsWith('.txt') ? 'T' : 'M'),
              h('strong', null, selected.fileName),
              h('button', { type: 'button', className: 'mom-lib-x', 'aria-label': '关闭预览', onClick: function () { setSelected(null) } }, '×'),
            ),
            h('article', { className: 'mom-lib-article' },
              blocks.length
                ? blocks.map(function (block, index) {
                    return h(block.type === 'p' ? 'p' : block.type, { key: index }, block.text)
                  })
                : h('p', null, article || '这份文件是空的。'),
            ),
        ) : null,
      )
    }

    function supportsDockedPanels(ctx) {
      return !!(ctx && ctx.layout && typeof ctx.layout.selectPanel === 'function')
    }

    function activatePluginWorkspace(pluginId) {
      window.dispatchEvent(new CustomEvent(WORKSPACE_EVENT, { detail: { pluginId: pluginId } }))
    }

    function observePluginWorkspace(pluginId, close) {
      function onActivate(event) {
        var detail = event && event.detail
        if (!detail || detail.pluginId !== pluginId) close()
      }
      window.addEventListener(WORKSPACE_EVENT, onActivate)
      return function () { window.removeEventListener(WORKSPACE_EVENT, onActivate) }
    }

    function registerMainPanel(ctx, id, render, onHidden) {
      var disposed = false
      var generation = 0
      function Body(props) {
        useEffect(function () {
          var current = ++generation
          return function () {
            queueMicrotask(function () {
              if (!disposed && generation === current && typeof onHidden === 'function') onHidden()
            })
          }
        }, [])
        return render(props)
      }
      var remove = ctx.slots.register({ name: 'main', key: id }, Body)
      try {
        ctx.layout.selectPanel(id)
      } catch (err) {
        remove()
        throw err
      }
      return function () {
        if (disposed) return
        disposed = true
        remove()
      }
    }

    function createWorkspace(ctx, client) {
      var listeners = new Set()
      var disposeWorkspace
      var docked = supportsDockedPanels(ctx)
      function notify() { listeners.forEach(function (fn) { fn() }) }
      function isSelected() {
        if (!docked) return disposeWorkspace !== undefined
        try {
          return ctx.layout.panelInfo && typeof ctx.layout.panelInfo.getSnapshot === 'function'
            ? ctx.layout.panelInfo.getSnapshot().activePanelId === PANEL_ID
            : false
        } catch (err) {
          return false
        }
      }
      function close() {
        if (docked) {
          if (isSelected()) {
            try { ctx.layout.selectPanel(null) } catch (err) {}
          }
          notify()
          return
        }
        if (disposeWorkspace === undefined) return
        var dispose = disposeWorkspace
        disposeWorkspace = undefined
        dispose()
        notify()
      }
      function open() {
        activatePluginWorkspace(PLUGIN_ID)
        if (docked) {
          try { ctx.layout.selectPanel(PANEL_ID) } catch (err) {
            console.error('[mom-docs] could not open panel', err)
          }
          notify()
          return
        }
        if (disposeWorkspace !== undefined) return
        disposeWorkspace = registerMainPanel(ctx, PANEL_ID, function () {
          return h(LibraryView, { client: client, workspace: controller })
        }, close)
        notify()
      }
      var controller = {
        close: close,
        open: open,
        toggle: function () { if (isSelected()) close(); else open() },
      }
      return controller
    }

    function DocIcon(props) {
      var size = (props && props.size) || 18
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z', stroke: 'currentColor', strokeWidth: '1.6' }),
        h('path', { d: 'M14 3.5V8h4.5', stroke: 'currentColor', strokeWidth: '1.6' }),
      )
    }

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') {
        console.error('[mom-docs] 无 slots，无法注册资料库页面')
        return
      }
      ensureCss()
      var docked = supportsDockedPanels(ctx)
      var workspace = createWorkspace(ctx, ctx)
      if (typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return observePluginWorkspace(PLUGIN_ID, function () { workspace.close() })
        }, 'dsh-mom-docs: exclusive workspace')
        ctx.effect(function () {
          return function () { workspace.close() }
        }, 'dsh-mom-docs: workspace lifecycle')
      }
      if (docked) {
        ctx.slots.inject('main', function () {
          return ctx.slots.register({ name: 'main', key: PANEL_ID }, function MomMain() {
            return h(LibraryView, { client: ctx, workspace: workspace })
          })
        })
        ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: -6,
            label: function () { return '资料库' },
          }, function MomIcon(props) { return h(DocIcon, { size: (props && props.size) || 18 }) })
        })
        return
      }
      ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register({ name: 'sidebar.footer.action', id: PANEL_ID, order: -6 }, function MomFooter() {
          return h('button', { type: 'button', onClick: function () { workspace.toggle() } }, '资料库')
        })
      })
    }

    module.exports = { inject: ['slots', 'layout', 'sessions'], apply: apply }
    return module.exports
  },
})
