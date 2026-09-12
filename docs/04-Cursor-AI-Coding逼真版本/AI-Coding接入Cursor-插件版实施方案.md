# AI-Coding：接入 Cursor（独立插件版 · 硬约束实施方案）

> **状态**：主交互流程已冻结（`dsh-cursor-coding@0.6.7`）——见 [Cursor写码插件-主流程冻结.md](./Cursor写码插件-主流程冻结.md)；后续只做细节优化，不改主流程形态。  
> **相对原文**：原 [AI-Coding接入Cursor-体验逼近方案.md](./AI-Coding接入Cursor-体验逼近方案.md) 落点在 WorkBuddy `engine + mes-bridge`；**本文改落点为公司 DSH 独立 Bundle**，体验目标不变，交付形态变。  
> **安全底线**：HITL nonce、沙箱、`write_scope` —— 只缩短摩擦，不拆除。

---

## 0. 五条硬约束（不可协商）

| # | 约束 | 本方案如何满足 |
| --- | --- | --- |
| 1 | **不动 WorkBuddy 任何功能** | 零改 `DSH-ZR-WorkBuddy` 仓库：不碰 `mes-bridge`、`features/code-dev`、引擎 `code_dev`、`.dsh/skills`。WorkBuddy 现网写码车道保持原样并行存在。 |
| 2 | **WorkBuddy 写码功能代码可复制** | 允许拷贝/改编：沙箱、路径范围、Job 账本、流解析、HITL 语义、确认/续改状态机。禁止依赖 WorkBuddy 进程或 `mesEngine.runEngine`。 |
| 3 | **只写功能不写原生壳；界面全交 DSH 原生壳** | 不写 Electron / 独立桌面窗 / 第二 bridge。用户界面 = **DSH Web 聊天 + 官方插槽**（`tool.call.toolview`、`settings.section`、工具 presentResult）。插件只往壳里挂卡与设置页，不自研聊天壳。 |
| 4 | **独立插件、安装即可用** | 公司市场 npm Bundle（`@zhongruan/dsh-cursor-coding` 一类）；点安装 → profile 加载 → 工具与客户端面可用。不依赖 WorkBuddy 引擎已启动；本机填 Cursor API Key 后即可跑。 |
| 5 | **写码过程像跟 Cursor 对话一样顺畅；返回内容来自 Cursor** | 唯一写码执行器 = **cursor-sdk Local**；过程事件经 Job SSE **原样/结构化转述**进 DSH 工具卡；禁止 DSH Agent 用 Write/Bash 改用户工程；禁止用模型「复述」冒充 Cursor 过程流。 |

### 0.1 对约束 3 的硬释义（避免再争议）

| 算「交给 DSH 原生壳」 | 不算（禁止） |
| --- | --- |
| 插件 `dsh.client` → 注入 `tool.call.toolview`（确认/进度/审清单卡） | 新开 Electron / 自定义桌面窗 |
| 注入 `settings.section`（Key / 开关） | 第二个 `mes-bridge` 式常驻业务壳 |
| 使用 DSH 已有消息流、工具行、设置侧栏 | 聊天内嵌完整 IDE Diff / 终端 / Debugger 为主路径 |
| 卡片内 `fetch` 插件本机 HTTP + SSE | 改 DSH / WorkBuddy host 内核 |

> **结论**：交互卡是 **DSH 壳的扩展面**，不是「另写壳」。约束 5 所需的顺畅过程流，必须挂在这张卡上；纯文本 GenericToolCard 达不到第 5 条，故本方案 **强制** 带 client 面。

---

## 1. 一句话目标

在 **DSH 原生聊天壳**里，经 **独立可安装插件**，把「确认 → Cursor 改沙箱 → 人审后受限同步」做成接近 Composer 的连续改码流水线；**改文件的智能只来自 Cursor**，插件只做编排、门禁、回显与同步决策；**WorkBuddy 一行代码都不改**。

---

## 2. 目标体验（不变）

```text
说需求 →（短）选项/确认 → 进度卡「Cursor 正在…」→ 变更清单勾选同步
       → 落盘完成 → 同一聊天下一句「再改一下 xxx」→ 轻量确认 → 再跑 Cursor
```

| 体感要求（对应硬约束 5） | 实现手段 |
| --- | --- |
| 过程跟手 | begin 立刻返回 `job_id`；卡片 SSE 刷 `tool_events` / 正文块 |
| 内容来自 Cursor | sink 只消费 SDK `stream`/`messages`；终稿与工具态不经 DSH 模型改写 |
| 续改短 | `parent_job_id` + 同 workspace；SDK 支持则 `Agent.resume` / 同实例二次 `send` |
| 落盘可控 | `pending_review` → 勾选 apply；范围外显式决策 |

