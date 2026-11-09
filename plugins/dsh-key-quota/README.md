# @zhongruan/dsh-key-quota

**本仓库用量统计的现行产品入口。** 侧栏「用量统计」、按平台账号分配 DeepSeek Key、看用量、设上限、超额拦截，都认这个插件。

不要去改 `@zhongruan/dsh-llm-meter` 做用量页或限额——那只是本机旁路计量与冻结口径对照。

## 用量分路（勿混）

| 卡片 | 数据来源 | 说明 |
|---|---|---|
| **LLM** | 中软模型网关接口 | 服务器统计；本插件不改其合计 |
| **写码** | ① `dsh-cursor-chat` 运行时 SDK usage；② Cursor 控制台账单补历史 | 都进本机 `events.jsonl`（`source=cursor`）；不改 LLM 网关 |

macOS 上 Cursor 的 `accessToken` 多为 `cursor-safe-storage` 密文。本机同步需能读钥匙串「Cursor Safe Storage」；首次可能弹授权，点「始终允许」后刷新用量页即可补历史日。也可用环境变量 `CURSOR_AUTH_TOKEN` 提供明文会话 token。

对话写码每轮 `run.wait()` 若带回 token，会立刻写入写码账（`quality=sdk`）。打开用量页仍会补 Cursor 控制台账单；**同一自然日若已有账单（`cuev-`），展示时丢掉同日运行时行，避免双计**。无账单日以运行时为准。

## 做什么

- Key 由平台管理端指定给同事并设置上限；本插件界面展示用量（同事只看本人）。
- 同事用自己的平台账号登录，只用分给自己的那把 Key，也只看自己的用量。
- 用量和上限记在平台上。同一个平台账号换一台电脑，看到的是同一份。
- 尚未分配 Key 时，该同事的模型调用不发出。
- token 合计与 `@zhongruan/dsh-llm-meter` 相同：reasoning 不进合计。本插件不改那本账。

## 文档

- 限额主方案：`docs/10-token用量统计/按Key限额-可行性实施方案.md`
- 总览与明细：`docs/10-token用量统计/按用户各模型token-总览与明细-可行性方案.md`
- Agent 规则：`.cursor/rules/usage-key-quota.mdc`

登录哪个平台账号，对话就用分给该账号的那把 Key，用量记在这一把上。系统配置里的 Key 可以留空。页面只显示尾号。
