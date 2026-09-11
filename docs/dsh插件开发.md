# DSH 插件开发详细方案

> 目标：开发一个可在 DSH（DeepSeek Harness）中**正常安装、加载、调用**的第三方插件，以 **PCB 辅助工具** 为示例功能，验证完整开发流程。

---

## 一、方案概述

### 1.1 插件定位

| 项 | 说明 |
|---|---|
| 插件包名 | `dsh-pcb-helper` |
| 插件标识 | `pcb-helper` |
| 功能范围 | 提供 2 个简单 PCB 相关工具，供模型在对话中调用 |
| 验证目标 | 环境准备 → 编码 → 本地 patch 调试 → 打包 → profile 安装 → Web UI 调用 |

### 1.2 提供的工具

| 工具名 | 功能 | 输入 | 输出 |
|---|---|---|---|
| `pcb_parse_dimensions` | 解析 PCB 板尺寸字符串 | `sizeText`（如 `100x80mm`） | 长、宽、单位 |
| `pcb_count_bom` | 统计 BOM 清单行数与总数量 | `bomText`（每行 `位号,数量`） | 行数、总件数、明细 |

> 功能刻意保持简单，不依赖外部 EDA 软件，纯字符串解析，便于快速验证插件生命周期。

### 1.3 整体流程

```mermaid
flowchart LR
    A[环境准备] --> B[创建项目]
    B --> C[编写插件代码]
    C --> D[本地 patch 调试]
    D --> E[打包为 Bundle]
    E --> F[安装到 profile]
    F --> G[Web UI 验证]
```

---

## 二、开发环境准备

### 2.1 基础要求

| 依赖 | 版本要求 | 说明 |
|---|---|---|
| Node.js | ≥ 22.19 | DSH 运行环境 |
| pnpm | 最新稳定版 | 推荐包管理器 |
| DSH CLI 或源码 | `dsh-v0.1.1-rc.2` 或更高 | 二选一即可 |

### 2.2 方式 A：仅安装 DSH CLI（推荐快速验证）

```bash
# 全局安装 dsh CLI（具体命令以官方文档为准）
npm install -g @deepseek-ai/dsh

# 验证
dsh --version
node -v   # 应 >= 22.19
```

### 2.3 方式 B：克隆 DSH 源码（推荐深度开发）

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout dsh-v0.1.1-rc.2   # 或当前稳定 tag
pnpm install
pnpm run build
pnpm run typecheck            # 验证 TypeScript 环境
```

源码模式下，后续命令中的 `dsh` 替换为 `pnpm dsh`。

### 2.4 创建工作区

在本仓库（或任意目录）创建插件项目：

```bash
cd /Users/hebo/Desktop/中软项目/pythonProject_dsh_plugin
mkdir -p dsh-pcb-helper/src
cd dsh-pcb-helper
pnpm init
```

---

## 三、项目结构与关键文件

### 3.1 目录结构

```
dsh-pcb-helper/
├── package.json           # npm 包 + dsh.bundle 声明
├── cordis.patch.yml       # 插件组合层（安装时自动注入 DSH）
├── tsconfig.json          # TypeScript 编译配置
├── src/
│   └── index.ts           # 插件主入口（导出 name / inject / apply）
└── lib/                   # 构建产物（pnpm build 后生成）
    └── index.js
```

### 3.2 package.json

```json
{
  "name": "dsh-pcb-helper",
  "version": "0.1.0",
  "description": "DSH PCB 辅助工具插件（尺寸解析、BOM 统计）",
  "type": "module",
  "main": "lib/index.js",
  "files": ["lib", "cordis.patch.yml"],
  "scripts": {
    "build": "tsc",
    "prepare": "pnpm run build"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-tools": "*"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "workspace:*",
    "@deepseek-ai/dsh-tools": "workspace:*",
    "typescript": "^5.7.0"
  }
}
```

**要点说明：**

- `"type": "module"`：DSH 插件使用 ESM。
- `"dsh.bundle.patch"`：声明这是一个可安装的 Bundle，安装后 DSH 会自动加载 `cordis.patch.yml`。
- `"prepare"`：从 GitHub 安装时 pnpm 会自动执行 build（见第六节注意事项）。
- 若独立开发（非 monorepo），将 `peerDependencies` 中的包改为具体版本号，devDependencies 安装对应 npm 包。

### 3.3 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "lib",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

### 3.4 cordis.patch.yml

```yaml
- insert:
    - id: pcb-helper
      name: dsh-pcb-helper
