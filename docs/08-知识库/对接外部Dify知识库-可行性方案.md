# 对接外部 Dify 知识库：可行性方案

> **状态**：待确认（2026-11-09）。按文末默认项回复「按方案做」即可开工。  
> **落点**：现有插件 `@zhongruan/dsh-knowledge`（目录 `plugins/dsh-knowledge/`）。不新建插件，不改 WorkBuddy 引擎。  
> **产品一句话**：创建一个知识库并勾选「对接外部知识库」后，填写已部署 Dify 的服务地址、知识库 ID 和 API Key；这个库挂到会话并打开召回时，回答前直接检索 Dify 里现有的知识库。

---

## 0. 这是什么

| 是 | 边界 |
| --- | --- |
| 知识库插件在召回时调用 Dify 官方检索接口 | 不把 Dify 文档导入本机 SQLite，知识库页面不列出 Dify 原文 |
| 每个知识库各自指向一个 Dify dataset | 不在插件 `config.json`、不在「推送配置」里做全局账本 |
| 只读检索。命中片段进入本轮自动召回和 `knowledge_search` | 不向 Dify 写入，不把对话回写进外部库 |
| 本机库照旧走 SQLite 全文检索 | 未勾选外部对接的库行为不变 |
| 密钥加密存在知识库所在的那台机器上，接口不回显 | 不把 API Key 写进系统提示、工具结果或日志 |

和现有能力的关系：

| 现有能力 | 本方案 |
| --- | --- |
| 创建知识库表单里的「访问地址 / 帐号 / 密码」 | 字段还在这一页，但改成 Dify 要的三项。今天只落库，召回不会发请求 |
| 本机条目的全文检索（`local-provider.search`） | 仍只查 SQLite。外部库在同一次搜索里另走 HTTP，再和本机命中一起排序 |
| 插件「远程知识库」：另一台 DSH 的 `/knowledge-api/v1` + 客户端令牌 | 不动。那是 DSH 连 DSH。Dify 是某一条知识库记录上的上游 |
| `@zhongruan/dsh-esc` 的 `zr_esc_dify_search` | 不动。那是专家技能点名后才调用的工具。知识库召回不依赖它，也不取代它 |
| 公司共享库旁路（仅管理员） | 不动。外部 Dify 命中与公司库摘录按现有合并方式并列 |

今天填了 Dify 地址也不会通：`external_url`、`external_username`、`external_password` 只做校验和加密保存。`readExternalPassword` 没有任何调用方。`search` 只查 `knowledge_entries`。帐号密码也不是 Dify 的 Dataset API Key。

---

## 1. 硬约束

| # | 约束 | 做法 |
| --- | --- | --- |
| 1 | 只认 Dify 检索契约 | 唯一出站请求是 `POST {地址}/datasets/{知识库ID}/retrieve`，头为 `Authorization: Bearer {API Key}`。不用控制台登录，不扫网页 |
| 2 | 失败不编造 | HTTP 失败、超时、JSON 不合约定、片段没有正文：该库本轮 0 条。其它已挂载库继续检索 |
| 3 | 外部库不可写 | 导入、新建条目、审核写入、直接写入、抽取回写遇到外部库一律拒绝。挂载写入方式固定为「仅召回」 |
| 4 | 密钥不出界面 | 列表和详情只返回「已配置」。解密只发生在即将发检索请求时 |
| 5 | 本机库不被误伤 | 未填写外部字段的库仍走全文检索。已 `succeeded` 的业务状态与本方案无关，不改其它插件 |
| 6 | 旧数据不当成 Dify | 已保存的帐号/密码没有「这是 Dify」标记，禁止拿去当 Bearer。必须重新保存成知识库 ID + API Key 才检索 |
| 7 | 配置不进插件账本 | 不写插件 `config.json`，不在自动化「推送配置」加 Dify。WorkBuddy 系统配置没有按库区分的 dataset 字段，密钥跟知识库行走，用现有 `secret-box` 加密 |
| 8 | 交付走插件市场 | 实施时升 `plugins/dsh-knowledge` 版本再 pack / upload。不默认覆盖本机 profile |

