# 按 Key 统计 token 并限额：可行性实施方案

> **状态**：方案可实施（2026-10-23）  
> **落点**：插件 `@zhongruan/dsh-key-quota`，目录 `plugins/dsh-key-quota/`  
> **对照**：现有 `@zhongruan/dsh-llm-meter` 的 token 分项与合计口径（`.cursor/rules/llm-meter-locked.mdc`、`plugins/dsh-llm-meter/src/usage.ts`）。本插件复制同一公式，不改旧插件、不改 WorkBuddy 用量页。  
> **交付**：公司插件市场安装。开发机联调可用本地 link，对用户说「去插件市场安装」。

本文取代 2026-10-22 的「管理员电脑当额度服务」方案。2026-10-23 起，管理页认工作助手当前登录：admin 看到 Key 管理，同事只看分给自己的一行。2026-10-25 起，DeepSeek 官方路线按当前平台账号取分给它的那把 Key；系统配置里的 Key 可以留空。Key 原文只加密留在本机，页面只显示尾号。

产品一句话：领导用平台账号 admin 登录。他有一个 DeepSeek 账号，下面多把 Key 分给同事。admin 在 Key 管理里指定哪位同事用哪把 Key，看各 Key 用量并设上限。同事用自己的平台账号登录，只用分给他的那把 Key，也只看自己的用量。到达上限后，工作助手里的下一次模型调用直接拒绝。

---

## 0. 本方案做 / 不做

| 做 | 不做 |
| --- | --- |
| 应用认人用现有平台账号（admin / 同事）。不另做一套登录 | 用 DeepSeek 账号登录代替平台登录；用某一台电脑或上报令牌认人 |
| admin 的 Key 管理：添加 Key、指定给哪位同事、看用量、设上限 | 同事自己填 Key、自己填额度地址、自己任命管理员 |
| 用量和上限记在平台上，用平台用户对上 Key | 把某一台电脑上的 `state.json` 当全公司权威账本 |
| 统计并拦截走宿主 `llm/stream` 的调用（主聊天、知识库抽取、记忆、会话标题） | 改 `dsh-llm-meter` 的公式、schema、`events.jsonl`、waterfall |
| 合计口径与现有用量计量一致，限额只比这个合计 | 把 `reasoning` 加进合计；另做一套「更接近官网」的算法 |

已知边界（写进管理页说明）：

1. 同事拿这把 Key 去别的软件、脚本、网页里调用，本插件看不到，也停不掉。DeepSeek 没有「给单把 Key 设硬上限」的公开接口，账号余额仍是多把 Key 共用。
2. 工作助手里不走 `llm/stream` 的调用照样记不到、拦不住。现网已核实的旁路：自动化任务直连 `chat/completions`、引擎直连的 PCB / 审码。本方案 v1 不碰这两处。
3. 用量以工作助手里实际发出的调用为准，按分给该同事的 Key 累加。不从 DeepSeek 控制台反查账单。

---

## 1. 硬约束

| # | 约束 | 做法 |
| --- | --- | --- |
| 1 | 计量口径冻结 | 不改 `plugins/dsh-llm-meter/**`、不改规则文件。新插件自带一份 `pickUsage`，注释指向冻结日，测试向量与 `plugins/dsh-llm-meter/test/usage.test.mjs` 对齐 |
| 2 | 认人只认平台账号 | 当前登录用户来自工作助手已有登录。admin 看全部并改分配和上限；其它账号只看自己被分配的那一把 |
| 3 | Key 由 admin 配置 | Key 在 Key 管理里添加并指定给同事的平台账号。同事不再到「系统配置」另填一把作为限额身份 |
| 4 | 权威数据在平台 | Key、分配、本月已用、上限存在平台。换一台电脑，用同一个平台账号登录，看到的是同一份 |
| 5 | 零改其它插件的账 | 不改引擎用量页、不改 meter jsonl 路径。Cordis id 仍是 `key-quota` |
| 6 | 市场可装 | `dsh.bundle` + `dshMarket.zh/en`。发版走 `pack.sh dsh-key-quota` → `upload.sh` |
| 7 | 控制信号只认字段 | 拒绝原因只认 `error.code`：`quota_exceeded` / `key_blocked` / `key_unassigned`。禁止用正文匹配「超额」「用完」 |
| 8 | 记账失败不改写已成功的调用 | 模型已经返回之后，记账失败只进待补队列，不把成功对话打成失败 |
| 9 | 界面和日志不出现完整 Key | 列表、日志、普通读取接口只给尾号。Key 原文只在「admin 保存」和「该同事本次调用领取」两处出现 |

