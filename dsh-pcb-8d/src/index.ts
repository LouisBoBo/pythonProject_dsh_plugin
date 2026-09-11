import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DEMO_SCENARIO } from './demo-scenario.js'

export const name = 'pcb-8d'
export const inject = ['tools'] as const

/** D0–D8 步骤定义 */
const DISCIPLINES = [
  { key: 'D0', title: '准备 / 应急响应' },
  { key: 'D1', title: '成立小组' },
  { key: 'D2', title: '问题描述' },
  { key: 'D3', title: '临时围堵措施' },
  { key: 'D4', title: '根因分析' },
  { key: 'D5', title: '选择纠正措施' },
  { key: 'D6', title: '实施并验证纠正措施' },
  { key: 'D7', title: '预防再发' },
  { key: 'D8', title: '祝贺小组 / 结案' },
] as const

type DisciplineKey = (typeof DISCIPLINES)[number]['key']

type EightDReport = {
  id: string
  title: string
  product: string
  symptom: string
  createdAt: string
  updatedAt: string
  meta?: Record<string, string | number>
  steps: Record<DisciplineKey, { title: string; content: string }>
}

function storeDir(): string {
  const dir = join(homedir(), '.zhongruan', 'pcb-8d-drafts')
  mkdirSync(dir, { recursive: true })
  return dir
}

function reportPath(id: string): string {
  return join(storeDir(), `${id}.json`)
}

function newId(): string {
  const d = new Date()
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    '-',
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
  ].join('')
  return `8D-${stamp}-${randomBytes(2).toString('hex')}`
}

function emptySteps(): EightDReport['steps'] {
  const steps = {} as EightDReport['steps']
  for (const d of DISCIPLINES) {
    steps[d.key] = { title: d.title, content: '' }
  }
  return steps
}

function normalizeStep(raw: string): DisciplineKey {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '')
  const m = s.match(/^D([0-8])$/)
  if (!m) {
    throw new Error(`无效步骤「${raw}」，请使用 D0～D8`)
  }
  return `D${m[1]}` as DisciplineKey
}

function loadReport(id: string): EightDReport {
  const path = reportPath(id.trim())
  if (!existsSync(path)) {
    throw new Error(`找不到 8D 报告「${id}」。请先 pcb_8d_create / pcb_8d_demo，或用 pcb_8d_list 查看。`)
  }
  return JSON.parse(readFileSync(path, 'utf8')) as EightDReport
}

function saveReport(report: EightDReport): void {
  report.updatedAt = new Date().toISOString()
  writeFileSync(reportPath(report.id), JSON.stringify(report, null, 2), 'utf8')
}

function filledCount(report: EightDReport): number {
  return DISCIPLINES.filter((d) => report.steps[d.key].content.trim()).length
}

function summaryLine(report: EightDReport): string {
  return `${report.id}｜${report.title || '未命名'}｜已填 ${filledCount(report)}/9 步`
}

function toMarkdown(report: EightDReport): string {
  const lines = [
    `# PCB 8D 报告：${report.title || report.id}`,
    '',
    `> 本报告可为模拟演示数据，用于验证 8D 插件框架。`,
    '',
    `- 报告编号：${report.id}`,
    `- 产品 / 料号：${report.product || '—'}`,
    `- 不良现象：${report.symptom || '—'}`,
    `- 创建时间：${report.createdAt}`,
    `- 更新时间：${report.updatedAt}`,
  ]

  if (report.meta && Object.keys(report.meta).length) {
    lines.push('')
    lines.push('## 业务抬头（模拟）')
    lines.push('')
    const labels: Record<string, string> = {
      customer: '客户',
      workOrder: '工单',
      lotNo: '批次',
      line: '线体',
      defectCode: '缺陷代码',
      qtySuspect: '嫌疑数量',
      qtyConfirmNg: '确认 NG',
      ppm: '批内 PPM',
    }
    for (const [k, v] of Object.entries(report.meta)) {
      lines.push(`- ${labels[k] ?? k}：${v}`)
    }
  }

  lines.push('')
  for (const d of DISCIPLINES) {
    const step = report.steps[d.key]
    lines.push(`## ${d.key} ${step.title}`)
    lines.push('')
    lines.push(step.content.trim() || '_（待补全）_')
    lines.push('')
  }
  return lines.join('\n')
}

function exportMarkdown(report: EightDReport): { filePath: string; markdown: string } {
  const markdown = toMarkdown(report)
  const filePath = join(storeDir(), `${report.id}.md`)
  writeFileSync(filePath, markdown, 'utf8')
  return { filePath, markdown }
}

