# dsh-pcb-helper 公司内网安装（用户 UI 点装）

> 场景：WorkBuddy / DSH **已经上线**，插件**不上公开 npm**；用户在公司 App 里 **设置 → 插件市场** 搜索并安装。  
> 关联：[dsh插件开发.md](./dsh插件开发.md) · [dsh-pcb-helper-WorkBuddy安装.md](./dsh-pcb-helper-WorkBuddy安装.md)

---

## 1. 一句话说明

```text
插件打成 .tgz 放内网 → 公司维护 plugins.json 目录 → WorkBuddy 启动时指向该目录
→ 用户在「设置 → 插件市场」里点安装
```

**不需要公开 npm**，**不需要用户敲命令**。

---

## 2. 和 WorkBuddy 里其它「插件」别混

| 入口 | 装什么 | 你的 pcb 插件 |
|---|---|---|
| 引擎 `:8000` → **功能插件** | WorkBuddy 自有 `features/` | ❌ 不能走这里 |
| 聊天 `:3080` → **设置 → 插件市场** | DSH 生态 Bundle | ✅ 走这里 |
| 聊天 `:3080` → 左侧 **插件中心** | Studio 官方插件 | 可选，内网一般只用插件市场 |

---

## 3. 整体流程

```mermaid
flowchart LR
    A[作者 build + pack] --> B[上传 tgz 到内网]
    B --> C[更新 plugins.json]
    C --> D[WorkBuddy 配置 DSHM_REGISTRY_URL]
    D --> E[用户打开插件市场]
    E --> F[搜索并安装]
    F --> G[对话中使用工具]
```

---

## 4. 插件作者：打包与发布

### 4.1 构建

```bash
cd dsh-pcb-helper
pnpm install
pnpm build
```

确认存在 `lib/index.js`，且 `package.json` 含 `dsh.bundle` 声明。

### 4.2 打安装包（tgz）

```bash
pnpm pack
# 生成 dsh-pcb-helper-0.1.0.tgz
```

### 4.3 上传到内网制品库

将 tgz 放到内网可 HTTPS 下载的位置，例如：

```text
https://plugins.example.corp/artifacts/dsh-pcb-helper-0.1.0.tgz
```

可用 Nginx 静态目录、MinIO、GitLab Release 附件等。

### 4.4 发新版本

1. 修改 `package.json` 的 `version`
2. 重新 `pnpm build && pnpm pack`
3. 上传新 tgz
4. 更新公司 `plugins.json` 中的 `version`、`tarball`、`install`（见 §5）

---

## 5. 运维：维护公司插件目录 plugins.json

### 5.1 托管位置

在内网部署一份 JSON，例如：

```text
https://plugins.example.corp/plugins.json
```

### 5.2 最小示例（仅 dsh-pcb-helper）

```json
{
  "name": "company-dsh-plugins",
  "url": "https://plugins.example.corp",
  "updated": "2026-09-08",
  "count": 1,
  "categories": {
    "tools": {
      "en": "Tools & Capabilities",
      "zh": "工具与能力"
    }
  },
  "plugins": [
    {
      "name": "dsh-pcb-helper",
      "owner": "中软",
      "url": "https://git.example.corp/dsh-pcb-helper",
      "category": "tools",
      "description": {
        "zh": "PCB 尺寸解析、BOM 清单统计",
        "en": "PCB dimension parsing and BOM counting"
      },
      "npm": null,
      "tarball": "https://plugins.example.corp/artifacts/dsh-pcb-helper-0.1.0.tgz",
      "version": "0.1.0",
      "install": "dsh plugin --profile web add https://plugins.example.corp/artifacts/dsh-pcb-helper-0.1.0.tgz",
      "added": "2026-09-08"
    }
  ]
}
```

### 5.3 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 插件 id，与 npm 包名一致 |
| `category` | 是 | 分类 key，需在 `categories` 里定义 |
| `description.zh` | 推荐 | 市场里显示的中文说明 |
| `tarball` | 推荐 | 预构建 tgz 地址，安装最快 |
| `install` | 是 | 市场点击安装时执行的 spec（与 tarball 一致） |
| `version` | 推荐 | 展示用版本号 |
| `npm` | 否 | 内网方案填 `null`，不走公开 npm |

> 插件市场（dshmarket）**只允许安装目录里登记过的来源**，相当于公司白名单。未写入 `plugins.json` 的包，用户在市场里搜不到也装不了。

---

## 6. WorkBuddy：指向公司目录

WorkBuddy 内嵌 **dshmarket**，默认读公网 `awesome-dsh-plugin.com/plugins.json`。

改为读公司内网目录，启动 DSH 时设置环境变量：

```bash
export DSHM_REGISTRY_URL=https://plugins.example.corp/plugins.json
dsh web
```

