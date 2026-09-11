import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'pcb-helper'
export const inject = ['tools'] as const

/** 解析 "100x80mm" / "100 x 80 mm" 等格式 */
function parseDimensions(text: string) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, '')
  const match = normalized.match(/^(\d+(?:\.\d+)?)[x×](\d+(?:\.\d+)?)(mm|cm|in)?$/)
  if (!match) {
    throw new Error(`无法解析尺寸: "${text}"，期望格式如 100x80mm`)
  }
  return {
    length: Number(match[1]),
    width: Number(match[2]),
    unit: match[3] ?? 'mm',
  }
}

/** 解析 BOM 文本，每行格式: 位号,数量  或  位号 数量 */
function parseBom(text: string) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const items: { ref: string; qty: number }[] = []
  for (const line of lines) {
    const parts = line.split(/[,\s]+/)
    if (parts.length < 2) continue
    const ref = parts[0]
    const qty = Number(parts[1])
    if (!ref || Number.isNaN(qty)) continue
    items.push({ ref, qty })
  }

  return {
    lineCount: items.length,
    totalQty: items.reduce((sum, i) => sum + i.qty, 0),
    items,
  }
}

export function apply(ctx: Context) {
  ctx.tools.register(
    defineTool({
      name: 'pcb_parse_dimensions',
      description:
        '【板尺寸字符串解析】当用户给出如 100x80mm、120×80、50x30cm 的板长宽文字，问长宽/尺寸是多少时调用。' +
        '不要用 mes_pcb（那是工艺问答）。参数 sizeText 填用户原始尺寸字符串。',
      parameters: {
        sizeText: {
          type: 'string',
          required: true,
          description: '尺寸字符串，例如 100x80mm',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            length: { type: 'number' },
            width: { type: 'number' },
            unit: { type: 'string' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `PCB 尺寸: ${value.length} × ${value.width} ${value.unit}`,
          },
        ],
      },
      async execute(args) {
        return parseDimensions(args.sizeText)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'pcb_count_bom',
      description:
        '【BOM 清单统计】当用户粘贴位号+数量清单（每行如 R1,10 或 C2 20），问有多少行、元器件总共多少、BOM 数量时必须调用。' +
        '把清单原文放入 bomText。不要用 mes_pcb（mes_pcb 只做工艺问答，不做加减统计）。',
      parameters: {
        bomText: {
          type: 'string',
          required: true,
          description: 'BOM 文本，每行一条，如 R1,10',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            lineCount: { type: 'number' },
            totalQty: { type: 'number' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  ref: { type: 'string' },
                  qty: { type: 'number' },
                },
              },
            },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `BOM 共 ${value.lineCount} 行，元器件总数量 ${value.totalQty}`,
          },
        ],
      },
      async execute(args) {
        return parseBom(args.bomText)
      },
    }),
  )

  console.log('[pcb-helper] 插件已加载，注册了 pcb_parse_dimensions、pcb_count_bom 工具')
}
