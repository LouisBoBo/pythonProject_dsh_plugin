# 文档目录

本仓库 `docs/` 索引。按主题查阅；实施细节以各文正文为准。

---

## 1. DSH 插件开发与公司市场

| 文档 | 说明 |
| --- | --- |
| [dsh插件开发.md](./dsh插件开发.md) | DSH Bundle 插件开发基础（以 pcb-helper 为例） |
| [dsh-插件发现与调用说明.md](./dsh-插件发现与调用说明.md) | 市场如何发现可装插件；装完如何被对话调用 |
| [dsh-pcb-helper-公司插件全流程实施方案.md](./dsh-pcb-helper-公司插件全流程实施方案.md) | **主文档**：开发 → 打包 → 私有 npm → 市场 → WorkBuddy 安装 |
| [dsh-pcb-helper-公司内网插件市场.md](./dsh-pcb-helper-公司内网插件市场.md) | 内网市场方案与脚本说明 |
| [dsh-pcb-helper-WorkBuddy安装.md](./dsh-pcb-helper-WorkBuddy安装.md) | 开发机手动 `dsh plugin add`（早期路径） |
| [dsh-pcb-helper-上线安装设计.md](./dsh-pcb-helper-上线安装设计.md) | 预装/清单型方案（与市场方案互补） |
| [workbuddy-插件安装卡在gh-proxy.md](./workbuddy-插件安装卡在gh-proxy.md) | 市场安装卡在 gh-proxy 的原因与修复 |

**仓库内示例插件：** `dsh-pcb-helper`、`dsh-weather`、`dsh-pcb-8d`、`dsh-remote-review`  
**发布脚本：** `scripts/internal-market/`（`pack.sh` / `upload.sh` / …）

---

## 2. 业务样例

| 文档 | 说明 |
| --- | --- |
| [pcb-8d-完整模拟报告样例.md](./pcb-8d-完整模拟报告样例.md) | PCB 8D 全模拟业务数据完整报告样例 |

---

## 3. 审码自动化（与 DSH 插件正交）

> 审码执行面仍在 **WorkBuddy 引擎**（`/api/code-review/*` 零改动）。  
> 第二种用 **DSH 插件 `@zhongruan/dsh-remote-review`** 提供 Webhook 服务、Hook 安装和飞书投递；不替代第一种本机 Hook。

| 文档 | 说明 | 状态 |
| --- | --- | --- |
| [ide-commit-hook-自动审码-MVP.md](./ide-commit-hook-自动审码-MVP.md) | **第一种**：本机 `post-commit` → 本机引擎审码 | 已有脚本 `scripts/hook-review/` |
| [remote-push-服务器审码-方案确认.md](./remote-push-服务器审码-方案确认.md) | **第二种**：Webhook 拉仓/本地路径 → 现有审码 API → 飞书文档 | **已落地 MVP**（插件 `dsh-remote-review`，本地 :18787） |
| [remote-review-配置说明-大白话.md](./remote-review-配置说明-大白话.md) | **第二种怎么配**：`config.json` / 飞书三项 / Webhook 地址填哪 | 实用配置说明 |

### 能力边界（速查）

| 场景 | 推荐落点 | 能否整包做成 DSH 插件 |
| --- | --- | --- |
| 天气 / 8D / 可对话工具 | 公司 DSH 插件 | ✅ |
| 本机目录 + 引擎长流程 + 专用 UI 卡（写码/提交等） | feature + 引擎 | ❌ |
| IDE 提交 / 远端 push 自动审码 + 飞书文档 | DSH 插件 `dsh-remote-review`（Webhook 服务）+ 现有审码 API | ✅ 插件只做触发/拉仓/投递，审码引擎不改 |
| 审码规则包（按客户换清单） | 可选插件扩展 | ✅ 仅规则，非监听 |

---

## 4. 相关脚本

| 路径 | 用途 |
| --- | --- |
| `scripts/internal-market/` | 公司插件打包、生成目录、上传、校验 |
| `scripts/hook-review/` | 第一种：本机 commit Hook → 直调引擎审码 |
| `dsh-remote-review/` | 第二种：Webhook 审码插件（本地 `pnpm start` 或对话启动） |
| `company-registry/` | 本地生成的 `plugins.json` / npm / artifacts |
| `company-registry/nginx-dsh-plugins.conf` | 服务器 nginx 静态目录参考配置 |
