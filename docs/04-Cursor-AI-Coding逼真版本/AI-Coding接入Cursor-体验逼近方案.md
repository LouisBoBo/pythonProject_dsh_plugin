# AI-Coding：接入 Cursor、逼近 Composer 体验（实施方案）

> **状态**：体验/分期母本（对照用）  
> **落点说明**：本文原落点在 WorkBuddy `engine + mes-bridge`。若须满足「不动 WorkBuddy / 独立插件安装即用」等硬约束，**实施以** [AI-Coding接入Cursor-插件版实施方案.md](./AI-Coding接入Cursor-插件版实施方案.md) **为准**；本文保留作体验目标与分期语义对照。  
> **立场（硬约束）**：本产品是 **接 Cursor AI-Coding**，不是再造编码平台 / IDE / 第二个 Composer。  
> **交互壳**：用户说话、确认、看进度、续改，全部发生在 **DSH 聊天**；算数与改盘只在 **编排层 + cursor-sdk Local Agent**。  
> **安全底线**：HITL nonce、回环、沙箱、`write_scope` —— 只缩短摩擦，不拆除。

---

## 0. 一句话目标

在 **DSH 聊天壳**里，把「确认 → Cursor 改沙箱 → 受限同步」做成 **接近 Cursor Composer 的连续改码流水线**：同工程能续改、落盘前能审清单、范围外不静默丢、过程流可读；**改文件的智能与工具链仍全部交给 Cursor**，我们只做编排、门禁、回显与同步决策。

---

## 1. 边界：做什么 / 明确不做什么

### 1.1 我们做（编排层）

| 做 | 放哪 | 说明 |
| --- | --- | --- |
| 意图、Brief、确认卡、进度卡、续改卡 | DSH 面板 `client.js` + `features/code-dev` | 聊天壳体验 |
| Job 状态机、沙箱、同步、HITL | `engine/app/code_dev/*` | 唯一算数真相源 |
| 调 Cursor Local | `cursor_agent.py`（cursor-sdk） | **唯一写码执行器** |
| 路由与话术 | `.dsh/skills/zr-workbuddy-*` | 教 Agent 何时出卡，不替 Cursor 写盘 |

### 1.2 我们不做（禁止再造）

| 不做 | 原因 |
| --- | --- |
| 自研 Agent 循环 / 自研 Apply Patch 引擎 | 那是 Cursor 的活 |
| 聊天内嵌完整 Diff 编辑器 / 终端 / Debugger | 那是 IDE；壳是 DSH 聊天 |
| 第二个 bridge / profile 业务 Cordis 包 | 铁律 |
| feature 里 `import` cursor-sdk | 算数只在 engine |
| 拆掉 HITL「一句话直接开工」 | 企业底线；只做「续改少确认」 |
| 用 DSH Agent 的 Write/Bash 改用户工程 | 已硬拦；保持 |
| 1:1 复制 Cursor IDE 全部能力 | 目标是 **Composer 流水线在聊天里好用**，不是伪装 IDE |

### 1.3 产品口径（对外怎么说）

- ✅「在 WorkBuddy（DSH）里确认需求，由 **Cursor** 在本机工程里改码，进度回聊天。」  
- ❌「我们自己做了一个 AI 写码平台。」  
- ❌「必须打开 Cursor IDE 窗口才能用。」（Local Agent 无窗亦可；IDE 是可选加深审查，不是主路径。）

---

## 2. 目标体验（DSH 聊天里长什么样）

用户感知应接近：

```text
说需求 →（短）选项/确认 → 进度卡里「Cursor 正在…」→ 变更清单卡（勾选同步）
       → 落盘完成 → 同一聊天下一句「再改一下 xxx」→ 轻量确认 → 再跑一轮 Cursor
```

相对今天的断点：

| 今天 | 目标 |
| --- | --- |
| 每轮几乎重走选目录 + discuss | **续改**：同 workspace + 上次 job 上下文，一卡或一句即可 |
| Cursor 跑完直接 sync（或 deferred 只警告） | **审清单再落盘**（文件级勾选；不做 IDE diff） |
| deferred 静默跳过 | **决策卡**：扩大 scope / 放弃 / 下轮再说 |
| 跑中只能 cancel | **跑后追问优先**；跑中「追加指令」第二期（见分期） |
| 过程少代码、像验尸 | **活动流**：工具态 + 路径；代码折叠可选，不自研语法高亮 IDE |

