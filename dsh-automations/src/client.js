/**
 * 左侧栏「自动化」：与设置并列（sidebar.footer.action）。
 * 主面板对标 simplified-workbuddy AutomationsView（定时任务 / 运行记录）。
 * 不注入 settings.section，不占用右侧栏。
 */
window.__ModuleLoader__.load({
  id: '@zhongruan/dsh-automations',
  factory: (require) => {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useRef = React.useRef

    var PLUGIN_ID = '@zhongruan/dsh-automations'
    var WORKSPACE_EVENT = '@lemoncat7/dsh-plugin-ui/workspace-activate'
    var RUNS_PAGE_SIZE = 10
    var SECRET_MASK = '••••••••••••'
    var CUSTOM_SCHEDULE_VALUE = 'custom'
    var WEEKDAYS = [
      { value: 'MO', label: '一' },
      { value: 'TU', label: '二' },
      { value: 'WE', label: '三' },
      { value: 'TH', label: '四' },
      { value: 'FR', label: '五' },
      { value: 'SA', label: '六' },
      { value: 'SU', label: '日' },
    ]
    var WORKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR']
    var PRESETS = [
      { value: 'daily-0800', label: '每天 08:00', rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0' },
      { value: 'daily-0830', label: '每天 08:30', rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=30' },
      { value: 'daily-0900', label: '每天 09:00', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
      { value: 'daily-1800', label: '每天 18:00', rrule: 'FREQ=DAILY;BYHOUR=18;BYMINUTE=0' },
      { value: 'weekly-fr-1700', label: '每周五 17:00', rrule: 'FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=0' },
      { value: 'weekly-su-1000', label: '每周日 10:00', rrule: 'FREQ=WEEKLY;BYDAY=SU;BYHOUR=10;BYMINUTE=0' },
      { value: 'weekday-0900', label: '工作日 09:00', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0' },
    ]
    var FALLBACK_TEMPLATES = [
      {
        id: 'daily-ai-news',
        icon: 'news',
        title: '每日PCB+AI新闻推送',
        description:
          '检索并整理今日 PCB+AI 领域重要新闻，聚焦 PCB+AI；输出 3–5 条中文摘要，每条含标题、要点与来源链接（如有）。',
        prompt:
          '检索并整理今日 PCB+AI 领域重要新闻，聚焦 PCB+AI；输出 3–5 条中文摘要，每条含标题、要点与来源链接（如有）。',
        push_to_wecom: true,
        schedule_type: 'recurring',
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        scheduleLabel: '每天 09:00',
      },
      {
        id: 'weekly-work-report',
        icon: 'report',
        title: '每周工作周报',
        description: '每周五根据本周 git 提交与代码变更，汇总 ZR WorkBuddy 真实功能交付（不编造 MES 运维项）。',
        prompt:
          '生成本周工作周报：仅依据系统注入的「本周代码变更依据」（git 提交与变更文件）归纳已完成工作；聚焦本周新增/改动的功能与代码；进行中写尚未合入或待验证项；下周计划写 2～3 条可执行事项；语气专业简洁，适合发给团队。禁止编造提交中不存在的功能。',
        push_to_wecom: false,
        schedule_type: 'recurring',
        rrule: 'FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=0',
        scheduleLabel: '每周五 17:00',
      },
      {
        id: 'mes-daily-production-report',
        icon: 'mes',
        title: '每日生产运营日报',
        description:
          '每天早上汇总昨日 MES 真实生产数据：工单、设备稼动率、产量、工序良率；早报式排版，面向领导阅读。',
        prompt:
          '生成【昨日生产运营日报】，面向领导阅读；必须真实查询当前 MES，禁止编造任何数字。',
        push_to_wecom: true,
        schedule_type: 'recurring',
        rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
        scheduleLabel: '每天 08:00',
      },
    ]
    var PROMPT_SKELETON =
      '【目标】（一句话：要产出什么）\n【数据来源】MES 查数 / 联网检索 / 本仓库 git\n【查数或检索步骤】\n1. …\n2. …\n【输出格式】\n- 共几条；每条含标题、要点；（新闻类须保留来源链接）\n- 查不到的数据整段省略，禁止编造\n【禁止】Markdown 表格、工具名、写码/提交/部署'

    function servicePort() {
      try {
        var p = localStorage.getItem('dsh-automations-port')
        if (p && /^\d+$/.test(p)) return p
      } catch (e) {}
      return '18789'
    }
    function serviceHost() {
      try {
        var x = localStorage.getItem('dsh-automations-host')
        if (x) return x
      } catch (e) {}
      return '127.0.0.1'
    }
    function serviceBase() {
      return 'http://' + serviceHost() + ':' + servicePort()
    }
    function rememberPort(port) {
      try {
        localStorage.setItem('dsh-automations-host', '127.0.0.1')
        if (port) localStorage.setItem('dsh-automations-port', String(port))
      } catch (e) {}
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
    function fetchJson(url, opts) {
      opts = opts || {}
      return fetch(url, Object.assign({ signal: AbortSignal.timeout(120000) }, opts)).then(function (r) {
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
    function pad2(n) {
      return String(n).padStart(2, '0')
    }
    function findPresetByRrule(rrule) {
      var raw = String(rrule || '').trim()
      for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].rrule === raw) return PRESETS[i]
      return null
    }
    function parseRruleToCustom(rrule) {
      var raw = String(rrule || '').trim()
      var byhour = Number((raw.match(/BYHOUR=(\d+)/) || [])[1] || 9)
      var byminute = Number((raw.match(/BYMINUTE=(\d+)/) || [])[1] || 0)
      var hour = Number.isFinite(byhour) ? Math.min(23, Math.max(0, byhour)) : 9
      var minute = Number.isFinite(byminute) ? Math.min(59, Math.max(0, byminute)) : 0
      var time = pad2(hour) + ':' + pad2(minute)
      var dayRaw = (raw.match(/BYDAY=([A-Z,]+)/) || [])[1] || ''
      var days = dayRaw
        .split(',')
        .map(function (d) {
          return d.trim().toUpperCase()
        })
        .filter(function (d) {
          return WEEKDAYS.some(function (x) {
            return x.value === d
          })
        })
      if (raw.indexOf('FREQ=DAILY') >= 0 || (raw.indexOf('FREQ=WEEKLY') < 0 && !dayRaw)) {
        return { kind: 'daily', time: time, weekdays: WORKDAYS.slice() }
      }
      var isWorkday =
        days.length === 5 &&
        WORKDAYS.every(function (d) {
          return days.indexOf(d) >= 0
        })
      if (isWorkday) return { kind: 'weekday', time: time, weekdays: WORKDAYS.slice() }
      return { kind: 'weekly', time: time, weekdays: days.length ? days : ['MO'] }
    }
    function buildCustomRrule(kind, time, weekdays) {
      var m = String(time || '09:00').match(/^(\d{1,2}):(\d{2})$/)
      var hour = m ? Math.min(23, Math.max(0, Number(m[1]))) : 9
      var minute = m ? Math.min(59, Math.max(0, Number(m[2]))) : 0
      var hm = 'BYHOUR=' + hour + ';BYMINUTE=' + minute
      if (kind === 'daily') return 'FREQ=DAILY;' + hm
      if (kind === 'weekday') return 'FREQ=WEEKLY;BYDAY=' + WORKDAYS.join(',') + ';' + hm
      var days = (weekdays || []).filter(Boolean)
      if (!days.length) days = ['MO']
      return 'FREQ=WEEKLY;BYDAY=' + days.join(',') + ';' + hm
    }
    function rruleToScheduleLabel(rrule) {
      var raw = String(rrule || '')
      var hour = (raw.match(/BYHOUR=(\d+)/) || [])[1]
      var minute = (raw.match(/BYMINUTE=(\d+)/) || [])[1]
      var time = hour != null && minute != null ? pad2(hour) + ':' + pad2(minute) : ''
      if (raw.indexOf('FREQ=DAILY') >= 0) return time ? '每天 ' + time : '每天'
      if (raw.indexOf('FREQ=WEEKLY') >= 0) {
        var day = (raw.match(/BYDAY=([A-Z,]+)/) || [])[1] || ''
        if (day === 'MO,TU,WE,TH,FR' && time) return '工作日 ' + time
        var map = { MO: '一', TU: '二', WE: '三', TH: '四', FR: '五', SA: '六', SU: '日' }
        var days = day
          .split(',')
          .map(function (d) {
            return map[d] || d
          })
          .join('、')
        return days && time ? '每周' + days + ' ' + time : '每周'
      }
      return '循环执行'
    }
    function scheduleSummary(item) {
      if (!item) return ''
      if (item.schedule_type === 'once') {
        return item.scheduled_at ? '单次 · ' + String(item.scheduled_at).replace('T', ' ') : '单次执行'
      }
      return item.schedule_label || item.scheduleLabel || rruleToScheduleLabel(item.rrule) || '循环执行'
    }
    function formatTime(ts) {
      if (!ts) return '—'
      var d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
      if (Number.isNaN(d.getTime())) return '—'
      return d.toLocaleString('zh-CN')
    }
    function runStatusLabel(status) {
      return ({ pending: '等待中', running: '运行中', succeeded: '成功', failed: '失败', skipped: '跳过', cancelled: '已取消' }[status] || status || '—')
    }
    function deliveryStatusLabel(status) {
      return ({ sent: '已推送', failed: '失败', skipped: '未推送', dry_run: '干跑', pending: '待推送' }[status] || status || '—')
    }
    function summaryPreview(text) {
      var s = String(text || '').replace(/\s+/g, ' ').trim()
      if (!s) return '—'
      return s.length > 80 ? s.slice(0, 80) + '…' : s
    }
    function runErrorText(row) {
      if (!row) return ''
      if (typeof row.error === 'string') return row.error
      if (row.error && row.error.message) return row.error.message
      return ''
    }
    function iconKey(tpl) {
      if (tpl && tpl.icon) return tpl.icon
      var id = tpl && tpl.id ? tpl.id : ''
      if (id.indexOf('news') >= 0) return 'news'
      if (id.indexOf('mes') >= 0) return 'mes'
      if (id.indexOf('dir') >= 0) return 'calendar'
      return 'report'
    }
    function svgEl(attrs, children) {
      return React.createElement.apply(React, ['svg', attrs].concat(children || []))
    }
    function pathEl(attrs) {
      return h('path', attrs)
    }
    function TimerIcon(size) {
      size = size || 16
      return svgEl(
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        [
          h('circle', { cx: '8', cy: '8', r: '6.5', stroke: 'currentColor', strokeWidth: '1.2' }),
          pathEl({ d: 'M8 4.5V8l2.5 1.5', stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round' }),
        ],
      )
    }
    function ListIcon() {
      return svgEl({ width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, [
        h('rect', { x: '3', y: '2.5', width: '10', height: '11', rx: '1.5', stroke: 'currentColor', strokeWidth: '1.2' }),
        pathEl({ d: 'M5.5 6h5M5.5 8.5h5M5.5 11h3', stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round' }),
      ])
    }
    function TplIcon(kind) {
      var k = kind || 'report'
      if (k === 'news') {
        return svgEl({ width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none' }, [
          h('rect', { x: '3', y: '4', width: '14', height: '12', rx: '2', stroke: 'currentColor', strokeWidth: '1.4' }),
          pathEl({ d: 'M6 8h8M6 11h5', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
        ])
      }
      if (k === 'mes') {
        return svgEl({ width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none' }, [
          pathEl({
            d: 'M3 15l4-8 3 5 3-3 4 6',
            stroke: 'currentColor',
            strokeWidth: '1.4',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        ])
      }
      if (k === 'calendar') {
        return svgEl({ width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none' }, [
          h('rect', { x: '3', y: '5', width: '14', height: '12', rx: '2', stroke: 'currentColor', strokeWidth: '1.4' }),
          pathEl({ d: 'M3 8h14M7 3v3M13 3v3', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
        ])
      }
      return svgEl({ width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none' }, [
        pathEl({ d: 'M5 4h10v12H5z', stroke: 'currentColor', strokeWidth: '1.4' }),
        pathEl({ d: 'M7.5 12V9M10 12V7M12.5 12v-4', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
      ])
    }
    function EmptyHeroIcon() {
      return svgEl({ width: 72, height: 72, viewBox: '0 0 72 72', fill: 'none' }, [
        h('circle', { cx: '36', cy: '36', r: '28', stroke: '#cbd5e1', strokeWidth: '2' }),
        pathEl({ d: 'M36 20v16l10 6', stroke: '#94a3b8', strokeWidth: '2', strokeLinecap: 'round' }),
        h('circle', { cx: '52', cy: '52', r: '10', fill: '#f8fafc', stroke: '#22c55e', strokeWidth: '2' }),
        pathEl({ d: 'M48 52l3 3 6-6', stroke: '#22c55e', strokeWidth: '2', strokeLinecap: 'round' }),
      ])
    }

    var ZA_CSS =
      ':has(> .za-launcher),:has(> div > .za-launcher){flex-wrap:wrap}' +
      ':has(> .za-launcher--rail),:has(> div > .za-launcher--rail){flex-direction:column;align-items:center}' +
      '.za-launcher{display:flex;flex:0 0 calc(100% + 4px);order:-1;min-width:0;gap:4px;width:calc(100% + 4px);margin:4px -2px;box-sizing:border-box}' +
      '.za-launcher--rail{flex:none;width:36px;margin:8px 0 10px;flex-direction:column;align-items:center}' +
      '.za-trigger{position:relative;flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:8px;height:36px;margin:0;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:14px;line-height:22px;white-space:nowrap}' +
      '.za-trigger:hover{background:var(--surface-hover,rgba(127,127,127,.12))}' +
      '.za-trigger.is-active{background:var(--surface-hover,rgba(127,127,127,.16))}' +
      '.za-trigger--rail{width:36px;height:36px;padding:0;justify-content:center;border-radius:50%}' +
      '.za-root{--za-bg:#fff;--za-bg2:#f8fafc;--za-bg3:#f1f5f9;--za-text:#1e293b;--za-text2:#64748b;--za-text3:#94a3b8;--za-border:#e2e8f0;--za-brand:#4f46e5;--za-brand-light:#eef2ff;--za-danger:#dc2626;--za-danger-bg:#fef2f2;--za-radius:8px;--za-radius-lg:12px;display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;background:var(--za-bg2);color:var(--za-text);font-family:system-ui,"Noto Sans SC",sans-serif;font-size:13px;line-height:1.5}' +
      '.za-view{display:flex;flex-direction:column;height:100%;min-height:0}' +
      '.za-page-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 24px;background:var(--za-bg);border-bottom:1px solid var(--za-border);flex-shrink:0}' +
      '.za-header-tabs{display:flex;gap:4px}' +
      '.za-header-tab{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border:none;border-radius:8px;background:transparent;color:var(--za-text2);font-size:14px;font-family:inherit;cursor:pointer}' +
      '.za-header-tab:hover{background:var(--za-bg3);color:var(--za-text)}' +
      '.za-header-tab.active{background:var(--za-bg3);color:var(--za-text);font-weight:600}' +
      '.za-header-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}' +
      '.za-btn{padding:7px 14px;border-radius:8px;border:1px solid var(--za-border);background:var(--za-bg);color:var(--za-text);cursor:pointer;font:inherit;font-size:13px}' +
      '.za-btn:disabled{opacity:.5;cursor:not-allowed}' +
      '.za-btn.primary{background:var(--za-brand);border-color:transparent;color:#fff}' +
      '.za-btn.link{border:none;background:transparent;color:var(--za-brand);padding:4px 8px}' +
      '.za-btn.link.danger{color:var(--za-danger)}' +
      '.za-btn.ghost{background:transparent}' +
      '.za-page-body{flex:1;overflow-y:auto;padding:24px}' +
      '.za-loading{text-align:center;color:var(--za-text3);padding:48px}' +
      '.za-error-card{padding:12px 16px;border-radius:var(--za-radius);background:var(--za-danger-bg);color:var(--za-danger);font-size:13px}' +
      '.za-empty-section{max-width:960px;margin:0 auto}' +
      '.za-empty-hero{display:flex;flex-direction:column;align-items:center;padding:48px 16px 40px}' +
      '.za-empty-icon{margin-bottom:16px}' +
      '.za-empty-title{font-size:15px;color:var(--za-text2);margin:0 0 20px}' +
      '.za-templates-heading{font-size:14px;font-weight:600;color:var(--za-text);margin:0 0 16px}' +
      '.za-template-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}' +
      '.za-template-grid.compact{grid-template-columns:repeat(4,minmax(0,1fr))}' +
      '.za-template-card{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:16px;text-align:left;border:1px solid var(--za-border);border-radius:var(--za-radius-lg);background:var(--za-bg);cursor:pointer;font-family:inherit;color:inherit}' +
      '.za-template-card:hover{border-color:var(--za-brand);box-shadow:0 2px 8px rgba(15,23,42,.06)}' +
      '.za-template-card.compact{padding:12px}' +
      '.za-template-title{font-size:14px;font-weight:600;color:var(--za-text);line-height:1.4}' +
      '.za-template-desc{font-size:12px;color:var(--za-text3);line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}' +
      '.za-tpl-icon{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;background:var(--za-bg3);color:var(--za-text2)}' +
      '.za-tpl-icon.news{color:#2563eb;background:#eff6ff}' +
      '.za-tpl-icon.report{color:#7c3aed;background:#f5f3ff}' +
      '.za-tpl-icon.mes{color:#0d9488;background:#f0fdfa}' +
      '.za-tpl-icon.calendar{color:#d97706;background:#fffbeb}' +
      '.za-task-list{max-width:960px;margin:0 auto}' +
      '.za-task-toolbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;color:var(--za-text3);font-size:13px}' +
      '.za-task-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}' +
      '.za-task-card{padding:16px;border:1px solid var(--za-border);border-radius:var(--za-radius-lg);background:var(--za-bg)}' +
      '.za-task-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px}' +
      '.za-task-name{font-size:15px;font-weight:600;margin:0;color:var(--za-text)}' +
      '.za-pill{flex-shrink:0;font-size:11px;padding:2px 8px;border-radius:999px;background:var(--za-bg3);color:var(--za-text2)}' +
      '.za-pill[data-status="active"]{background:#ecfdf5;color:#166534}' +
      '.za-task-schedule{font-size:12px;color:var(--za-brand);margin:0 0 4px}' +
      '.za-task-next{font-size:12px;color:var(--za-text3);margin:0 0 8px}' +
      '.za-task-prompt{font-size:13px;color:var(--za-text2);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:0 0 12px}' +
      '.za-task-actions{display:flex;flex-wrap:wrap;gap:4px}' +
      '.za-compact-templates{margin-top:32px}' +
      '.za-runs-empty{text-align:center;padding:64px 16px}' +
      '.za-runs-hint{margin-top:8px;font-size:13px;color:var(--za-text3)}' +
      '.za-runs-wrap{width:80%;max-width:1280px;margin:0 auto;background:var(--za-bg);border:1px solid var(--za-border);border-radius:var(--za-radius-lg);overflow:hidden;padding:16px 20px 12px}' +
      '.za-runs-toolbar{display:flex;justify-content:flex-end;margin-bottom:12px;font-size:13px;color:var(--za-text3)}' +
      '.za-table{width:100%;border-collapse:collapse}' +
      '.za-table th{text-align:left;font-size:12px;color:var(--za-text3);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--za-border)}' +
      '.za-table td{padding:10px;border-bottom:1px solid var(--za-border);font-size:13px;color:var(--za-text2);cursor:pointer;vertical-align:top}' +
      '.za-table tr:hover td{background:var(--za-bg2)}' +
      '.za-table tr.selected td{background:var(--za-brand-light)}' +
      '.za-run-status[data-status="succeeded"]{color:#166534;font-weight:600}' +
      '.za-run-status[data-status="failed"]{color:#dc2626;font-weight:600}' +
      '.za-run-status[data-status="running"]{color:#2563eb;font-weight:600}' +
      '.za-run-delivery[data-delivery="sent"]{color:#16a34a;font-weight:600}' +
      '.za-run-delivery[data-delivery="failed"]{color:#dc2626;font-weight:600}' +
      '.za-pager{display:flex;justify-content:flex-end;gap:6px;margin-top:16px;padding-top:12px;border-top:1px solid var(--za-border)}' +
      '.za-pager button{min-width:32px;height:32px;border:1px solid var(--za-border);border-radius:6px;background:var(--za-bg);cursor:pointer}' +
      '.za-pager button.on{background:var(--za-brand);color:#fff;border-color:transparent}' +
      '.za-mask{position:fixed;inset:0;background:rgba(15,23,42,.35);z-index:80;display:flex}' +
      '.za-drawer{margin-left:auto;width:40%;min-width:320px;max-width:560px;background:var(--za-bg);height:100%;display:flex;flex-direction:column;box-shadow:-8px 0 24px rgba(15,23,42,.12)}' +
      '.za-drawer-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--za-border);font-weight:600}' +
      '.za-drawer-body{flex:1;overflow:auto;padding:16px 20px}' +
      '.za-drawer-meta{display:flex;flex-wrap:wrap;gap:8px 12px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--za-border);font-size:12px;color:var(--za-text3)}' +
      '.za-banner{display:flex;align-items:center;justify-content:center;gap:10px;margin:8px 0 16px;color:var(--za-text2)}' +
      '.za-dialog-wrap{position:fixed;inset:0;background:rgba(15,23,42,.35);z-index:90;display:flex;align-items:center;justify-content:center;padding:24px}' +
      '.za-dialog{width:600px;max-width:100%;max-height:90vh;overflow:auto;background:var(--za-bg);border-radius:12px;padding:20px 22px 16px;box-shadow:0 16px 48px rgba(15,23,42,.18)}' +
      '.za-dialog h3{margin:0 0 14px;font-size:16px}' +
      '.za-alert{padding:10px 12px;border-radius:8px;background:#eff6ff;color:#1e40af;font-size:13px;margin-bottom:14px}' +
      '.za-alert ul{margin:8px 0 0;padding-left:18px}' +
      '.za-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}' +
      '.za-field label{font-size:13px;color:var(--za-text)}' +
      '.za-field input,.za-field textarea,.za-field select{padding:8px 10px;border-radius:8px;border:1px solid var(--za-border);background:var(--za-bg);color:inherit;font:inherit}' +
      '.za-field textarea{min-height:140px;resize:vertical}' +
      '.za-hint{font-size:12px;color:var(--za-text3);margin:4px 0 0}' +
      '.za-radio-row,.za-switch-row,.za-range-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}' +
      '.za-footer-tip{font-size:12px;color:var(--za-text3);margin:0 12px 0 0;flex:1}' +
      '.za-dialog-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px}' +
      '.za-toast{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:100;padding:8px 14px;border-radius:8px;background:#111827;color:#fff;font-size:13px}' +
      '.za-toast.ok{background:#166534}' +
      '.za-toast.err{background:#991b1b}' +
      '.za-morning{white-space:pre-wrap;font-size:13px;line-height:1.65;color:var(--za-text)}' +
      '@media (max-width:900px){.za-template-grid,.za-template-grid.compact{grid-template-columns:repeat(2,minmax(0,1fr))}.za-task-grid{grid-template-columns:1fr}.za-runs-wrap{width:100%}.za-drawer{width:100%;max-width:none}}'

    function ensureCss() {
      if (typeof document === 'undefined') return
      if (document.getElementById('za-ui-css')) return
      var style = document.createElement('style')
      style.id = 'za-ui-css'
      style.textContent = ZA_CSS
      document.head.appendChild(style)
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

    function emptyConfig() {
      return {
        listen: '127.0.0.1',
        port: '18789',
        schedulerEnabled: true,
        tickSec: 30,
        llmBaseUrl: '',
        llmApiKey: '',
        llmApiKeyConfigured: false,
        llmModel: 'deepseek-chat',
        wecomPushEnabled: false,
        wecomWebhookKey: '',
        wecomWebhookKeyConfigured: false,
        wecomDryRun: true,
        mesBaseUrl: '',
      }
    }

    function Toast(props) {
      if (!props.text) return null
      return h('div', { className: 'za-toast' + (props.ok ? ' ok' : props.ok === false ? ' err' : '') }, props.text)
    }

    function ConfigDialog(props) {
      var cfg = props.cfg
      var setCfg = props.setCfg
      if (!props.open) return null
      function field(key, label, extra) {
        return h('div', { className: 'za-field' }, [
          h('label', null, label),
          h(
            'input',
            Object.assign(
              {
                value: cfg[key] == null ? '' : String(cfg[key]),
                onChange: function (e) {
                  var next = Object.assign({}, cfg)
                  next[key] = e.target.value
                  setCfg(next)
                },
              },
              extra || {},
            ),
          ),
        ])
      }
      return h('div', { className: 'za-dialog-wrap', onClick: props.onClose }, [
        h(
          'div',
          {
            className: 'za-dialog',
            onClick: function (e) {
              e.stopPropagation()
            },
          },
          [
            h('h3', null, '推送配置'),
            h('p', { className: 'za-hint' }, '对标 WorkBuddy「系统配置 → 自动化推送 / 商用模型」。密钥只保存在本机。'),
            field('llmBaseUrl', 'LLM Base URL', { placeholder: 'https://api.deepseek.com/v1' }),
            field('llmApiKey', 'LLM API Key', { type: 'password', placeholder: '未改则保留已保存密钥' }),
            field('llmModel', '模型名'),
            h('div', { className: 'za-field' }, [
              h('label', null, '开启企微推送'),
              h('div', { className: 'za-switch-row' }, [
                h('input', {
                  type: 'checkbox',
                  checked: !!cfg.wecomPushEnabled,
                  onChange: function (e) {
                    setCfg(Object.assign({}, cfg, { wecomPushEnabled: e.target.checked }))
                  },
                }),
                h('span', null, '任务成功后可推送到企微群'),
              ]),
            ]),
            field('wecomWebhookKey', '企微 Webhook Key', { placeholder: '只填 key，或完整 URL' }),
            h('div', { className: 'za-field' }, [
              h('label', null, '推送联调模式'),
              h('div', { className: 'za-switch-row' }, [
                h('input', {
                  type: 'checkbox',
                  checked: cfg.wecomDryRun !== false,
                  onChange: function (e) {
                    setCfg(Object.assign({}, cfg, { wecomDryRun: e.target.checked }))
                  },
                }),
                h('span', null, '仅打日志，不真正发送'),
              ]),
            ]),
            field('mesBaseUrl', 'MES Base URL（生产日报）'),
            h('div', { className: 'za-field' }, [
              h('label', null, '调度器'),
              h('div', { className: 'za-switch-row' }, [
                h('input', {
                  type: 'checkbox',
                  checked: cfg.schedulerEnabled !== false,
                  onChange: function (e) {
                    setCfg(Object.assign({}, cfg, { schedulerEnabled: e.target.checked }))
                  },
                }),
                h('span', null, '开启后按日程自动执行'),
              ]),
            ]),
            h('div', { className: 'za-dialog-foot' }, [
              h('button', { type: 'button', className: 'za-btn', onClick: props.onClose }, '取消'),
              h('button', { type: 'button', className: 'za-btn primary', disabled: props.saving, onClick: props.onSave }, props.saving ? '保存中…' : '保存'),
            ]),
          ],
        ),
      ])
    }

    function EditDialog(props) {
      var initial = props.initial || {}
      var isEdit = !!initial.id
      var source = initial._source || (initial.id ? 'edit' : 'custom')
      var showAi = source !== 'template'
      var formState = useState(null)
      var form = formState[0]
      var setForm = formState[1]
      var presetState = useState('daily-0900')
      var recurringPreset = presetState[0]
      var setRecurringPreset = presetState[1]
      var customKindState = useState('daily')
      var customKind = customKindState[0]
      var setCustomKind = customKindState[1]
      var customTimeState = useState('09:00')
      var customTime = customTimeState[0]
      var setCustomTime = customTimeState[1]
      var customDaysState = useState(WORKDAYS.slice())
      var customDays = customDaysState[0]
      var setCustomDays = customDaysState[1]
      var rewritingState = useState(false)
      var rewriting = rewritingState[0]
      var setRewriting = rewritingState[1]

      useEffect(
        function () {
          var next = {
            id: initial.id || '',
            name: initial.name || '',
            prompt: initial.prompt || '',
            template_id: initial.template_id || '',
            schedule_type: initial.schedule_type || 'recurring',
            rrule: initial.rrule || 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
            scheduled_at: initial.scheduled_at ? String(initial.scheduled_at).slice(0, 16) : '',
            cwdText: (initial.cwds || []).join(', '),
            push_to_wecom: !!initial.push_to_wecom,
            valid_from: initial.valid_from || '',
            valid_until: initial.valid_until || '',
          }
          setForm(next)
          var hit = findPresetByRrule(next.rrule)
          if (hit) {
            setRecurringPreset(hit.value)
          } else if (next.rrule) {
            setRecurringPreset(CUSTOM_SCHEDULE_VALUE)
            var custom = parseRruleToCustom(next.rrule)
            setCustomKind(custom.kind)
            setCustomTime(custom.time)
            setCustomDays(custom.weekdays)
          } else {
            setRecurringPreset('daily-0900')
          }
        },
        [initial],
      )

      if (!props.open || !form) return null

      function patch(part) {
        setForm(Object.assign({}, form, part))
      }
      function applyPreset(value) {
        setRecurringPreset(value)
        if (value === CUSTOM_SCHEDULE_VALUE) {
          var custom = parseRruleToCustom(form.rrule)
          setCustomKind(custom.kind)
          setCustomTime(custom.time)
          setCustomDays(custom.weekdays)
          patch({ rrule: buildCustomRrule(custom.kind, custom.time, custom.weekdays) })
          return
        }
        var hit = PRESETS.filter(function (p) {
          return p.value === value
        })[0]
        if (hit) patch({ rrule: hit.rrule })
      }
      function syncCustom(kind, time, days) {
        setCustomKind(kind)
        setCustomTime(time)
        setCustomDays(days)
        patch({ rrule: buildCustomRrule(kind, time, days) })
      }

      return h('div', { className: 'za-dialog-wrap', onClick: props.onClose }, [
        h(
          'div',
          {
            className: 'za-dialog',
            onClick: function (e) {
              e.stopPropagation()
            },
          },
          [
            h('h3', null, isEdit ? '编辑自动化任务' : '添加自动化任务'),
            !isEdit
              ? h('div', { className: 'za-alert' }, [
                  h('strong', null, '自动化任务能做什么'),
                  h('ul', null, [
                    h('li', null, [h('strong', null, '适合：'), 'MES 查数简报、联网新闻摘要、仓库 git 周报（只读汇总）']),
                    h('li', null, [h('strong', null, '不适合：'), '改代码、Git 提交、触发部署等需人工确认的操作']),
                    h('li', null, [h('strong', null, '建议：'), '不确定时先用下方模板；保存后务必「立即测试」再看运行记录']),
                  ]),
                ])
              : null,
            h('div', { className: 'za-field' }, [
              h('label', null, '任务名称'),
              h('input', {
                maxLength: 120,
                placeholder: '例如：每日 MES 资料包巡检',
                value: form.name,
                onChange: function (e) {
                  patch({ name: e.target.value })
                },
              }),
            ]),
            h('div', { className: 'za-field' }, [
              h('label', null, '执行指令'),
              h('div', { className: 'za-switch-row' }, [
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'za-btn link',
                    onClick: function () {
                      patch({ prompt: PROMPT_SKELETON })
                    },
                  },
                  '填入指令骨架',
                ),
                showAi
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'za-btn link',
                        disabled: rewriting,
                        onClick: function () {
                          setRewriting(true)
                          fetchJson(serviceBase() + '/api/rewrite-prompt', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ draft: form.prompt, task_name: form.name }),
                          })
                            .then(function (x) {
                              if (!x.ok || !x.d.prompt) throw new Error((x.d && x.d.detail) || '改写失败')
                              patch({ prompt: x.d.prompt })
                            })
                            .catch(function (e) {
                              props.onToast(e.message || String(e), false)
                            })
                            .then(function () {
                              setRewriting(false)
                            })
                        },
                      },
                      rewriting ? '改写中…' : 'AI 改写',
                    )
                  : null,
              ]),
              h('textarea', {
                maxLength: 8000,
                placeholder: '示例结构（也可点「填入指令骨架」）：\n【目标】汇总昨日工单与设备产出\n【数据来源】当前 MES\n【输出格式】早报式：编号 + 要点 + 可选细分',
                value: form.prompt,
                onChange: function (e) {
                  patch({ prompt: e.target.value })
                },
              }),
              h(
                'p',
                { className: 'za-hint' },
                '写清目标、数据来源、输出格式；时间与目录在下方单独配置，勿写进指令。' +
                  (showAi ? '自定义任务可先写几句意图，再点「AI 改写」按骨架扩写（不改变你的目标）。' : ''),
              ),
            ]),
            h('div', { className: 'za-field' }, [
              h('label', null, '调度类型'),
              h('div', { className: 'za-radio-row' }, [
                h('label', null, [
                  h('input', {
                    type: 'radio',
                    checked: form.schedule_type === 'recurring',
                    onChange: function () {
                      patch({ schedule_type: 'recurring' })
                    },
                  }),
                  ' 循环执行',
                ]),
                h('label', null, [
                  h('input', {
                    type: 'radio',
                    checked: form.schedule_type === 'once',
                    onChange: function () {
                      patch({ schedule_type: 'once' })
                    },
                  }),
                  ' 单次执行',
                ]),
              ]),
            ]),
            form.schedule_type === 'recurring'
              ? h('div', { className: 'za-field' }, [
                  h('label', null, '循环规则'),
                  h(
                    'select',
                    {
                      value: recurringPreset,
                      onChange: function (e) {
                        applyPreset(e.target.value)
                      },
                    },
                    PRESETS.concat([{ value: CUSTOM_SCHEDULE_VALUE, label: '自定义时间…', rrule: '' }]).map(function (opt) {
                      return h('option', { key: opt.value, value: opt.value }, opt.label)
                    }),
                  ),
                  recurringPreset === CUSTOM_SCHEDULE_VALUE
                    ? h('div', null, [
                        h(
                          'div',
                          { className: 'za-radio-row', style: { marginTop: 8 } },
                          [
                            ['daily', '每天'],
                            ['weekday', '工作日'],
                            ['weekly', '每周'],
                          ].map(function (pair) {
                            return h(
                              'button',
                              {
                                key: pair[0],
                                type: 'button',
                                className: 'za-btn' + (customKind === pair[0] ? ' primary' : ''),
                                onClick: function () {
                                  syncCustom(pair[0], customTime, customDays)
                                },
                              },
                              pair[1],
                            )
                          }),
                        ),
                        customKind === 'weekly'
                          ? h(
                              'div',
                              { className: 'za-radio-row', style: { marginTop: 8 } },
                              WEEKDAYS.map(function (d) {
                                var on = customDays.indexOf(d.value) >= 0
                                return h(
                                  'label',
                                  { key: d.value },
                                  [
                                    h('input', {
                                      type: 'checkbox',
                                      checked: on,
                                      onChange: function () {
                                        var next = on
                                          ? customDays.filter(function (x) {
                                              return x !== d.value
                                            })
                                          : customDays.concat([d.value])
                                        syncCustom(customKind, customTime, next)
                                      },
                                    }),
                                    ' 周' + d.label,
                                  ],
                                )
                              }),
                            )
                          : null,
                        h('div', { className: 'za-range-row', style: { marginTop: 8 } }, [
                          h('span', null, '执行时间'),
                          h('input', {
                            type: 'time',
                            value: customTime,
                            onChange: function (e) {
                              syncCustom(customKind, e.target.value || '09:00', customDays)
                            },
                          }),
                        ]),
                        h('p', { className: 'za-hint' }, '当前规则：' + rruleToScheduleLabel(form.rrule)),
                      ])
                    : null,
                ])
              : h('div', { className: 'za-field' }, [
                  h('label', null, '执行时间'),
                  h('input', {
                    type: 'datetime-local',
                    value: form.scheduled_at,
                    onChange: function (e) {
                      patch({ scheduled_at: e.target.value })
                    },
                  }),
                ]),
            h('div', { className: 'za-field' }, [
              h('label', null, '工作目录（可选）'),
              h('input', {
                placeholder: '留空则使用默认；多个目录用英文逗号分隔',
                value: form.cwdText,
                onChange: function (e) {
                  patch({ cwdText: e.target.value })
                },
              }),
            ]),
            h('div', { className: 'za-field' }, [
              h('label', null, '推送到企业微信'),
              h('div', { className: 'za-switch-row' }, [
                h('input', {
                  type: 'checkbox',
                  checked: !!form.push_to_wecom,
                  onChange: function (e) {
                    patch({ push_to_wecom: e.target.checked })
                  },
                }),
                h('span', null, form.push_to_wecom ? '任务成功后推送到企微群' : '不推企微'),
              ]),
              h('p', { className: 'za-hint' }, 'Webhook 在本页「推送配置」中填写。'),
            ]),
            h('div', { className: 'za-field' }, [
              h('label', null, '生效区间（可选）'),
              h('div', { className: 'za-range-row' }, [
                h('input', {
                  type: 'date',
                  value: form.valid_from,
                  onChange: function (e) {
                    patch({ valid_from: e.target.value })
                  },
                }),
                h('span', null, '至'),
                h('input', {
                  type: 'date',
                  value: form.valid_until,
                  onChange: function (e) {
                    patch({ valid_until: e.target.value })
                  },
                }),
              ]),
            ]),
            h('div', { className: 'za-dialog-foot' }, [
              !isEdit ? h('p', { className: 'za-footer-tip' }, '保存后请在任务卡片点「立即测试」，确认摘要无误再依赖定时与企微推送。') : null,
              h('button', { type: 'button', className: 'za-btn', onClick: props.onClose }, '取消'),
              h(
                'button',
                {
                  type: 'button',
                  className: 'za-btn primary',
                  disabled: props.saving,
                  onClick: function () {
                    props.onSave({
                      name: form.name,
                      prompt: form.prompt,
                      template_id: form.template_id || null,
                      source: form.template_id ? 'template' : 'custom',
                      schedule_type: form.schedule_type,
                      rrule: form.rrule,
                      scheduled_at: form.scheduled_at || null,
                      valid_from: form.valid_from || null,
                      valid_until: form.valid_until || null,
                      cwds: String(form.cwdText || '')
                        .split(',')
                        .map(function (s) {
                          return s.trim()
                        })
                        .filter(Boolean),
                      push_to_wecom: !!form.push_to_wecom,
                      id: form.id || undefined,
                    })
                  },
                },
                props.saving ? '保存中…' : isEdit ? '保存' : '创建',
              ),
            ]),
          ],
        ),
      ])
    }

    function AutomationsView(props) {
      var workspace = props.workspace
      ensureCss()
      var tabState = useState('tasks')
      var tab = tabState[0]
      var setTab = tabState[1]
      var loadingState = useState(true)
      var loading = loadingState[0]
      var setLoading = loadingState[1]
      var errorState = useState('')
      var error = errorState[0]
      var setError = errorState[1]
      var itemsState = useState([])
      var items = itemsState[0]
      var setItems = itemsState[1]
      var templatesState = useState(FALLBACK_TEMPLATES)
      var templates = templatesState[0]
      var setTemplates = templatesState[1]
      var runsState = useState([])
      var runs = runsState[0]
      var setRuns = runsState[1]
      var runsTotalState = useState(0)
      var runsTotal = runsTotalState[0]
      var setRunsTotal = runsTotalState[1]
      var runsPageState = useState(1)
      var runsPage = runsPageState[0]
      var setRunsPage = runsPageState[1]
      var selectedRunState = useState(null)
      var selectedRun = selectedRunState[0]
      var setSelectedRun = selectedRunState[1]
      var editOpenState = useState(false)
      var editOpen = editOpenState[0]
      var setEditOpen = editOpenState[1]
      var editInitialState = useState(null)
      var editInitial = editInitialState[0]
      var setEditInitial = editInitialState[1]
      var savingState = useState(false)
      var saving = savingState[0]
      var setSaving = savingState[1]
      var testingIdState = useState('')
      var testingId = testingIdState[0]
      var setTestingId = testingIdState[1]
      var toastState = useState(null)
      var toast = toastState[0]
      var setToast = toastState[1]
      var cfgState = useState(emptyConfig)
      var cfg = cfgState[0]
      var setCfg = cfgState[1]
      var cfgOpenState = useState(false)
      var cfgOpen = cfgOpenState[0]
      var setCfgOpen = cfgOpenState[1]
      var cfgSavingState = useState(false)
      var cfgSaving = cfgSavingState[0]
      var setCfgSaving = cfgSavingState[1]
      var toastTimer = useRef(null)

      function say(text, ok) {
        setToast({ text: text, ok: ok })
        if (toastTimer.current) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(function () {
          setToast(null)
        }, 2600)
      }

      function loadRuns(page) {
        var p = page || runsPage
        return callHost('listRuns', { page: p, page_size: RUNS_PAGE_SIZE }).then(function (hres) {
          if (hres && hres.ok && hres.items) return hres
          return fetchJson(serviceBase() + '/api/automations/runs?page=' + p + '&page_size=' + RUNS_PAGE_SIZE).then(function (x) {
            return x.d
          })
        }).then(function (d) {
          setRuns((d && d.items) || [])
          setRunsTotal(Number(d && d.total) || 0)
        })
      }

      function loadAll() {
        setLoading(true)
        setError('')
        rememberPort(cfg.port)
        callHost('getConfig', {})
          .then(function (viaHost) {
            if (viaHost && viaHost.ok && viaHost.config) return viaHost
            return fetchJson(serviceBase() + '/api/config').then(function (x) {
              return { ok: x.ok, config: x.d && x.d.config, detail: x.d && x.d.detail }
            })
          })
          .then(function (x) {
            if (x && x.ok && x.config) {
              var c = Object.assign(emptyConfig(), x.config)
              if (c.llmApiKeyConfigured) c.llmApiKey = SECRET_MASK
              if (c.wecomWebhookKeyConfigured) c.wecomWebhookKey = SECRET_MASK
              setCfg(c)
              rememberPort(c.port)
            }
            return Promise.all([
              fetchJson(serviceBase() + '/api/templates').then(function (r) {
                return (r.d && r.d.items) || FALLBACK_TEMPLATES
              }),
              fetchJson(serviceBase() + '/api/automations').then(function (r) {
                if (!r.ok) throw new Error((r.d && r.d.detail) || '加载失败')
                return (r.d && r.d.items) || []
              }),
              loadRuns(runsPage),
            ])
          })
          .then(function (pack) {
            setTemplates(pack[0] && pack[0].length ? pack[0] : FALLBACK_TEMPLATES)
            setItems(pack[1] || [])
          })
          .catch(function (e) {
            setError(e.message || String(e))
          })
          .then(function () {
            setLoading(false)
          })
      }

      useEffect(function () {
        loadAll()
      }, [])

      function openCreate() {
        setEditInitial({ _source: 'custom' })
        setEditOpen(true)
      }
      function openFromTemplate(tpl) {
        setEditInitial({
          name: tpl.title,
          prompt: tpl.prompt,
          schedule_type: tpl.schedule_type,
          rrule: tpl.rrule || '',
          scheduleLabel: tpl.scheduleLabel,
          template_id: tpl.id,
          cwds: [],
          push_to_wecom: Boolean(tpl.push_to_wecom),
          _source: 'template',
        })
        setEditOpen(true)
      }
      function openEdit(item) {
        setEditInitial(Object.assign({}, item, { _source: 'edit' }))
        setEditOpen(true)
      }
      function saveTask(payload) {
        setSaving(true)
        var p
        if (payload.id) {
          p = fetchJson(serviceBase() + '/api/automations/' + encodeURIComponent(payload.id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).then(function (x) {
            return x.d
          })
        } else {
          p = fetchJson(serviceBase() + '/api/automations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).then(function (x) {
            return x.d
          })
        }
        p.then(function (x) {
          if (!x || !x.ok) throw new Error((x && x.detail) || '保存失败')
          say(payload.id ? '已保存' : '已创建', true)
          setEditOpen(false)
          loadAll()
        })
          .catch(function (e) {
            say(e.message || String(e), false)
          })
          .then(function () {
            setSaving(false)
          })
      }
      function togglePause(item) {
        var next = item.status === 'active' ? 'paused' : 'active'
        fetchJson(serviceBase() + '/api/automations/' + encodeURIComponent(item.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: next }),
        })
          .then(function (x) {
            if (!x.ok) throw new Error((x.d && x.d.detail) || '操作失败')
            say(next === 'active' ? '已恢复' : '已暂停', true)
            loadAll()
          })
          .catch(function (e) {
            say(e.message || String(e), false)
          })
      }
      function onTestRun(item) {
        setTestingId(item.id)
        fetchJson(serviceBase() + '/api/automations/' + encodeURIComponent(item.id) + '/run', { method: 'POST' })
          .then(function (x) {
            var d = Object.assign({ http: x.http }, x.d)
            if (d.code === 'already_running' || d.reason === 'already_running') {
              say('当前有对话在进行，请稍后再试', false)
            } else if (d.ok) {
              say('执行完成，请到「运行记录」查看摘要', true)
              setRunsPage(1)
              setTab('runs')
            } else {
              throw new Error(d.detail || (d.run && d.run.error && d.run.error.message) || '执行失败')
            }
            loadAll()
          })
          .catch(function (e) {
            say(e.message || String(e), false)
          })
          .then(function () {
            setTestingId('')
          })
      }
      function onDelete(item) {
        if (!window.confirm('确定删除「' + item.name + '」？')) return
        fetchJson(serviceBase() + '/api/automations/' + encodeURIComponent(item.id), { method: 'DELETE' })
          .then(function (x) {
            if (!x.ok) throw new Error((x.d && x.d.detail) || '删除失败')
            say('已删除', true)
            loadAll()
          })
          .catch(function (e) {
            say(e.message || String(e), false)
          })
      }
      function saveCfg() {
        setCfgSaving(true)
        var body = Object.assign({}, cfg)
        if (body.llmApiKey === SECRET_MASK) body.llmApiKey = ''
        if (body.wecomWebhookKey === SECRET_MASK) body.wecomWebhookKey = ''
        body.port = Number(body.port)
        body.tickSec = Number(body.tickSec)
        fetchJson(serviceBase() + '/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then(function (x) {
            if (!x.ok) throw new Error((x.d && x.d.detail) || '保存失败')
            say(x.d.detail || '已保存', true)
            setCfgOpen(false)
            loadAll()
          })
          .catch(function (e) {
            say(e.message || String(e), false)
          })
          .then(function () {
            setCfgSaving(false)
          })
      }

      function templateCard(tpl, compact) {
        var k = iconKey(tpl)
        return h(
          'button',
          {
            key: tpl.id,
            type: 'button',
            className: 'za-template-card' + (compact ? ' compact' : ''),
            onClick: function () {
              openFromTemplate(tpl)
            },
          },
          [
            h('span', { className: 'za-tpl-icon ' + k, 'aria-hidden': 'true' }, TplIcon(k)),
            h('span', { className: 'za-template-title' }, tpl.title),
            compact ? null : h('span', { className: 'za-template-desc' }, tpl.description),
          ],
        )
      }

      var header = h('header', { className: 'za-page-header' }, [
        h('div', { className: 'za-header-tabs' }, [
          h(
            'button',
            {
              type: 'button',
              className: 'za-header-tab' + (tab === 'tasks' ? ' active' : ''),
              onClick: function () {
                setTab('tasks')
              },
            },
            [TimerIcon(16), '定时任务'],
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'za-header-tab' + (tab === 'runs' ? ' active' : ''),
              onClick: function () {
                setTab('runs')
                loadRuns(runsPage)
              },
            },
            [ListIcon(), '运行记录'],
          ),
        ]),
        h('div', { className: 'za-header-actions' }, [
          h(
            'button',
            {
              type: 'button',
              className: 'za-btn ghost',
              onClick: function () {
                setCfgOpen(true)
              },
            },
            '推送配置',
          ),
          workspace
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'za-btn ghost',
                  onClick: function () {
                    workspace.close()
                  },
                },
                '返回对话',
              )
            : null,
          tab === 'tasks'
            ? h(
                'button',
                { type: 'button', className: 'za-btn primary', onClick: openCreate },
                '+ 添加自动化',
              )
            : null,
        ]),
      ])

      var body
      if (loading) {
        body = h('div', { className: 'za-loading' }, '加载中…')
      } else if (error) {
        body = h('div', { className: 'za-error-card' }, error)
      } else if (tab === 'tasks') {
        if (!items.length) {
          body = h('section', { className: 'za-empty-section' }, [
            h('div', { className: 'za-empty-hero' }, [
              h('div', { className: 'za-empty-icon', 'aria-hidden': 'true' }, EmptyHeroIcon()),
              h('p', { className: 'za-empty-title' }, '开启你的第一个自动化任务吧'),
              h('button', { type: 'button', className: 'za-btn primary', onClick: openCreate }, '+ 添加自动化'),
            ]),
            h('div', null, [
              h('h2', { className: 'za-templates-heading' }, '自动化任务模板'),
              h(
                'div',
                { className: 'za-template-grid' },
                templates.map(function (tpl) {
                  return templateCard(tpl, false)
                }),
              ),
            ]),
          ])
        } else {
          body = h('section', { className: 'za-task-list' }, [
            h('div', { className: 'za-task-toolbar' }, h('span', null, '共 ' + items.length + ' 个任务')),
            h(
              'div',
              { className: 'za-task-grid' },
              items.map(function (item) {
                return h('article', { key: item.id, className: 'za-task-card' }, [
                  h('div', { className: 'za-task-head' }, [
                    h('h3', { className: 'za-task-name' }, item.name),
                    h('span', { className: 'za-pill', 'data-status': item.status }, item.status === 'active' ? '运行中' : '已暂停'),
                  ]),
                  h('p', { className: 'za-task-schedule' }, scheduleSummary(item)),
                  item.next_run_at ? h('p', { className: 'za-task-next' }, '下次：' + formatTime(item.next_run_at)) : null,
                  h('p', { className: 'za-task-prompt' }, item.prompt),
                  h('div', { className: 'za-task-actions' }, [
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'za-btn link',
                        disabled: testingId === item.id,
                        onClick: function () {
                          onTestRun(item)
                        },
                      },
                      testingId === item.id ? '执行中…' : '立即测试',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'za-btn link',
                        onClick: function () {
                          openEdit(item)
                        },
                      },
                      '编辑',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'za-btn link',
                        onClick: function () {
                          togglePause(item)
                        },
                      },
                      item.status === 'active' ? '暂停' : '恢复',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'za-btn link danger',
                        onClick: function () {
                          onDelete(item)
                        },
                      },
                      '删除',
                    ),
                  ]),
                ])
              }),
            ),
            h('div', { className: 'za-compact-templates' }, [
              h('h2', { className: 'za-templates-heading' }, '从模板快速创建'),
              h(
                'div',
                { className: 'za-template-grid compact' },
                templates.map(function (tpl) {
                  return templateCard(tpl, true)
                }),
              ),
            ]),
          ])
        }
      } else if (!runsTotal) {
        body = h('section', { className: 'za-runs-empty' }, [
          h('p', { className: 'za-empty-title' }, '暂无运行记录'),
          h('p', { className: 'za-runs-hint' }, '调度执行器接入后，每次自动运行会在此展示摘要与状态。'),
        ])
      } else {
        var pageCount = Math.max(1, Math.ceil(runsTotal / RUNS_PAGE_SIZE))
        var pages = []
        for (var i = 1; i <= pageCount && i <= 8; i++) pages.push(i)
        body = h('div', { className: 'za-runs-wrap' }, [
          h('div', { className: 'za-runs-toolbar' }, h('span', null, '共 ' + runsTotal + ' 条记录')),
          h('table', { className: 'za-table' }, [
            h('thead', null, h('tr', null, ['任务', '状态', '推送', '写表', '开始时间', '摘要预览'].map(function (col) {
              return h('th', { key: col }, col)
            }))),
            h(
              'tbody',
              null,
              runs.map(function (row) {
                return h(
                  'tr',
                  {
                    key: row.id,
                    className: selectedRun && selectedRun.id === row.id ? 'selected' : '',
                    onClick: function () {
                      setSelectedRun(row)
                    },
                  },
                  [
                    h('td', null, row.automation_name || row.automation_id),
                    h('td', null, h('span', { className: 'za-run-status', 'data-status': row.status }, runStatusLabel(row.status))),
                    h(
                      'td',
                      { title: row.delivery_error || '' },
                      row.delivery_status
                        ? h('span', { className: 'za-run-delivery', 'data-delivery': row.delivery_status }, deliveryStatusLabel(row.delivery_status))
                        : '—',
                    ),
                    h('td', null, '—'),
                    h('td', null, formatTime(row.started_at)),
                    h('td', null, summaryPreview(row.summary)),
                  ],
                )
              }),
            ),
          ]),
          h(
            'div',
            { className: 'za-pager' },
            [
              h(
                'button',
                {
                  type: 'button',
                  disabled: runsPage <= 1,
                  onClick: function () {
                    var n = runsPage - 1
                    setRunsPage(n)
                    loadRuns(n)
                  },
                },
                '上一页',
              ),
            ].concat(
              pages.map(function (p) {
                return h(
                  'button',
                  {
                    key: p,
                    type: 'button',
                    className: p === runsPage ? 'on' : '',
                    onClick: function () {
                      setRunsPage(p)
                      loadRuns(p)
                    },
                  },
                  String(p),
                )
              }),
              [
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: runsPage >= pageCount,
                    onClick: function () {
                      var n = runsPage + 1
                      setRunsPage(n)
                      loadRuns(n)
                    },
                  },
                  '下一页',
                ),
              ],
            ),
          ),
        ])
      }

      var drawer = selectedRun
        ? h(
            'div',
            {
              className: 'za-mask',
              onClick: function () {
                setSelectedRun(null)
              },
            },
            h(
              'aside',
              {
                className: 'za-drawer',
                onClick: function (e) {
                  e.stopPropagation()
                },
              },
              [
                h('div', { className: 'za-drawer-head' }, [
                  h('span', null, selectedRun.automation_name || '运行详情'),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'za-btn ghost',
                      onClick: function () {
                        setSelectedRun(null)
                      },
                    },
                    '关闭',
                  ),
                ]),
                h('div', { className: 'za-drawer-body' }, [
                  h('div', { className: 'za-drawer-meta' }, [
                    h('span', { className: 'za-run-status', 'data-status': selectedRun.status }, runStatusLabel(selectedRun.status)),
                    h('span', null, '开始：' + formatTime(selectedRun.started_at)),
                    selectedRun.finished_at ? h('span', null, '结束：' + formatTime(selectedRun.finished_at)) : null,
                    selectedRun.delivery_status
                      ? h('span', null, '推送：' + deliveryStatusLabel(selectedRun.delivery_status))
                      : null,
                  ]),
                  h('div', { className: 'za-banner' }, [h('span', null, '— —'), h('span', null, '📰 ' + (selectedRun.automation_name || '任务摘要') + ' 📰'), h('span', null, '— —')]),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'za-btn',
                      style: { marginBottom: 12 },
                      onClick: function () {
                        var text = selectedRun.summary || ''
                        if (!text) return
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                          navigator.clipboard.writeText(text).then(function () {
                            say('已复制', true)
                          })
                        }
                      },
                    },
                    '一键复制',
                  ),
                  runErrorText(selectedRun) ? h('p', { className: 'za-error-card' }, runErrorText(selectedRun)) : null,
                  selectedRun.summary ? h('div', { className: 'za-morning' }, selectedRun.summary) : h('p', { className: 'za-runs-hint' }, '暂无摘要内容'),
                ]),
              ],
            ),
          )
        : null

      return h('div', { className: 'za-root' }, [
        h('div', { className: 'za-view' }, [header, h('div', { className: 'za-page-body' }, body)]),
        drawer,
        h(EditDialog, {
          open: editOpen,
          initial: editInitial || {},
          saving: saving,
          onClose: function () {
            setEditOpen(false)
          },
          onSave: saveTask,
          onToast: say,
        }),
        h(ConfigDialog, {
          open: cfgOpen,
          cfg: cfg,
          setCfg: setCfg,
          saving: cfgSaving,
          onClose: function () {
            setCfgOpen(false)
          },
          onSave: saveCfg,
        }),
        h(Toast, toast || {}),
      ])
    }

    function AutomationsFooterAction(props) {
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
        { className: 'za-launcher' + (wide ? '' : ' za-launcher--rail'), role: 'group', 'aria-label': '自动化入口' },
        h(
          'button',
          {
            type: 'button',
            className: 'za-trigger' + (wide ? '' : ' za-trigger--rail') + (open ? ' is-active' : ''),
            'aria-label': open ? '返回对话' : '打开自动化',
            'aria-pressed': open,
            title: open ? '返回对话' : '自动化',
            onClick: function () {
              workspace.toggle()
            },
          },
          [TimerIcon(wide ? 16 : 18), wide ? h('span', null, '自动化') : null],
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
            return h(AutomationsView, { workspace: controller })
          },
          close,
        )
      }
      controller = {
        isOpen: function () {
          return disposeWorkspace !== undefined
        },
        open: function () {
          open()
          notify()
        },
        toggle: function () {
          if (disposeWorkspace !== undefined) return close()
          open()
          notify()
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

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') {
        console.error('[automations] 无 slots，无法注册侧栏入口')
        return
      }
      ensureCss()
      var workspace = createWorkspace(ctx)
      if (typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return observePluginWorkspace(PLUGIN_ID, function () {
            workspace.close()
          })
        }, 'dsh-automations: exclusive workspace')
        ctx.effect(function () {
          return function () {
            workspace.close()
          }
        }, 'dsh-automations: workspace lifecycle')
      }
      ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'automations', order: -8 },
          function AutomationsFooter(props) {
            return h(AutomationsFooterAction, { wide: props && props.wide, workspace: workspace })
          },
        )
      })
      console.log('[automations] 已注册侧栏「自动化」（与设置并列）')
    }

    module.exports = { inject: ['slots', 'layout'], apply: apply }
    return module.exports
  },
})
