# 远端 Webhook 审码：完整实施方案（知识积累）

> **状态：整条链路已跑通（2026-09-11）**  
> **目标读者：** 以后换环境 / 换人 / 重做一遍时，按本文顺序做即可成功。  
> **插件：** `@zhongruan/dsh-remote-review`（源码目录 `dsh-remote-review/`）  
> **分册：**  
> - 方案边界：[remote-push-服务器审码-方案确认.md](./remote-push-服务器审码-方案确认.md)  
> - 配置大白话：[remote-review-配置说明-大白话.md](./remote-review-配置说明-大白话.md)  
> - 飞书踩坑：[remote-review-飞书文档库联调复盘.md](./remote-review-飞书文档库联调复盘.md)  
> - 文档总索引：[../README.md](../README.md)

---

## 0. 一句话成功公式

```text
GitHub/GitLab push
  → 公网可达的 Webhook（本机常开 18787 + ngrok，或公司机反代）
  → dsh-remote-review 拉仓/用本地路径
  → 现有引擎 /api/code-review/*（不改引擎）
  → 飞书「我的文档库」wiki 节点
  → Markdown 转文档块写入（须 convert 权限 + 发布）
```

**成功标志：** 任务 `status=feishu_ok`，飞书打开是标题/列表/代码块，不是一整段白文。

---

## 1. 这是什么、不是什么

| 是 | 不是 |
| --- | --- |
| **第二种**：远端 push（或本机 Hook 只 POST JSON）→ Webhook 服务 → 审码 → 飞书 | 第一种：本机 `post-commit` **直调**引擎（见 `ide-commit-hook-自动审码-MVP.md`） |
| 插件只做触发 / 拉仓 / 调已有审码 API / 投递飞书 | 不是新做一套 LLM 审码引擎 |
| 配置落在本机 `~/.zhongruan/remote-review/` | 密钥/Token **禁止**提交进任何 git 仓 |

与第一种关系：可并存；第二种主路径是 **push → Webhook**。只 `commit` 不 `push`，GitHub Webhook **不会**触发。

---

## 2. 架构与组件

```text
┌─────────────┐     push / webhook      ┌──────────────────────────┐
│ GitHub/GitLab│ ─────────────────────► │ 入口（ngrok 或公司 nginx） │
└─────────────┘                         └────────────┬─────────────┘
                                                     │ POST /webhook
                                                     ▼
                                        ┌──────────────────────────┐
                                        │ dsh-remote-review         │
                                        │ 默认 127.0.0.1:18787      │
                                        │ · 验签 / 去重 / 入队       │
                                        │ · clone 到 workspaces     │
                                        │ · 调引擎 list→run         │
                                        │ · 写飞书 wiki + 本地 md   │
                                        └────────────┬─────────────┘
                                                     │
                          ┌──────────────────────────┼──────────────────────────┐
                          ▼                          ▼                          ▼
                 WorkBuddy 引擎 :8000        飞书开放平台 API            ~/.zhongruan/...
                 /api/code-review/*         docx + wiki + convert       config / jobs / feishu-out
```

| 组件 | 路径 / 端口 | 职责 |
| --- | --- | --- |
| 插件源码 | `dsh-remote-review/` | HTTP 服务 + DSH 设置页 + 对话工具 |
| 本机配置 | `~/.zhongruan/remote-review/config.json` | 引擎、密钥、飞书、监听 |
| 任务落盘 | `~/.zhongruan/remote-review/jobs/` | 每次审码任务 JSON |
| 工作区 | `…/workspaces/<owner>_<repo>` | clone/pull 后的代码 |
| 本地备份 | `…/feishu-out/*.md` | 飞书失败或未配时的 Markdown |
| 审码引擎 | 默认 `http://127.0.0.1:8000` | **已有** `/api/code-review/*`，插件零改动 |
| 公司部署（可选） | `/www/wwwroot/dsh-remote-review` + nginx `/remote-review/` | 与插件市场同机但目录独立 |

---

## 3. 前置条件清单（缺一不可）

### 3.1 机器侧