---

## 2. 人和 Key 怎么对上

两件事先分开：

- 平台账号决定人。领导是 admin，同事是 Hebo 这样的平台用户。谁能看全部、谁能改上限，看这个登录的角色。
- Key 决定账单上的哪一把。admin 在 DeepSeek 账号下建好 Key，再在 Key 管理里配进来，并指定给一个平台账号。

对应关系是 admin 亲手写的。DeepSeek 不会返回「这把 Key 是 Hebo」。不需要同事上报到某一台电脑，也不需要把地址和令牌发给同事。

```text
admin 登录
  Key 管理
    Key 尾号 e761  →  同事 Hebo  →  本月已用  →  上限
    Key 尾号 ab12  →  同事 张三  →  本月已用  →  上限

Hebo 登录
  对话使用分给他的那把 Key
  用量页只有自己这一行
```

一把 Key 同一时间只分给一个平台账号。一个平台账号 v1 只领一把 Key。改分配后，新的调用走新 Key；旧 Key 上已记下的用量留在旧行。

---

## 3. 目标体验

### 3.1 admin

1. 用平台账号 admin 登录工作助手。
2. 用量页有三个分类：个人用量、企业用量、Key 管理。后两个只有 admin 能看到。Key 管理里列出尾号、分给谁、本月已用、上限。
3. 添加一把 Key，选择同事的平台账号，上限可空（不限）。保存后列表不再显示 Key 原文，只留尾号。
4. 同事一通过工作助手调用，对应行的本月已用增加。
5. 已用达到上限后，该同事的下一次对话不再请求 DeepSeek，界面给出 `quota_exceeded` 和已用/上限。admin 把上限调大或等下月，即可恢复。
6. 可以把这把 Key 改分给另一位同事、从列表删除，或停用。停用后下一次调用拒绝，code 为 `key_blocked`。

### 3.2 同事

1. 用自己的平台账号登录。不登录 DeepSeek，不填写额度地址。
2. 用量页只有个人用量。没有企业用量，没有 Key 管理。
3. 对话使用这把 Key。尚未分配时，这次调用不发出，code 为 `key_unassigned`，文案请管理员在 Key 管理里分配。

### 3.3 空态

- 还没有任何 Key：admin 看到空列表和添加入口。同事看到未分配。
- 平台暂时不可达：已经分配了 Key 的同事，本次调用拒绝，文案写明限额服务不可达，不是模型故障。不提供「服务挂了也放行」的开关。

---

## 4. 架构

```text
admin / 同事
  工作助手平台登录（现有账号）
        │
        ▼
  dsh-key-quota
        │  按当前平台用户问平台：分到哪把 Key、已用、上限
        │  未分配或已超额：不调用 next()
        │  允许：用分到的 Key 走 llm/stream
        │  从 usage chunk 取分项（与 meter 同一公式）
        │  调用后把 total 记到这把 Key 的本月
        ▼
  平台账本
    keys：尾号、密文、分给哪个平台用户、上限、停用、按月已用
```

`llm-meter` 继续照旧记本机 `events.jsonl`。两个插件都挂 `llm/stream` 时：

- 未超额：两边都看得到同一次流。meter 记来源明细，本插件按 Key 累加。两边合计应一致（同一 `pickUsage`）。
- 已超额：本插件不调用 `next()`，请求不会发到 DeepSeek。

Cordis id：`key-quota`。不要用 `llm-meter`。

平台账本是权威。插件本地可以留待补队列，队列里的数字不能当 admin 看到的已用。

---

## 5. Token 口径（照抄冻结规则）

限额比较的数只有一个：`total`。

| 项 | 规则 |
| --- | --- |
| 未命中输入 `input` | `inputTokens` / `input_tokens` / `prompt_tokens` |
| 缓存命中 `cacheRead` | 与 input **分列**，不并进 input |
| 缓存写入 `cacheWrite` | 单独一列 |
| 输出 `output` | 只认 completion / `outputTokens` |
| `reasoning` | **只明细**。不加进 `total`，也不算进「输出」 |
| `total` | 有供应商 `totalTokens` / `total_tokens` 用原样；否则 `input + output + cacheRead + cacheWrite` |
| 全 0 | 视为这次没有用量，`total` 不加，调用本身仍算成功 |

只认 `chunk.type === 'usage'`，数值读 `chunk.usage`。禁止扫正文估 token。