---

## 2. 用户怎么配

创建或编辑知识库时，勾选「对接外部知识库」后填写：

| 界面 | 存什么 | 规则 |
| --- | --- | --- |
| 访问地址 | `external_url` | Dify **服务 API 根路径**，必须以 `/v1` 结尾。自建示例：`https://dify.公司域名/v1`。这不是控制台页面，也不是已经拼好的 `/datasets/.../retrieve` |
| 知识库 ID | `external_dataset_id` | Dify 里该知识库的 `dataset_id`。只允许字母、数字、`-`，长度 1–64 |
| API Key | `external_api_key`（密文） | Dify 知识库的 Dataset API Key。密码框，不回显。编辑时留空表示沿用已保存的密钥 |

说明文案改为：填写 Dify 服务 API 根路径、知识库 ID 和 Dataset API Key。密钥只存在本机，不会回显，也不会进入对话。

取消勾选时清空这三项，之后该库只查本机条目。

地址校验沿用现有规则，并加两条：

- 协议只允许 `http` / `https`。地址里不能带帐号密码，不能带 `#` 片段。
- 公网主机必须 `https`。`http` 只放行本机（`localhost`、`127.0.0.1`、`::1`）和内网地址（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`）。自建 Dify 经常没有公网证书。
- 路径必须是 `/v1`。用户若粘贴了 `/datasets/` 或 `/retrieve`，保存失败并提示改填 API 根路径。

卡片上仍显示「外部」标记，并显示知识库 ID。不显示密钥。

编辑页提供「测通」：用当前表单（留空密钥时用已保存密钥）发一次检索，问句固定为 `连通性探测`。成功只提示 HTTP 成功以及返回片段条数。失败提示状态码和截断后的错误正文（最多 180 字）。测通结果不入库。

---

## 3. 检索请求

仅当该库 `external_kind = dify`，且地址、知识库 ID、密钥三者齐全，才发请求。

```http
POST {external_url}/datasets/{external_dataset_id}/retrieve
Authorization: Bearer {apiKey}
Content-Type: application/json
Accept: application/json
```

```json
{
  "query": "用户本轮要查的原文",
  "retrieval_model": {
    "search_method": "semantic_search",
    "reranking_enable": false,
    "top_k": 4
  }
}
```

| 项 | 定法 |
| --- | --- |
| 问句 | 调用方传入的检索文本，去掉首尾空白，最长 2000 字。空问句不请求 |
| `top_k` | 等于本次该库的 `limit`，钳在 1–10。自动召回现有上限是 20 条候选，单个外部库最多拿 10 段 |
| 超时 | 10 秒，并接上本轮 `AbortSignal`。用户停掉这一轮时请求一起取消 |
| 重试 | 不做。失败即该库 0 条 |
| 重定向 | 只跟随跳回同一主机的重定向。跳到别的主机视为失败 |

只认 JSON 对象里的 `records` 数组。每一条要同时满足：

- `segment.content` 是非空字符串
- `segment.id` 是非空字符串
- `score` 是有限数字

标题用 `segment.document.name`，没有则用「Dify 片段」。正文用 `segment.content`，最长保留 4000 字。`score` 钳到 `[0, 1]`（大于 1 记为 1，小于 0 记为 0）。缺字段或类型不对的记录丢掉，不补分数、不补正文。

这些命中不写入 `knowledge_entries`。它们只存在于这一次搜索的返回值里，形状与本机命中相同，便于现有排序和展示：

| 字段 | 取值 |
| --- | --- |
| `id` | `difyseg:` 加上片段 id 中的字母数字。同一片段在本轮去重 |
| `knowledgeBaseId` | 本机这条知识库的 id |
| `title` | 文档名 |
| `body` | 片段正文 |
| `type` | `fact` |
| `tags` | `[]`。外部库忽略挂载上的包含/排除标签，标签筛不作用于 Dify |
| `scope` | `{ kind: 'global' }` |
| `confidence` | 钳制后的 `score` |
| `status` | `active` |
| `documentState` | `open` |
| `version` | `1` |

自动召回的最低分仍是现有 `autoRecallMinScore`（默认 `0.2`）。Dify 分数低于这个值的片段不会注入本轮，避免为了外部库放宽本机库的门槛。

---

## 4. 接在哪一次搜索上

检索发生在**持有 SQLite 的那一侧**的 `local-provider.search`，不发生在浏览器里。

原因：远程模式下，客户端只把搜索转给中央知识库。API Key 不能下发给客户端。中央机器解密并发起 `retrieve`，再把片段当搜索结果返回。本机模式没有中央机器，同一段代码在本进程执行。

一次 `search` 的库 id 分成两组：

1. 普通库：保持现在的全文检索 SQL。
2. `external_kind = dify` 的库：每个库单独请求。一个库失败只丢掉该库，并 `logger.warn` 状态码。日志里不写密钥，不写 `Authorization` 头。

两组结果按现有规则排序：`score` 降序，再按 `updatedAt`。外部片段的 `updatedAt` 用本次检索时间，只参与并列时的次序。

自动召回（`agent/pre-step` → `searchMountedKnowledge`）和工具 `knowledge_search` 都走 `provider.search`，因此都会带上外部命中，不必再在召回层写第二套 HTTP。

`knowledge_read` 仍只打开本机条目。外部命中的展示里不给 handle，并写明正文已在片段中，不要调用 `knowledge_read`。有人硬拿一个 `difyseg:` id 去读时，按现有逻辑返回「条目不可用」，不发第二次 Dify 请求。

系统提示里的挂载目录继续只放库名和描述，不放片段正文，也不放密钥。外部库的描述行追加「外部 Dify，仅召回」。

---

## 5. 写入怎么封住

外部库是检索入口，不是本机文档库。

| 动作 | 结果 |
| --- | --- |
| 导入文件、新建条目、更新条目，目标库是外部库 | HTTP 400，不写 SQLite |
| 挂载时写入方式不是 `none` | 保存改为拒绝；编辑界面上写入方式固定为「仅召回」并不可改 |
| 抽取回写挑选目标库 | 跳过 `external_kind = dify` 的库。本机库仍按原策略 |
| 取消勾选外部对接 | 清空外部字段。库变回普通库，之后可以按原规则写入 |

已有挂载若写成了「审核写入」，实施迁移时不改用户别的字段；下一次保存挂载时按上表拒绝。在此之前回写挑选必须已经跳过该库，避免抽取任务往外部库塞条目。

---

## 6. 库表

在 `knowledge_bases` 上追加列（新的 migration，版本在现有 `user_version` 之后）：

| 列 | 含义 |
| --- | --- |
| `external_kind` | 空字符串或 `dify`。只有 `dify` 才发检索 |
| `external_dataset_id` | 知识库 ID。默认空字符串 |
| `external_api_key` | API Key 密文，可空。算法沿用 `secret-box`（`enc:v1:`） |

保留现有 `external_url`。不再写入 `external_username` 和 `external_password`。这两列留在表里，避免 SQLite 删列。读取时忽略它们，列表接口不返回旧密码。

列表和详情对外只给：

- `externalKind`
- `externalUrl`
- `externalDatasetId`
- `externalApiKeyConfigured`（布尔）

管理接口的创建/更新草稿接受 `externalApiKey`。响应里去掉这个字段。

---

## 7. 要改的代码

都在 `plugins/dsh-knowledge/`。

| 位置 | 改动 |
| --- | --- |
| `lib/storage/migrations.js` | 加上表三列 |
| `lib/domain.js`、`lib/domain.d.ts` | 草稿校验：`/v1`、知识库 ID、密钥长度；公网禁止 `http` |
| `lib/secret-box.js` | 继续加密，不改算法 |
| `lib/local-provider.js` | 保存/读取新字段；`search` 对 Dify 库走检索；写入类方法拒绝外部库 |
| 新建 `lib/dify-retrieve.js` | 组 URL、发 POST、解析 `records`、把错误收成「该库 0 条」 |
| `lib/api.js` | 草稿解析；对外 DTO 不带密钥；增加测通路由 |
| `lib/retrieval.js` | 外部命中的展示不带 `knowledge_read` handle |
| 回写挑选知识库处 | 跳过外部库 |
| `web/app.js` | 表单改为地址、知识库 ID、API Key；卡片展示；测通 |
| 测试 | 见第 9 节 |

不改 `plugins/dsh-esc/`。不改 WorkBuddy `config.yaml` 的结构。

---

## 8. 和专家连接器怎么并存

`dsh-esc` 里已有同形请求：`POST {baseUrl}/datasets/{datasetId}/retrieve`，Bearer API Key。它挂在连接器工具 `zr_esc_dify_search` 上，要等模型按技能去调，而且面板上目前只收集知识库 ID，地址和密钥没有输入框。

知识库插件这条路是「库挂上了就在回答前检索」。两处可以指向同一个 Dify 知识库，互不调用。本方案不合并、不关闭连接器。若两个都开，同一轮可能各查一次。这是可接受的重复，避免为了对接 Dify 去改专家插件的启用条件。

---

## 9. 验收

实现时用假的 HTTP 服务覆盖下面几条，不依赖一台真 Dify 才能合并代码。真环境再手工走第 7 条。

1. 保存合法的 `https://dify.example.com/v1`、知识库 ID、API Key 后，再次打开编辑页：地址和 ID 还在，密钥框为空且提示已保存。GET 知识库的 JSON 不含密钥明文。
2. 公网 `http://`、地址里带 `user:pass@`、路径不是 `/v1`、知识库 ID 含空格：保存失败。`http://10.0.0.8/v1` 与 `http://127.0.0.1/v1` 可以保存。
3. 挂载该库并打开召回。`search` 对假的 Dify 发出文档中的 POST，头为 Bearer，路径含知识库 ID。`records` 里合法片段出现在结果中，且没有写入 `knowledge_entries`。
4. 假的 Dify 返回 401、超时或没有 `segment.content`：该库 0 条；同一次搜索里的本机库命中仍然返回。
5. 只填了旧版帐号密码、没有 `external_kind=dify` 的行：`search` 不发 HTTP。
6. 向外部库导入或新建条目被拒绝。回写候选不含该库。挂载写入方式不能改成审核或直接写入。
7. 手工：用已部署 Dify 的真实 API 根路径、dataset id、Dataset API Key 测通，能看到片段条数大于 0；在挂载了该库的会话里提问，回答前的召回里出现片段正文。知识库条目列表仍为空（或只有本机自己建的条目）。

