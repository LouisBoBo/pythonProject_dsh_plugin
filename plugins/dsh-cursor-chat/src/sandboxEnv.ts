/**
 * 凭证隔离：沙箱内 spawn/exec 命令的环境变量白名单。
 *
 * 背景：Cursor agent 在沙箱里可以写 `console.log(process.env)` 把宿主所有 API keys 打出来。
 *       所以我们把透传给沙箱子进程的 env 收敛到"命令跑起来必需的最小集合"。
 *
 * 原则：
 *   - 显式白名单，不透传 process.env
 *   - PATH / HOME / TMPDIR / npm 缓存路径等是运行必需的
 *   - API keys / 私有 token / 云凭证一律不透传
 */

/** 允许透传给沙箱子进程的 env 前缀列表（不区分大小写） */
const ALLOWED_PREFIXES = [
  // 路径 / 系统基础
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_',
  'PWD',
  'OLDPWD',
  // 运行时标志（CI=1 让 npm 不弹交互式 prompt）
  'CI',
  'NODE_ENV',
  'NODE_OPTIONS',
  // Node/npm/yarn/pnpm 路径
  'NPM_',
  'YARN_',
  'PNPM_',
  'NODE_PATH',
  // 语言工具链
  'PYTHONPATH',
  'PIP_',
  'GOPATH',
  'GOROOT',
  'GOCACHE',
  'CARGO_',
  'RUST_',
  'JAVA_HOME',
  'MAVEN_',
  'GRADLE_',
  // 编辑器相关（不敏感，可能被某些工具链用到）
  'TERM',
  'COLORTERM',
  'FORCE_COLOR',
  // DSH / Cursor 自身标识（不敏感，让子进程知道自己在哪个插件里）
  'CURSOR_CHAT_',
  'DSH_',
]

/** 绝对禁止透传的 env 键（即使通过前缀也拦） */
const FORBIDDEN_KEY_PATTERNS = [
  /KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /PRIVATE/i,
  /ACCESS/i,
  /API_KEY/i,
  /APIKEY/i,
  /BEARER/i,
  /AUTH/i,
  /COOKIE/i,
  /SESSION/i,
  /AWS/i,
  /GCP/i,
  /AZURE/i,
  /ALIYUN/i,
  /VOLC/i,
  /OPENAI/i,
  /ANTHROPIC/i,
  /DEEPSEEK/i,
  /ZHIPU/i,
  /DOUBAO/i,
  /MOONSHOT/i,
]

/**
 * 从 process.env 中提取沙箱子进程能安全看到的 env。
 * 用于 verify.ts / runJob.ts 里的 spawnSync env 参数。
 *
 * 安全策略：
 *   1. 先按 ALLOWED_PREFIXES 匹配（正向白名单）
 *   2. 再按 FORBIDDEN_KEY_PATTERNS 扫描（黑名单兜底，防止前缀误伤）
 *   3. 结果是"必需最小集"，不含任何凭证
 */
export function sandboxSafeEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue
    const upper = key.toUpperCase()

    // 黑名单兜底：绝对不让敏感键过
    const isForbidden = FORBIDDEN_KEY_PATTERNS.some((re) => re.test(key))
    if (isForbidden) continue

    // 正向白名单：前缀匹配
    const isAllowed = ALLOWED_PREFIXES.some((prefix) =>
      upper === prefix || upper.startsWith(prefix),
    )
    if (isAllowed) {
      out[key] = value
    }
  }

  // 调用方显式追加的 env（覆盖默认值）——也走黑名单检查
  for (const [key, value] of Object.entries(extra)) {
    if (!value) continue
    const isForbidden = FORBIDDEN_KEY_PATTERNS.some((re) => re.test(key))
    if (!isForbidden) out[key] = value
  }

  return out
}