自然月 = **Asia/Shanghai**。用「UTC 时间戳 + 8 小时」取年月，禁止用 UTC 的 `YYYY-MM` 把凌晨 8 点前算到上一月。与 meter 的 `formatTsShanghai` 同一偏移。

验收向量（必须有单测，期望值与 meter 测试相同）：

| 输入 | total |
| --- | --- |
| input 1826，output 361，cacheRead 19840，reasoning 70 | `22027`（不含 70） |
| input 10，output 2，totalTokens 99，reasoning 5 | `99`，reasoning 仍为 5 |
| 仅 cacheRead 128 | `128` |
| 非 usage chunk，或全 0 | 不加 |

---

## 6. Key 身份

界面和账本主键用 Key 的哈希，不把原文当主键展示。

```text
keyId = hex(sha256(trim(api_key)))
tail  = api_key 最后 4 位
```

- 一行 Key 有 `assigneeUserId`（平台用户 id）、`limitTokens`（`null` 表示不限）、`blocked`、按月 `used`。
- admin 列表显示尾号、同事显示名、已用、上限。
- 同事接口只返回 `assigneeUserId` 等于自己的那一行。
- `options.provider` 有值且不是 deepseek：放行、不计数、不限额。
- provider 为空或 deepseek：走当前用户被分配的那把 Key。

---

## 7. 限额怎么判

状态机只认这些字段：是否已分配、`blocked`、`limitTokens`、`used`、`period`。

```text
usedNow = 平台本月 used + 本机尚未确认的 pending 合计

当前用户没有分配               → 拒绝  key_unassigned
平台不可达，且没有上一份快照   → 拒绝  quota_unreachable
blocked == true               → 拒绝  key_blocked
limitTokens == null           → 放行
usedNow >= limitTokens        → 拒绝  quota_exceeded
否则                          → 放行，然后才 next()
```

已经放行的这一次，允许把 `used` 打到上限以上（例如还剩 100，这次实际用了 800）。**下一次**再拒绝。调用前不知道最终 token，禁止用字符数估算去提前卡死正常对话。

并发：同一把 Key 两路同时通过检查时，可能各超一点。v1 接受这个窗口，不在调用前预扣一个拍脑袋的 token 数。

记账：

- 客户端在调用前生成 `callId`。平台按 `callId` 幂等，重复上报不双计。
- 记账失败：追加到本机待补队列，下次检查或定时重试时再送。成功对话的界面状态不变。
- 平台确认已入账的 `callId` 从待补队列删掉。
- 没有 usage 块：仍记 `total=0`、`quality=missing`，`used` 不变。

`limitTokens=0` 表示本月禁止调用，code 用 `quota_exceeded`。停用只用 `key_blocked`。

平台不可达但本机有上一份快照时：用快照里的 `used+pending` 和 `limitTokens` 本地判。已超额照样拒绝。快照里不限，则放行，调用记入待补，恢复后补记。

---

## 8. 谁能看、谁能改

调用方是谁，只认当前平台登录。不认 Key 自报的身份，不认局域网地址。

| 动作 | 谁可以 | 别人会得到 |
| --- | --- | --- |
| 看自己的尾号、已用、上限 | 被分配到这把 Key 的平台用户 | 没有分配：`key_unassigned`，响应里没有别人的 Key |
| 看全部 Key、同事、用量 | 平台角色为 admin 的账号 | 非 admin：不返回列表 |
| 添加 Key、改分配、改上限、停用 | 仅 admin | 非 admin 的写请求拒绝，账本不变 |
| 领取自己的 Key 原文用于本次调用 | 仅被分配的那个平台用户 | 别人的用户 id 领不到 |

错误体：

```json
{ "ok": false, "error": { "code": "quota_exceeded", "message": "本月 token 已用完：已用 1000000，上限 1000000。" } }
```

`error.code` 只用这些：`quota_exceeded`、`quota_unreachable`、`key_blocked`、`key_unassigned`、`not_admin`、`not_found`。

流内拒绝不发 HTTP 给模型，向 `llm/stream` 写入宿主已有的结束块：

```json
{
  "type": "finish",
  "reason": {
    "kind": "error",
    "failure": {
      "code": "quota_exceeded",
      "message": "本月 token 已用完：已用 1000000，上限 1000000。请联系管理员提高上限。"
    }
  }
}
```

开工时对照本机已安装的 `@deepseek-ai/dsh-llm` 的 `StreamChunk`。若结束块字段名不同，改成宿主类型里真实的 error/finish。