### 6.1 开发机（host.sh 启动）

在 `scripts/host.sh` 启动 web 的逻辑中注入，例如：

```bash
export DSHM_REGISTRY_URL=https://plugins.example.corp/plugins.json
dsh web --no-open
```

或写入运维统一的环境配置文件，由 `scripts/host.sh start-web` / `ensure-web` 加载。

### 6.2 一体桌面版

在启动内嵌 DSH 进程时传入同一环境变量（`desktop/main.js` 里 spawn 时的 `env`）。

### 6.3 验证配置生效

1. 打开 **设置 → 插件市场**
2. 应能看到 `dsh-pcb-helper`（不应再是完整公网几千条列表，除非你们合并了公网目录）
3. 若列表为空或报错，检查内网 URL 是否可达、JSON 格式是否正确

---

## 7. 用户安装步骤（无需命令行）

1. 打开 WorkBuddy 聊天界面（通常 `http://127.0.0.1:3080`）
2. 进入 **设置 → 插件市场**
3. 搜索 `pcb` 或 `dsh-pcb-helper`
4. 点击 **安装**，等待进度完成
5. 在 **已安装** 中确认状态为 **已启用 / 运行中**
6. 回到对话测试：

   ```
   请用 pcb_parse_dimensions 解析尺寸 120x80mm
   ```

   ```
   请用 pcb_count_bom 统计以下 BOM：
   R1,10
   C2,20
   U3,1
   ```

安装过程中市场会自动下载 tgz、写入 Profile、必要时重启 Host，用户无需执行 `dsh plugin add`。

---

## 8. 可选方案

### 8.1 内网 GitLab Release

- 每个版本在 GitLab 打 Release，附件为 `pnpm pack` 产物
- `plugins.json` 的 `tarball` 指向 Release 下载 URL

### 8.2 私有 npm（Verdaccio / GitHub Packages）

- 插件发布到内网 npm
- `plugins.json` 中设置 `"npm": "dsh-pcb-helper"`，`install` 为 `dsh plugin --profile web add dsh-pcb-helper`
- 需在 profile 或 `.npmrc` 配置内网 registry 地址

### 8.3 与公网市场并存

若希望内网既显示公司插件、又显示公网插件，需自行**合并两份 plugins.json** 后托管到内网 URL，再设 `DSHM_REGISTRY_URL` 指向合并后的文件（维护成本更高，一般公司内仅放自有插件即可）。

---

## 9. 安全与治理

| 项 | 说明 |
|---|---|
| 白名单 | 仅 `plugins.json` 内登记的插件可一键安装 |
| 上架 | 新发版 = 上传 tgz + 更新目录，由你们内部审批 |
| 外网 | 内网 tgz / 内网 JSON 外网不可访问，插件不会泄露到公网 |
| 信任 | 收录不等于安全审计，只安装来源可信的插件 |
| 备份 | 市场备份功能可能含 profile 配置，按公司规范处理 |

---

## 10. 常见问题

| 现象 | 处理 |
|---|---|
| 设置里没有「插件市场」 | 确认 profile 已装 `dshmarket`；一体桌面版通常已内嵌 |
| 市场列表为空 | 检查 `DSHM_REGISTRY_URL` 是否配置、内网 JSON 是否可访问 |
| 安装失败 | 确认 tgz URL 可下载、`lib/index.js` 已打进包、`dsh.bundle` 声明正确 |
| 装完工具不可用 | 看 Host 日志是否有 `[pcb-helper] 插件已加载`；已安装页是否「运行中」 |
| 搜不到插件 | 检查 `plugins.json` 是否已更新、浏览器重进市场页 |

---

## 11. 与公开 npm 方案对比

| | 公开 npm + 公网市场 | 公司内网（本文） |
|---|---|---|
| 插件存放 | npmjs.com | 内网 `.tgz` 或私有 npm |
| 市场目录 | awesome-dsh-plugin | **自建 `plugins.json`** |
| 用户安装方式 | 插件市场 UI | **同样是插件市场 UI** |
| 审核 | npm 无人工审核 | **公司管目录**（不上目录 = 不可装） |
| 适用 | 对外分发 | **仅公司内** |

---

## 12. 检查清单

### 作者发版

- [ ] `pnpm build` 成功，`lib/index.js` 存在
- [ ] `pnpm pack` 生成 tgz
- [ ] tgz 已上传内网 HTTPS 地址
- [ ] `plugins.json` 已更新 version / tarball / install

### 运维

- [ ] `plugins.json` 内网可访问
- [ ] WorkBuddy 启动环境含 `DSHM_REGISTRY_URL`
- [ ] 插件市场页面能列出 `dsh-pcb-helper`

### 用户验收