---

## 3. 架构原则（落地时不许偏离）

```text
┌─────────────────────────────────────────────────────────┐
│  DSH 聊天壳（mes-bridge client.js）                       │
│  卡片：讨论 / 确认 / 进度(SSE) / 变更审 / 续改 / deferred │
│  不写盘；只 issueHitl + fetch 引擎                        │
└──────────────────────────┬──────────────────────────────┘
                           │ 127.0.0.1 引擎 HTTP + HITL nonce
┌──────────────────────────▼──────────────────────────────┐
│  引擎 code_dev Job 状态机                                 │
│  pending_review → syncing → done | 续跑 start(parent)     │
└──────────────────────────┬──────────────────────────────┘
                           │ cwd=沙箱
┌──────────────────────────▼──────────────────────────────┐
│  Cursor Local（cursor-sdk）← 唯一「会写码」的大脑与手     │
└─────────────────────────────────────────────────────────┘
```

1. **Cursor 只负责改沙箱**；是否进真实工程由引擎 + 人在聊天卡上决定。  
2. **DSH Agent 只路由与出卡**，禁止自己 Write 用户工程。  
3. **增量只改**：`code_dev/*`、`features/code-dev`、`mes-bridge` 写码相关 UI、Skill、测试；不改 host 内核。  
4. **验收认引擎**：探活 / Job 终态 / synced_files；不以「必须打开 Harness」为成败。

---

## 4. 分期落地（可排期、可验收）

### 阶段 A — 续改闭环（优先，体感提升最大）

**要解决**：同一工程下一句话还要重走长流程。

| 项 | 说明 |
| --- | --- |
| **Job 关联** | `jobs/*.json` 增加 `parent_job_id`、`workspace`、`last_synced_files`、`continue_count` |
| **意图** | chat / discuss：若 brief 或最近成功 job 同 workspace，识别「续改/再改/接着」→ 出 **续改确认卡**（非全量 options） |
| **开工** | `POST /api/code-dev/confirm` 增可选 `parent_job_id`；服务端校验 workspace 一致 + HITL |
| **沙箱策略** | 优先：**复用父 Job 沙箱目录再增量拷贝变更**；若已清则从 target 再 `prepare_sandbox`（实现选一，文档写死默认） |
| **Prompt** | `build_prompt` 注入「上次已同步文件摘要 + 用户新指令」；仍单次 `agent.send`（不假装多轮 IDE） |
| **DSH UI** | 完成卡底部：「继续改这个工程」快捷；Agent 工具 `mes_code_dev_continue`（薄封装 → 引擎） |
| **Skill** | 写明：有成功 job 时优先续改，勿重新 `begin` 全收集 |

**验收**

1. 同 workspace 成功后再说「把按钮改红」→ 出现续改确认卡（路径已填）→ 一点确认再跑 Cursor。  
2. 无 parent / workspace 不一致 → 拒绝续改，走正常 begin。  
3. 仍须 HITL nonce；Agent 不能仅 `confirmed=true` 绕过。

**改动面（预计）**

- `brief.py` / `chat_bridge.py` / `ops.py` / `service.py` / `jobs.py`  
- `features/code-dev/index.js`  
- `client.js` 完成卡 + 续改卡  
- `.dsh/skills/zr-workbuddy-code-dev`（或 routing）  
- `engine/tests/test_code_dev*.py`

---

### 阶段 B — 落盘前变更审（文件级，不做 IDE）

**要解决**：Cursor 改完直接进真工程；用户无法像 Composer 那样「先看改了啥再接受」。

