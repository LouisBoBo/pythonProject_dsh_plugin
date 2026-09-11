# 方案确认：远端 push + 服务器审码（第二种）

> 状态：**已落地 MVP（本地 Webhook 服务可测）**  
> 形态：公司 DSH 插件 `@zhongruan/dsh-remote-review` + 可独立运行的本地 Webhook 服务。  
> 与 [ide-commit-hook-自动审码-MVP.md](./ide-commit-hook-自动审码-MVP.md)（第一种：本机 Hook 直调引擎）并列。  
> 文档索引见 [README.md](./README.md)。

---

## 1. 目标场景

开发人员在 IDE 里提交代码后，由 **Webhook 服务**自动审码；正式环境不依赖本机 WorkBuddy 窗口。当前没有正式服务器，先用 **本机 18787 端口**联调。

---

## 2. 落地链路

```text
IDE git commit
    → 本仓 post-commit（本插件安装，只 POST JSON，不调引擎）
        若原先已有第一种 Hook，改名为 post-commit.dsh-prev 并链式调用
    → POST http://127.0.0.1:18787/webhook
    → 插件服务：必要时 clone/pull 到工作区（本地提交直接用 local_path）
    → 原样调用现有审码 API（list → path_ticket → run）
       不修改 WorkBuddy 引擎 / 第一种 Hook 脚本
    → 把报告 Markdown 写成飞书云文档（docx）
       未配飞书时先落到 ~/.zhongruan/remote-review/feishu-out/，配好后可补发
```

GitHub / GitLab **push** Webhook 打到同一 `/webhook` 即可（解析 clone_url 后检出再审）。公司 Git 域名请设环境变量 `REMOTE_REVIEW_ALLOWED_HOSTS`（逗号分隔，默认 `github.com,gitlab.com`）。

---

## 3. 与第一种、与现有审码的关系

| | 第一种（本机 Hook） | 第二种（本插件） |
| --- | --- | --- |
| 触发 | 本机 `post-commit` 直调引擎 | IDE 提交 → Webhook；兼收 GitHub/GitLab push |
| 执行面 | `scripts/hook-review/` | `dsh-remote-review` 本地/服务器进程 |
| 审码 API | `/api/code-review/*` | **同一套，只 HTTP 调用，零改动** |
| 通知 | 报告文件 | **飞书云文档** + 本地 md 备份 |
| 对已有功能 | 保持 | Hook 链式保留；不改 pcb/weather/8d/引擎 |

---

## 4. 本地怎么测（无正式服务器）

前置：WorkBuddy 引擎已起，`GET http://127.0.0.1:8000/api/code-review/status` 的审码车道为就绪。

```bash
cd dsh-remote-review
pnpm install
pnpm build
pnpm start
# 监听 http://127.0.0.1:18787/webhook
```

另开终端模拟一次提交（不需要真 push）：

```bash
curl -sS -X POST http://127.0.0.1:18787/simulate \
  -H 'Content-Type: application/json' \
  -d '{"local_path":"/绝对路径/某仓库","focus":"local simulate"}'
```

或对话里让插件 `remote_review_install_hook` 装到目标仓，再 `git commit`。

健康检查：`GET http://127.0.0.1:18787/health`  
任务列表：`GET http://127.0.0.1:18787/jobs`

---

## 5. 飞书文档与配置文件

**大白话（推荐先看）**：[remote-review-配置说明-大白话.md](./remote-review-配置说明-大白话.md)

**原则：配置在用户本机，不写进任何项目仓库。普通用户用设置页，不要手改文件。**

- **首选**：WorkBuddy → **设置 → 远端审码**（图形界面填飞书 / 装 Hook）  
- 落点：`~/.zhongruan/remote-review/config.json`（设置页保存写入）  
- 备选：环境变量 `FEISHU_*` / `REMOTE_REVIEW_*`，或对话工具 `remote_review_config`  
- 业务仓 / 插件源码里不要提交 App Secret、Webhook 密钥

自建应用需开通：创建/编辑新版文档、文档块转换；应用身份要对目标文件夹有建文档权限。

未配置时：审码仍会跑完，任务状态 `feishu_pending`，Markdown 在 `~/.zhongruan/remote-review/feishu-out/`。配好后 `remote_review_retry_feishu` 或 `POST /jobs/{id}/retry-feishu`。

---

## 6. DSH 对话工具

安装本插件后（或 `pnpm start` 独立跑服务）：

| 工具 | 作用 |
| --- | --- |
| `remote_review_status` | 服务 / 引擎 / 飞书是否就绪 |
| `remote_review_start` / `stop` | 启停本机 Webhook |
| `remote_review_config` | 写引擎地址、端口、飞书凭据 |
| `remote_review_install_hook` | 给某仓装提交 Webhook Hook（链式保留旧 Hook） |
| `remote_review_simulate` | 不经过 git，立刻审某目录 |
| `remote_review_jobs` | 最近任务与飞书链接 |
| `remote_review_retry_feishu` | 补发飞书文档 |

配置落盘：`~/.zhongruan/remote-review/config.json`。

---

## 7. 明确不做（遵守「不改现有审码」）

- 不改 `engine/app/code_review/*`、不改 `/api/code-review/*` 签名
- 不改 `scripts/hook-review/`、不改已有 pcb / weather / 8d 插件源码
- 不新做一套 LLM 审码引擎；引擎未就绪则任务失败并写明原因

---

## 8. 正式服务器以后怎么接

公司机已落地（与插件市场同机、目录与 nginx 均独立，不改 `/dsh-plugins`）：

- 应用目录：`/www/wwwroot/dsh-remote-review`
- 本机监听：`127.0.0.1:18787`；引擎：`http://127.0.0.1:8000`
- 公网：`http://175.178.238.31/remote-review/webhook`
- 部署：`./scripts/remote-review/deploy.sh`
- nginx extension：`…/extension/175.178.238.31/remote-review.conf`（不动 `dsh-plugins.conf`）

GitLab/GitHub 填上述 Payload URL + `REMOTE_REVIEW_SECRET`。
