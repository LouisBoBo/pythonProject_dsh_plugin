# @zhongruan/dsh-llm-meter

在宿主 `llm/stream` 出口记录每一次模型调用的 **真实 token 分项**，追加到本机 `$DSH_HOME/llm-meter/events.jsonl`。

**本机观测 ≠ DeepSeek 控制台账单。** 官网按 Key 的 HTTP 计；本插件只覆盖走 `ctx.llm.stream` 的调用。引擎直连 `api.deepseek.com`（如 PCB/审码）不经过这条 waterfall，仍由引擎自己的账本记。两边合在一起才接近本机全貌，不要求加总等于官网。

**口径已冻结（2026-09-17）**：Token 公式、schema、waterfall 未经产品明确允许不得改。见仓库 `.cursor/rules/llm-meter-locked.mdc`。

## 做什么 / 不做什么

| 做 | 不做 |
|---|---|
| 旁路 LLM（知识库抽取、记忆 dream、会话标题等）也能记到 usage | 改 DSH 内核或其它业务插件 |
| 分项：`prompt_tokens`（uncached input）、cache、reasoning、output | 只存一个合计 |
| 记账失败只 `warn`，不打断聊天 | 因落盘失败抛错、改写 `options.messages` |
| 一行一条 JSON，`id` 幂等 | 把 API Key / prompt 正文写入 jsonl 或日志 |
| 超出 `maxFileBytes` 轮转为 `events.jsonl.<utc>`，不删近期文件 | LiteLLM 代理、对账 UI、请求官网控制台 |

## 安装

公司插件走 **设置 → 插件市场 → 发现**。开发机联调：

```bash
dsh plugin --profile web add @zhongruan/dsh-llm-meter@0.1.0
# 然后完全退出并重启 WorkBuddy / dsh web
```

确认 profile 的 `cordis.patch` 出现 `id: llm-meter`，且没有 `disabled: true`。

## 落盘

- 默认路径：`~/.dsh/llm-meter/events.jsonl`（即 `dshHomePath('llm-meter/events.jsonl')`）
- schema `v: 1`，字段名稳定，供 WorkBuddy `ingest_llm_meter` 按 `id` 幂等读取
- `quality=provider` 表示抓到了 usage 块；`quality=missing` 表示这次调用没有 usage（次数仍有意义）
- `source`：`dsh_chat` / `dsh_knowledge` / `dsh_memory` / `dsh_title` / `dsh_other`

## 配置

```yaml
- id: llm-meter
  name: '@zhongruan/dsh-llm-meter'
  config:
    enabled: true
    eventsPath: !!js dshHomePath('llm-meter/events.jsonl')
    maxFileBytes: 52428800
```

`enabled: false` 时不注册 waterfall，行为与未安装相同。

## 开发

```bash
cd dsh-llm-meter
pnpm install
pnpm test
```

验收对照：主聊天 `source=dsh_chat` 且 `total_tokens>0`；知识库抽取出现 `dsh_knowledge`（或至少次数增加）；失败路径有 `ok:false` 且聊天报错与未装插件时一致。卸载后聊天 / 知识库 / 记忆行为不变。