function createReport(input: {
  title: string
  symptom: string
  product?: string
  teamHint?: string
}): EightDReport {
  const now = new Date().toISOString()
  const report: EightDReport = {
    id: newId(),
    title: input.title.trim(),
    product: (input.product ?? '').trim(),
    symptom: input.symptom.trim(),
    createdAt: now,
    updatedAt: now,
    steps: emptySteps(),
  }

  report.steps.D2.content = [
    `问题标题：${report.title}`,
    report.product ? `产品/料号：${report.product}` : '',
    `不良现象：${report.symptom}`,
  ]
    .filter(Boolean)
    .join('\n')

  if (input.teamHint?.trim()) {
    report.steps.D1.content = input.teamHint.trim()
  }

  report.steps.D0.content =
    '已启动 8D。请继续补全 D1～D8；可用自然语言说明，由助手调用 pcb_8d_fill。'

  saveReport(report)
  return report
}

/** 生成填满 D0～D8 的模拟完整报告 */
function createDemoReport(): EightDReport {
  const now = new Date().toISOString()
  const demo = DEMO_SCENARIO
  const report: EightDReport = {
    id: newId(),
    title: demo.title,
    product: demo.product,
    symptom: demo.symptom,
    createdAt: now,
    updatedAt: now,
    meta: { ...demo.meta },
    steps: emptySteps(),
  }
  for (const d of DISCIPLINES) {
    report.steps[d.key].content = demo.steps[d.key]
  }
  saveReport(report)
  return report
}