---

## 9. 平台上的记录

权威记录在平台，不在某一台电脑的 `key-quota/state.json`。本地只保留待补队列和上一份快照。

一条 Key 至少包括：

| 字段 | 含义 |
| --- | --- |
| `keyId` | sha256，列表和日志用它 |
| `tail` | 最后 4 位 |
| `secret` | Key 原文。只给 admin 写入，和 assignee 本次调用领取 |
| `assigneeUserId` | 平台用户 id。空表示尚未分给同事 |
| `assigneeName` | 当时的显示名，便于列表展示 |
| `blocked` | 停用 |
| `limitTokens` | `null` 不限；`0` 本月禁止 |
| `months[YYYY-MM].used` | 上海时区自然月合计 |

调用流水按 `callId` 幂等。超出体量后按日轮转，不删当月。

---

## 10. 插件侧

| 文件 | 职责 |
| --- | --- |
| `src/client.js` | admin：Key 管理（添加、分配、用量、上限、停用）。同事：只有自己一行 |
| `src/index.ts` | 挂 `llm/stream`：按当前平台用户检查、放行或拒绝、记账 |
| `src/usage.ts` | `pickUsage`，口径见 §5 |
| `src/decide.ts` | §7 纯函数，无 IO |
| `src/key-id.ts` | sha256 与尾号 |
| `test/usage.test.mjs` | §5 向量 |
| `test/decide.test.mjs` | 未分配、不限、超额、停用、不可达、pending 叠加、最后一次允许超支 |
| `test/access.test.mjs` | 同事读不到别人；非 admin 不能改分配和上限 |

面板按平台角色画：

- admin：Key 管理全表。
- 其它账号：自己那一行。没有添加入口。

对话工具不做。限额不是让模型自己去调的。

旧方案里的 `role=server`、`quotaBaseUrl`、`reportToken`、本机回环任命，不再作为产品配置。同事安装插件后，用自己的平台账号即可。

---

## 11. 实施顺序与验收

本文先定方案。代码仍是旧的本机额度服务，按下面顺序改。

### P0 平台账本和拦截

1. `pickUsage`、`decide` 单测先对齐新状态（未分配、按平台用户隔离），再改调用链。
2. admin 能添加 Key、指定平台用户、写入上限。列表接口不返回 Key 原文。
3. 同事登录后的 `llm/stream` 使用分给他的 Key。
4. 验收：
   - 上限很大时，正常聊天，该 Key 本月 `used` 增加，且等于这次 usage 的 `total`（含缓存、不含 reasoning）。
   - 把上限改到小于已用，下一条对话不产生新的 DeepSeek 用量，失败 code 为 `quota_exceeded`。
   - 未分配的同事下一条对话不发出，code 为 `key_unassigned`。
   - 同一 `callId` 记账两次，`used` 只加一次。
   - 列表和日志里搜不到完整 Key。
   - 同事请求全量列表被拒绝，响应里没有其它 Key。
   - 换一台电脑用同一 admin 登录，看到同一份分配和用量。
   - `dsh-llm-meter` 的测试原样通过，其 `usage.ts` 无 diff。

### P1 界面

- admin 的 Key 管理能完成 §3.1。
- 同事的用量页只有自己一行，与 §3.2 一致。
- 未分配、超额、平台不可达三种文案与 §3.3、§7 一致。

### P2 上架

`pack.sh dsh-key-quota` → `upload.sh` → 市场清单里能看到新包。同事从「设置 → 插件市场 → 发现」安装。装完完全退出工作助手再开。

本方案不包含：代理转发、控制台 CSV 对账、自动化任务旁路、PCB/审码旁路。要堵「拿 Key 去别的软件用」，才需要代理，那是另一个项目。

---

## 12. 自检

- [ ] 人只认平台登录，Key 只由 admin 分配
- [ ] 拒绝只依赖 `error.code` / `blocked` / `limitTokens` / 是否已分配，不扫对话正文
- [ ] 成功返回的对话不会因为记账失败被改成失败
- [ ] 超额和未分配路径不会调用 `next()`，因此不会打到 DeepSeek
- [ ] 同事的响应里没有其它 Key，也没有 Key 原文
- [ ] 同一平台账号换电脑看到同一份用量和上限
- [ ] 合计与 meter 测试向量一致，reasoning 不进 `total`
- [ ] 未改 `dsh-llm-meter` 与 WorkBuddy 用量页