---

## 3. 架构（相对原文的调整）

```text
┌─────────────────────────────────────────────────────────────┐
│  DSH 原生壳（Web 聊天 · 不新写）                               │
│  · 消息流 / 工具行 / 设置侧栏                                  │
│  · 插件 client.js → tool.call.toolview + settings.section    │
└──────────────────────────┬──────────────────────────────────┘
                           │ 127.0.0.1 插件内 HTTP + HITL nonce
┌──────────────────────────▼──────────────────────────────────┐
│  独立 Bundle：@zhongruan/dsh-cursor-coding（示例名）            │
│  · 工具：zr_cursor_begin / continue / status / cancel …      │
│  · 编排：Job 状态机、沙箱、scope、HITL（自算法，可从 WB 拷贝） │
│  · 本机服务：SSE stream / confirm / apply（随插件进程启动）   │
└──────────────────────────┬──────────────────────────────────┘
                           │ cwd=沙箱
┌──────────────────────────▼──────────────────────────────────┐
│  Cursor Local（@cursor/sdk）← 唯一「会写码」的大脑与手         │
└─────────────────────────────────────────────────────────────┘

WorkBuddy 现网 code-dev / mes-bridge ── 不修改、不调用、不共享 Job
```

### 3.1 相对原文改了什么

| 原文落点 | 插件版落点 | 原因 |
| --- | --- | --- |
| `engine/app/code_dev/*` | 插件内编排模块（建议 TypeScript + `@cursor/sdk`） | 硬约束 1、4：不绑 WorkBuddy 引擎 |
| `features/code-dev` + `mes_code_dev_*` | 插件 `ctx.tools.register` + **`zr_cursor_*` 新名** | 硬约束 1：避免与现网抢路由 |
| `mes-bridge` 写码卡 | **本插件** `client.js` 注入同名插槽 | 硬约束 3：仍用 DSH 插槽，但不改 bridge |
| `.dsh/skills/zr-workbuddy-*` | 插件自带 Skill（若宿主支持）或工具 description 写死路由 | 硬约束 1：不改 WorkBuddy Skill |
| Python `cursor_agent.py` | 拷贝流解析语义 → TS 重写，调 `@cursor/sdk` | 硬约束 2+4：可复制 + 安装即用 |

### 3.2 明确不做

| 不做 | 对应硬约束 |
| --- | --- |
| 改 WorkBuddy 任一文件 / 预装清单 | 1 |
| 插件调用 WorkBuddy `/api/code-dev/*` 当唯一引擎 | 1、4 |
| 新 Electron、第二 bridge、业务焊进 host | 3 |
| feature/插件里让 DSH Agent Write 用户工程 | 5 |
| 用模型二手复述代替 Cursor 过程流 | 5 |
| 天气插件式「只有文本工具、无卡」作为目标形态 | 5 |

---

## 4. 包内结构（建议）

```text
dsh-cursor-coding/
├── package.json              # dsh.bundle + dsh.client
├── cordis.patch.yml
├── src/
│   ├── index.ts              # 注册 zr_cursor_* 工具；启动本机服务
│   ├── client.js             # toolview 卡 + settings（DSH 壳插槽）
│   ├── server/               # 本机 HTTP：confirm / apply / stream / jobs
│   ├── orchestrator/         # Job、沙箱、scope、HITL（可自 WB 拷贝改编）
│   └── cursor/               # @cursor/sdk Local 封装 + 事件规范化
├── skills/                   # 可选：插件侧路由说明
└── lib/
```

对照已验证先例：`@zhongruan/dsh-remote-review`（自带 HTTP + `dsh.client` 设置页）。写码在此基础上增加 **主聊天 toolview + SSE**。

---

## 5. 与 WorkBuddy 并存规则（硬约束 1）

1. 工具名 **不得** 使用 `mes_code_dev_*`。  
2. 产品话术区分：「WorkBuddy 本机写码」vs「Cursor 写码插件」。  
3. 同一 profile 若两者都装：路由优先看用户是否点名插件 / Skill 描述是否足够硬；冲突时以 **关掉其一** 为运维手段，**禁止** 为修冲突去改 WorkBuddy。  
4. 更干净的验收环境：纯 DSH profile 只装本插件（不装 WorkBuddy 写码 feature）。

