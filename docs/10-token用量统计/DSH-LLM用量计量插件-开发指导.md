# DSH LLM 用量计量插件 · 开发指导

> **给谁**：独立 DSH 插件仓（建议包名 `@zhongruan/dsh-llm-meter`），**不是** DSH-ZR-WorkBuddy 本仓。  
> **目标**：在宿主 `llm/stream` 出口记每一次模型调用的 **真实 token 明细**，减少相对 DeepSeek 控制台的漏采；本机用量可按来源下钻。  
> **非目标**：加总强制等于官网控制台；不做 LiteLLM 出口代理；不改 DSH 内核源码。  
> **WorkBuddy 侧**：插件落盘后，本仓引擎只读采集进 `engine/data/usage/`（另开任务接线；本文先定契约）。

对照背景：[`Token消耗统计分析方案.md`](./Token消耗统计分析方案.md)。  
2026-09-16 实测：本机账本 106 次 / 1.44M token，官网 218 次 / 2.00M；会话 usage 已采全，缺口来自 **未进 session 的旁路 LLM**（如 knowledge 抽取）及 **memory 审计 token 全 0**。

---

## 0. 先定口径

| 说法 | 对不对 |
|---|---|
| 「装上就能和官网一模一样」 | **不对**。官网按 Key 的 HTTP 计；本插件按 `ctx.llm.stream` 计，引擎直连 DeepSeek 仍由 WorkBuddy 引擎账本记 |
| 「少漏 + 有真实分项明细」 | **对**。这是验收标准 |
| 「改 WorkBuddy 的 mes-bridge 挂 llm」 | **不对**。计量是宿主 Cordis 包，走插件中心；禁止焊进 bridge |

关系图：

```text
DSH 内任何 ctx.llm.stream(...)
        │
        ▼
  llm/stream waterfall（本插件监听）
        │  读 usage 块 → 追加一行 jsonl（禁止打断主流程）
        ▼
  ~/.dsh/llm-meter/events.jsonl
        │
        ▼
  WorkBuddy 引擎 ingest（本仓后续接）→ 用量页「本机观测」
```

引擎直连 `api.deepseek.com`（PCB/审码等）**不经过**该 waterfall，仍由引擎自己的 `usage` 账本记——两边都要有，才接近「本机全貌」。

---

## 1. 为什么现有用法不够

| 现有做法 | 问题（已核实） |
|---|---|
| 回放 `~/.dsh/sessions/**/session.jsonl*` 的 `assistant/chunk` usage | 只覆盖主 Agent 步进；**knowledge `extraction.js` 的 `ctx.llm.stream` 不落 session usage** |
| 读 `~/.dsh/memory/memory.db` → `llm_audit_logs` | 有次数，但 **input/output/total 常为 0** |
| 社区 usage 面板（session 投影） | UI 更好看，同源漏采；**解决不了你的缺口** |

mneme 写审计时常见错误读法（对照用，**建议另开 PR 修，本指导以独立 meter 为主**）：

```js
// 错：usage 在 chunk.usage 里，不在 chunk 顶层
if (chunk.type === "usage") {
  const i = chunk.inputTokens; // 常常是 undefined → 记成 0
}
// 对：
const u = chunk.usage || chunk;
const i = u.inputTokens ?? u.input_tokens ?? 0;
```

会话里真实 usage 形状（本机 09-16 全量样本）：

```json
{
  "type": "usage",
  "usage": {
    "inputTokens": 1826,
    "outputTokens": 361,
    "cacheReadTokens": 19840,
    "reasoningTokens": 70
  }
}
```

字段语义（`@deepseek-ai/dsh-llm` TokenUsage）：**`inputTokens` 与 `cacheReadTokens` 互斥分列**；计费输入 ≈ `inputTokens + cacheReadTokens (+ cacheWriteTokens)`。  
`total` 建议：`input + cacheRead + cacheWrite + output + reasoning`（与 WorkBuddy `from_sdk_usage` 一致），并保留分项，禁止只存一个合计。

---

## 2. 推荐方案：独立 Cordis 计量包

**不要**先改一堆业务插件；做一个只做计量的包，挂在 `llm/stream` waterfall 上，覆盖：

- 主聊天 Agent 循环  
- `@zhongruan/dsh-knowledge` 抽取 / 结构化  
- `@modusensus/dsh-mneme` dream / summarize  
- 会话标题 LLM  
- 其它凡走 `ctx.llm.stream` 的包  

### 2.1 包标识（建议）

