import { AsyncLocalStorage } from 'node:async_hooks'

const store = new AsyncLocalStorage<string>()
const DEEPSEEK_REF = 'DEEPSEEK_API_KEY'

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

type Credentials = {
  resolve: (ref: string) => Promise<{ value: string, source: string } | undefined>
}

const installed = { fetch: false, credentials: false }

function requestUrl(input: FetchInput): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function hostOf(input: FetchInput): string {
  try {
    return new URL(requestUrl(input)).hostname
  } catch {
    return ''
  }
}

function shouldRewrite(input: FetchInput, init: FetchInit): boolean {
  const host = hostOf(input)
  if (host === 'api.deepseek.com' || host.endsWith('.deepseek.com')) return true
  const headers = new Headers(init?.headers)
  return headers.has('x-api-key')
}

/** 只在这一次模型调用里换上分配的 Key。项目里原来的 Key 可以是空的。 */
export function installAssignedKeyTransport(credentials?: Credentials): void {
  if (!installed.fetch) {
    const original = globalThis.fetch.bind(globalThis)
    const wrapped: typeof fetch = async (input, init) => {
      const key = store.getStore()
      if (!key || !shouldRewrite(input, init)) return original(input, init)
      const headers = new Headers(init?.headers)
      headers.set('x-api-key', key)
      headers.set('authorization', `Bearer ${key}`)
      return original(input, { ...init, headers })
    }
    globalThis.fetch = wrapped
    installed.fetch = true
  }
  if (credentials && !installed.credentials && typeof credentials.resolve === 'function') {
    const original = credentials.resolve.bind(credentials)
    credentials.resolve = async (ref: string) => {
      const key = store.getStore()
      if (key && String(ref) === DEEPSEEK_REF) return { value: key, source: 'key-quota' }
      return original(ref)
    }
    installed.credentials = true
  }
}

export async function* pullWithAssignedKey<T>(apiKey: string, source: AsyncIterable<T>): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]()
  try {
    while (true) {
      const step = await store.run(apiKey, () => iterator.next())
      if (step.done) return
      yield step.value
    }
  } finally {
    if (typeof iterator.return === 'function') {
      await store.run(apiKey, () => iterator.return!())
    }
  }
}
