# 远端审码：配置文件大白话说明

> 给「第二种：Webhook + 飞书文档」用。  
> 对应插件：`dsh-remote-review`（`@zhongruan/dsh-remote-review`）  
> 方案全文：[remote-push-服务器审码-方案确认.md](./remote-push-服务器审码-方案确认.md)  
> 飞书文档库联调踩坑：[remote-review-飞书文档库联调复盘.md](./remote-review-飞书文档库联调复盘.md)

---

## 一句话：用户在 WorkBuddy 设置页配，别写进项目仓库

| 要不要写这里 | 说明 |
| --- | --- |
| ❌ 业务代码仓库（你们日常开发的那个 git 仓） | **不要**放飞书 Secret、Webhook 密钥、`config.json` |
| ❌ 本插件源码仓 `pythonProject_dsh_plugin` / `dsh-remote-review/` | **不要**写死 App ID、文件夹 token、公司密钥 |
| ✅ WorkBuddy **设置 → 远端审码**（图形界面） | **普通用户首选**：填飞书、保存、装 Hook |
| ✅ 每个用户本机：`~/.zhongruan/remote-review/config.json` | 设置页保存后的落点（按人、按机器） |
| ✅ 本机环境变量（可选） | 运维/脚本用，不进 git |
| ✅ 对话工具 `remote_review_config` | 备选；密钥会进对话，不如设置页 |

插件包里只有空默认值（端口默认 18787、引擎默认本机 8000），**没有**你们公司的飞书账号。  
每人装完插件后，自己在设置页配；换人、换电脑互不影响，也不会把密钥提交进代码库。

---

## 真实实用场景：用户要在哪操作

### 首选：WorkBuddy「设置 → 远端审码」（图形界面）

装好插件并重启 / 重新打开 WorkBuddy 后：

1. 打开 **设置**
2. 左侧点 **远端审码**（和「WorkBuddy」配置中心同级）
3. 在页面里填写：
   - 飞书 App ID / App Secret
   - **文档库 space_id**（推荐）+ 可选父节点 token；文件夹 Token 一般留空
   - （可选）Webhook 密钥、引擎地址
   - （可选）业务仓库路径 → 点「安装提交 Hook」
4. 点 **保存配置**

保存后写到本机 `~/.zhongruan/remote-review/config.json`，**不会写进业务项目**。  
普通用户只需会点设置页，不必懂改电脑文件。

### 场景 A：开发者本机 + GitHub push → 自动审 → 飞书文档（已联调通）

1. **装插件**  
   WorkBuddy → 设置 → 插件市场 → 安装 `@zhongruan/dsh-remote-review`

2. **在「设置 → 远端审码」填飞书**（wikiSpaceId 等，见上）

3. **确认服务在跑**  
   `cd dsh-remote-review && node lib/cli.js`，或设置页「检测服务」  
   `http://127.0.0.1:18787/health` 里 `feishuReady: true`

4. **GitHub Webhook** 指到本机入口（联调常用 ngrok → `…/webhook`），Secret 与本机一致

5. **`git push`**（不是只 commit）→ 审码 → 飞书 wiki 出现 **Markdown 转换后的**结构化文档

说明：本机 Hook（post-commit）是旁路；「第二种」主路径是 **远端 push → Webhook**。

### 场景 B：公司服务器 `175.178.238.31`（GitLab / GitHub push）

已独立部署，**不影响** `/dsh-plugins` 市场与其它服务：

| 项 | 值 |
| --- | --- |
| 健康检查 | `http://175.178.238.31/remote-review/health` |
| GitHub / GitLab **Payload URL** | `http://175.178.238.31/remote-review/webhook` |
| Content-Type | `application/json` |
| Secret | 与服务器 `/www/wwwroot/dsh-remote-review/server.env` 里 `REMOTE_REVIEW_SECRET` 一致（公网强制密钥） |
| 本机进程 | 仅 `127.0.0.1:18787`，nginx 反代 `/remote-review/` |

飞书仍在 **跑服务那台机器** 上配（`server.env` 或设置页连公司服务器后保存）。  
设置页可点「填公司服务器」：host=`175.178.238.31`、port=`80`、路径前缀=`/remote-review`。

---

## 配置文件在哪（本机自动生成，用户一般不用手改）

路径（Mac / Linux）：

```text
~/.zhongruan/remote-review/config.json
```

- **正常用法**：在「设置 → 远端审码」点保存，系统自动写这个文件。  
- 运维/排错时才需要打开看；**不要**教普通用户用记事本改。  
- 这个文件在用户家目录，**默认不会进任何 git 仓库**。

---

## 完整模板（复制到本机 config.json，改成你的）

```json
{
  "engine": "http://127.0.0.1:8000",
  "listen": "127.0.0.1",
  "port": 18787,
  "secret": "自己设一串别告诉别人的随机字符",
  "workspaceRoot": "/Users/你的用户名/.zhongruan/remote-review/workspaces",
  "dataRoot": "/Users/你的用户名/.zhongruan/remote-review",
  "feishu": {
    "appId": "cli_xxxxxxxx",
    "appSecret": "xxxxxxxxxxxxxxxx",
    "wikiSpaceId": "7573257760905969668",
    "wikiParentNodeToken": "Og7IwDu2Fi9VQwkIVnicIJl6n8b",
    "folderToken": ""
  }
}
```

### 每一项是什么意思