- [ ] Node ≥ 20，能 `pnpm install && pnpm build`
- [ ] 审码引擎已起，车道就绪：`GET http://127.0.0.1:8000/api/code-review/status`
- [ ] Webhook 进程常开：`cd dsh-remote-review && node lib/cli.js`（或 `pnpm start`）
- [ ] `GET http://127.0.0.1:18787/health` 返回正常，且 `feishuReady: true`

### 3.2 Git 侧（第二种主路径）

- [ ] 仓库在 GitHub/GitLab（或已把域名加入 `REMOTE_REVIEW_ALLOWED_HOSTS`）
- [ ] Webhook Payload URL 能打到本机 `/webhook`（联调：ngrok；生产：公司反代）
- [ ] Content-Type：`application/json`
- [ ] Secret 与 `config.json` 的 `secret`（或服务器 `REMOTE_REVIEW_SECRET`）一致
- [ ] 触发事件含 **push**；验证时必须 **`git push`**，不是只 commit

### 3.3 飞书侧（报告进「我的文档库」）

开放平台（企业自建应用，如 DSH-WorkBuddy）：

- [ ] `docx:document` / `docx:document:create`
- [ ] **`docx:document.block:convert`（转换文本为云文档块）** ← Markdown 结构化写入必开
- [ ] `wiki:wiki`（及列表/只读类可一并开）
- [ ] **创建版本并发布**（只「已开通」未发布 → 线上仍可能无权限）

文档库资源侧（与多维表格同一套路）：

- [ ] 打开目标文档库 → **已添加应用 / 添加应用**（不是「邀请协作者」搜人）
- [ ] 选本应用，权限 **可编辑** → 添加
- [ ] 本机配置填 `wikiSpaceId`（数字）；可选 `wikiParentNodeToken`（URL `/wiki/` 后那串）
- [ ] **`folderToken` 一般留空**（个人云盘易 `no folder permission`）

### 3.4 配置落点原则

- [ ] 密钥只在本机设置页 / `config.json` / 服务器 `server.env`
- [ ] **绝不**写进业务仓、插件源码仓、群聊、git

---

## 4. 推荐实施路径（照做）

### 阶段 A：本机先跑通「服务 + 引擎」（不接 GitHub）

```bash
# 1) 引擎就绪（按你们现有方式启动 WorkBuddy / 审码车道）
curl -sS http://127.0.0.1:8000/api/code-review/status | head

# 2) 构建并启动 Webhook
cd dsh-remote-review
pnpm install && pnpm build
node lib/cli.js
# 另开终端：
curl -sS http://127.0.0.1:18787/health
```

期望：`ok` / 监听 `127.0.0.1:18787`。此时飞书可能尚未 ready。

### 阶段 B：配飞书（文档库，不是个人文件夹）

1. 开放平台开通权限（含 **convert**）→ **发布版本**  
2. 文档库添加应用 · 可编辑  
3. 查 `wikiSpaceId`：  
   - 页面 URL `/wiki/<节点token>` 里是 **父节点 token**，不是 space_id  
   - 用开放平台 `GET /open-apis/wiki/v2/spaces/get_node?token=<节点token>` 取 `space_id`  
   - 或本机（需管理密钥头）：`GET http://127.0.0.1:18787/api/feishu/wiki-spaces`  
4. WorkBuddy **设置 → 远端审码** 填写并保存，或写本机：

```json
{
  "engine": "http://127.0.0.1:8000",
  "listen": "127.0.0.1",
  "port": 18787,
  "secret": "与 GitHub Webhook Secret 一致的一串",
  "workspaceRoot": "/Users/你/.zhongruan/remote-review/workspaces",
  "dataRoot": "/Users/你/.zhongruan/remote-review",
  "feishu": {
    "appId": "cli_xxxx",
    "appSecret": "xxxx",
    "wikiSpaceId": "数字 space_id",
    "wikiParentNodeToken": "可选-挂到某页下的节点token",
    "folderToken": ""
  }
}
```

5. 重启 `node lib/cli.js`，再查 health：`feishuReady: true`

联调参考值（换环境请重查，勿当生产密钥）：

| 项 | 值 |
| --- | --- |
| wikiSpaceId | `7573257760905969668` |
| 父节点「我的代码审核文档」 | `Og7IwDu2Fi9VQwkIVnicIJl6n8b` |

