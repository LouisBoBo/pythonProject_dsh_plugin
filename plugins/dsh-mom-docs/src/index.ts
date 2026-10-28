import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { registerMomHttp } from './http.js'
import { listDocuments, readDocument, saveDocument, setWorkspaceCatalog } from './store.js'
import { MomError, type MomCode } from './types.js'

export const name = 'mom-docs'
export const inject = ['tools'] as const

function textBlocks(text: string) {
  return [{ type: 'text' as const, text }]
}

function fail(err: unknown): { code: Exclude<MomCode, 'ok'>; message: string } {
  if (err instanceof MomError) return { code: err.code, message: err.message }
  return { code: 'write_failed', message: '保存失败' }
}

const MOM_PROMPT =
  '【本地资料库】用户说「存入资料库」「保存到资料库」「放到资料库」时，调用 zr_mom_save。' +
  '把当前对话里已经写好的文档写入 {当前工程根目录}/MOM/{上海时区当天日期}/文件名.md。' +
  '资料库是工作区里的 MOM 目录，不是知识库。不要要求挂载知识库，不要反问，不要改存 Word。' +
  'directory 填当前工程根目录的绝对路径。'

export function apply(ctx: Context): void {
  setWorkspaceCatalog(join(homedir(), '.dsh', 'mom-docs', 'workspaces.txt'))
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const transformed = await next()
    const contexts = (transformed.contexts ?? []).filter(
      (item: { name?: string }) => item.name !== 'dsh-mom-docs:library',
    )
    contexts.push({ name: 'dsh-mom-docs:library', text: MOM_PROMPT })
    return { ...transformed, contexts }
  })

  ctx.tools.register(
    defineTool({
      name: 'zr_mom_save',
      description:
        '把当前对话里已经写好的文档存入本地资料库。' +
        '用户说「存入资料库」「保存到资料库」「放到资料库」，或明确要求保存纪要、方案、报告、说明时调用。' +
        '资料库不是知识库：不要挂载知识库，不要把文档写成知识库笔记，不要改存 Word。' +
        'directory 填当前工程根目录的绝对路径。' +
        'filename 用简短文件名，可以不带扩展名，默认 .md；只允许 .md 或 .txt。' +
        'content 是要落盘的全文。' +
        '文件写到 {directory}/MOM/{上海时区当天日期}/{filename}。同名不覆盖，自动加 -2、-3。' +
        '不要用本工具改工程源码。',
      parameters: {
        directory: { type: 'string', required: true, description: '当前工程根目录绝对路径' },
        filename: { type: 'string', required: true, description: '文件名；可空，则使用 title' },
        title: { type: 'string', required: true, description: '标题；可空' },
        content: { type: 'string', required: true, description: '文档全文' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            code: { type: 'string' },
            message: { type: 'string' },
            filePath: { type: 'string' },
            relativePath: { type: 'string' },
            fileName: { type: 'string' },
            date: { type: 'string' },
            bytes: { type: 'number' },
          },
        },
        render: (_args, value) =>
          textBlocks(
            value.ok
              ? `已保存 ${value.relativePath}（${value.bytes} 字节）`
              : `未保存：${value.code} ${value.message}`,
          ),
      },
      async execute(args) {
        try {
          const saved = saveDocument({
            directory: String(args.directory ?? ''),
            filename: String(args.filename ?? ''),
            title: String(args.title ?? ''),
            content: String(args.content ?? ''),
          })
          return {
            ok: true,
            code: 'ok',
            message: '已保存',
            filePath: saved.filePath,
            relativePath: saved.relativePath,
            fileName: saved.fileName,
            date: saved.date,
            bytes: saved.bytes,
          }
        } catch (err) {
          const failed = fail(err)
          return {
            ok: false,
            code: failed.code,
            message: failed.message,
            filePath: '',
            relativePath: '',
            fileName: '',
            date: '',
            bytes: 0,
          }
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_mom_list',
      description:
        '列出某个工作区本地资料库中某一天的文件。' +
        'directory 是工程根目录绝对路径。' +
        'date 传 YYYY-MM-DD；不知道日期就传空字符串，表示上海时区今天。',
      parameters: {
        directory: { type: 'string', required: true, description: '工程根目录绝对路径' },
        date: { type: 'string', required: true, description: 'YYYY-MM-DD；空字符串表示今天' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            code: { type: 'string' },
            message: { type: 'string' },
            date: { type: 'string' },
            count: { type: 'number' },
            items: { type: 'string' },
          },
        },
        render: (_args, value) =>
          textBlocks(
            value.ok
              ? value.count
                ? `${value.date} 共 ${value.count} 份：\n${value.items}`
                : `${value.date} 还没有资料`
              : `未能列出：${value.code} ${value.message}`,
          ),
      },
      async execute(args) {
        try {
          const listed = listDocuments(String(args.directory ?? ''), String(args.date ?? ''))
          const items = listed.items
            .map((item) => `${item.fileName}\t${item.bytes}\t${item.title}`)
            .join('\n')
          return {
            ok: true,
            code: 'ok',
            message: '已列出',
            date: listed.date,
            count: listed.items.length,
            items,
          }
        } catch (err) {
          const failed = fail(err)
          return { ok: false, code: failed.code, message: failed.message, date: '', count: 0, items: '' }
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_mom_read',
      description:
        '读取本地资料库中已经保存的一份文档。' +
        'filename 必须使用 zr_mom_list 返回的文件名。' +
        'date 传 YYYY-MM-DD；空字符串表示上海时区今天。',
      parameters: {
        directory: { type: 'string', required: true, description: '工程根目录绝对路径' },
        date: { type: 'string', required: true, description: 'YYYY-MM-DD；空字符串表示今天' },
        filename: { type: 'string', required: true, description: '列表中的文件名' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            code: { type: 'string' },
            message: { type: 'string' },
            filePath: { type: 'string' },
            fileName: { type: 'string' },
            date: { type: 'string' },
            content: { type: 'string' },
          },
        },
        render: (_args, value) =>
          textBlocks(value.ok ? `${value.fileName}\n${value.content}` : `未能读取：${value.code} ${value.message}`),
      },
      async execute(args) {
        try {
          const doc = readDocument(
            String(args.directory ?? ''),
            String(args.date ?? ''),
            String(args.filename ?? ''),
          )
          return {
            ok: true,
            code: 'ok',
            message: '已读取',
            filePath: doc.filePath,
            fileName: doc.fileName,
            date: doc.date,
            content: doc.content,
          }
        } catch (err) {
          const failed = fail(err)
          return {
            ok: false,
            code: failed.code,
            message: failed.message,
            filePath: '',
            fileName: '',
            date: '',
            content: '',
          }
        }
      },
    }),
  )

  attachLibraryHttp(ctx)
}