| 项 | 值 |
|---|---|
| npm `name` | `@zhongruan/dsh-llm-meter` |
| Cordis `id` | `llm-meter`（短名，唯一） |
| `dsh.client` | 可无 UI；若做设置页再加 client bundle |
| 依赖 | `peerDependencies`：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-llm`（版本对齐当前宿主，如 `0.1.1-rc.2`） |

`cordis.patch.yml` 示例：

```yaml
- insert:
    - id: llm-meter
      name: '@zhongruan/dsh-llm-meter'
      config:
        enabled: true
        # 相对 DSH_HOME；WorkBuddy ingest 只读此路径
        eventsPath: !!js dshHomePath('llm-meter/events.jsonl')
        # 单文件软上限（字节），超出则轮转 events.jsonl.1
        maxFileBytes: 52428800
```

安装：插件中心或：

```bash
dsh plugin --profile web add @zhongruan/dsh-llm-meter@<ver>
# 然后重启 dsh web
```

与 WorkBuddy 公司市场：发版进私有 registry 后，按 [`插件中心使用说明.md`](../宿主与运维排障/插件中心使用说明.md) 合并进 seed（另开确认，本文不强制）。

### 2.2 生命周期硬性约定

1. **禁止**因记账失败抛错打断 `next()` 流。try/catch + `ctx.logger?.warn`。  
2. **禁止**在模块顶层 `setInterval`；清理挂 `ctx.effect` / fiber。  
3. **禁止**日志打印 API Key、完整 prompt、用户消息正文（可记 `prompt_chars` / hash）。  
4. **禁止**改写 `options` 里的 messages（只读）；waterfall 里调用 `next()` 原样透传。  
5. 同一逻辑调用可能因 retry 产生多次 HTTP：每次完整 stream（含最终 usage）记 **1 行**；不要在插件里擅自「合并 retry」。

---

## 3. 核心实现：`llm/stream` waterfall

### 3.1 注册方式（伪代码）

以当前 DSH Cordis 惯例为准（名称以你宿主版本文档为准；若 API 名不同，以 `dsh-llm` 的 `llm/stream` 声明为准）：

```js
export const name = 'llm-meter'
export const inject = ['llm'] // 按实际需要；不要 inject 用不到的服务