- [ ] 市场内搜索 → 安装 → 已安装显示运行中
- [ ] 对话中 `pcb_parse_dimensions` / `pcb_count_bom` 可调用

---

## 13. 本仓库已提供的实施脚本（本地联调）

已在项目中落地目录与脚本，**默认仅本地 127.0.0.1:8790**，未修改 WorkBuddy 仓库。

```text
company-registry/
  config.env          # BASE_URL、OWNER 等配置
  plugins.json        # 由脚本生成（gitignore）
  artifacts/          # tgz 制品（gitignore）

scripts/internal-market/
  pack.sh             # 构建 + pack + 生成 plugins.json
  serve.sh            # 本地 HTTP 目录服务
  verify.sh           # 校验 JSON 与 HTTP 可访问
  generate-registry.sh
```

### 本地联调三步

```bash
# 1. 打包并生成目录
./scripts/internal-market/pack.sh

# 2. 启动目录服务（保持运行）
./scripts/internal-market/serve.sh

# 3. 另开终端校验
./scripts/internal-market/verify.sh
```

### 在 DSH / WorkBuddy 里用 UI 安装

```bash
export DSHM_REGISTRY_URL=http://127.0.0.1:8790/plugins.json
dsh web
# 设置 → 插件市场 → 搜索 pcb → 安装
```

### 上线到真实服务器时

当前已配置服务器：

```text
BASE_URL = http://175.178.238.31/dsh-plugins
目录 URL = http://175.178.238.31/dsh-plugins/plugins.json
制品 URL = http://175.178.238.31/dsh-plugins/artifacts/dsh-pcb-helper-0.1.0.tgz
```

1. 本机执行 `./scripts/internal-market/pack.sh`（已按上述地址生成）  
2. 在服务器 nginx 站点根下创建目录并上传：

```bash
# 服务器上示例（路径按你们实际站点根调整）
mkdir -p /www/wwwroot/dsh-plugins/artifacts

# 本机上传（把 user 和远端路径换成你们的）
scp company-registry/plugins.json root@175.178.238.31:/www/wwwroot/dsh-plugins/
scp company-registry/artifacts/*.tgz root@175.178.238.31:/www/wwwroot/dsh-plugins/artifacts/
```

3. 浏览器访问应返回 JSON（不是 404）：  
   `http://175.178.238.31/dsh-plugins/plugins.json`  
4. **桌面软件打包时写死一次**（用户不用每次设置）：

```bash
DSHM_REGISTRY_URL=http://175.178.238.31/dsh-plugins/plugins.json
```

以后发新插件：只重复步骤 1～2（更新 tgz + plugins.json），**不要**让用户重装软件。  

---

### 安装按钮报 `unsupported source url` 时

dshmarket **不允许**直接安装 `http://服务器/...tgz`（安全限制，只认 GitHub / npm）。

公司内方案已改为：

1. 包名：`@zhongruan/dsh-pcb-helper`（私有作用域）  
2. 市场目录里 `url` 用 GitHub 形态占位，`npm` 字段指向真实包名  
3. 私有 npm：`http://175.178.238.31/dsh-plugins/npm/`  
4. Profile 需有 `.npmrc`：

```ini
@zhongruan:registry=http://175.178.238.31/dsh-plugins/npm/
strict-ssl=false
```

发版：`./scripts/internal-market/pack.sh` → `./scripts/internal-market/upload.sh` → **`./scripts/internal-market/install-latest.sh`**（本机强制覆盖旧版）

`install-latest.sh` 会：

1. 读本地/线上 `plugins.json` 的最新 `version`  
2. 用制品 tgz **直接覆盖** `~/.dsh/profiles/web/node_modules/@zhongruan/...`  
3. 把 Profile `package.json` 依赖钉成**精确版本**（去掉 `^0.1.1` 这种锁死升级）  
4. 写入 `@zhongruan:registry=...` 到 Profile `.npmrc`  

市场 `install` 字段也会带 `@version`，例如：`dsh plugin --profile web add @zhongruan/dsh-remote-review@0.1.5`。

---

### 13.1 WorkBuddy 已写死启动配置（用户不用 export）

配置文件（改地址只改这一处）：

`DSH-ZR-WorkBuddy/apps/zr-workbuddy/config/company-dsh-market.env`

启动入口会自动注入（**不覆盖**你已 export 的同名变量）：

- `scripts/host.sh start-web` / `restart-web`
- `scripts/restart-dsh.sh`
- 桌面一体包 `desktop/main.js`

临时恢复公网市场（仅当前终端）：

```bash
export DSHM_REGISTRY_URL=
# 或指向其它目录后再 scripts/host.sh restart-web
```

---

*文档版本：v1.3 | 适用：WorkBuddy + dshmarket + @zhongruan/dsh-pcb-helper*