type MomWebServer = {
  register: (route: {
    kind: 'prefix'
    path: string
    handler: (req: { method?: string; url?: string; headers: Record<string, string | string[] | undefined> }, res: { writeHead: (status: number, headers?: Record<string, string>) => void; setHeader?: (name: string, value: string) => void; end: (body?: string) => void }) => void
  }) => () => void
}

function attachLibraryHttp(ctx: Context): void {
  const host = ctx as Context & {
    inject?: (deps: string[], plugin: (httpCtx: { webServer?: MomWebServer; get?: (name: string) => unknown; effect?: (dispose: () => void, label?: string) => void }) => void) => void
    webServer?: MomWebServer
    logger?: { warn: (message: string) => void }
  }
  const register = (httpCtx: { webServer?: MomWebServer; get?: (name: string) => unknown; effect?: (dispose: () => void, label?: string) => void }) => {
    const server = httpCtx.webServer ?? (typeof httpCtx.get === 'function' ? httpCtx.get('webServer') as MomWebServer | undefined : undefined)
    if (!server || typeof server.register !== 'function') {
      host.logger?.warn('dsh-mom-docs: webServer unavailable')
      return
    }
    try {
      const dispose = registerMomHttp(server)
      if (typeof httpCtx.effect === 'function') httpCtx.effect(() => dispose, 'dsh-mom-docs.http')
    } catch (err) {
      host.logger?.warn(`dsh-mom-docs: library page failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  try {
    if (typeof host.inject === 'function') host.inject(['webServer'], register)
    else if (host.webServer) register({ webServer: host.webServer })
  } catch (err) {
    host.logger?.warn(`dsh-mom-docs: library page failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