export function apply(ctx, config) {
  if (config?.enabled === false) return

  const path = resolveEventsPath(ctx, config)
  ensureParentDir(path)

  // 关键：名称以宿主「llm/stream」waterfall 为准
  ctx.waterfall(ctx.get('llm') /* 或文档要求的 this */, 'llm/stream', async function* (options, next) {
    const started = Date.now()
    const meta = classifyCall(options) // 见 §4
    let usage = null
    let finishKind = ''
    let errMsg = ''

    try {
      for await (const chunk of next()) {
        const parsed = pickUsage(chunk)
        if (parsed) usage = parsed
        if (chunk?.type === 'finish') {
          finishKind = chunk.reason?.kind || chunk.finish?.kind || 'finish'
        }
        if (chunk?.type === 'error' || chunk?.type === 'aborted') {
          finishKind = chunk.type
          errMsg = String(chunk.failure?.message || chunk.message || '').slice(0, 200)
        }
        yield chunk
      }
    } catch (e) {
      errMsg = String(e?.message || e).slice(0, 200)
      // 仍尝试落盘一次（token 可能为空）
      appendEvent(path, buildEvent({ meta, usage, started, finishKind: 'throw', errMsg, ok: false }))
      throw e // 业务错误原样抛出
    }

    appendEvent(path, buildEvent({
      meta,
      usage,
      started,
      finishKind,
      errMsg,
      ok: !errMsg && finishKind !== 'error' && finishKind !== 'aborted',
    }))
  })
}
```

> 若宿主 waterfall 签名是 `(options, next) => AsyncIterable` 而非 generator wrapper，改为：包装 `next()` 的 async iterator，同样在迭代中抓 usage，结束后 append。**关键是：不丢 chunk、不吞异常语义。**

### 3.2 解析 usage

```js
function pickUsage(chunk) {
  if (!chunk || chunk.type !== 'usage') return null
  const u = chunk.usage && typeof chunk.usage === 'object' ? chunk.usage : chunk
  const input = num(u.inputTokens ?? u.input_tokens ?? u.prompt_tokens)
  const output = num(u.outputTokens ?? u.output_tokens ?? u.completion_tokens)
  const cacheRead = num(u.cacheReadTokens ?? u.cache_read_tokens)
  const cacheWrite = num(u.cacheWriteTokens ?? u.cache_write_tokens)
  const reasoning = num(u.reasoningTokens ?? u.reasoning_tokens)
  const total = input + output + cacheRead + cacheWrite + reasoning
  if (total <= 0 && input === 0 && output === 0) return null
  return { input, output, cacheRead, cacheWrite, reasoning, total }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
```

流结束仍无 usage：照样落盘，`quality: "missing"`，`total: 0`（次数仍有意义）。

---

## 4. 来源标签（明细要能看懂）

控制台没有「谁调的」；本机明细要靠标签。建议字段 `source` / `lane`：

| 推断线索（options / 调用栈 / 约定） | `source` 建议值 |
|---|---|
| Agent loop 主会话（`options.sessionId` 且带 agent 标记） | `dsh_chat` |
| knowledge 抽取（system prompt 含 knowledge / extraction，或 options 自定义 `meterTag`） | `dsh_knowledge` |
| mneme dream / summarize | `dsh_memory` |
| session title | `dsh_title` |
| 其它 | `dsh_other` |

**推荐约定（给业务插件的可选增强）**：调用方在 `options` 上带非协议字段（若 adapter 会剥掉，改用 AsyncLocalStorage / ctx.state）：

```js
// knowledge extraction.js 里（可选，meter 不依赖也能跑）
ctx.llm.stream({
  ...,
  // 若 GenerateOptions 不允许多余字段，改用 ctx.set('llmMeterTag', 'dsh_knowledge')
})
```

独立 meter **不得**强依赖业务包改代码才能工作；启发式 + 可选显式标签即可。

启发式示例：

```js
function classifyCall(options) {
  const sys = String(options?.system || '')
  const sid = String(options?.sessionId || '')
  if (/knowledge base|document-oriented knowledge|Extract only knowledge/i.test(sys)) {
    return { source: 'dsh_knowledge', sessionId: sid }
  }
  if (/mneme|dream|consolidat|summarize_compress/i.test(sys)) {
    return { source: 'dsh_memory', sessionId: sid }
  }
  if (/会话标题|session title|title/i.test(sys) && sys.length < 2000) {
    return { source: 'dsh_title', sessionId: sid }
  }
  return { source: sid ? 'dsh_chat' : 'dsh_other', sessionId: sid }
}
```

---

## 5. 落盘契约（WorkBuddy 将按此 ingest）

### 5.1 路径

- 默认：`$DSH_HOME/llm-meter/events.jsonl`（即 `~/.dsh/llm-meter/events.jsonl`）  
- 一行一条 JSON，UTF-8，追加写；用 `fs.appendFile` + 进程内串行队列，避免交错半行。

### 5.2 单行 schema（稳定字段，勿随意改名）

```json
{
  "v": 1,
  "id": "meter_20260917120000_a1b2c3",
  "ts": "2026-09-17T12:00:00.123+08:00",
  "source": "dsh_knowledge",
  "provider": "deepseek-official",
  "model": "deepseek-v4-flash",
  "session_id": "session-…",
  "ok": true,
  "finish": "stop",
  "error": "",
  "quality": "provider",
  "prompt_tokens": 1826,
  "completion_tokens": 361,
  "cache_read_tokens": 19840,
  "cache_write_tokens": 0,
  "reasoning_tokens": 70,
  "total_tokens": 22097,
  "duration_ms": 1520,
  "prompt_chars": 0
}
```

| 字段 | 说明 |
|---|---|
| `v` | schema 版本，现为 `1` |
| `id` | 全局唯一；WorkBuddy 用它做幂等 |
| `ts` | ISO8601，建议带 `+08:00` |
| `source` | §4 标签 |
| `quality` | `provider`（有 usage）/ `missing`（无 usage） |
| `total_tokens` | 按 §1 公式；有分项时不要另发明算法 |
| `prompt_tokens` | 对应 **uncached input**（`inputTokens`） |

轮转：超过 `maxFileBytes` 时 rename 为 `events.jsonl.<utc>` 再新建；**不要删除**近期文件（WorkBuddy 可能还没采）。

### 5.3 幂等

- 同一 stream 只 append **一次**（在 iterator 正常结束或 catch 时）。  
- `id` 用 `meter_` + 时间 + 随机；不要用「session+turn+step」当唯一键（旁路调用没有 turn/step）。

---

## 6. 可选增强（第二优先级）

### 6.1 修 mneme 审计 token

路径（插件仓内，若你们维护 fork）：`dsh-mneme` 的 `summarize.js` / `dream.js` 读 `chunk.usage.*`。  
修好后 WorkBuddy 现有 `ingest_dsh_side` 可直接吃到真值；与 meter **可并存**（注意去重：WorkBuddy ingest 应以 meter `id` 为主，memory 审计为辅，或按时间窗口去重——本仓接线时处理）。

### 6.2 knowledge 显式打标

在 `callExtractionModel` 前后设置 meter tag，便于明细里一眼区分抽取与聊天。

### 6.3 不要做

- 不要再做一个「只读 session 的 usage UI」冒充对账。  
- 不要在计量插件里发 HTTP 到 DeepSeek 控制台。  
- 不要把 Key 写进 jsonl。

---

## 7. 本地开发与验收

### 7.1 开发

```bash
# 在插件仓
npm pack   # 或 link 到 ~/.dsh/profiles/web
dsh plugin --profile web add <tgz或npm名>
# 重启
scripts/host.sh restart-web   # 若用 WorkBuddy 宿主脚本
```

确认 profile `cordis.patch` 出现 `id: llm-meter` 且无 `disabled: true` 全名误伤。

### 7.2 功能验收（对照缺口）

1. **主聊天**发一轮带工具的对话 → `events.jsonl` 增加多行，`source=dsh_chat`，`total_tokens>0`，`cache_read_tokens` 常非 0。  
2. **打开 knowledge 抽取/回写**（或完成一轮会触发 extraction 的对话）→ 出现 `source=dsh_knowledge`（或 `dsh_other` 但次数增加）。  
3. **等待 memory dream/summarize** → 有 `dsh_memory` 或等价行，且 **token 不再全 0**。  
4. 故意断网 / 无效模型 → 有 `ok:false` 行，**聊天错误行为与未装插件时一致**。  
5. 连续跑一天后：本机 `llm-meter` 行数 + 引擎账本（PCB/审码）与官网差额应 **缩小**（不要求抹平）。

### 7.3 回归

- 卸载插件后聊天/知识库/记忆行为正常。  
- 磁盘：故意把 events 路径设为无写权限 → 仅 warn，不炸 stream。

---

## 8. 交给 WorkBuddy 本仓的接口（约定）

**本仓已接线（2026-09-17）**：

1. `engine/app/usage/ingest_llm_meter.py`：增量读 `~/.dsh/llm-meter/events.jsonl*`，`job_id = meter id` 幂等。  
2. `summarize`：若 meter 文件非空 → 采 meter，并**跳过** session / memory / title 补采（防双计）；引擎直连流水仍照常。  
3. 用量页文案：**本机观测**；控制台录入改为可选「参考数字」，不对账。  
4. 返回字段 `llm_meter_active`：前端提示是否已吃到 meter。

插件发版并本机出现 `events.jsonl` 后，重启引擎即可；无需再改本仓契约（保持 §5 schema `v:1`）。

---

## 9. 交付检查清单（插件仓 PR）

- [ ] 包名 / Cordis `id: llm-meter` / patch 可装  
- [ ] waterfall 不改写请求、不因记账失败打断业务  
- [ ] usage 从 `chunk.usage` 正确解析；分项 + total 公式正确  
- [ ] 落盘路径默认 `dshHomePath('llm-meter/events.jsonl')`，schema `v:1`  
- [ ] 无 Key / 无 prompt 正文进日志与 jsonl  
- [ ] 主聊天 + knowledge 抽取（或模拟 stream）+ 无 usage 失败路径均有验收记录  
- [ ] README 写明：本机观测 ≠ DeepSeek 控制台账单  

---

## 10. 参考（只读）

| 材料 | 用途 |
|---|---|
| 本机 `~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-llm` | `TokenUsage`、`llm/stream` 声明 |
| `@zhongruan/dsh-knowledge/lib/extraction.js` → `callExtractionModel` | 旁路调用样板（漏记根因） |
| `@modusensus/dsh-mneme/lib/summarize.js` | 审计 token=0 根因 |
| WorkBuddy `apps/zr-workbuddy/engine/app/usage/parse.py` → `from_sdk_usage` | total 公式对齐 |
| [插件中心使用说明.md](../宿主与运维排障/插件中心使用说明.md) | 公司市场发版 |

---

**一句话**：在插件仓做 `@zhongruan/dsh-llm-meter`，挂 `llm/stream`，按 §5 落 jsonl；验收看「旁路有真 token、缺口缩小」，不看「等于官网」。