---

## 6. 分期落地（体验目标同原文，实现面改插件）

### 阶段 A — 续改闭环（优先）

- Job：`parent_job_id`、`workspace`、`last_synced_files`。  
- 工具：`zr_cursor_begin` / `zr_cursor_continue`。  
- 卡：续改确认（路径已填）。  
- Cursor：优先同 Agent / `resume`；否则沙箱复用 + prompt 注入上次摘要。  
- **验收**：同工程再说「把按钮改红」→ 续改卡 → 一点确认再跑；仍须 HITL。

### 阶段 B+C — 审清单 + deferred

- Cursor 成功后 `pending_review`，未 apply 前真工程不变。  
- SSE `review`：in_scope / deferred 分区；勾选同步或扩大 scope（前缀校验 + 敏感路径拒绝）。  
- **验收**：只勾 2/5 → 仅 2 进 synced；无 nonce → 拒绝。

### 阶段 D — 过程流保真（硬约束 5 本体）

- 稳定 `tool_events[]`（name/status/path）；正文可折叠代码块（长度上限 + 脱敏）。  
- UI 时间线绑事件，不猜字符串。  
- **验收**：同一次 Local 跑，卡上工具顺序/路径与 Cursor 对话框大体一致。

### 阶段 E — 跑中追问（可选）

- SDK 已支持同实例二次 `send` → 可做 `steer`（轻量 HITL 或仅已确认 job）。  
- 不支持的运行时 → 文案引导「等完成后续改（A）」，不做假多轮。

---

## 7. 接口草案（插件本机服务）

| 方法 | 路径 | 作用 | HITL |
| --- | --- | --- | --- |
| POST | `/api/cursor-coding/confirm` | 开工；可选 `parent_job_id` | `cursor-coding.confirm` |
| POST | `/api/cursor-coding/jobs/{id}/apply` | 审后同步 | `cursor-coding.apply` |
| GET | `/api/cursor-coding/jobs/{id}/stream` | SSE：进度 / tool_event / review | 否 |
| POST | `/api/cursor-coding/jobs/{id}/cancel` | 取消 | 视实现 |
| 可选 | `/api/cursor-coding/jobs/{id}/steer` | 跑中追加（阶段 E） | 轻量或绑定已确认 job |

工具（均薄封装 → 本机服务，**无** npm 业务逻辑泄漏进模型面以外）：

- `zr_cursor_begin` / `continue` / `status` / `job` / `cancel`  
- **不**提供「Agent 直接 apply」；apply 只由面板签发 nonce。

中文 tags/summary：实现时按仓库 API 文档规范写入服务 OpenAPI（若暴露文档）。

---

## 8. Job 状态机

```text
queued → running(sandbox→cursor) → pending_review
                              ↘ 无变更/失败 → failed|cancelled
pending_review → apply → syncing → succeeded
              → expire/cancel → cancelled（不落盘）

续改: succeeded ──confirm(parent)──► 新 job
```

删除类意图：可跳过 pending_review 或只展示将删路径（实现时单开一节；默认不因多一步勾选拖死删除体验）。

---

## 9. 安装即用（硬约束 4）清单

| 项 | 要求 |
| --- | --- |
| 市场 | `plugins.json` + 私有 npm tgz；用户「设置 → 插件市场」安装 |
| 加载 | `apply()` 注册工具；启动本机 loopback 服务；client 面注册插槽 |
| 配置 | 设置页：Cursor API Key、可选端口、write_scope 默认；落盘 `~/.zhongruan/cursor-coding/` |
| 运行时 | Node ≥ 与 DSH 一致；**不**要求用户再装 Python / WorkBuddy 引擎 |
| 超时 | `execute` 必须秒级返回；长跑在后台 Job |
| 卸载 | 停服务、卸工具、卸插槽；不留改 WorkBuddy 的痕迹 |

---

## 10. 安全（与原文对齐，不因插件形态削弱）

| 控制 | 本方案 |
| --- | --- |
| confirm / apply nonce | 必有；payload 绑 job + 列表 hash |
| 回环 / 仅 127.0.0.1 | 服务只绑本机 |
| write_scope | expand 须校验；敏感路径永不 sync |
| Agent `confirmed=true` | 不可单独开工 |
| DSH Agent 写盘 | 禁止；Skill/description 写死 |

---

## 11. 验收总表（产品）

