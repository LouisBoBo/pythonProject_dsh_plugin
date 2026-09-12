# DSH 会话 / 上下文 / 历史记忆分层

> **状态**：定稿（2026-09-12）  
> **原则**：能由 DSH 宿主处理的，插件与 WorkBuddy **不得再撑一套**；宿主接不住的，只补执行账本与对账，不当聊天会话库。

配合：[四车道会话契约](./四车道会话契约.md)（WorkBuddy 写码/审码/提交/部署卡隔离）、DSH Cursor 插件 `@zhongruan/dsh-cursor-coding`。

---

## 0. 一句话

**聊天记忆认 DSH 事件日志；写码执行认本机 Job；浏览器缓存只加速。禁止插件/引擎另造会话树。**

---

## 1. 三层权威（禁止串层）

| 层 | 谁管 | 存什么 | 存活 | 禁止 |
|---|---|---|---|---|
| **L1 聊天会话** | DSH `ctx.sessions` + `sessionPersistence` | 消息树、`tool/call`+`tool/result`（含 `presentationMeta`）、标题 | 刷新/重启可恢复 | 插件 `sessionStorage` / 自建聊天库当权威 |
| **L1b 上下文窗口** | DSH `ctx.compaction` + tokenMeter + tool-result pruner | 压进 checkpoint 的工作集 | 模型只看见压缩后的 surface | 插件私自截断/改写 DSH 历史 |
| **L2 执行账本** | 本机 Job（`ccj-*` / `ldj-*`） | Cursor/沙箱/同步、过程 transcript | 本机 `dataRoot/jobs` | 把 Job 目录当 DSH 会话库；按工作区抢别人的 Job |
| **L3 加速** | `sessionStorage` / 卡级 localStorage | 首屏 transcript、滚动位置 | 关标签即丢 | 用缓存覆盖 DSH meta / Job 终态 |

**模型可见 ⟺ 已写入 DSH 会话日志。** 要让下一轮 Agent 记得的结论，必须进 `tool/result` 的 `content`（如 `zr_cursor_finish` 的 `chat_body`），不要只写在 Job JSON 或浏览器里。

---

## 2. DSH 已具备（直接用，不要重做）

| 能力 | 宿主入口 | 用法 |
|---|---|---|
| 会话持久化 / 刷新恢复 | `ctx.sessionPersistence`、`ctx.agents.resume` | 卡还在，因为 tool 事件在日志里 |
| 身份 | `sessionId`、`callId` | 工具卡主键是 **`callId`**；会话分桶用 `sessionId` |
| 上下文压缩 | `ctx.compaction` | 长聊由宿主压窗口 |
| 跨会话点名 | `ctx.sessionReferenceResolver` | `@` 其它会话快照 |
| 可选跨会话检索 | `session_search` 等（默认未挂） | 需要时在宿主组合里启用，不在业务插件里自造搜索 |
| 目标/计划 | `ctx.goals` / `planMode` | 跨轮目标用宿主；todo 投影在下一 `turn/start` 会清 |
| 后台 Job 帧 | `ctx.jobs` | **进程内**，重启即空；长任务不要只靠它 |

**宿主缺口（尚未补，插件不得假装已有）：**

- `presentationMeta` 只在 `execute` 返回时写一次，中途不能回写工具卡。
- 无 `tool/progress` 事件；刷新后进度只能用 L1 已落盘的 `job_id` 去 L2 水合。
- 无官方 `ctx.memory`；长期语义记忆用会话日志 + 压缩，或 MCP memory（默认关）。

---

## 3. 插件必须补的（L2 对账）

在 DSH 未提供「中途改卡 meta / 进度绑定 session node」之前：

1. **begin 阻塞期**：用 DSH **`callId`**（次级 `sessionId`）对本机 pending；禁止 `pending-latest?workspace=` 抢最新一条。  
2. **begin 返回后**：`presentationMeta` 只带 `job_id` + 工作区等快照；刷新后 **GET 本机 Job** 水合相位。  
3. **Job 必须记下 DSH 身份**：`dsh_session_id`、`dsh_call_id`。续改默认找 **本会话** 最近成功 Job，不得按工作区全局 `findLatestSucceeded`。  
4. **续改上下文**（给 Cursor，不是给 DSH Agent）：父 Job 的诉求摘录 + 已同步文件 + 结论摘录，写入 Cursor prompt；**不要**把 Cursor 全程 thinking 倒进 DSH 聊天。  
5. **`sessionStorage` 仅加速** transcript 首屏；相位以 DSH `job_id` + Job.status 为准。

WorkBuddy 四车道另守 [四车道会话契约](./四车道会话契约.md)（`callId` + `wb-cd-*` 等前缀）。DSH Cursor 插件前缀：`dsh-cc-accel:`（加速），Job 文件 `ccj-*`。

---

## 4. 历史记忆怎么流

```text
用户说话
  → DSH 会话日志（L1，Agent 下一轮能看见）
  → begin 确认卡（callId 对账 pending）
  → 本机 Job（L2，Cursor transcript 只在这里）
  → finish.chat_body「本轮结论」（写回 L1，供压缩与续聊）
  → 续改：本 session 的 parent Job → 压缩 handoff → Cursor prompt（L2→执行器）
```

| 想记住什么 | 正确落点 | 错误落点 |
|---|---|---|
| 用户原话、确认结论、本轮结论 | DSH `tool/result` content / 用户消息 | 仅 Job / 仅 sessionStorage |
| 写码过程 thinking、工具轨迹 | 本机 Job transcript | DSH 系统提示 / 第二套会话库 |
| 卡上「进行到哪一步」 | 刷新后用 `job_id` 拉 Job | 把相位写进 sessionStorage 当权威 |

---

## 5. 改代码门禁

未改本文前禁止：

- 在插件里用工作区路径当会话主键；
- 把 `sessionStorage` / `localStorage` 当成恢复完成态的唯一依据；
- 为「记忆」再造聊天消息表或平行于 DSH 的 session 文件；
- 把 Cursor 全程日志灌进 DSH Agent 上下文（会撑爆窗口且重复 compaction）。

**给宿主的后续诉求（不阻塞当前）**：`tool/progress` 或允许中途更新 `presentationMeta`，把 L2 进度绑到同一 `callId` 节点。
