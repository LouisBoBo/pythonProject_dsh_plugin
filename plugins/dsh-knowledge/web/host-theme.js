const HOST_THEME_MESSAGE = '@zhongruan/dsh-knowledge/host-theme'
const HOST_THEME_READY_MESSAGE = '@zhongruan/dsh-knowledge/host-theme-ready'
const HOST_THEME_PROTOCOL_VERSION = 1
const HOST_MOUNT_CONTEXT_MESSAGE = '@zhongruan/dsh-knowledge/host-mount-context'
const HOST_MOUNT_CONTEXT_REQUEST = '@zhongruan/dsh-knowledge/host-mount-context-request'
const HOST_MOUNT_CONTEXT_VERSION = 1
const COLOR_TOKENS = new Set([
  '--bg', '--surface', '--surface-raised', '--surface-soft', '--surface-hover', '--dialog-surface',
  '--text', '--text-secondary', '--text-tertiary', '--border', '--border-strong',
  '--accent', '--accent-hover', '--accent-soft', '--on-accent',
  '--success', '--success-soft', '--warning', '--warning-soft', '--danger', '--danger-soft',
])
const STYLE_TOKENS = new Set(['--shadow'])

function referrerOrigin() {
  if (!document.referrer) return ''
  try {
    const origin = new URL(document.referrer).origin
    return origin === 'null' ? '' : origin
  } catch {
    return ''
  }
}

/** Embedding parent origin when the browser exposes it (Chromium / WebKit). */
function ancestorOrigin() {
  try {
    const list = document.location.ancestorOrigins
    if (!list || list.length === 0) return ''
    const origin = list[0]
    return !origin || origin === 'null' ? '' : origin
  } catch {
    return ''
  }
}

function isLocalAppOrigin(origin) {
  if (!origin || origin === 'null') return true
  try {
    const url = new URL(origin)
    if (url.protocol === 'file:' || url.protocol === 'dsh-app:' || url.protocol === 'app:') return true
    const host = url.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

function expectedParentOrigin() {
  return ancestorOrigin() || referrerOrigin()
}

function acceptParentMessage(event) {
  if (event.source !== window.parent) return false
  const expected = expectedParentOrigin()
  if (expected) return event.origin === expected
  // no-referrer + no ancestorOrigins (e.g. Firefox): only trust local app hosts.
  return isLocalAppOrigin(event.origin)
}

function parentPostTarget() {
  return expectedParentOrigin() || (isLocalAppOrigin(window.location.origin) ? window.location.origin : '*')
}

/** Synchronise only the host colour scheme and the explicitly allowed tokens. */
export function installHostThemeBridge(options = {}) {
  if (window.parent === window) return Promise.resolve()
  const onMountContext = typeof options.onMountContext === 'function' ? options.onMountContext : null
  return new Promise(resolve => {
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      window.clearTimeout(fallback)
      resolve()
    }
    const fallback = window.setTimeout(settle, 160)
    window.addEventListener('message', event => {
      if (!acceptParentMessage(event)) return
      const message = event.data
      if (!message || typeof message !== 'object') return
      if (message.type === HOST_MOUNT_CONTEXT_MESSAGE && message.version === HOST_MOUNT_CONTEXT_VERSION) {
        onMountContext?.({
          sessionId: typeof message.sessionId === 'string' ? message.sessionId : '',
          projectId: typeof message.projectId === 'string' ? message.projectId : '',
        })
        return
      }
      if (message.type !== HOST_THEME_MESSAGE || message.version !== HOST_THEME_PROTOCOL_VERSION) return
      if (message.colorScheme !== 'light' && message.colorScheme !== 'dark') return
      if (!message.tokens || typeof message.tokens !== 'object' || Array.isArray(message.tokens)) return

      const root = document.documentElement
      for (const name of [...COLOR_TOKENS, ...STYLE_TOKENS]) root.style.removeProperty(name)
      for (const [name, value] of Object.entries(message.tokens)) {
        if (typeof value !== 'string' || value.length === 0 || value.length > 512) continue
        if (COLOR_TOKENS.has(name) && CSS.supports('color', value)) root.style.setProperty(name, value)
        else if (STYLE_TOKENS.has(name) && CSS.supports('box-shadow', value)) root.style.setProperty(name, value)
      }
      root.dataset.dshHostTheme = 'true'
      root.dataset.colorScheme = message.colorScheme
      root.style.colorScheme = message.colorScheme
      document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', message.colorScheme)
      const background = root.style.getPropertyValue('--bg')
      if (background) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background)
      settle()
    })
    const target = parentPostTarget()
    window.parent.postMessage({
      type: HOST_THEME_READY_MESSAGE,
      version: HOST_THEME_PROTOCOL_VERSION,
    }, target)
    window.parent.postMessage({
      type: HOST_MOUNT_CONTEXT_REQUEST,
      version: HOST_MOUNT_CONTEXT_VERSION,
    }, target)
  })
}

export function requestHostMountContext() {
  if (window.parent === window) return
  window.parent.postMessage({
    type: HOST_MOUNT_CONTEXT_REQUEST,
    version: HOST_MOUNT_CONTEXT_VERSION,
  }, parentPostTarget())
}