| 项 | 说明 |
| --- | --- |
| **状态** | Cursor 成功且有 diff 后进入 `pending_review`（**暂不 sync**） |
| **SSE** | 推送 `type: review`：`changed_files[]`、`deleted_files[]`、建议 in_scope / deferred 标记 |
| **API** | `POST /api/code-dev/jobs/{id}/apply`：body=`{ accept: string[], reject: string[], expand_scope?: string[] }` + HITL nonce（新 action 如 `code-dev.apply`） |
| **行为** | accept ∩ in_scope → sync；reject 丢弃（沙箱保留供审计可选）；expand_scope 经校验后可并入本次 sync |
| **超时** | 可配置：超时未 apply → 默认 **不落盘**（安全优先）或「仅 sync 原 write_scope」（配置项，默认不落盘） |
| **DSH UI** | 进度卡终态变「变更清单」：checkbox 列表 +「同步到本机」；不渲染完整 diff hunk（可链「在 Finder/IDE 打开沙箱路径」可选） |

**验收**

1. 确认写码后，未点「同步」前，真实工程文件未变。  
2. 只勾 2/5 个文件 → 仅 2 个进 synced_files。  
3. 无 nonce 调 apply → 401/拒绝。

**明确不做**：逐行 diff UI、侧栏对比、Checkpoint 时间旅行（放阶段 D）。

---

### 阶段 C — deferred / scope 决策（与 B 可同迭代）

**要解决**：范围外变更只警告、半残工程。

| 项 | 说明 |
| --- | --- |
| **现状** | `service.py` 把 outside 写入 `deferred_files` 并跳过 |
| **目标** | review 卡上分区展示「将同步 / 范围外」；人可勾选扩大或明确放弃 |
| **引擎** | `partition_changed_paths` 结果原样进 SSE；apply 时 `expand_scope` 做前缀校验 + 敏感路径拒绝 |
| **文案** | 不用「验尸」；说清「这些改动在允许范围外，同步可能导致依赖不完整」 |

**验收**：人为制造 scope 外文件 → 卡上可见 → 扩大后同步成功；放弃后工程不被半同步。

---

### 阶段 D — 过程流「像 Cursor 对话框」（保真，不造编辑器）

**要解决**：流被过度 sanitize，专业感不足。

| 项 | 说明 |
| --- | --- |
| **原则** | 展示 Cursor 已产生的活动：工具名、相对路径、状态；**不**自研文件树/终端 |
| **放开** | 过程正文允许折叠代码块（长度上限 + 脱敏路径）；终稿仍可「说明方案」为主 |
| **结构化** | SSE 增加稳定 `tool_events[]`（name/status/path），UI 时间线绑事件而非纯字符串猜 |
| **删除车道** | 过程仍信 Cursor 流；结论仍信引擎落盘（不与本阶段冲突） |

**验收**：对照同一次 Local 跑，聊天过程卡路径/工具顺序与 Cursor 对话框大体一致（允许缺 raw I/O）。

---

### 阶段 E — 跑中追问（可选，依赖 SDK 能力）

**前提**：核实当前 `cursor-sdk` 是否支持 **同一 Agent 实例二次 `send`** / 会话 id 续跑。

| 若 SDK 支持 | Job 增加 `running` 下的 `POST .../steer`（追加自然语言）+ 轻量 HITL 或「仅同会话已确认 job」 |
| 若 SDK 不支持 | **不做假多轮**；产品文案引导「取消或等完成后再续改（阶段 A）」 |

本阶段 **排在 A/B/C 之后**，避免在 SDK 能力不清时堆接口。

---

## 5. 接口草案（阶段 A–C）

> 中文 tags/summary 按仓库规范在实现时写入 `main.py`。下列为语义草案，字段可微调。

| 方法 | 路径 | 作用 | HITL |
| --- | --- | --- | --- |
| 已有 | `POST /api/code-dev/confirm` | 开工；增 `parent_job_id?` | `code-dev.confirm` |
| 新增 | `POST /api/code-dev/jobs/{id}/apply` | 审后同步 | `code-dev.apply` |
| 已有 | `GET .../stream` | 增事件 `review` / `tool_event` | 否 |
| 可选 | `POST .../continue-discuss` | 仅出续改确认卡、不开工 | 否 |

Feature 工具（均 `runEngine`，无 npm）：

- 保留：`mes_code_dev_begin` / status / cancel …  
- 新增：`mes_code_dev_continue`（带 parent job）  
- 不新增「Agent 直接 apply」；apply 只由面板签发 nonce 后调用（与 confirm 同模式）。

---

## 6. Job 状态机（相对今天）

