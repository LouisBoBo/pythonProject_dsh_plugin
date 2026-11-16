# Git 交付 · 本批审码引擎内嵌（方案 B）立项

> **日期**：2026-11-16  
> **状态**：立项（未开工实现）  
> **决策**：不做 A（依赖本机 WorkBuddy `:8000` 保活）、不做 C（Cursor 审 Cursor）；做 **B：从 WorkBuddy 迁出本批审码能力，供 Git 交付闸专用**。  
> **硬约束**：**禁止影响写码主路径**（`zr_cchat_begin` / `continue` / 默认同步 / 交付审计 / 用量计量）。只动 `git_deliver` 审码闸及其隔离依赖。

---

## 0. 一句话

把 WorkBuddy 引擎里「对本批文件跑 LLM 审码 → 结构化 high/medium/low」的能力，**裁剪迁到插件仓旁路包**；由 `dsh-cursor-chat` 的 **Git 交付确认后**调用。  
**写码仍走 Cursor；审码走另一条 LLM 车道（读 WorkBuddy `config.yaml` 的 deepseek 等）——不是 Cursor 自审。**

---

## 1. 为什么是 B（对本项目）

| 现状 | 问题 |
| --- | --- |
| `gitDeliverReview.ts` HTTP 调 WorkBuddy `/api/code-review` | 本机引擎常未起 → 闸卡住 / 人审噪音 |
| 整包复制进写码插件 Node 进程 | 语言/依赖/双份维护，易误伤主路径 |
| Cursor 再审本批 | 写审同源，产品不接受 |

B 的目标：**交付闸有独立审码，且与写码进程隔离。**

---

## 2. 架构（隔离优先）

```text
┌─────────────────────────────────────────────┐
│ dsh-cursor-chat（Node）                      │
│  begin/continue/同步  …… 完全不动              │
│  git_deliver：确认卡 → [审码适配器] → commit   │
└──────────────────┬──────────────────────────┘
                   │ 仅 git_deliver 调用
                   ▼
┌─────────────────────────────────────────────┐
│ dsh-batch-review（新建旁路包，建议 Python）     │
│  从 WorkBuddy code_review 裁剪迁入             │
│  · list/run（本批 files）                     │
│  · findings 解析 / high_count                 │
│  · LLM：config.yaml deepseek.*（非 Cursor）   │
│  默认本机环回端口（非占用则自选），或 stdio RPC   │
└─────────────────────────────────────────────┘
         ▲ 口径同源
         │
 WorkBuddy engine/app/code_review（正本仍可保留给 WB UI）
```

### 2.1 明确不迁什么

| 不迁 | 原因 |
| --- | --- |
| WorkBuddy 聊天桥 / 确认卡 UI / feature 插件壳 | 与 DSH 写码壳无关 |
| `space` 报告入库、path_ticket 企业闸全套 | 交付闸只需本批 files + 结构化结果 |
| 整引擎 FastAPI 全家桶 | 体积与端口冲突；只留最小 HTTP 或 CLI |
| Cursor SDK / `dsh-cursor-chat` 写码编排 | **绝对禁止**审码进写码链路 |

### 2.2 建议迁什么（最小核）

正本目录：`DSH_WorkBuddy/apps/zr-workbuddy/engine/app/code_review/`

| 模块 | 迁入优先级 | 说明 |
| --- | --- | --- |
| `findings.py` | P0 | 结构化块解析、severity |
| `skill_prompt.py` + skill 文案 | P0 | 审码方法论，禁止自造清单 |
| `local_files.py`（去 sandbox 硬依赖或薄适配） | P0 | 本批读文件 |
| `review.py` 中 batch + `llm_freeform` 调用 | P0 | 核心跑批 |
| `config.py` 白名单/限额 | P0 | 读 `config.yaml` |
| `ops.run_review_async` 精简版 | P0 | 对外 `run(files)` |
| `enrich.py` / `profile_scope.py` | P1 | 可后置，先保闸可用 |
| `chat_bridge.py` / store→space | 不迁 | |

LLM 调用（**硬约束 · 网关，禁止跑偏**）：

- **优先** 公司模型网关（与桌面壳一致）：`ZR_MODEL_GATEWAY_URL` 或默认 `http://113.90.149.166:19772` → `{origin}/api/ai`，鉴权 `ZR_GATEWAY_TOKEN`（`$DSH_HOME/.credentials.yaml`），模型别名默认 `standard`  
- WorkBuddy `config.yaml` 若已配 **非官网** `base_url`（openai_compat 等）仍可用；**禁止**使用 `api.deepseek.com`  
- **禁止**在旁路包写死官网 URL；插件 `config.json` **不存** LLM Key  
- 未登录网关或网关不可达 → `unavailable`，不得拖垮写码主路径；**禁止**走 Cursor SDK / Agent

---

## 3. 对 `dsh-cursor-chat` 的接入（窄口）

### 3.1 唯一改动面

| 允许改 | 禁止改 |
| --- | --- |
| `gitDeliverReview.ts`（解析引擎基址 / 调新旁路） | `orchestrator/runJob.ts` 写码主路径 |
| `launchGitDeliver.ts` 仅审码阶段日志文案 | `index.ts` begin/continue/finish 语义 |
| 可选：插件本地调度项（旁路端口），非业务 Key | 用量 meter 公式、key-quota |
| 自测只加 git_deliver / review 用例 | 默认同步、沙箱、HITL 写码确认 |

### 3.2 功能开关（默认安全）

```text
git_deliver.review_backend =
  off          → 确认后直接 commit（当前「先关闸」等价；默认建议先用这个直到旁路验收通过）
  workbuddy    → 旧行为：HTTP 调 WorkBuddy :8000（兼容回滚）
  embedded     → 新旁路 dsh-batch-review
```

