/**
 * WorkBuddy 设置页：「远端审码」
 * 用户在界面填写飞书 / Webhook，保存到本机 ~/.zhongruan/remote-review/config.json
 * （不写进任何业务项目仓库）
 */
window.__ModuleLoader__.load({
  id: '@zhongruan/dsh-remote-review',
  factory: (require) => {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect

    function servicePort() {
      try {
        var p = localStorage.getItem('dsh-remote-review-port')
        if (p && /^\d+$/.test(p)) return p
      } catch (e) {}
      return '18787'
    }

    function serviceHost() {
      try {
        var x = localStorage.getItem('dsh-remote-review-host')
        if (x) return x
      } catch (e) {}
      return '127.0.0.1'
    }

    function servicePrefix() {
      try {
        var x = localStorage.getItem('dsh-remote-review-prefix')
        if (x != null) return x
      } catch (e) {}
      return ''
    }

    function serviceBase() {
      var host = serviceHost()
      var port = servicePort()
      var prefix = servicePrefix() || ''
      if (prefix && prefix.charAt(0) !== '/') prefix = '/' + prefix
      if (prefix.endsWith('/')) prefix = prefix.slice(0, -1)
      if (port === '80') return 'http://' + host + prefix
      if (port === '443') return 'https://' + host + prefix
      return 'http://' + host + ':' + port + prefix
    }

    function emptyDraft() {
      return {
        engine: 'http://127.0.0.1:8000',
        listen: '127.0.0.1',
        port: '18787',
        secret: '',
        secretConfigured: false,
        feishuAppId: '',
        feishuAppSecret: '',
        feishuAppSecretConfigured: false,
        feishuFolderToken: '',
        feishuWikiSpaceId: '',
        feishuWikiParentNodeToken: '',
        webhook: '',
        dataRoot: '',
        feishuReady: false,
      }
    }

    var SECRET_MASK = '••••••••••••'

    function field(label, props, full, required) {
      return h(
        'div',
        { className: 'rr-set-field' + (full ? ' full' : '') },
        h(
          'label',
          null,
          required ? h('span', { className: 'rr-req' }, '*') : null,
          required ? ' ' : null,
          label,
        ),
        h('input', props),
      )
    }

    function ensureCss() {
      if (typeof document === 'undefined') return
      if (document.getElementById('rr-set-css')) return
      var style = document.createElement('style')
      style.id = 'rr-set-css'
      style.textContent =
        '.rr-set{max-width:720px;padding:4px 2px 24px;font-size:13px;line-height:1.5;color:var(--color-text,inherit)}' +
        '.rr-set-lead{margin:0 0 12px;opacity:.85}' +
        '.rr-set-card{border:1px solid var(--color-border,rgba(127,127,127,.35));border-radius:10px;padding:12px 14px;margin:0 0 12px;background:var(--color-bg-subtle,transparent)}' +
        '.rr-set-card h3{margin:0 0 10px;font-size:14px}' +
        '.rr-set-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}' +
        '.rr-set-field{display:flex;flex-direction:column;gap:4px}' +
        '.rr-set-field.full{grid-column:1/-1}' +
        '.rr-set-field label{font-size:12px;opacity:.8}' +
        '.rr-set-field .rr-req{color:#cf222e;font-weight:700;margin-right:2px}' +
        '.rr-set-field input{padding:7px 9px;border-radius:8px;border:1px solid var(--color-border,rgba(127,127,127,.4));background:var(--color-bg,transparent);color:inherit}' +
        '.rr-set-hint{font-size:12px;opacity:.75;margin:6px 0 0}' +
        '.rr-set-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}' +
        '.rr-set-btn{padding:7px 12px;border-radius:8px;border:1px solid var(--color-border,rgba(127,127,127,.45));background:var(--color-bg-elevated,transparent);cursor:pointer;color:inherit}' +
        '.rr-set-btn:disabled{opacity:.5;cursor:not-allowed}' +
        '.rr-set-btn.primary{background:var(--color-primary,#2f6fed);border-color:transparent;color:#fff}' +
        '.rr-set-msg{font-size:12px}.rr-set-msg.ok{color:#1a7f37}.rr-set-msg.err{color:#cf222e}' +
        '.rr-set-eng{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}' +
        '.rr-set-eng input{width:110px;padding:6px 8px;border-radius:8px;border:1px solid var(--color-border,rgba(127,127,127,.4));background:transparent;color:inherit}'
      document.head.appendChild(style)
    }

    function secretForSave(value) {
      var s = String(value || '').trim()
      if (!s || s === SECRET_MASK || /^•+$/.test(s)) return ''
      return s
    }

    function maskIfConfigured(configured) {
      return configured ? SECRET_MASK : ''
    }

    function RemoteReviewSettingsSection() {
      ensureCss()
      var draftState = useState(emptyDraft)
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
      var hostState = useState(serviceHost())
      var svcHost = hostState[0]
      var setSvcHost = hostState[1]
      var portState = useState(servicePort())
      var svcPort = portState[0]
      var setSvcPort = portState[1]
      var prefixState = useState(servicePrefix())
      var svcPrefix = prefixState[0]
      var setSvcPrefix = prefixState[1]
      var repoState = useState('')
      var repoPath = repoState[0]
      var setRepoPath = repoState[1]
      var healthState = useState('')
      var health = healthState[0]
      var setHealth = healthState[1]

      function rememberEndpoint() {
        try {
          localStorage.setItem('dsh-remote-review-host', String(svcHost || '127.0.0.1').trim())
          localStorage.setItem('dsh-remote-review-port', String(svcPort || '18787').trim())
          localStorage.setItem('dsh-remote-review-prefix', String(svcPrefix || '').trim())
        } catch (e) {}
      }

      function base() {
        var host = String(svcHost || '127.0.0.1').trim()
        var port = String(svcPort || '18787').trim()
        var prefix = String(svcPrefix || '').trim()
        if (prefix && prefix.charAt(0) !== '/') prefix = '/' + prefix
        if (prefix.endsWith('/')) prefix = prefix.slice(0, -1)
        if (port === '80') return 'http://' + host + prefix
        if (port === '443') return 'https://' + host + prefix
        return 'http://' + host + ':' + port + prefix
      }

      function callHost(method, args) {
        try {
          if (typeof host !== 'undefined' && host && typeof host.call === 'function') {
            return host.call(method, args || {}).catch(function () {
              return null
            })
          }
        } catch (e) {}
        return Promise.resolve(null)
      }

      function authHeaders(extra) {
        var h = Object.assign({}, extra || {})
        var s = secretForSave(draft.secret)
        if (s) h['X-Remote-Review-Secret'] = s
        return h
      }

      function fetchJson(url, opts) {
        opts = opts || {}
        var headers = authHeaders(opts.headers || {})
        return fetch(
          url,
          Object.assign({}, opts, { headers: headers, signal: opts.signal || AbortSignal.timeout(8000) }),
        )
          .then(function (r) {
            return r.text().then(function (text) {
              var d = {}
              try {
                d = text ? JSON.parse(text) : {}
              } catch (e) {
                d = { ok: false, detail: text.slice(0, 200) || '非 JSON 响应' }
              }
              return { http: r.status, ok: r.ok && d && d.ok !== false, d: d }
            })
          })
          .catch(function (e) {
            var msg = e && e.message ? e.message : String(e)
            if (/Failed to fetch|NetworkError|Load failed|aborted|timeout/i.test(msg)) {
              throw new Error(
                '连不上本机审码服务 ' +
                  base() +
                  '。请确认：① 已安装并启用本插件；② 没有旧版终端进程占端口（可关掉旧的 pnpm start）；③ 刷新/重开 WorkBuddy 让插件重新拉起服务。原始错误：' +
                  msg,
              )
            }
            throw e
          })
      }

      function loadConfig() {
        setBusy(true)
        setMsg('加载中…')
        setMsgOk(false)
        rememberEndpoint()
        callHost('getConfig', {})
          .then(function (viaHost) {
            if (viaHost && viaHost.ok && viaHost.config) return viaHost
            return fetchJson(base() + '/api/config').then(function (x) {
              if (x.http === 404) {
                throw new Error(
                  '端口上是旧版服务（无 /api/config）。请结束占用 18787 的旧进程后重开 WorkBuddy，再点「连接并加载」。',
                )
              }
              if (x.http === 401) {
                throw new Error((x.d && x.d.detail) || 'Webhook 密钥不正确')
              }
              return {
                ok: x.ok,
                config: x.d && x.d.config,
                needSecret: !!(x.d && x.d.needSecret),
                detail: (x.d && x.d.detail) || (!x.ok ? 'HTTP ' + x.http : ''),
              }
            })
          })
          .then(function (x) {
            if (!x || !x.ok || !x.config) {
              if (x && x.needSecret) {
                throw new Error(
                  '服务已配置 Webhook 密钥：请在下方「Webhook 密钥」填入明文后点「连接并加载」（优先用 WorkBuddy 宿主通道则无需手填）',
                )
              }
              throw new Error((x && x.detail) || '无法加载配置：请先安装并启用远端审码插件，然后刷新页面')
            }
            var c = x.config
            setDraft({
              engine: c.engine || 'http://127.0.0.1:8000',
              listen: c.listen || '127.0.0.1',
              port: String(c.port != null ? c.port : 18787),
              secret: maskIfConfigured(!!c.secretConfigured),
              secretConfigured: !!c.secretConfigured,
              feishuAppId: c.feishuAppId || '',
              feishuAppSecret: maskIfConfigured(!!c.feishuAppSecretConfigured),
              feishuAppSecretConfigured: !!c.feishuAppSecretConfigured,
              feishuFolderToken: c.feishuFolderToken || '',
              feishuWikiSpaceId: c.feishuWikiSpaceId || '',
              feishuWikiParentNodeToken: c.feishuWikiParentNodeToken || '',
              webhook: c.webhook || '',
              dataRoot: c.dataRoot || '',
              feishuReady: !!c.feishuReady,
            })
            setMsg('已加载本机配置（不会写进项目仓库）')
            setMsgOk(true)
          })
          .catch(function (e) {
            setMsg('加载失败：' + (e && e.message ? e.message : String(e)))
            setMsgOk(false)
          })
          .finally(function () {
            setBusy(false)
          })
      }

      function saveConfig() {
        setBusy(true)
        setMsg('保存中…')
        setMsgOk(false)
        rememberEndpoint()
        var payload = {
          engine: draft.engine,
          listen: draft.listen,
          port: draft.port,
          secret: secretForSave(draft.secret),
          feishuAppId: draft.feishuAppId,
          feishuAppSecret: secretForSave(draft.feishuAppSecret),
          feishuFolderToken: draft.feishuFolderToken,
          feishuWikiSpaceId: draft.feishuWikiSpaceId,
          feishuWikiParentNodeToken: draft.feishuWikiParentNodeToken,
        }
        if (!String(payload.feishuAppId || '').trim()) {
          setMsg('保存失败：请填写飞书 App ID')
          setMsgOk(false)
          setBusy(false)
          return
        }
        if (!draft.feishuAppSecretConfigured && !payload.feishuAppSecret) {
          setMsg('保存失败：请填写飞书 App Secret')
          setMsgOk(false)
          setBusy(false)
          return
        }
        if (
          !String(payload.feishuWikiSpaceId || '').trim() &&
          !String(payload.feishuFolderToken || '').trim()
        ) {
          setMsg('保存失败：请填写文档库 space_id（推荐）或云盘文件夹 Token')
          setMsgOk(false)
          setBusy(false)
          return
        }
        // 填了 wikiSpaceId 会进「我的文档库」；folder 可不填
        callHost('saveConfig', payload)
          .then(function (viaHost) {
            if (viaHost && viaHost.ok) return viaHost
            return fetchJson(base() + '/api/config', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ config: payload }),
            }).then(function (x) {
              if (x.http === 404) {
                throw new Error(
                  '端口上是旧版服务，无法保存。请结束占用端口的旧 pnpm start / node lib/cli.js，重开 WorkBuddy 后再保存。',
                )
              }
              if (x.http === 401) {
                throw new Error(
                  (x.d && x.d.detail) ||
                    '保存需要 Webhook 密钥：请在设置页填入明文密钥后再保存（或走宿主通道）',
                )
              }
              return Object.assign({ ok: x.ok }, x.d, {
                detail: (x.d && x.d.detail) || (!x.ok ? 'HTTP ' + x.http : undefined),
              })
            })
          })
          .then(function (x) {
            if (!x || !x.ok) throw new Error((x && x.detail) || '保存失败')
            var c = x.config || {}
            setDraft(function (prev) {
              return Object.assign({}, prev, {
                engine: c.engine || prev.engine,
                listen: c.listen || prev.listen,
                port: String(c.port != null ? c.port : prev.port),
                secret: maskIfConfigured(!!c.secretConfigured),
                secretConfigured: !!c.secretConfigured,
                feishuAppId: c.feishuAppId || '',
                feishuAppSecret: maskIfConfigured(!!c.feishuAppSecretConfigured),
                feishuAppSecretConfigured: !!c.feishuAppSecretConfigured,
                feishuFolderToken: c.feishuFolderToken || '',
                feishuWikiSpaceId: c.feishuWikiSpaceId || '',
                feishuWikiParentNodeToken: c.feishuWikiParentNodeToken || '',
                webhook: c.webhook || prev.webhook,
                dataRoot: c.dataRoot || prev.dataRoot,
                feishuReady: !!c.feishuReady,
              })
            })
            setMsg((x.detail || '已保存') + (x.note ? '；' + x.note : ''))
            setMsgOk(true)
          })
          .catch(function (e) {
            setMsg('保存失败：' + (e && e.message ? e.message : String(e)))
            setMsgOk(false)
          })
          .finally(function () {
            setBusy(false)
          })
      }

      function checkHealth() {
        rememberEndpoint()
        setHealth('检测中…')
        fetch(base() + '/health')
          .then(function (r) {
            return r.json().then(function (d) {
              return { ok: r.ok, d: d }
            })
          })
          .then(function (x) {
            var d = x.d || {}
            var eng = d.engine || {}
            var ready = d.config && d.config.feishuReady
            setHealth(
              (x.ok ? '✅ 服务在线' : '❌ 服务异常') +
                ' · 飞书' +
                (ready ? '已配置' : '未配置') +
                ' · 引擎' +
                (eng.ok ? '就绪' : eng.detail || '未就绪'),
            )
          })
          .catch(function (e) {
            setHealth('❌ ' + (e && e.message ? e.message : String(e)))
          })
      }

      function installHook() {
        var path = String(repoPath || '').trim()
        if (!path) {
          setMsg('请填写要安装 Hook 的业务仓库绝对路径')
          setMsgOk(false)
          return
        }
        setBusy(true)
        setMsg('安装 Hook 中…')
        setMsgOk(false)
        rememberEndpoint()
        callHost('installHook', { repoPath: path })
          .then(function (viaHost) {
            if (viaHost && (viaHost.ok === true || viaHost.ok === false)) return viaHost
            return fetch(base() + '/api/install-hook', {
              method: 'POST',
              headers: authHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ repoPath: path }),
            }).then(function (r) {
              return r.json().then(function (d) {
                return Object.assign({ ok: r.ok && d && d.ok !== false }, d)
              })
            })
          })
          .then(function (x) {
            if (!x || !x.ok) throw new Error((x && x.detail) || '安装失败')
            setMsg(x.detail || 'Hook 已安装')
            setMsgOk(true)
          })
          .catch(function (e) {
            setMsg('安装失败：' + (e && e.message ? e.message : String(e)))
            setMsgOk(false)
          })
          .finally(function () {
            setBusy(false)
          })
      }

      useEffect(function () {
        loadConfig()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      return h(
        'div',
        { className: 'rr-set' },
        h(
          'p',
          { className: 'rr-set-lead' },
          '顶部先选连哪台服务（本机或公司服务器），再填下面表单并点保存——会写到该服务机器，不会进业务 git。',
        ),
        h(
          'div',
          { className: 'rr-set-eng' },
          h('label', null, '服务 host'),
          h('input', {
            value: svcHost,
            onChange: function (e) {
              setSvcHost(e.target.value)
            },
          }),
          h('label', null, 'port'),
          h('input', {
            value: svcPort,
            onChange: function (e) {
              setSvcPort(e.target.value)
            },
          }),
          h('label', null, '路径前缀'),
          h('input', {
            value: svcPrefix,
            placeholder: '本机空；服务器填 /remote-review',
            style: { width: '160px' },
            onChange: function (e) {
              setSvcPrefix(e.target.value)
            },
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'rr-set-btn',
              disabled: busy,
              onClick: function () {
                rememberEndpoint()
                loadConfig()
                checkHealth()
              },
            },
            '连接并加载',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'rr-set-btn',
              disabled: busy,
              onClick: function () {
                setSvcHost('175.178.238.31')
                setSvcPort('80')
                setSvcPrefix('/remote-review')
              },
            },
            '填公司服务器',
          ),
        ),
        h(
          'p',
          { className: 'rr-set-hint' },
          '连公司服务器：点「填公司服务器」→「连接并加载」→ 填飞书 → 保存。不要把公网地址填进下面的「引擎/监听」。',
        ),
        h(
          'div',
          { className: 'rr-set-card' },
          h('h3', null, '1 · 审码引擎'),
          h(
            'div',
            { className: 'rr-set-grid' },
            field(
              'WorkBuddy 引擎地址',
              {
                value: draft.engine,
                placeholder: 'http://127.0.0.1:8000',
                onChange: function (e) {
                  setDraft(Object.assign({}, draft, { engine: e.target.value }))
                },
              },
              true,
              true,
            ),
          ),
          h('p', { className: 'rr-set-hint' }, '填「跑审码的那台机器本机地址」。公司服务器请填 http://127.0.0.1:8091，不要填 175.178.238.31。'),
        ),
        h(
          'div',
          { className: 'rr-set-card' },
          h('h3', null, '2 · 飞书文档（审核报告发到这里）'),
          h(
            'p',
            { className: 'rr-set-hint' },
            '以下只保存在本机 ~/.zhongruan/remote-review/config.json，不会写进任何 git 项目。每人/每台机器各自填。',
          ),
          h(
            'div',
            { className: 'rr-set-grid' },
            field(
              '飞书 App ID',
              {
                value: draft.feishuAppId,
                placeholder: 'cli_xxxx（开放平台 → 凭证与基础信息）',
                onChange: function (e) {
                  setDraft(Object.assign({}, draft, { feishuAppId: e.target.value }))
                },
              },
              true,
              true,
            ),
            field(
              draft.feishuAppSecretConfigured ? '飞书 App Secret（已保存）' : '飞书 App Secret',
              {
                type: 'password',
                autoComplete: 'new-password',
                value: draft.feishuAppSecret,
                placeholder: draft.feishuAppSecretConfigured
                  ? '点击后可改密；不改请保持密文'
                  : '在开放平台复制',
                onFocus: function () {
                  setDraft(function (prev) {
                    if (prev.feishuAppSecret === SECRET_MASK) {
                      return Object.assign({}, prev, { feishuAppSecret: '' })
                    }
                    return prev
                  })
                },
                onBlur: function () {
                  setDraft(function (prev) {
                    if (prev.feishuAppSecretConfigured && !String(prev.feishuAppSecret || '').trim()) {
                      return Object.assign({}, prev, { feishuAppSecret: SECRET_MASK })
                    }
                    return prev
                  })
                },
                onChange: function (e) {
                  var v = e.target.value
                  setDraft(function (prev) {
                    return Object.assign({}, prev, { feishuAppSecret: v })
                  })
                },
              },
              true,
              true,
            ),
            field(
              '文档库 space_id（推荐）',
              {
                value: draft.feishuWikiSpaceId,
                placeholder: '一串数字的 space_id（不是 URL 里 /wiki/ 后面那串）',
                onChange: function (e) {
                  setDraft(Object.assign({}, draft, { feishuWikiSpaceId: e.target.value }))
                },
              },
              true,
              false,
            ),
            field(
              '文档库父节点（可选）',
              {
                value: draft.feishuWikiParentNodeToken,
                placeholder: 'URL 里 /wiki/ 后面那串；空则落在文档库根',
                onChange: function (e) {
                  setDraft(Object.assign({}, draft, { feishuWikiParentNodeToken: e.target.value }))
                },
              },
              true,
              false,
            ),
            field(
              '云盘文件夹 Token（一般不用）',
              {
                value: draft.feishuFolderToken,
                placeholder: 'fld… 仅备用；个人云盘常无权限',
                onChange: function (e) {
                  setDraft(Object.assign({}, draft, { feishuFolderToken: e.target.value }))
                },
              },
              true,
              false,
            ),
          ),
          h(
            'p',
            { className: 'rr-set-hint' },
            '要出现在「我的文档库」：文档库「添加应用」选本应用并给可编辑 → 填 space_id。父节点/文件夹留空可清空。开放平台需开通并发布 wiki 权限。',
          ),
        ),
        h(
          'div',
          { className: 'rr-set-card' },
          h('h3', null, '3 · Webhook 服务'),
          h(
            'div',
            { className: 'rr-set-grid' },
            field('监听地址', {
              value: draft.listen,
              placeholder: '127.0.0.1',
              onChange: function (e) {
                setDraft(Object.assign({}, draft, { listen: e.target.value }))
              },
            }),
            field('端口', {
              value: draft.port,
              onChange: function (e) {
                setDraft(Object.assign({}, draft, { port: e.target.value }))
              },
            }),
            field(
              draft.secretConfigured ? 'Webhook 密钥（已保存，可选）' : 'Webhook 密钥（可选）',
              {
                type: 'password',
                autoComplete: 'new-password',
                value: draft.secret,
                placeholder: draft.secretConfigured ? '点击后可改密；不改请保持密文' : '本机自测可空',
                onFocus: function () {
                  setDraft(function (prev) {
                    if (prev.secret === SECRET_MASK) {
                      return Object.assign({}, prev, { secret: '' })
                    }
                    return prev
                  })
                },
                onBlur: function () {
                  setDraft(function (prev) {
                    if (prev.secretConfigured && !String(prev.secret || '').trim()) {
                      return Object.assign({}, prev, { secret: SECRET_MASK })
                    }
                    return prev
                  })
                },
                onChange: function (e) {
                  var v = e.target.value
                  setDraft(function (prev) {
                    return Object.assign({}, prev, { secret: v })
                  })
                },
              },
              true,
            ),
          ),
          h(
            'p',
            { className: 'rr-set-hint' },
            'Webhook 地址：' +
              (draft.webhook || serviceBase() + '/webhook') +
              (draft.dataRoot ? ' · 本机配置目录 ' + draft.dataRoot : ''),
          ),
        ),
        h(
          'div',
          { className: 'rr-set-card' },
          h('h3', null, '4 · 给业务仓库装提交触发（可选）'),
          field(
            '业务仓库绝对路径',
            {
              value: repoPath,
              placeholder: '/Users/你/某业务仓',
              onChange: function (e) {
                setRepoPath(e.target.value)
              },
            },
            true,
          ),
          h(
            'p',
            { className: 'rr-set-hint' },
            '只在该仓安装 post-commit 敲门脚本，不会把飞书密钥写进仓库。若已有旧 Hook 会自动链式保留。',
          ),
          h(
            'div',
            { className: 'rr-set-actions' },
            h(
              'button',
              { type: 'button', className: 'rr-set-btn', disabled: busy, onClick: installHook },
              '安装提交 Hook',
            ),
          ),
        ),
        h(
          'div',
          { className: 'rr-set-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'rr-set-btn primary',
              disabled: busy,
              onClick: saveConfig,
            },
            '保存配置',
          ),
          h(
            'button',
            { type: 'button', className: 'rr-set-btn', disabled: busy, onClick: loadConfig },
            '重新加载',
          ),
          h(
            'button',
            { type: 'button', className: 'rr-set-btn', disabled: busy, onClick: checkHealth },
            '检测服务',
          ),
          msg ? h('span', { className: 'rr-set-msg' + (msgOk ? ' ok' : ' err') }, msg) : null,
        ),
        health ? h('p', { className: 'rr-set-hint' }, health) : null,
      )
    }

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') {
        console.error('[remote-review] 无 slots，无法注册设置页')
        return
      }
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          {
            name: 'settings.section',
            id: 'remote-review',
            order: 6,
            label: '远端审码',
          },
          RemoteReviewSettingsSection,
        )
      })
      console.log('[remote-review] 已注册设置页「远端审码」')
    }

    module.exports = { inject: ['slots'], apply: apply }
    return module.exports
  },
})
