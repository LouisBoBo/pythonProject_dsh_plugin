# Cursor 写码插件：写码 / 删码 / 续改 · 复盘总结

> 日期：2026-09-12  
> 包：`@zhongruan/dsh-cursor-coding`（联调收口约 **0.6.32～0.6.36**；主流程形态见冻结文档）  
> 结论：**写码、删码（含菜单/报表入口删除）、续改三条主路径已基本跑通**  
> 相关：  
> - [Cursor写码插件-主流程冻结.md](../04-Cursor-AI-Coding逼真版本/Cursor写码插件-主流程冻结.md)  
> - [Cursor写码插件-新用户使用手册.md](../04-Cursor-AI-Coding逼真版本/Cursor写码插件-新用户使用手册.md)  
> - [DSH会话与记忆分层.md](../架构与选型/DSH会话与记忆分层.md)

---

## 1. 目标与最终结论

**目标：** 在 DSH / WorkBuddy 对话里，用独立插件驱动 Cursor Local 写码，体验接近「确认 → 看得见过程 → 正文有结论」；新增/删除页面·菜单须先澄清；续改与首轮同一套流程。

**结论（2026-09-12，基本通）：**

| 场景 | 状态 | 验收要点 |
| --- | --- | --- |
| **写码**（小改 / 增列等） | ✅ | 确认卡 → 进度卡 → 聊天正文「本轮结论」 |
| **删码 / 删菜单入口**（如报表中心彻底删某报表） | ✅ | **先** `ask_user_question` 澄清范围 → 再确认开写 → 进度 → 结论 |
| **续改** | ✅ | 同会话挂 parent Job；同样确认 → 进度 → **必有**本轮结论 |

产品形态已冻结为四步，不允许再改步骤顺序与职责边界（细节 bug / 文案 / 性能除外）。

---

## 2. 冻结主流程（复盘口径）

```text
1. 需求澄清（新增/删除 报表·页面·菜单入口 —— 服务端硬拦；「新增一列」等小改除外）
   → DSH 原生 ask_user_question
2. 确认卡（HITL）
   → zr_cursor_begin / continue；确认前不写码、正文零输出
3. 进度卡
   → 沙箱 → Cursor → 自动同步；卡内只展示思考/工具（含编辑片段）
4. 正文结论
   → begin/continue 等终态返回「## 本轮结论」；zr_cursor_finish 仅兜底
```

**职责切分（踩坑后定稿）：**

| 层 | 认谁 | 不认谁 |
| --- | --- | --- |
| L1 聊天 / 压缩 | DSH 会话 | 插件私自当「真会话」 |
| L2 执行账本 | 本机 Job（`ccj-*`）+ `dsh_session_id` / `dsh_call_id` | 用旧 Job 冒充新诉求 |
| 加速 | `sessionStorage` `dsh-cc-accel:` | 当唯一真相源 |

---

## 3. 走过的弯路（按主题）

### 3.1 结论与续改

| 现象 | 真实原因 | 正确做法 |
| --- | --- | --- |
| 写完只有进度卡，聊天正文没有结论 | 依赖模型自觉调 `finish`，经常漏 | **begin/continue 阻塞到 Job 终态**，用 `waitJobUntilConclusion` + `buildConclusionToolResult` 强制出「本轮结论」；finish 仅兜底 |
| 续改像「半截流程」 | 产品曾把续改当特例 | **续改 = 同一套四步**；凡写码必有结论 |
| 确认前助手已在正文复述状态 | 工具秒回 + 模型抢话 | 确认前阻塞；确认前正文保持空 |

### 3.2 进度卡「像真在改码」

| 现象 | 真实原因 | 正确做法 |
| --- | --- | --- |
| 编辑行只有路径，没有代码片段 | Cursor `edit` 事件常无 `new_string` | `editSnippet.ts`：`running` 时对**工作区**打 baseline（勿对沙箱抢打——SDK 常先写沙箱再发 running）；`completed` 后出短 `+/-` diff；无 diff 则文件预览 |
| 自测有 snippet、真人 Job 没有 | 宿主仍跑旧内存代码 / 旧 Job 不会回填 | 重启后**新开 Job**；`/health.pluginVersion` 核对 |

### 3.3 串 Job / 旧卡复用

| 现象 | 真实原因 | 正确做法 |
| --- | --- | --- |
| 新诉求弹出上一轮已完成的进度卡 | pending-latest / accel 把旧 `job_id` 粘到新 call | `cardBootstrap`：诉求冲突则拆绑；`callId` 身份变化则重置；pending 不得在需求冲突时贴旧 Job |

### 3.4 澄清闸门（删菜单最易炸）