**默认：`off` 或保持 `workbuddy` 直到 embedded 自测+本机验收通过，再切 `embedded`。**  
切换不得需要改写码代码。

### 3.3 契约冻结（与现闸对齐）

旁路 `run` 返回须能被现有 `evaluateBatchReviewPayload` 消费，至少含：

- `ok` / `findings[]`（`severity`: critical|high|medium|low）
- `high_count`（或可从 findings 计算）
- `reply` / `summary` / `report_id`（可空）

插件侧 **高危挡提交 / 修 / 暂停** 状态机不改权威字段语义。

---

## 4. 风险与防误伤

| 风险 | 对策 |
| --- | --- |
| 旁路进程拖死写码服务 | 独立进程；超时；失败只影响 `runBatchCodeReview` |
| 误用 Cursor Key/会话 | 代码审查清单 + 自测断言无 `Cursor` SDK import |
| 拷贝后双份漂移 | 文档注明正本仍在 WorkBuddy；变更先改正本再同步裁剪包（或后续再抽真·共享包） |
| 端口冲突 | 探测空闲口；写入插件调度配置；禁止写死强占 8000 |
| 默认一开就挡全员提交 | 默认 `off`，验收后再 `embedded` |
| 把聊天审码 UI 一并拷进 DSH | 范围外，拒绝 |

---

## 5. 分期（可独立验收）

### 阶段 0 · 立项与契约（本文）

- [x] 产品排除 A/C，选定 B  
- [x] 默认关闸 `gitDeliverReviewBackend=off`（2026-11-16，`dsh-cursor-chat` 0.3.75）  
- [ ] 冻结返回 JSON 字段与 `evaluateBatchReviewPayload` 对照表  
- [ ] 确认 LLM 仅 `config.yaml`  

### 阶段 1 · 旁路包可单跑 · 已完成（2026-11-16）

- [x] 新建 `plugins/dsh-batch-review`（Python）  
- [x] 裁剪迁入 `findings.py`（自洽，无 chat/space）  
- [x] CLI：`parse-findings` / `version` / `llm-status` / `review`  
- [x] 单测：findings + mock 网关跑批（不打真网）  
- [x] `review_run` + LLM：**只认 config.yaml 的 base_url（网关）**；缺 base_url 则 unavailable，**禁止**写死官网  

**验收**：旁路可单跑；写码插件默认 off 不调 `:8000`；写码回归零。

### 阶段 2 · 插件窄接（开关默认 off）

- [x] `gitDeliverReview` backend 开关；`off` 跳过审码直接放行  
- [x] `embedded` → 子进程调 `dsh_batch_review review`（仅显式打开时；默认仍 off）  
- [x] **禁止**改 begin/continue（持续）  

**验收**：默认 off 时可 commit；写码主路径自测全绿；embedded 需网关配置 + `DSH_BATCH_REVIEW_ROOT`。

### 阶段 3 · 本机打开 embedded

- [x] 默认 `gitDeliverReviewBackend=embedded`（2026-11-16，`dsh-cursor-chat` 0.3.77）  
- [x] LLM：公司网关 `ZR_GATEWAY_TOKEN` + `{origin}/api/ai`（拒 `api.deepseek.com`；WB 非官网 base 仍可用）  
- [ ] 实机：确认 → 审码 → 无高危 → PR；有高危 → 暂停/修  
- [ ] 对比同批文件在 WorkBuddy UI 审码的严重级别抽检  

### 阶段 4 · 收敛（可选）

- [ ] 文档改「正审 = embedded」；`workbuddy` 仅回滚  
- [ ] 评估与 WorkBuddy 正本是否改为真共享子仓（避免长期双份）  

---

## 6. 目录草案（阶段 1 落地时）

```text
plugins/dsh-batch-review/          # 新建；独立 version；可不进写码 Bundle
  pyproject.toml / requirements
  src/dsh_batch_review/
    findings.py                    # 自 WB 裁剪
    review_run.py
    llm_bridge.py                  # 只读 config.yaml
    http_main.py                   # 可选最小 /run
  tests/
  README.md                        # 与 WB 正本同步说明

plugins/dsh-cursor-chat/
  src/gitDeliverReview.ts          # 仅此处接 backend 开关
  src/launchGitDeliver.ts          # 文案；逻辑仍调 runBatchCodeReview
```

**不上架策略**：阶段 1–2 默认只改仓库；本机 Profile 同步、市场上架均须用户明确口令（现有仓库规则不变）。

---

## 7. 非目标（本立项不做）

- 替换 WorkBuddy 产品内「代码审核」聊天入口  
- 用 Cursor / Agent.resume 做审码  
- 改 PR 评论格式以外的 Git 协议  
- 把审码失败变成写码 Job 失败  
- 未验收就默认打开 embedded  

---

## 8. 建议的下一步（待你点头）

1. **先把 Git 交付审码开关默认 `off`**（立即恢复可提交，且为 B 留回滚位）——小改、可单独验。  
2. 再开 **阶段 1**：建 `dsh-batch-review` 裁剪包 + CLI，**仍不接写码**。  

未点头前：**不改生产默认行为、不 pack/upload、不碰 begin/continue。**

---

## 9. 关联文档

- [写码插件-Git交付出口方案.md](./写码插件-Git交付出口方案.md)（v1.1 闸；将注 B 演进）  
- WorkBuddy 正本：`DSH_WorkBuddy/apps/zr-workbuddy/engine/app/code_review/`  
- 插件调用方：`plugins/dsh-cursor-chat/src/gitDeliverReview.ts`