export function apply(ctx: Context) {
  ctx.tools.register(
    defineTool({
      name: 'pcb_8d_demo',
      description:
        '【一键生成完整模拟 8D 报告】当用户要演示 8D、要一份完整样例、全模拟业务数据、输出完整报告时调用。' +
        '无需真实 MES：内置 PCB-A100 虚焊场景，自动填满 D0～D8 并导出 Markdown。' +
        '参数 ignore 传空字符串即可。',
      parameters: {
        ignore: {
          type: 'string',
          required: true,
          description: '占位参数，传空字符串即可',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            product: { type: 'string' },
            filledSteps: { type: 'number' },
            filePath: { type: 'string' },
            markdown: { type: 'string' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              `已生成完整模拟 8D：${value.id}（${value.filledSteps}/9）\n` +
              `料号 ${value.product}｜${value.title}\n` +
              `文件：${value.filePath}\n\n` +
              value.markdown,
          },
        ],
      },
      async execute() {
        const report = createDemoReport()
        const { filePath, markdown } = exportMarkdown(report)
        return {
          id: report.id,
          title: report.title,
          product: report.product,
          filledSteps: filledCount(report),
          filePath,
          markdown,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'pcb_8d_create',
      description:
        '【新建 PCB 8D 报告草稿】当用户要开 8D、写 8D 报告、做质量纠正报告时调用。' +
        '若只要完整演示样例，优先用 pcb_8d_demo。' +
        '参数：title、symptom、product、teamHint。会生成 reportId。',
      parameters: {
        title: {
          type: 'string',
          required: true,
          description: '问题标题，例如 焊盘虚焊导致功能失效',
        },
        symptom: {
          type: 'string',
          required: true,
          description: '不良现象描述',
        },
        product: {
          type: 'string',
          required: true,
          description: '产品名或料号；未知可填「待补充」',
        },
        teamHint: {
          type: 'string',
          required: true,
          description: '小组成员提示；未知可填「待指定」',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            product: { type: 'string' },
            symptom: { type: 'string' },
            filledSteps: { type: 'number' },
            hint: { type: 'string' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              `已创建 8D 草稿 ${value.id}\n` +
              `标题：${value.title}\n` +
              `已填步骤：${value.filledSteps}/9\n` +
              value.hint,
          },
        ],
      },
      async execute(args) {
        const report = createReport({
          title: String(args.title),
          symptom: String(args.symptom),
          product: String(args.product ?? ''),
          teamHint: String(args.teamHint ?? ''),
        })
        return {
          id: report.id,
          title: report.title,
          product: report.product,
          symptom: report.symptom,
          filledSteps: filledCount(report),
          hint: '请继续用 pcb_8d_fill 补全；或说「生成完整模拟 8D」调用 pcb_8d_demo。',
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'pcb_8d_fill',
      description:
        '【补全 8D 某一步】用户补充 D0～D8 任一章节内容时调用。' +
        '参数：reportId、step（D0～D8）、content；mode=replace|append。',
      parameters: {
        reportId: {
          type: 'string',
          required: true,
          description: '报告编号',
        },
        step: {
          type: 'string',
          required: true,
          description: '步骤代号 D0～D8，例如 D4',
        },
        content: {
          type: 'string',
          required: true,
          description: '该步骤要写入的正文',
        },
        mode: {
          type: 'string',
          required: true,
          description: 'replace 覆盖或 append 追加；未知传 replace',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            step: { type: 'string' },
            stepTitle: { type: 'string' },
            filledSteps: { type: 'number' },
            preview: { type: 'string' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              `已更新 ${value.id} → ${value.step} ${value.stepTitle}\n` +
              `进度 ${value.filledSteps}/9\n` +
              `预览：\n${value.preview}`,
          },
        ],
      },
      async execute(args) {
        const report = loadReport(String(args.reportId))
        const step = normalizeStep(String(args.step))
        const mode = String(args.mode || 'replace').toLowerCase()
        const incoming = String(args.content || '').trim()
        if (!incoming) throw new Error('content 不能为空')

        const prev = report.steps[step].content.trim()
        report.steps[step].content =
          mode === 'append' && prev ? `${prev}\n${incoming}` : incoming
        saveReport(report)

        const preview = report.steps[step].content
        return {
          id: report.id,
          step,
          stepTitle: report.steps[step].title,
          filledSteps: filledCount(report),
          preview: preview.length > 400 ? `${preview.slice(0, 400)}…` : preview,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'pcb_8d_get',
      description: '【查看 8D 草稿】参数 reportId。',
      parameters: {
        reportId: {
          type: 'string',
          required: true,
          description: '报告编号',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            product: { type: 'string' },
            symptom: { type: 'string' },
            filledSteps: { type: 'number' },
            outline: { type: 'string' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `${value.id}｜${value.title}｜已填 ${value.filledSteps}/9 步\n${value.outline}`,
          },
        ],
      },
      async execute(args) {
        const report = loadReport(String(args.reportId))
        const outline = DISCIPLINES.map((d) => {
          const c = report.steps[d.key].content.trim()
          const flag = c ? '✓' : '○'
          const brief = c ? c.replace(/\s+/g, ' ').slice(0, 60) : '空'
          return `${flag} ${d.key} ${d.title}：${brief}`
        }).join('\n')
        return {
          id: report.id,
          title: report.title,
          product: report.product,
          symptom: report.symptom,
          filledSteps: filledCount(report),
          outline,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'pcb_8d_list',
      description: '【列出本机 8D 草稿】参数 ignore 传空字符串。',
      parameters: {
        ignore: {
          type: 'string',
          required: true,
          description: '占位参数，传空字符串即可',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            count: { type: 'number' },
            items: { type: 'string' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: value.count
              ? `共 ${value.count} 份草稿：\n${value.items}`
              : '暂无 8D 草稿，请先 pcb_8d_create 或 pcb_8d_demo。',
          },
        ],
      },
      async execute() {
        const dir = storeDir()
        const files = readdirSync(dir)
          .filter((f: string) => f.endsWith('.json'))
          .sort()
          .reverse()
        const lines: string[] = []
        for (const f of files.slice(0, 20)) {
          try {
            const r = JSON.parse(readFileSync(join(dir, f), 'utf8')) as EightDReport
            lines.push(summaryLine(r))
          } catch {
            /* skip */
          }
        }
        return { count: lines.length, items: lines.join('\n') }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'pcb_8d_export',
      description:
        '【导出 8D 为 Markdown】参数 reportId。写入本机 .md 并返回全文。',
      parameters: {
        reportId: {
          type: 'string',
          required: true,
          description: '报告编号',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            filePath: { type: 'string' },
            filledSteps: { type: 'number' },
            markdown: { type: 'string' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              `已导出 ${value.id}（${value.filledSteps}/9）\n` +
              `文件：${value.filePath}\n\n` +
              value.markdown,
          },
        ],
      },
      async execute(args) {
        const report = loadReport(String(args.reportId))
        const { filePath, markdown } = exportMarkdown(report)
        return {
          id: report.id,
          filePath,
          filledSteps: filledCount(report),
          markdown,
        }
      },
    }),
  )

  console.log(
    '[pcb-8d] 插件已加载：pcb_8d_demo / create / fill / get / list / export；目录 ' +
      storeDir(),
  )
}
