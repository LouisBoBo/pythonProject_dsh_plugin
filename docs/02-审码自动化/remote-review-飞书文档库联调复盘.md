# 远端审码 × 飞书文档库：联调复盘笔记

> 日期：2026-09-11  
> 插件：`@zhongruan/dsh-remote-review`（本机 Webhook `:18787`）  
> 相关：[remote-push-服务器审码-方案确认.md](./remote-push-服务器审码-方案确认.md)、[remote-review-配置说明-大白话.md](./remote-review-配置说明-大白话.md)、[完整实施方案.md](./remote-review-远端Webhook审码-完整实施方案.md)

---

## 1. 目标与最终结论

**目标：** GitHub / 本机 Webhook 触发审码 → 报告以 **真正的 Markdown 结构化文档** 出现在飞书 **「我的文档库」**（不是白文粘贴、不是只给外链、不是个人云盘文件夹）。

**结论（整条链路已跑通，2026-09-11）：**

1. 用 **文档库（wiki）建节点**，不要依赖个人云盘 `folderToken`。  
2. 开放平台开通 `docx` + `wiki` 权限并**发布**只是一半；还必须在文档库里 **「添加应用」且权限为可编辑**。  
3. 报告正文必须以 **Markdown** 写入飞书：须开通并发布 **`docx:document.block:convert`（转换文本为云文档块）**；插件**不再**降级成纯文本块。  
4. 配置只写本机 `~/.zhongruan/remote-review/config.json`，**禁止写进 git 项目**。  
5. 市场发版后，本机 Profile 可能仍锁旧版 → 用 `install-latest.sh` 强制覆盖。

成功样例：任务 `feishu_ok`（如提交 `0cffe97…` / 报告 `cr-aff640fa…`），链接形如 `https://www.feishu.cn/wiki/...`，出现在「我的代码审核文档」下，标题/列表/代码块为文档块而非白文。

---

## 2. 走过的弯路（按时间）

| 现象 | 真实原因 | 正确做法 |
| --- | --- | --- |
| `no folder permission` | 个人云盘文件夹 + `tenant_access_token`，应用写不进去 | **不要用个人文件夹**；改走文档库 |
| 共享框搜不到应用 | 个人文件夹「邀请协作者」主要搜人/群 | 文档库用 **「已添加应用 / 添加应用」** |
| 想建群加机器人 | 官方对文件夹的旁路，体验差 | 文档库添加应用即可，**不必搞群机器人** |
| 只配 App ID/Secret，建出的文档「飞书里找不到」 | 文档建在应用空间，不在「我的文档库」树里 | 配 `wikiSpaceId`（+ 可选父节点）并给应用文档库编辑权 |
| URL 里 `/wiki/xxxx` 当 space_id | 那是 **节点 token** | space_id 是数字串；可用 `get_node` 接口从节点反查 |
| 开放平台 wiki 权限已开通仍 `permission denied` | 缺的是**资源侧**「文档库添加应用」 | 文档库 → 添加应用 → **可编辑** → 添加 |
| 插件重装界面仍是旧的「文件夹 Token」 | 市场已是 0.1.5，本机 `~/.dsh/profiles/web` 仍锁 `^0.1.1` | `./scripts/internal-market/install-latest.sh` |
| `curl 127.0.0.1:18787` 连不上 | Webhook 服务进程没开 | `cd dsh-remote-review && node lib/cli.js` 保持运行 |
| 飞书文档像「把 MD 源码当白文贴进去」 | 缺 `docx:document.block:convert`，旧逻辑曾降级为简单文本块 | 开通该权限并**发布版本**；当前代码转换失败则整单失败，不再降级 |
| 只 commit 不 push，飞书没有新报告 | 第二种依赖 GitHub Webhook，本地 commit  alone 不会打到公网入口 | `git push`（Payload URL 经 ngrok/公司入口到本机 `/webhook`） |

---

## 3. 和「以前多维表格」同一套路

多维表格能用，本质是：

1. 开放平台给应用开 **bitable/docx** 等接口权限并发布；  
2. 在**那张表 / 那个库**上把应用加成 **可编辑**（「添加应用」，不是搜用户）；  
3. 配置里只填 **appId / appSecret / 资源 ID**（表 token、文档库 space_id 等），落本机。

审码报告进文档库，完全对齐第 2、3 步：资源是 **wiki 文档库**，ID 是 `wikiSpaceId`（可选 `wikiParentNodeToken`）。

---

## 4. 正确配置清单（本机）

路径：`~/.zhongruan/remote-review/config.json`