1. **WorkBuddy 仓库 git diff 为空**（相对本功能交付）；现网写码仍可用。  
2. 用户全程主要在 **DSH 聊天**完成；无需以打开 Cursor IDE 为步骤。  
3. 真正改文件的是 **Cursor Local**；进度可对应 Job；过程流来自 SDK 事件。  
4. 市场安装后填 Key 即可跑；卸载干净。  
5. 同工程续改短于首轮；非删除写码未 apply 前工程不变；deferred 须人决策。  
6. 无第二 bridge、无业务焊进 host、无「模型复述过程流」。

---

## 12. 推荐排期

| 顺序 | 内容 | 工期感 |
| --- | --- | --- |
| 0 | Bundle 骨架 + 设置页 Key + 本机服务探活 + 工具名隔离 | 小 | **已完成** |
| 1 | 阶段 A（确认卡 + Cursor stream 进度卡 + 续改） | 中 | **已完成**（`CURSOR_CODING_MOCK=1 pnpm self-test`） |
| 2 | 阶段 B+C（审清单 + deferred） | 中 | **已完成**（`@0.3.0`；未 apply 前真工程不变；无 nonce → 401） |
| 3 | 阶段 D（过程流保真打磨） | 小～中 |
| 4 | 阶段 E（跑中追问，可选） | 待定 |

**先 A 再 B/C 已落地**：跟手聊 + 审后勾选同步；下一步阶段 D 打磨过程流保真；E 不硬扛。

---

## 13. 与原文关系

| 文档 | 关系 |
| --- | --- |
| [AI-Coding接入Cursor-体验逼近方案.md](./AI-Coding接入Cursor-体验逼近方案.md) | 体验与分期语义的母本；落点在 WorkBuddy 时仍可对照 |
| 本文 | **在五条硬约束下的唯一推荐落点**；实施以本文为准 |
| WorkBuddy `P0-1-本机写码功能实现.md` | 可复制算法与交互对照；只读 |

---

## 14. 决策冻结句

> 体验目标对齐原文；**交付形态冻结为独立 DSH Bundle**。  
> 五条硬约束全部满足：不动 WorkBuddy、可复制写码算法、UI 只挂 DSH 原生插槽、市场安装即用、过程与终稿来自 Cursor 并经卡片 SSE 跟手展示。  
> 若取消插件 client 面 / 禁止 toolview —— **直接违反硬约束 5**，本方案不成立，需产品改约束而非偷偷降级体验。

---

## 15. 阶段 0 落地清单（已完成）

目录：`dsh-cursor-coding/`（包名 `@zhongruan/dsh-cursor-coding`）

| 项 | 状态 |
| --- | --- |
| 工具名 `zr_cursor_*`（不用 `mes_code_dev_*`） | 已完成 |
| 本机 loopback `127.0.0.1:18788` | 已完成 |
| Cursor API Key 门禁（无 Key → 403 `cursor_key_required`） | 已完成 |
| HITL nonce（缺/复用 → 401） | 已完成 |
| confirm → Job 账本 → SSE（阶段 0 终态 `blocked_no_runner`，不改盘） | 已完成 |
| 设置页插槽 `settings.section` + 确认卡 `tool.call.toolview` | 已完成 |
| `pnpm build && pnpm self-test` | 已通过 |

**本地安装（开发）**

```bash
cd dsh-cursor-coding && pnpm install && pnpm build
dsh plugin --profile web add ./dsh-cursor-coding
# 宿主重载后：设置 → Cursor 写码 填 Key；对话调 zr_cursor_begin
```

**阶段 0 明确不做**：调用 `@cursor/sdk`、沙箱拷贝、同步落盘（留给阶段 A）。

---

## 16. 阶段 A 落地清单（已完成）

| 项 | 状态 |
| --- | --- |
| `@cursor/sdk` Local（含 Mock：`test-` Key / `CURSOR_CODING_MOCK=1`） | 已完成 |
| 沙箱受限拷贝 / 稀疏拷贝 + 快照 diff | 已完成 |
| write_scope 分区同步；范围外记 `deferred_files` 不静默丢 | 已完成 |
| SSE 转述 Cursor/Mock 过程事件 | 已完成 |
| `parent_job_id` 续改 + prompt 注入上次同步摘要 + 尝试 `Agent.resume` | 已完成 |
| 自检：无 Key 403、无 nonce 401、Mock 同步到真工程、续改 parent | 已通过 |

**真 Cursor 验收**：设置页填真实 API Key（非 `test-` 前缀）后，确认卡应看到真实工具事件并改盘。