### 阶段 C：本地模拟一次审码（仍可不经 GitHub）

```bash
curl -sS -X POST http://127.0.0.1:18787/simulate \
  -H 'Content-Type: application/json' \
  -H "X-Remote-Review-Secret: <你的secret>" \
  -d '{"local_path":"/绝对路径/某git仓","focus":"local simulate"}'
```

查任务：

```bash
SECRET=你的secret
curl -sS http://127.0.0.1:18787/jobs -H "X-Remote-Review-Secret: $SECRET"
```

期望：`feishu_ok` + `https://www.feishu.cn/wiki/...`；打开文档应有结构化排版。

失败只审码成功、飞书未写：状态多为 `feishu_pending` / 失败 detail；本地 md 在 `feishu-out/`。修好权限后：

```bash
curl -sS -X POST "http://127.0.0.1:18787/jobs/<jobId>/retry-feishu" \
  -H "X-Remote-Review-Secret: $SECRET"
```

### 阶段 D：接上 GitHub push（联调推荐 ngrok）

1. 本机 18787 已常开  
2. 启动隧道，例如：`ngrok http 18787`（或公司已有入口）  
3. GitHub 仓库 → Settings → Webhooks：  
   - Payload URL：`https://<隧道域名>/webhook`  
   - Content type：`application/json`  
   - Secret：与本机一致  
   - 事件：至少 **push**  
4. 在业务仓改一点代码 → **`git push`**  
5. GitHub Delivery 绿勾 → 本机 jobs 新任务 → 飞书新文档  

> 腾讯云公网 `175.178.238.31/remote-review/` 曾出现 GitHub 入站或服务器出站 GitHub 不通，**联调默认用本机 + ngrok**，勿一上来绑死公网机。

### 阶段 E（可选）：装进公司插件市场

```bash
./scripts/internal-market/pack.sh dsh-remote-review
./scripts/internal-market/upload.sh
./scripts/internal-market/install-latest.sh dsh-remote-review
```

然后**完全退出并重启 WorkBuddy**。市场 `install` 建议钉死版本 `@x.y.z`，避免 Profile 锁在 `^0.1.1`。

公司机部署（与市场同机、互不影响）：

```bash
./scripts/remote-review/deploy.sh
# 健康：http://<host>/remote-review/health
# Webhook：http(s)://<host>/remote-review/webhook
```

应用目录：`/www/wwwroot/dsh-remote-review`；进程只听 `127.0.0.1:18787`；nginx 反代 `/remote-review/`。飞书配置写在**跑服务那台机器**上。

---

## 5. 关键接口与鉴权（排障用）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 服务 / 飞书就绪 |
| POST | `/webhook` | GitHub/GitLab/本机 Hook |
| POST | `/simulate` | 本机路径立即审 |
| GET | `/jobs`、`/jobs/:id` | 任务列表/详情 |
| POST | `/jobs/:id/retry-feishu` | 补发飞书 |
| GET/PUT | `/api/config` | 读写配置（管理面） |
| POST | `/api/install-hook` | 安装 post-commit |

管理类接口需请求头：`X-Remote-Review-Secret: <secret>`（与配置一致）。  
Webhook 验签：GitHub `X-Hub-Signature-256` 或共享 Secret 头。

对话工具（装插件后）：`remote_review_status` / `start` / `jobs` / `retry_feishu` / `simulate` / `install_hook` 等。敏感密钥优先走设置页，少用对话传 Secret。

---

## 6. 飞书写入规则（必记）

1. **只走 Markdown → 文档块转换**（`content_type: markdown` + `docx:document.block:convert`）。  
2. **不再降级**为纯文本块；转换失败 → 任务失败并提示开权限。  
3. 文档建在 **wiki 文档库**（配了 `wikiSpaceId`），才会出现在「我的文档库」树里。  
4. 只配 App ID/Secret、不配 wiki / 不加「文档库应用」→ 文档可能在应用空间，用户「飞书里找不到」。

---

## 7. 验收清单（整链打勾）