| 字段 | 大白话 | 本地测试怎么填 |
| --- | --- | --- |
| `engine` | WorkBuddy **审码引擎**地址 | 本机一般 `http://127.0.0.1:8000` |
| `listen` | Webhook 绑哪块网卡 | 本机自测填 `127.0.0.1` |
| `port` | Webhook 端口 | 默认 `18787` |
| `secret` | 敲门暗号 | 本机可暂空；对外必填 |
| `workspaceRoot` / `dataRoot` | 本机数据目录 | 保持默认即可 |
| `feishu.appId` | 飞书自建应用 App ID | 开放平台复制 |
| `feishu.appSecret` | App Secret | 同上（别进 git、别发群） |
| `feishu.wikiSpaceId` | **推荐**：文档库 space_id，报告出现在「我的文档库」 | 接口查，不是 URL 里那串 |
| `feishu.wikiParentNodeToken` | 可选：挂到某 wiki 页面下 | URL `/wiki/` 后面那串 |
| `feishu.folderToken` | 备用：个人云盘文件夹（常因权限失败） | 一般留空 |

配好后本机地址：

```text
http://127.0.0.1:18787/webhook
```

健康检查：

```text
http://127.0.0.1:18787/health
```

---

## 飞书从哪来（开放平台 + 本机填写，不是项目配置）

### App ID、App Secret

1. 打开 [飞书开放平台](https://open.feishu.cn/)  
2. 企业自建应用 → **凭证与基础信息**  
3. 复制 App ID、App Secret  
4. 权限（开通后须 **创建版本并发布**）：  
   - 创建/编辑新版文档、**wiki 文档库**相关权限  
   - **必开**：`docx:document.block:convert`（界面名：**转换文本为云文档块**）  
     审码报告按 Markdown 写入飞书依赖它；缺权限时任务失败，不会再降级成白文。  

### wikiSpaceId（要出现在「我的文档库」时填）

- URL 里 `/wiki/xxxx` 的 xxxx 是**节点 token**，不是 space_id。  
- space_id 是一串数字；可问已配好的同事，或本机 `GET http://127.0.0.1:18787/api/feishu/wiki-spaces`。  
- 文档库成员里把应用加成**可编辑**。  
- 可选再填 `wikiParentNodeToken`（节点 token），报告挂到该页下面。  

### folderToken（一般不用）

个人云盘文件夹 token；应用很难有写权限，优先用文档库。

---

## 环境变量（可选，仍是本机，不是项目）

启动前在**自己的终端** export（不要写进仓库的 `.env` 再提交）：

```bash
export FEISHU_APP_ID='cli_xxxx'
export FEISHU_APP_SECRET='xxxx'
export FEISHU_WIKI_SPACE_ID='7573…'
export FEISHU_WIKI_PARENT_NODE='Og7I…'
export FEISHU_FOLDER_TOKEN=''
export REMOTE_REVIEW_SECRET='你的Webhook暗号'
export WORKBUDDY_ENGINE='http://127.0.0.1:8000'
```

规则：**环境变量优先于本机 config.json**。

| 变量 | 用途 |
| --- | --- |
| `REMOTE_REVIEW_PORT` | 端口 |
| `REMOTE_REVIEW_LISTEN` | 监听地址 |
| `REMOTE_REVIEW_ALLOWED_HOSTS` | 允许 clone 的 Git 主机（逗号分隔） |

---

## Webhook「地址」填在哪

| 场景 | 填哪里 | 填什么 |
| --- | --- | --- |
| IDE 提交（本机服务） | 一般不用手填；`install_hook` 写 `.git/hooks/post-commit` | `http://127.0.0.1:18787/webhook` |
| IDE / Git → 公司服务器 | GitHub/GitLab Settings → Webhooks | **`http://175.178.238.31/remote-review/webhook`** + Secret |
| 飞书后台 | **不用填 Webhook URL** | 只提供 App 凭据 |

说明：`.git/hooks/` 通常不进 git，密钥仍只在本机 `config.json` / 环境变量里。

---

## 配完怎么确认

1. 引擎开着、审码车道就绪  
2. Webhook 服务开着（`node lib/cli.js` 或插件拉起）  
3. `health` 里 `feishuReady: true`  
4. **push** 一次（或对已有任务 `retry-feishu`）  
5. `/jobs` 里 `feishu_ok`，打开 wiki 链接：标题/列表/代码块正常（说明 Markdown 转块成功）  

未配飞书时：`feishu_pending`，报告在本机 `~/.zhongruan/remote-review/feishu-out/`，配好后可 `remote_review_retry_feishu` 补发。  
若报错含 `document.block:convert`：回开放平台开通该权限并发布后再补发。

---

## 常见误会

| 误会 | 正解 |
| --- | --- |
| 在业务项目里加 `config.json` / `.env` 提交 | **禁止**；配在用户家目录或本机环境变量 |
| 把飞书 Secret 写进插件源码再发包 | **禁止**；插件只带空默认 |
| 去飞书后台配审码 Webhook URL | 飞书只管 App；URL 在 Hook / Git 平台 |
| 只配飞书、不启动服务 | 没人听 18787 |
| 只启动服务、引擎没开 | 能接到请求但审码失败 |
| 改完本机 config 不重启服务 | 可能仍用旧配置 |
| 飞书文档是白文、像 MD 源码 | 缺「转换文本为云文档块」权限，或未发布版本 |
| 只 commit 不 push | 第二种 Webhook 收不到；需要 push |

---

## 和方案文档的关系

- 原理与链路：[remote-push-服务器审码-方案确认.md](./remote-push-服务器审码-方案确认.md)  
- 第一种（本机 Hook 直调引擎）：[ide-commit-hook-自动审码-MVP.md](./ide-commit-hook-自动审码-MVP.md)  
- 本文只讲：**真实用户在哪配、为什么不能写死在项目里**。