```text
今天:  queued → running(sandbox→cursor→sync) → succeeded|failed|cancelled

目标:  queued → running(sandbox→cursor) → pending_review
                                    ↘（无变更/失败） failed|cancelled
         pending_review → apply → syncing → succeeded
                        → expire/cancel → cancelled（不落盘）

续改:  succeeded ──confirm(parent)──► 新 job（queued…）
```

删除意图：可 **跳过 pending_review**（仍走引擎 reconcile），或 review 只展示「将删路径」——实现时在删除专篇补一句，默认 **删除保持现网：Cursor 计划 + 引擎落盘，不强制多一步勾选**（避免删菜单更繁琐）；写码（非删）走 pending_review。

---

## 7. DSH 聊天壳适配要点

1. **所有新交互都是卡片**，挂在现有 `CodeDevBeginCard` / 进度卡体系，不新开「写码 IDE 页」为主路径。  
2. **localStorage brief** 续改时写入 `last_job_id`；服务端仍以 job 账本为准，防篡改。  
3. **桌面一体与浏览器 DSH** 共用引擎 API；卡片逻辑只在 bridge `client.js`（改完需重载宿主，热插拔管不了面板壳——文档写明）。  
4. **Agent 话术**：Skill 规定「用户说续改 → 调 continue / 出续改卡」，禁止 Agent 声称自己已改文件。  
5. **提交 / 部署仍分车道**：完成卡可链「去提交」入口，但不在本方案内合并 commit。

---

## 8. 与现有安全方案对齐

| 控制 | 本方案 |
| --- | --- |
| confirm nonce | 续改 confirm 仍要 |
| apply nonce | 新 action，payload 绑 job_id + accept 列表 hash |
| 回环 / CORS | 不改 |
| write_scope | expand 须校验；敏感路径永不 sync |
| Agent confirmed=true | apply/confirm 均不可仅凭参数开工 |

详见 [企业级安全加固方案.md](../安全/企业级安全加固方案.md)。

---

## 9. 推荐排期（人力感）

| 顺序 | 阶段 | 建议工期感 | 依赖 |
| --- | --- | --- | --- |
| 1 | A 续改 | 小～中 | 无 |
| 2 | B+C 审清单 + deferred | 中 | 改 sync 时机，需测删除车道不回归 |
| 3 | D 过程流保真 | 小～中 | 可与 B 并行前端 |
| 4 | E 跑中追问 | 待定 | SDK 能力调研 |

建议：**先 A 上线一版**，立刻改善「像连续用 Cursor」；再 B+C，补上「专业可控」；D 打磨观感；E 不硬扛。

---

## 10. 验收总表（产品）

1. 用户全程主要在 **DSH 聊天**完成写码，无需以打开 Cursor IDE 为步骤。  
2. 真正改文件的是 **Cursor Local**，日志/进度可对应到 Job。  
3. 同工程续改路径明显短于首轮。  
4. 非删除写码：未 apply 前本机工程不变；apply 后 synced_files 与勾选一致。  
5. deferred 必须人决策，禁止静默半残。  
6. `scripts/test.sh zr-workbuddy` 相关单测通过；`check-secrets.sh` 无密钥进仓。  
7. 铁律自检：无第二 bridge、无 feature import sdk、无业务焊进 host。

---

## 11. 文档与实现同步约定

- 本文件为 **体验逼近总方案**；落地某一阶段时，在 [P0-1-本机写码功能实现.md](./P0-1-本机写码功能实现.md) §10 改「已做/进行中」，并补该阶段接口表。  
- 删除行为差异写进 [P0-1-删除菜单车道.md](./P0-1-删除菜单车道.md) 一小段「与 pending_review 关系」。  
- 不在本方案内改 P0-2/P0-3/P1 主叙事。

---

## 12. 相关文档

| 文档 | 关系 |
| --- | --- |
| [P0-1-本机写码功能实现.md](./P0-1-本机写码功能实现.md) | 现状实现 |
| [功能迁移-写码审码提交自动化.md](../架构与选型/功能迁移-写码审码提交自动化.md) | P0 边界 |
| [企业级安全加固方案.md](../安全/企业级安全加固方案.md) | HITL |
| [AGENTS.md](../../AGENTS.md) | 分层铁律 |
