# 文档目录

本仓库 `docs/` 按主题分目录；实施细节以各文正文为准。

```text
docs/
├── README.md                 ← 本索引
├── 01-插件开发与市场/         ← DSH 插件开发、公司市场、安装排障
├── 02-审码自动化/             ← 第一种 Hook / 第二种 Webhook + 飞书
├── 03-业务样例/               ← 业务报告样例等
├── 04-Cursor-AI-Coding逼真版本/  ← 接 Cursor 写码体验（含独立插件版）
├── 05-功能使用手册说明/       ← 使用向手册归档（可与各主题手册交叉引用）
├── 06-复盘总结/               ← 联调收口后的复盘（弯路、定稿、排障）
├── 07-周报/                   ← 面向领导的周报归档
└── 架构与选型/                ← 宿主会话/记忆分层等跨仓定稿（与 WorkBuddy 对齐）
```

---

## 1. 插件开发与市场 → [`01-插件开发与市场/`](./01-插件开发与市场/)

| 文档 | 说明 |
| --- | --- |
| [dsh插件开发.md](./01-插件开发与市场/dsh插件开发.md) | DSH Bundle 插件开发基础（以 pcb-helper 为例） |
| [dsh-插件发现与调用说明.md](./01-插件开发与市场/dsh-插件发现与调用说明.md) | 市场如何发现可装插件；装完如何被对话调用 |
| [dsh-pcb-helper-公司插件全流程实施方案.md](./01-插件开发与市场/dsh-pcb-helper-公司插件全流程实施方案.md) | **主文档**：开发 → 打包 → 私有 npm → 市场 → WorkBuddy 安装 |
| [dsh-pcb-helper-公司内网插件市场.md](./01-插件开发与市场/dsh-pcb-helper-公司内网插件市场.md) | 内网市场方案与脚本说明 |
| [dsh-pcb-helper-WorkBuddy安装.md](./01-插件开发与市场/dsh-pcb-helper-WorkBuddy安装.md) | 开发机手动 `dsh plugin add`（早期路径） |
| [dsh-pcb-helper-上线安装设计.md](./01-插件开发与市场/dsh-pcb-helper-上线安装设计.md) | 预装/清单型方案（与市场方案互补） |
| [workbuddy-插件安装卡在gh-proxy.md](./01-插件开发与市场/workbuddy-插件安装卡在gh-proxy.md) | 市场安装卡在 gh-proxy 的原因与修复 |

**仓库内示例插件：** `dsh-pcb-helper`、`dsh-weather`、`dsh-pcb-8d`、`dsh-remote-review`、`dsh-cursor-coding`  
**发布脚本：** `scripts/internal-market/`（`pack.sh` / `upload.sh` / …）

---

## 2. 审码自动化 → [`02-审码自动化/`](./02-审码自动化/)

> 审码执行面仍在 **WorkBuddy 引擎**（`/api/code-review/*` 零改动）。  
> 第二种用 **DSH 插件 `@zhongruan/dsh-remote-review`** 提供 Webhook 服务、Hook 安装和飞书投递；不替代第一种本机 Hook。

| 文档 | 说明 | 状态 |
| --- | --- | --- |
| [远端Webhook审码-新用户使用手册.md](./05-功能使用手册说明/远端Webhook审码-新用户使用手册.md) | **新用户照做**：安装、设置、装 Hook/Push、看飞书、排障 | 使用向 |
| [remote-review-远端Webhook审码-完整实施方案.md](./02-审码自动化/remote-review-远端Webhook审码-完整实施方案.md) | **第二种知识积累总册**：架构、清单、分阶段照做、验收、故障速查 | **照做即可成功**（2026-09-11 整链已通） |
| [ide-commit-hook-自动审码-MVP.md](./02-审码自动化/ide-commit-hook-自动审码-MVP.md) | **第一种**：本机 `post-commit` → 本机引擎审码 | 已有脚本 `scripts/hook-review/` |
| [remote-push-服务器审码-方案确认.md](./02-审码自动化/remote-push-服务器审码-方案确认.md) | **第二种**：Webhook → 审码 API → 飞书（Markdown 转块） | **整链已通** |
| [remote-review-配置说明-大白话.md](./02-审码自动化/remote-review-配置说明-大白话.md) | 第二种怎么配：`config.json` / 飞书 / Webhook 填哪 | 实用配置说明 |
| [remote-review-飞书文档库联调复盘.md](./02-审码自动化/remote-review-飞书文档库联调复盘.md) | 飞书文档库踩坑：添加应用、space_id、convert | 整链已通 |
| [remote-review-绕开腾讯云入站.md](./02-审码自动化/remote-review-绕开腾讯云入站.md) | 公网入站不通时用本机 + ngrok 绕行 | 联调备忘 |

### 能力边界（速查）

