/**
 * 把同仓 plugins/dsh-batch-review 同步进本插件 vendor/，随 npm 包发布。
 * 市场安装后 resolveBatchReviewRoot 优先用 vendor，不再依赖开发机同级目录。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(here, '..')
const srcRoot = join(pluginRoot, '..', 'dsh-batch-review')
const dstRoot = join(pluginRoot, 'vendor', 'dsh-batch-review')

if (!existsSync(join(srcRoot, 'src', 'dsh_batch_review'))) {
  console.error('[sync-batch-review] 找不到同仓旁路:', srcRoot)
  process.exit(1)
}

function scrubCaches(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === '__pycache__' || name === '.pytest_cache' || name.endsWith('.pyc')) {
      rmSync(p, { recursive: true, force: true })
      continue
    }
    if (statSync(p).isDirectory()) scrubCaches(p)
  }
}

rmSync(dstRoot, { recursive: true, force: true })
mkdirSync(join(dstRoot, 'src'), { recursive: true })
cpSync(join(srcRoot, 'src'), join(dstRoot, 'src'), { recursive: true })
scrubCaches(join(dstRoot, 'src'))
cpSync(join(srcRoot, 'pyproject.toml'), join(dstRoot, 'pyproject.toml'))
if (existsSync(join(srcRoot, 'README.md'))) {
  cpSync(join(srcRoot, 'README.md'), join(dstRoot, 'README.md'))
}
writeFileSync(join(dstRoot, 'requirements.txt'), 'PyYAML>=6.0\n', 'utf8')
console.log('[sync-batch-review] ok →', dstRoot)