```

**说明：**

- `id`：组合树中的唯一行标识。
- `name`：指向 npm 包名，DSH 通过 Node 模块解析加载 `package.json` 的 `main` 入口。
- 本地 patch 调试时（第五节）可改用绝对路径指向 `src/index.ts`。

---

## 四、插件核心代码

### 4.1 插件三要素

每个 DSH 插件必须导出：

| 导出项 | 作用 |
|---|---|
| `name` | 插件唯一标识 |
| `inject` | 声明依赖的服务（如 `tools`） |
| `apply(ctx)` | 插件加载时执行的注册逻辑 |

### 4.2 src/index.ts（完整示例）

```typescript
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
  // 工具 1：PCB 尺寸解析
  ctx.tools.register(
    defineTool({
      name: 'pcb_parse_dimensions',
      description: '解析 PCB 板尺寸字符串，支持如 100x80mm、50x30cm 等格式。',
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

  // 工具 2：BOM 统计
  ctx.tools.register(
    defineTool({
      name: 'pcb_count_bom',
      description: '统计 PCB BOM 清单的行数与元器件总数量。每行格式：位号,数量',
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
          properties: {
            lineCount: { type: 'number' },
            totalQty: { type: 'number' },
            items: { type: 'array' },
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
```

### 4.3 开发纪律

1. **不修改 DSH 内置配置**：只通过 `cordis.patch.yml` 声明插件行。
2. **依赖注入**：使用 `tools` 服务前必须在 `inject` 中声明 `'tools'`。
3. **资源清理**：通过 `ctx.tools.register` 注册的工具会在插件卸载时自动注销，无需手动清理。
4. **工具描述用中文**：便于模型理解何时调用（与业务 API 文档规范一致）。

---

## 五、本地调试（patch 方式）

在发布安装之前，用 `--patch` 快速验证，无需打包。

### 5.1 构建插件

```bash
cd dsh-pcb-helper
pnpm install
pnpm build
```

### 5.2 创建本地 patch 文件

在插件目录创建 `dev.patch.yml`（**仅用于开发，不提交**）：

```yaml
- insert:
    - id: pcb-helper-dev
      name: '/Users/hebo/Desktop/中软项目/pythonProject_dsh_plugin/dsh-pcb-helper/src/index.ts'
```

> ⚠️ `name` 必须是**绝对路径**，指向 TypeScript 源文件或编译后的 JS。

### 5.3 启动 DSH Web UI

**CLI 模式：**

```bash
dsh web --patch /Users/hebo/Desktop/中软项目/pythonProject_dsh_plugin/dsh-pcb-helper/dev.patch.yml
```

**源码模式（在 deepseek-harness 根目录）：**

```bash
pnpm dsh web --patch /Users/hebo/Desktop/中软项目/pythonProject_dsh_plugin/dsh-pcb-helper/dev.patch.yml
```

### 5.4 调试验证

1. 终端应打印：`[pcb-helper] 插件已加载...`
2. 打开 `http://127.0.0.1:3080`
3. 在对话中测试：

   ```
   请用 pcb_parse_dimensions 工具解析尺寸 120x80mm
   ```

   ```
   请用 pcb_count_bom 统计以下 BOM：
   R1,10
   C2,20
   U3,1
   ```

4. （可选）检查组合树：

   ```bash
   dsh --dump-config --patch ./dev.patch.yml
   ```

   确认输出中出现 `pcb-helper-dev` 行。

---

## 六、打包与安装到 DSH Profile

本地 patch 验证通过后，将插件安装到正式 profile，模拟真实用户使用场景。

### 6.1 确认构建产物

```bash
cd dsh-pcb-helper
pnpm build
ls lib/index.js   # 必须存在
```

### 6.2 安装到 profile

在包含 `dsh-pcb-helper` 目录的路径下执行：

```bash
# 创建并安装到名为 pcb-demo 的 profile
dsh plugin --profile pcb-demo add ./dsh-pcb-helper
```

首次执行会：

1. 初始化 `$DSH_HOME/profiles/pcb-demo/` 目录
2. 将 `@deepseek-ai/dsh-base` 作为基础 bundle
3. 通过 pnpm link 安装本地插件
4. 在 profile 的 `package.json` 中追加 bundle 记录

安装后 profile 的 `package.json` 大致如下：

```json
{
  "name": "dsh-profile-pcb-demo",
  "private": true,
  "dependencies": {
    "dsh-pcb-helper": "link:/path/to/dsh-pcb-helper"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "dsh-pcb-helper"
      ]
    }
  }
}
```

### 6.3 验证安装

```bash
# 查看组合配置（应出现 # == dsh-pcb-helper 层）
dsh --profile pcb-demo --dump-config

# 启动 Web UI
dsh --profile pcb-demo web
```

### 6.4 卸载（如需）

```bash
dsh plugin --profile pcb-demo remove dsh-pcb-helper
```

### 6.5 从 GitHub / npm 分发（可选）

| 方式 | 命令 | 注意 |
|---|---|---|
| 本地目录 | `dsh plugin --profile X add ./dsh-pcb-helper` | 开发阶段最常用 |
| npm 发布 | `dsh plugin --profile X add dsh-pcb-helper` | 需先 `pnpm publish`，且 `lib/` 已构建 |
| GitHub | `dsh plugin --profile X add github:you/dsh-pcb-helper` | 需 `prepare` 脚本 + pnpm `allowBuilds` 白名单 |
| tarball | `pnpm pack` → `dsh plugin add ./dsh-pcb-helper-0.1.0.tgz` | 无需 build 权限 |

**GitHub 安装注意（pnpm ≥ 10）：**

若 `prepare` 脚本被拦截，在 profile 的 `pnpm-workspace.yaml` 中添加：

```yaml
allowBuilds:
  dsh-pcb-helper: true
```

然后重新执行 `add`。

---

## 七、配置层加载顺序（理解冲突排查）

DSH 最终配置由多层 patch 合并，**后层覆盖前层**（按 row `id`）：

```
1. profile 中 dsh.profile.bundles 列表（@deepseek-ai/dsh-base → 各插件 bundle）
2. profile 目录下的 cordis.patch.yml（用户自定义）
3. $DSH_HOME/cordis.patch.yml（机器级偏好）
4. 命令行 --patch 参数（开发调试用）
```

排查插件未加载时，按此顺序检查是否被后续层覆盖或未出现在 bundle 列表中。

---

## 八、完整验证清单

按顺序勾选，全部通过即表示插件开发流程验证成功：

### 8.1 构建阶段

- [ ] `pnpm build` 无报错，`lib/index.js` 存在
- [ ] `package.json` 含 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`
- [ ] `cordis.patch.yml` 中 `name: dsh-pcb-helper` 与 package name 一致

### 8.2 本地 patch 阶段

- [ ] `dsh web --patch dev.patch.yml` 启动成功
- [ ] 终端打印 `[pcb-helper] 插件已加载`
- [ ] 对话中调用 `pcb_parse_dimensions` 返回正确长宽
- [ ] 对话中调用 `pcb_count_bom` 返回正确统计

### 8.3 正式安装阶段

- [ ] `dsh plugin --profile pcb-demo add ./dsh-pcb-helper` 成功
- [ ] `dsh --profile pcb-demo --dump-config` 可见 `dsh-pcb-helper` 层
- [ ] `dsh --profile pcb-demo web` 工具可正常调用
- [ ] `dsh plugin --profile pcb-demo remove dsh-pcb-helper` 可干净卸载

---

## 九、常见问题排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 插件未加载，无日志 | patch 路径错误或 bundle 未加入 profile | 检查绝对路径 / `dsh.profile.bundles` |
| `Cannot find module` | 未 build 或 main 指向错误 | 运行 `pnpm build`，确认 `main: lib/index.js` |
| 工具不可调用 | 未声明 `inject: ['tools']` | 检查 inject 与 register 代码 |
| GitHub 安装失败 | pnpm 拒绝运行 prepare | 配置 `allowBuilds` 后重装 |
| 工具注册了但模型不调用 | description 不清晰 | 优化中文 description，对话中明确提示使用工具名 |
| TypeScript 类型报错 | peer 依赖未安装 | 安装 `@deepseek-ai/cordis` 和 `@deepseek-ai/dsh-tools` |

---

## 十、后续扩展方向（非本次验证范围）

验证流程通过后，可按需扩展：

1. **读取 Gerber 文件名**：解析 `.GTL`、`.GBL` 等层名，返回层类型映射
2. **阻抗计算助手**：输入线宽、铜厚、介电常数，返回估算阻抗
3. **插件配置项**：导出 `Config` + Schemastery schema，让用户在 `cordis.patch.yml` 中配置默认单位
4. **客户端 UI 面**：在 `src/client/` 添加可视化 BOM 表格（需 Web 面 bundle 支持）

---

## 十一、参考资源

- [Your first plugin](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/) — 最小插件教程
- [Build a tool](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool) — 工具注册详解
- [Package and install a plugin](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish) — Bundle 打包与 profile 安装
- [Tool authoring reference](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool) — defineTool 完整参考
- 社区示例：`dsh-plugin-calculator`、`dsh-agent-teams`

---

## 十二、执行时间估算

| 阶段 | 预计耗时 |
|---|---|
| 环境准备 | 30～60 分钟 |
| 项目搭建 + 编码 | 1～2 小时 |
| 本地 patch 调试 | 30 分钟 |
| 打包安装验证 | 30 分钟 |
| **合计** | **约 3～4 小时**（首次） |

---

*文档版本：v1.0 | 适用 DSH：dsh-v0.1.1-rc.2 及以上*