| 场景 | 推荐落点 | 能否整包做成 DSH 插件 |
| --- | --- | --- |
| 天气 / 8D / 可对话工具 | 公司 DSH 插件 | ✅ |
| 本机目录 + 引擎长流程 + 专用 UI 卡（写码/提交等） | feature + 引擎 | ❌ |
| IDE 提交 / 远端 push 自动审码 + 飞书文档 | DSH 插件 `dsh-remote-review` + 现有审码 API | ✅ 插件只做触发/拉仓/投递 |
| 审码规则包（按客户换清单） | 可选插件扩展 | ✅ 仅规则，非监听 |

---

## 3. 业务样例 → [`03-业务样例/`](./03-业务样例/)

| 文档 | 说明 |
| --- | --- |
| [pcb-8d-完整模拟报告样例.md](./03-业务样例/pcb-8d-完整模拟报告样例.md) | PCB 8D 全模拟业务数据完整报告样例 |

---

## 4. Cursor AI-Coding → [`04-Cursor-AI-Coding逼真版本/`](./04-Cursor-AI-Coding逼真版本/)

| 文档 | 说明 | 状态 |
| --- | --- | --- |
| [Cursor写码插件-新用户使用手册.md](./05-功能使用手册说明/Cursor写码插件-新用户使用手册.md) | **新用户照做**：装插件、填 Key、澄清→确认→进度→结论、续改、排障 | 使用向 |
| [Cursor写码插件-主流程冻结.md](./04-Cursor-AI-Coding逼真版本/Cursor写码插件-主流程冻结.md) | 主交互四步冻结口径；过程加厚暂停 | 产品冻结 |
| [写码插件输出-VS-Cursor原生输出-对比报告.md](./04-Cursor-AI-Coding逼真版本/写码插件输出-VS-Cursor原生输出-对比报告.md) | **输出对照**：整体相似度 + 澄清/确认/思考/工具/结论/续改等节点 | 收口对照（2026-09-13） |
| [插件韧性-安装回退与进程隔离.md](./04-Cursor-AI-Coding逼真版本/插件韧性-安装回退与进程隔离.md) | 装失败回退、四套兼容声明、写码 HTTP 子进程隔离 | 0.6.42 |
| [AI-Coding接入Cursor-插件版实施方案.md](./04-Cursor-AI-Coding逼真版本/AI-Coding接入Cursor-插件版实施方案.md) | **按五条硬约束重写**：独立 Bundle、零改 WorkBuddy、UI 挂 DSH 原生插槽 | 实施向 |
| [AI-Coding接入Cursor-体验逼近方案.md](./04-Cursor-AI-Coding逼真版本/AI-Coding接入Cursor-体验逼近方案.md) | 体验/分期母本（原落点在 WorkBuddy 引擎 + mes-bridge） | 对照用 |

**仓库内插件：** `dsh-cursor-coding/`（`@zhongruan/dsh-cursor-coding`）

---

## 5. 复盘总结 → [`06-复盘总结/`](./06-复盘总结/)

| 文档 | 说明 | 状态 |
| --- | --- | --- |
| [Cursor写码插件-写码删码续改复盘.md](./06-复盘总结/Cursor写码插件-写码删码续改复盘.md) | 写码 / 删菜单 / 续改联调收口：弯路、定稿决策、排障 | **基本通**（2026-09-12） |

> 审码侧飞书联调复盘仍放在 [`02-审码自动化/`](./02-审码自动化/remote-review-飞书文档库联调复盘.md)；新主题复盘统一进本目录。

---

## 6. 周报 → [`07-周报/`](./07-周报/)

| 文档 | 说明 |
| --- | --- |
| [2026-W37-Cursor写码插件收口周报.md](./07-周报/2026-W37-Cursor写码插件收口周报.md) | 2026-09-08～14：写码主路径冻结、体验对照、韧性三项、待领导拍板 |
| [2026-W38-本周工作计划.md](./07-周报/2026-W38-本周工作计划.md) | 2026-09-14～20：稳定回归、可选上架、审码并行；冻结期内不加厚 |

---

## 7. 架构与选型 → [`架构与选型/`](./架构与选型/)

| 文档 | 说明 |
| --- | --- |
| [DSH会话与记忆分层.md](./架构与选型/DSH会话与记忆分层.md) | **定稿**：聊天认 DSH、执行认本机 Job、加速仅 sessionStorage；与 WorkBuddy 同源 |

---

## 8. 相关脚本（仓库根，非 docs）

| 路径 | 用途 |
| --- | --- |
| `scripts/internal-market/` | 公司插件打包、生成目录、上传、校验；`install-latest.sh` 强制本机装最新 |
| `scripts/hook-review/` | 第一种：本机 commit Hook → 直调引擎审码 |
| `scripts/remote-review/` | 第二种公司机部署 |
| `dsh-remote-review/` | 第二种：Webhook 审码插件 |
| `company-registry/` | 本地生成的 `plugins.json` / npm / artifacts |
| `company-registry/nginx-dsh-plugins.conf` | 服务器 nginx 静态目录参考配置 |