| 现象 | 真实原因 | 正确做法 |
| --- | --- | --- |
| 「报表中心菜单彻底删除…」直接确认开写 | 只靠提示词，模型跳过 `ask_user_question` | `requirementGate`：**入口级增删硬拦**；小改（增列/修 bug）不拦 |
| 传 `clarified=true` 空转过闸 | 布尔位可被模型伪造 | **必须** message 带澄清痕迹（`hasClarifyEvidence`）；空 `clarified` 不够 |
| 「待澄清」空壳卡，上面没有选择题 | 插件自造澄清 UI，又没有真正 ask | **澄清 UI 只认** DSH `ask_user_question`；插件只返回 `need_clarify` / `await_ask_user` |
| Deep diving / 确认卡「卡死」 | 前端按文案**藏掉**确认卡，服务端已在 `waitConfirmThenStart` 阻塞 | **禁止**客户端猜文案藏确认卡；显隐只认 `need_clarify` / `await_ask_user` |
| 磁盘已是新版本，行为仍旧 | `:18788` 旧 Node 进程不重载模块；硬刷前端无效 | **Cmd+Q 彻底退出**宿主再开；`curl :18788/health` 看 `pluginVersion` + `gate.mustClarify` |

### 3.5 运维与验证

| 现象 | 真实原因 | 正确做法 |
| --- | --- | --- |
| `health.pluginVersion` 为 `None` / 无 `gate` | 跑的是更早的服务实现 | 杀监听 `18788` 的进程 + 全量重启；健康检查应带版本与闸门样例 |
| 联调以为「代码没生效」 | symlink 指向源码，但进程缓存旧 `lib` | 先 `pnpm build`，再重启宿主；用 `verify:clarify` / self-test 做闸门回归 |

---

## 4. 关键决策（为什么这样定）

1. **提示词原则化 + 服务端硬闸兜底**  
   题目怎么出交给模型；入口级增删不信任模型自觉，用 `needsRequirementClarify` 拦。

2. **删菜单 = 写码，不是例外**  
   删除入口仍走澄清 → 确认 → Cursor 改码；禁止「删东西就跳过澄清」。

3. **结论挂在 begin/continue，不挂在模型自觉**  
   产品验收是「每轮一定有本轮结论」；工具超时/漏调 finish 不能让用户空手。

4. **确认卡与澄清卡职责不混**  
   澄清 = DSH 选择题；确认 = 插件 HITL。前端不得用启发式把「须澄清」伪装成藏确认，否则与服务端阻塞死锁。

5. **会话分层写进架构定稿**  
   聊天认 DSH、执行认 Job、加速仅 sessionStorage，避免续改/串卡时再发明第三套真相源。

---

## 5. 关键代码落点（便于以后对照）

| 能力 | 主要文件 |
| --- | --- |
| begin/continue 确认阻塞 + 终态结论 | `dsh-cursor-coding/src/index.ts`（`waitConfirmThenStart` / `waitJobUntilConclusion`） |
| 入口级澄清闸门 | `src/requirementGate.ts`、`src/clarifyFlow.ts` |
| 进度编辑片段 | `src/editSnippet.ts`、`src/orchestrator/runJob.ts` |
| 防旧 Job 粘卡 | `src/cardBootstrap.ts`、`src/client.js` |
| 健康检查版本/闸门 | `src/server.ts` → `GET /health` |
| 闸门自测 | `pnpm verify:clarify`、`pnpm self-test` |

安装常见形态：`~/.dsh/profiles/web/node_modules/@zhongruan/dsh-cursor-coding` → 仓库 `dsh-cursor-coding`（symlink）。**改源码后必须 build + 重启写码服务进程**，不能只强刷页面。

---

## 6. 验收清单（复盘时已对齐）

- [x] 小改：可直接确认开写 → 进度 → 正文结论  
- [x] 新增/删除页面·菜单：先选择题澄清，再确认开写  
- [x] 删除报表中心菜单项：澄清范围（只菜单 / 连带页面·路由等）后落码  
- [x] 续改：确认 → 进度 → 本轮结论（与首轮同形态）  
- [x] 新诉求不展示上一轮已完成 Job 卡  
- [x] `/health` 可核对本机实际加载的 `pluginVersion` 与闸门样例  

**仍属细节优化（不改冻结形态）：** snippet 在极端事件序下的覆盖率、热重载门禁模块、确认/澄清文案与滚动体验。

---

## 7. 给下一任的最短排障

1. 行为怪 → 先 `curl -s http://127.0.0.1:18788/health`，确认版本与 `gate`。  
2. 版本对不上 → **彻底退出** WorkBuddy/DSH，必要时 `kill` 占用 `18788` 的进程再开。  
3. 删菜单仍直接确认 → 查是否未过闸、或模型伪造 `clarified` 且 message 无澄清痕迹。  
4. 确认卡点了像卡死 → 查是否前端又藏了确认卡而 begin 仍在 wait。  
5. 有进度无结论 → 查 begin/continue 是否仍走 `waitJobUntilConclusion`（勿退回「只靠 finish」）。

---

## 8. 一句话收口

**写码 / 删码 / 续改能通，靠的是冻结四步 + 服务端闸门与结论兜底，而不是再加一层提示词；联调最大的隐形敌人是「磁盘已是新插件、进程还是旧的」。**