| # | 检查项 | 通过标准 |
| --- | --- | --- |
| 1 | 引擎 | `/api/code-review/status` 车道就绪 |
| 2 | Webhook 进程 | `/health` 通，`feishuReady: true` |
| 3 | 飞书权限 | convert + docx + wiki 已开通且**已发布** |
| 4 | 文档库 | 应用已添加且可编辑 |
| 5 | 配置 | wikiSpaceId 正确；secret 与 Git 平台一致 |
| 6 | 入口 | GitHub Delivery 能打到 `/webhook`（绿勾） |
| 7 | 触发 | **push** 后出现新 job |
| 8 | 审码 | job 有 reportId / 审码成功信息 |
| 9 | 飞书 | `feishu_ok` + wiki 链接；打开有标题/列表/代码块 |
| 10 | 安全 | 仓库内无 App Secret / Webhook 密钥 |

已验证样例（历史）：提交 `0cffe97…`，报告 `cr-aff640fa…`，任务 `feishu_ok`。

---

## 8. 故障速查

| 现象 | 先查 |
| --- | --- |
| GitHub 有 Delivery 红叉 | Payload URL / Secret / 本机或 ngrok 是否在线 |
| Delivery 绿但无任务 | 本机是否真是当前进程；路径是否 `/webhook`；去重窗口是否误杀 |
| 有任务审码失败 | 引擎是否通；workspace clone 是否被主机白名单拒绝 |
| `feishu_pending` / 本地有 md 无飞书 | App 未配齐；或 convert/wiki 权限未发布 |
| `permission denied` / no folder | 个人文件夹勿用；改 wiki + 文档库「添加应用」 |
| 文档白文像 MD 源码 | 缺 convert 或未发布；确认已用强制转块版本的插件 |
| 只 commit 无报告 | 第二种要 **push** |
| 设置页仍是旧「文件夹 Token」 | `install-latest.sh` 强制装新版并重启 WorkBuddy |
| `curl :18787` 连不上 | 没起 `node lib/cli.js` |
| 管理接口 401 | 补 `X-Remote-Review-Secret` |

---

## 9. 明确不做（边界）

- 不改 `engine/app/code_review/*`、不改 `/api/code-review/*` 签名  
- 不改第一种 `scripts/hook-review/` 主逻辑、不改 pcb / weather / 8d  
- 不新做审码 LLM；引擎未就绪则任务失败并写明原因  
- 不把密钥提交进 git；不把个人云盘当默认投递目标  

---

## 10. 日常运维口令

```bash
# 启服务
cd /path/to/pythonProject_dsh_plugin/dsh-remote-review && node lib/cli.js

# 健康
curl -sS http://127.0.0.1:18787/health

# 最近任务（带密钥）
curl -sS http://127.0.0.1:18787/jobs -H "X-Remote-Review-Secret: $SECRET"

# 补发飞书
curl -sS -X POST "http://127.0.0.1:18787/jobs/<id>/retry-feishu" \
  -H "X-Remote-Review-Secret: $SECRET"

# 发版进公司市场
./scripts/internal-market/pack.sh dsh-remote-review
./scripts/internal-market/upload.sh
./scripts/internal-market/install-latest.sh dsh-remote-review
```

---

## 11. 相关文档索引

| 文档 | 用途 |
| --- | --- |
| 本文 | **完整照做手册（知识积累）** |
| [remote-push-服务器审码-方案确认.md](./remote-push-服务器审码-方案确认.md) | 方案边界与组件关系 |
| [remote-review-配置说明-大白话.md](./remote-review-配置说明-大白话.md) | 配置项与用户操作位置 |
| [remote-review-飞书文档库联调复盘.md](./remote-review-飞书文档库联调复盘.md) | 飞书踩坑时间线 |
| [ide-commit-hook-自动审码-MVP.md](./ide-commit-hook-自动审码-MVP.md) | 第一种对照 |
| [remote-review-绕开腾讯云入站.md](./remote-review-绕开腾讯云入站.md) | 公网入站不通时的绕行 |

---

## 12. 一页纸备忘

> **push → Webhook(18787) → 引擎 → 飞书 wiki。**  
> 飞书三件套：开放平台权限（含 **convert**）并发布 + 文档库添加应用可编辑 + 本机 `wikiSpaceId`。  
> 配置只在本机；密钥不进仓；报告必须 Markdown 转块；联调优先本机 + ngrok。
