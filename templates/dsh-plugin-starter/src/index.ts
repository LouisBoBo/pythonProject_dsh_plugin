import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** 插件内部短名（不等于 npm 包名） */
export const name = 'hello'
/** 需要注册对话工具时声明 tools */
export const inject = ['tools'] as const

function textBlocks(text: string) {
  return [{ type: 'text' as const, text }]
}

/**
 * 插件加载入口：在这里注册工具 / 服务。
 * 改业务时：改工具 name、description、parameters、execute。
 */
export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      // 建议前缀 zr_ 或业务缩写，避免与其它插件撞名
      name: 'zr_hello_greet',
      description:
        '【示例】向用户回一句问候。仅在需要演示或用户明确要求打招呼时调用。' +
        '参数 name 为称呼，可传空字符串表示「同事」。',
      parameters: {
        name: {
          type: 'string',
          required: true,
          description: '称呼；不确定时传空字符串',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summary: { type: 'string' } },
        },
        render: (_args, value) => textBlocks(String(value.summary || '')),
      },
      async execute(args) {
        const who = String(args.name || '').trim() || '同事'
        return { summary: `你好，${who}！这是公司 DSH 示例插件的回复。` }
      },
    }),
  )
}
