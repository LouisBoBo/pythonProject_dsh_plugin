# 公司内 DSH 插件全流程实施方案

> **状态**：已按本方案落地并完成 UI 安装验收（`@zhongruan/dsh-pcb-helper`）  
> **目标**：插件不上公开 npm；用户在 WorkBuddy「设置 → 插件市场」点安装即可使用；发新版无需用户重装桌面软件  
> **适用仓库**：  
>
> - 插件工程：`pythonProject_dsh_plugin`  
> - 产品宿主：`DSH-ZR-WorkBuddy`  
> **服务器**：`http://175.178.238.31`（SSH 密钥 `~/.ssh/tc_staging_deploy`）

---

## 目录

1. [方案一句话与边界](#1-方案一句话与边界)
2. [整体架构](#2-整体架构)
3. [角色与职责](#3-角色与职责)
4. [环境与前置条件](#4-环境与前置条件)
5. [插件开发规范](#5-插件开发规范)
6. [本地开发与调试](#6-本地开发与调试)
7. [打包与公司目录生成](#7-打包与公司目录生成)
8. [发布到服务器](#8-发布到服务器)
9. [WorkBuddy 如何发现公司市场](#9-workbuddy-如何发现公司市场)
10. [用户安装与使用](#10-用户安装与使用)
11. [版本升级与回滚](#11-版本升级与回滚)
12. [后期维护（多插件、日常运维）](#12-后期维护多插件日常运维)
13. [安全与合规](#13-安全与合规)
14. [故障排查](#14-故障排查)
15. [检查清单](#15-检查清单)
16. [目录与 URL 速查](#16-目录与-url-速查)

---



## 1. 方案一句话与边界



### 1.1 一句话

> **开发者写 DSH Bundle 插件 → 打成私有 npm 包 → 登记进公司** `plugins.json` **→ 上传服务器；WorkBuddy 启动时指向公司目录；用户在插件市场点安装。**



### 1.2 明确不做的事


| 不做                                           | 原因                            |
| -------------------------------------------- | ----------------------------- |
| 发布到公开 npmjs.com                              | 公司内用不允许全网可用                   |
| 登记 awesome-dsh-plugin / 申请收录                 | 公网市场目录                        |
| 把插件塞进 `features/` / `install-feature`        | 那是 WorkBuddy 自有热插拔通道，契约不同     |
| 并进 `mes-bridge` / `plugin.sh install bridge` | bridge 是唯一常驻 Cordis，禁止再堆业务正式包 |
| 每次发插件改桌面安装包                                  | 目录与制品在服务器；软件只固定「超市地址」         |




### 1.3 与 WorkBuddy「功能插件」的区别


|     | 公司 DSH 插件（本方案）              | WorkBuddy feature            |
| --- | --------------------------- | ---------------------------- |
| 入口  | 聊天壳 **设置 → 插件市场**           | 引擎 **功能插件** 页                |
| 形态  | npm Bundle + `dsh.bundle`   | `manifest.json` + `index.js` |
| 安装  | 市场一键 / `dsh plugin add`     | `install-feature`            |
| 示例  | `@zhongruan/dsh-pcb-helper` | `code-dev`、`mes-ask`         |


---



## 2. 整体架构

```text
┌─────────────────────────────────────────────────────────────┐
│  开发机：pythonProject_dsh_plugin                             │
│  · dsh-pcb-helper/     插件源码                               │
│  · scripts/internal-market/   pack / upload / generate        │
│  · company-registry/   生成物（plugins.json + npm packument） │
└──────────────────────────┬──────────────────────────────────┘
                           │ pack.sh + upload.sh
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  服务器 175.178.238.31                                        │
│  /www/wwwroot/dsh-plugins/                                    │
│    plugins.json              ← 市场「商品目录」                 │
│    npm/@zhongruan/...        ← 私有 npm（安装按钮真正下载处）   │
│    artifacts/                ← 备份用 tgz                      │
│  nginx：/dsh-plugins/ 静态服务（不走 :8000 反代）               │
└──────────────────────────┬──────────────────────────────────┘
                           │ DSHM_REGISTRY_URL
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  WorkBuddy（开发机 host.sh / 桌面一体包）                      │
│  company-dsh-market.env 写死市场地址（只配一次）               │
│  设置 → 插件市场 → 点安装 → Profile 写入 Bundle → 工具可用     │
└─────────────────────────────────────────────────────────────┘
```



### 2.1 为什么必须「私有 npm + GitHub 占位 URL」

dshmarket 安装接口安全策略：

1. 目录里的 `url` **必须**能解析成 `https://github.com/owner/repo` 形态
2. 真正安装优先用条目的 `npm` **字段**（包名）
3. **拒绝**任意 `http://服务器/xxx.tgz` → 报错 `unsupported source url`

因此公司方案是：

- `url`：GitHub **占位**（不必真有公开仓库，有 `npm` 时不会去拉）  
- `npm`：`@zhongruan/dsh-pcb-helper`  
- 私有源：`http://175.178.238.31/dsh-plugins/npm/`  
- Profile `.npmrc`：`@zhongruan:registry=...`

---



## 3. 角色与职责


| 角色                    | 负责                                   |
| --------------------- | ------------------------------------ |
| **插件开发者**             | 写代码、升版本、`pack.sh`、提测                 |
| **发布人 / 运维**          | `upload.sh`、nginx、检查 URL 200         |
| **产品 / WorkBuddy 维护** | 维护 `company-dsh-market.env`、桌面打包带上配置 |
| **终端用户**              | 打开市场 → 安装 / 更新；不重装软件                 |


---



## 4. 环境与前置条件



### 4.1 开发机


| 项       | 要求                                                  |
| ------- | --------------------------------------------------- |
| Node.js | ≥ 22.19（当前常用 22.23.x）                               |
| pnpm    | 已安装（与 DSH 一致即可）                                     |
| dsh CLI | 已安装（`dsh --version`）                                |
| 仓库      | `pythonProject_dsh_plugin` + 可访问 `DSH-ZR-WorkBuddy` |




### 4.2 服务器


| 项          | 值                                                                         |
| ---------- | ------------------------------------------------------------------------- |
| 主机         | `175.178.238.31`                                                          |
| SSH        | `ssh -i ~/.ssh/tc_staging_deploy root@175.178.238.31`                     |
| 静态目录       | `/www/wwwroot/dsh-plugins/`                                               |
| nginx 扩展配置 | `/www/server/panel/vhost/nginx/extension/175.178.238.31/dsh-plugins.conf` |


> 注意：该 IP 的 80 端口主站默认反代到 `:8000`。**必须**用 extension 把 `/dsh-plugins/` 指到静态目录，否则上传成功也会 404。



### 4.3 WorkBuddy

配置文件（改地址只改这里）：

```text
DSH-ZR-WorkBuddy/apps/zr-workbuddy/config/company-dsh-market.env
```

内容示例：

```env
DSHM_REGISTRY_URL=http://175.178.238.31/dsh-plugins/plugins.json
ZHONGRUAN_NPM_REGISTRY=http://175.178.238.31/dsh-plugins/npm/
```

启动时由 `host.sh` / `restart-dsh.sh` / `desktop/main.js` 自动注入，**不覆盖**用户已 export 的同名变量。

---



## 5. 插件开发规范



### 5.1 推荐目录结构

```text
dsh-my-plugin/
├── package.json          # name 建议 @zhongruan/xxx；含 dsh.bundle
├── cordis.patch.yml      # insert 行 name = 包名
├── tsconfig.json
├── src/
│   └── index.ts          # export name / inject / apply
└── lib/                  # tsc 产物（必须打进包）
```



### 5.2 package.json 必填

```json
{
  "name": "@zhongruan/dsh-xxx",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "files": ["lib", "cordis.patch.yml"],
  "scripts": { "build": "tsc" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" }
  },
  "dependencies": {
    "@deepseek-ai/cordis": "^4.0.2",
    "@deepseek-ai/dsh-tools": "0.1.1-rc.2"
  }
}
```

要点：

- **作用域** `@zhongruan/`：才能用公司私有 registry，且不影响公网其它包解析  
- **不要用** `prepare` **跑 build**：用户安装时只有 `lib/`，没有完整 TS 工程  
- **必须声明** `dsh.bundle`：否则 `dsh plugin add` 只当普通依赖，不进 bundles 层



### 5.3 cordis.patch.yml

```yaml
- insert:
    - id: 短唯一 id   # 如 pcb-helper
      name: '@zhongruan/dsh-xxx'   # 必须与 package.json name 一致
```



### 5.4 插件代码三要素

```typescript
export const name = 'my-plugin-id'
export const inject = ['tools'] as const

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({ /* ... */ }))
}
```

工具：`parameters` / `output.schema`（object 需 `additionalProperties`）/ `execute` / 中文 `description`。

### 5.5 参考实现

本仓库已有示例：`dsh-pcb-helper`  
工具：`pcb_parse_dimensions`、`pcb_count_bom`。

---



## 6. 本地开发与调试



### 6.1 改代码

```bash
cd /Users/hebo/Desktop/中软项目/pythonProject_dsh_plugin/dsh-pcb-helper
pnpm install
pnpm build
```



### 6.2 不经市场、最快验证工具逻辑

```bash
# 仅开发机临时
dsh plugin --profile web add ./dsh-pcb-helper
# 或 WorkBuddy：
cd /Users/hebo/ai_projects/DSH-ZR-WorkBuddy
scripts/host.sh restart-web
```

对话里调用工具即可。验证完可 `dsh plugin --profile web remove @zhongruan/dsh-pcb-helper`。

### 6.3 走「真市场」联调（推荐发版前）

1. `pack.sh` + `upload.sh`（见下节）
2. `scripts/host.sh restart-web`（已自动带公司目录）
3. 市场里卸掉旧版 → 再点安装

---



## 7. 打包与公司目录生成



### 7.1 一键命令

```bash
cd /Users/hebo/Desktop/中软项目/pythonProject_dsh_plugin
./scripts/internal-market/pack.sh
```



### 7.2 pack.sh 做什么

1. `pnpm install && pnpm build`
2. `pnpm pack` → `dist/zhongruan-dsh-pcb-helper-x.y.z.tgz`
3. 复制到 `company-registry/artifacts/`
4. 调用 `generate-registry.sh` 生成：
  - `company-registry/plugins.json`  
  - `company-registry/npm/@zhongruan/<name>/index.json`（packument）  
  - `company-registry/npm/@zhongruan/<name>/-/<name>-x.y.z.tgz`



### 7.3 plugins.json 条目约定

```json
{
  "name": "@zhongruan/dsh-pcb-helper",
  "owner": "中软",
  "url": "https://github.com/zhongruan/dsh-pcb-helper",
  "category": "tools",
  "description": { "zh": "...", "en": "..." },
  "npm": "@zhongruan/dsh-pcb-helper",
  "version": "0.1.0",
  "install": "dsh plugin --profile web add @zhongruan/dsh-pcb-helper",
  "added": "2026-09-09"
}
```

- `url`：GitHub 形态占位（可改为你们真实私有仓地址，但须仍是 `github.com/owner/repo`）  
- `npm`：与包名一致  
- `category`：须在顶层 `categories` 中定义



### 7.4 多插件时

当前脚本按「单插件工程」生成。多个插件时建议：

1. 每个插件各自 `pack`
2. 合并进同一份 `plugins.json` 的 `plugins[]`
3. `count` 改为数组长度
4. `npm/` 下按 scope/name 并列多个包

（后续可把 `generate-registry.sh` 扩展为扫描多个包目录。）

---



## 8. 发布到服务器



### 8.1 一键上传

```bash
cd /Users/hebo/Desktop/中软项目/pythonProject_dsh_plugin
./scripts/internal-market/upload.sh
```

内部使用：

```bash
ssh/scp/rsync -i ~/.ssh/tc_staging_deploy root@175.178.238.31
→ /www/wwwroot/dsh-plugins/
```



### 8.2 发布后立刻验收

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  http://175.178.238.31/dsh-plugins/plugins.json

curl -sS -o /dev/null -w "%{http_code}\n" \
  http://175.178.238.31/dsh-plugins/npm/@zhongruan/dsh-pcb-helper

curl -sS -o /dev/null -w "%{http_code}\n" \
  "http://175.178.238.31/dsh-plugins/npm/@zhongruan/dsh-pcb-helper/-/dsh-pcb-helper-0.1.0.tgz"
```

三项均应为 **200**。

### 8.3 nginx（已配置，勿随意删）

扩展文件：

`/www/server/panel/vhost/nginx/extension/175.178.238.31/dsh-plugins.conf`

作用：

- `/dsh-plugins/` → `/www/wwwroot/dsh-plugins/`  
- `/dsh-plugins/npm/@scope/name` → 对应 `index.json`（packument）

改完后：

```bash
nginx -t && nginx -s reload
```



### 8.4 标准发版口令（复制即用）

```bash
cd /Users/hebo/Desktop/中软项目/pythonProject_dsh_plugin
# 1. 改 dsh-pcb-helper/package.json 的 version
# 2. 打包
./scripts/internal-market/pack.sh xxxx
# 3. 上传
./scripts/internal-market/upload.sh
# 4. curl 三项 200
# 5. 通知用户：市场刷新 / 更新插件
```

---



## 9. WorkBuddy 如何发现公司市场



### 9.1 配置文件

`DSH-ZR-WorkBuddy/apps/zr-workbuddy/config/company-dsh-market.env`

### 9.2 谁在启动时注入


| 入口                                          | 行为                             |
| ------------------------------------------- | ------------------------------ |
| `scripts/host.sh start-web` / `restart-web` | `apply_company_dsh_market`     |
| `scripts/restart-dsh.sh`                    | 同上                             |
| `scripts/host.sh wire`                      | 写入 profile `.npmrc`            |
| `desktop/main.js`                           | 桌面隔离 `DSH_HOME` 同样注入 + 写 npmrc |




### 9.3 Profile `.npmrc` 标记块

```ini
# --- company-dsh-market ---
@zhongruan:registry=http://175.178.238.31/dsh-plugins/npm/
strict-ssl=false
# --- /company-dsh-market ---
```

脚本**只改这一块**，其它 `.npmrc` 内容保留。

### 9.4 临时看公网市场

```bash
export DSHM_REGISTRY_URL=
scripts/host.sh restart-web
```

恢复公司市场：取消该 export，再 restart。

### 9.5 桌面一体包

打包时会带上 `apps/zr-workbuddy/config/company-dsh-market.env`（勿忽略该文件）。  
用户安装桌面版后：**无需**手动 export；市场直接读公司目录。

---



## 10. 用户安装与使用



### 10.1 安装步骤

1. 打开 WorkBuddy（`:3080` 或桌面壳）
2. **设置 → 插件市场**
3. 确认「全部」数量为公司目录规模（当前为 1，不是 3.4k）
4. 搜索插件名 / 关键词
5. 点 **安装**，等待任务完成
6. **已安装** 中确认 **已启用 / 运行中**



### 10.2 使用

回到对话，按插件说明调用。示例：

```text
请用 pcb_parse_dimensions 解析尺寸 120x80mm
```

```text
请用 pcb_count_bom 统计：
R1,10
C2,20
U3,1
```



### 10.3 卸载

市场「已安装」里卸载，或：

```bash
dsh plugin --profile web remove @zhongruan/dsh-pcb-helper
```

桌面隔离 profile 时，在对应 `DSH_HOME` 下操作 / 用市场 UI 卸载。

---



## 11. 版本升级与回滚



### 11.1 升级（开发者）

1. 改 `package.json` → `version`（建议 semver：`0.1.0` → `0.1.1` / `0.2.0`）
2. 改代码 → `pnpm build`
3. `./scripts/internal-market/pack.sh`
4. `./scripts/internal-market/upload.sh`
5. 用户：市场里对该插件点 **更新**，或卸了再装



### 11.2 用户是否要重装桌面软件？

**不需要。** 新版本只在服务器目录；软件里的 `DSHM_REGISTRY_URL` 不变。

### 11.3 回滚

1. 把旧版 tgz / packument / plugins.json 的 version 指回旧版后重新 upload
2. 或保留 `artifacts/` 历史包，手动改 packument 的 `dist-tags.latest`
3. 用户卸旧装新 / 点更新

建议在服务器或制品库保留最近 N 个版本的 tgz。

---



## 12. 后期维护（多插件、日常运维）



### 12.1 新增第二个公司插件

1. 新建 `@zhongruan/dsh-yyy` 工程（规范同 §5）
2. 扩展打包脚本或手工合并 `plugins.json`
3. 将 npm packument 放到 `npm/@zhongruan/dsh-yyy/`
4. upload → 市场刷新可见



### 12.2 改服务器地址 / 域名

只改两处并重启 / 重打包桌面：

1. `pythonProject_dsh_plugin/company-registry/config.env` 的 `BASE_URL`
2. `DSH-ZR-WorkBuddy/.../company-dsh-market.env`

然后重新 pack + upload；已安装用户更新软件或改 env 后重启。

### 12.3 监控建议


| 检查                            | 频率         |
| ----------------------------- | ---------- |
| 三个 URL 是否 200                 | 发版后 + 每日巡检 |
| nginx 错误日志                    | 有用户报装不上时   |
| 磁盘 `/www/wwwroot/dsh-plugins` | 按月         |




### 12.4 备份

定期备份：

```text
/www/wwwroot/dsh-plugins/
nginx extension dsh-plugins.conf
company-dsh-market.env
```

---



## 13. 安全与合规


| 项                  | 说明                                |
| ------------------ | --------------------------------- |
| 不上公开 npm           | 外网默认装不到 `@zhongruan/*`            |
| 市场白名单              | 只装 `plugins.json` 中登记的条目          |
| GitHub 占位 URL      | 勿填成不可信第三方仓；有 `npm` 时不会拉占位仓        |
| `strict-ssl=false` | 因私有源为 http；仅写在公司标记块；生产可后续升级 https |
| SSH 密钥             | 使用 `tc_staging_deploy`，勿提交到 git   |
| 插件代码信任             | 收录 ≠ 审计；只上架评审过的包                  |


**建议后续**：给 `dsh-plugins` 配 HTTPS（证书），去掉 `strict-ssl=false`。

---



## 14. 故障排查


| 现象                              | 原因                               | 处理                                            |
| ------------------------------- | -------------------------------- | --------------------------------------------- |
| 市场仍是 3.4k                       | 未注入 `DSHM_REGISTRY_URL`          | `host.sh restart-web`；查是否被空 export 覆盖         |
| 搜得到但安装 `unsupported source url` | 条目只有 http tarball、无合法 npm/GitHub | 用本方案的 npm + 占位 url 重新 generate/upload         |
| 安装失败找不到包                        | `.npmrc` 无 `@zhongruan:registry` | 再跑一次 `apply_company_dsh_market` / restart-web |
| plugins.json 404                | nginx 未放行 `/dsh-plugins/`        | 查 extension conf 并 reload                     |
| 装上了工具不可用                        | Bundle 未进 profile / 未重启          | `dsh --dump-config` 看是否有层；重启 web              |
| `dsh web` 不像 WorkBuddy          | 开的是空壳                            | 用 `scripts/host.sh restart-web`               |
| scp Permission denied           | 未带部署密钥                           | `-i ~/.ssh/tc_staging_deploy`                 |


---



## 15. 检查清单



### 15.1 新插件首次上架

- [ ] `package.json`：`@zhongruan/...`、`dsh.bundle`、`main: lib/index.js`  
- [ ] `cordis.patch.yml` name 与包名一致  
- [ ] `pnpm build` 无错  
- [ ] `pack.sh` 成功  
- [ ] `upload.sh` 成功  
- [ ] 三个 HTTP 200  
- [ ] WorkBuddy 市场「全部」为公司数量  
- [ ] **用户自己点安装**成功（不要只靠开发者 CLI add）  
- [ ] 对话调用工具成功  



### 15.2 发版升级

- [ ] version 已 bump  
- [ ] pack + upload  
- [ ] 市场可见新版本 / 可更新  
- [ ] 冒烟工具  



### 15.3 桌面发版（产品包）

- [ ] 含 `company-dsh-market.env`  
- [ ] 新装用户无需手动 export  
- [ ] 插件市场为公司目录  

---



## 16. 目录与 URL 速查



### 16.1 本机插件工程

```text
pythonProject_dsh_plugin/
├── dsh-pcb-helper/                 # 插件源码
├── company-registry/
│   ├── config.env                  # BASE_URL=http://175.178.238.31/dsh-plugins
│   ├── plugins.json                # 生成物
│   ├── artifacts/                  # tgz 备份
│   └── npm/@zhongruan/...          # 私有 npm 生成物
├── scripts/internal-market/
│   ├── pack.sh
│   ├── upload.sh
│   ├── generate-registry.sh
│   ├── serve.sh                    # 仅本地假目录（可选）
│   └── verify.sh
└── docs/
    ├── README.md                              ← 文档目录索引
    ├── dsh插件开发.md
    ├── dsh-插件发现与调用说明.md
    ├── dsh-pcb-helper-公司内网插件市场.md
    ├── dsh-pcb-helper-公司插件全流程实施方案.md  ← 本文
    ├── dsh-pcb-helper-WorkBuddy安装.md
    ├── dsh-pcb-helper-上线安装设计.md
    ├── workbuddy-插件安装卡在gh-proxy.md
    ├── pcb-8d-完整模拟报告样例.md
    ├── ide-commit-hook-自动审码-MVP.md         ← 本机 Hook 审码
    └── remote-push-服务器审码-方案确认.md       ← 远端 push 审码（方案）
```

另有示例插件目录：`dsh-pcb-helper/`、`dsh-weather/`、`dsh-pcb-8d/`；  
本机 Hook 脚本：`scripts/hook-review/`。



### 16.2 WorkBuddy

```text
DSH-ZR-WorkBuddy/
├── apps/zr-workbuddy/config/company-dsh-market.env
├── scripts/lib/company_dsh_market.sh
├── scripts/host.sh                 # 已接入
├── scripts/restart-dsh.sh          # 已接入
└── desktop/main.js                 # 已接入
```



### 16.3 线上 URL


| 用途           | URL                                                                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 市场目录         | [http://175.178.238.31/dsh-plugins/plugins.json](http://175.178.238.31/dsh-plugins/plugins.json)                                                                                         |
| 私有 npm 根     | [http://175.178.238.31/dsh-plugins/npm/](http://175.178.238.31/dsh-plugins/npm/)                                                                                                         |
| 示例 packument | [http://175.178.238.31/dsh-plugins/npm/@zhongruan/dsh-pcb-helper](http://175.178.238.31/dsh-plugins/npm/@zhongruan/dsh-pcb-helper)                                                       |
| 示例 tarball   | [http://175.178.238.31/dsh-plugins/npm/@zhongruan/dsh-pcb-helper/-/dsh-pcb-helper-0.1.0.tgz](http://175.178.238.31/dsh-plugins/npm/@zhongruan/dsh-pcb-helper/-/dsh-pcb-helper-0.1.0.tgz) |




### 16.4 日常三板斧

```bash
# 开发/发版机
cd /Users/hebo/Desktop/中软项目/pythonProject_dsh_plugin
./scripts/internal-market/pack.sh && ./scripts/internal-market/upload.sh

# 用户侧宿主
cd /Users/hebo/ai_projects/DSH-ZR-WorkBuddy
scripts/host.sh restart-web
# → 设置 → 插件市场 → 安装 / 更新
```

---



## 附录 A：已验收结论（截至本文编写）


| 项                                | 结果                  |
| -------------------------------- | ------------------- |
| 公司目录替换公网 3.4k                    | 通过（全部 1）            |
| 市场展示 `@zhongruan/dsh-pcb-helper` | 通过                  |
| 用户手动点安装                          | 通过                  |
| CLI 私有 npm add                   | 通过                  |
| 服务器静态 /dsh-plugins               | 通过（nginx extension） |


---



## 附录 B：相关文档

完整索引见 **[docs/README.md](./README.md)**。


| 文档 | 内容 |
| --- | --- |
| [README.md](./README.md) | 文档目录索引 |
| [dsh插件开发.md](./dsh插件开发.md) | DSH 插件开发基础六步 |
| [dsh-插件发现与调用说明.md](./dsh-插件发现与调用说明.md) | 市场发现与对话调用 |
| [dsh-pcb-helper-公司内网插件市场.md](./dsh-pcb-helper-公司内网插件市场.md) | 市场方案说明与脚本 |
| [dsh-pcb-helper-WorkBuddy安装.md](./dsh-pcb-helper-WorkBuddy安装.md) | 开发机手动 add（早期路径） |
| [dsh-pcb-helper-上线安装设计.md](./dsh-pcb-helper-上线安装设计.md) | 预装/清单型方案（与市场方案互补） |
| [workbuddy-插件安装卡在gh-proxy.md](./workbuddy-插件安装卡在gh-proxy.md) | 安装卡在 gh-proxy 排障 |
| [ide-commit-hook-自动审码-MVP.md](./ide-commit-hook-自动审码-MVP.md) | 本机 commit Hook → 审码 |
| [remote-push-服务器审码-方案确认.md](./remote-push-服务器审码-方案确认.md) | 远端 push → 服务器审码（方案已确认） |


---

*文档版本：v1.1 | 维护：随 pack/upload/host 脚本变更同步更新本文 §7–§9、§16；文档清单以 README.md 为准*