| 字段 | 填什么 | 备注 |
| --- | --- | --- |
| `feishu.appId` / `appSecret` | 开放平台自建应用 | 设置页填，勿进仓库 |
| `feishu.wikiSpaceId` | 文档库数字 ID | **不是** URL `/wiki/` 后面那串 |
| `feishu.wikiParentNodeToken` | 可选；挂到某页下 | **就是** URL `/wiki/` 后面那串 |
| `feishu.folderToken` | 一般留空 | 个人云盘易踩坑 |
| `engine` | 如 `http://127.0.0.1:8000` | 跑审码的引擎 |
| `secret` | Webhook 共享密钥 | 与 GitHub Webhook Secret 一致 |

从 wiki 链接反查 space_id（示例）：

- 链接：`https://xxx.feishu.cn/wiki/Og7IwDu2Fi9VQwkIVnicIJl6n8b`  
- 节点 token：`Og7IwDu2Fi9VQwkIVnicIJl6n8b`  
- 接口：`GET /open-apis/wiki/v2/spaces/get_node?token=...` → 返回里的 `space_id`

本次联调实际值（可作自测参考，换环境请重查）：

- `wikiSpaceId`：`7573257760905969668`  
- 父节点：「我的代码审核文档」→ `Og7IwDu2Fi9VQwkIVnicIJl6n8b`

---

## 5. 飞书侧操作（最短路径）

1. 开放平台 → 权限：至少  
   - `docx:document` / `docx:document:create`  
   - **`docx:document.block:convert`（转换文本为云文档块）** — 没有它，报告无法按 Markdown 进文档  
   - `wiki:wiki`（及只读/列表类可一起开）  
   → **创建版本并发布**（只「已开通」未发布，线上仍可能无效）  
2. 打开目标 **文档库**（或库内页面）→ **已添加应用 / 添加应用**（不是「邀请协作者」搜人）  
3. 选 **DSH-WorkBuddy**，权限 **可编辑**，点添加  
4. 本机配置填 `wikiSpaceId`（和可选父节点）→ 保存 → 保证 `:18787` 服务在跑  

写入行为：调用飞书 `POST .../docx/v1/documents/blocks/convert`（`content_type: markdown`），再把转换后的块写入新建文档；正文为空或转换失败 → 任务失败，提示补权限。

---

## 6. 怎么测

服务：

```bash
cd dsh-remote-review && node lib/cli.js   # 监听 127.0.0.1:18787
```

只测飞书（有旧任务时）：

```bash
SECRET=$(python3 -c "import json;print(json.load(open('$HOME/.zhongruan/remote-review/config.json'))['secret'])")
curl -sS -X POST "http://127.0.0.1:18787/jobs/<jobId>/retry-feishu" \
  -H "X-Remote-Review-Secret: $SECRET"
```

期望：`status` = `feishu_ok`，`detail` / `feishuUrl` 为 `https://www.feishu.cn/wiki/...`；打开链接可见标题/列表/代码块（Markdown 已转换成功）。

整条链路（已验证）：GitHub **push** →（ngrok/公司入口）→ 本机 `/webhook` → 引擎 `/api/code-review/*` → 飞书 wiki 文档。详见配置说明；第二种需要 **push**，不是仅本地 commit。

---

## 7. 发版与本机装最新

```bash
./scripts/internal-market/pack.sh dsh-remote-review
./scripts/internal-market/upload.sh
./scripts/internal-market/install-latest.sh dsh-remote-review   # 强制覆盖 Profile 旧包
```

然后**完全退出并重启 WorkBuddy**，设置页应出现「文档库 space_id」等字段（≥ 0.1.5）。

市场 `plugins.json` 的 `install` 建议带精确版本：  
`dsh plugin --profile web add @zhongruan/dsh-remote-review@x.y.z`，避免 `^0.1.1` 锁死。

---

## 8. 网络与部署备忘（第二种完整形态）

| 路径 | 状态（本次环境） |
| --- | --- |
| 本机 + ngrok ← GitHub Webhook | 可联调 |
| 腾讯云 `175.178.238.31` 公网 Webhook | GitHub 入站/服务器出站 GitHub 曾不通，勿当默认 |
| 审码引擎 | 仍用现有 `/api/code-review/*`，插件不改引擎 |

---

## 9. 一句话备忘

> **接口权限发布（含 `docx:document.block:convert`）+ 文档库「添加应用·可编辑」+ 本机填 wikiSpaceId + 18787 常开 + push 触发 + 发版后 install-latest。**  
> 别用个人云盘文件夹，别把密钥写进仓库，别把 `/wiki/` 后面那串当成 space_id；报告必须走 Markdown 转块，不要指望纯文本降级。