---

## 10. 这版不做

- 不把 Dify 文档同步进本机，不在知识库页浏览、编辑 Dify 原文。
- 不调用 Dify 的上传、删除、分段列表接口。
- 不支持一个知识库对多个 dataset，也不支持 Dify 以外的厂商。
- 不重排（`reranking_enable` 固定 false），不提供混合检索开关。
- 不把 API Key 放进 WorkBuddy 系统配置。一个密钥对应一个库；系统配置没有这条字段。
- 不改 `dsh-esc` 的 Dify 连接器。
- 不因为外部检索失败而中断本轮对话。

---

## 11. 待拍板

默认项已经写进上文。要改时指出编号即可。

| # | 默认 | 备选 |
| --- | --- | --- |
| 1 | 检索协议就是 `POST .../datasets/{id}/retrieve` + Bearer | 若现场 Dify 版本路径不同，开工前改第 3 节的 URL，不在代码里做多种猜测 |
| 2 | 每个知识库单独保存 API Key（加密在库行上） | 全公司共用一把 Key，放进 WorkBuddy 系统配置。多个库仍要各自的知识库 ID |
| 3 | 内网 `http` 允许，公网必须 `https` | 一律 `https`，自建 Dify 必须先上证书 |
| 4 | 只检索，不导入文档 | 另做同步，把 Dify 文档抄进 SQLite。那是另一期 |
| 5 | 外部库禁止回写 | 允许把对话摘录再写回 Dify。需要上传接口，本期不做 |
| 6 | 不改专家连接器 | 知识库接上之后，关掉 `zr_esc_dify_search`，避免同一轮查两次 |
