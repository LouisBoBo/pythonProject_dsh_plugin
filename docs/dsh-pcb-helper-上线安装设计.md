# dsh-pcb-helper 上线安装设计

> 问题：当前 `dsh plugin add` + 手工 `restart-web` 适合开发验证，**不适合产品上线**。  
> 目标：应用发布时，插件**自动进入 Profile、随宿主启动可用**，运维/用户无需手工装包。  
> 关联：[dsh插件开发.md](./dsh插件开发.md) · [dsh-pcb-helper-WorkBuddy安装.md](./dsh-pcb-helper-WorkBuddy安装.md)

---

## 1. 先定插件在产品里的角色

上线设计取决于插件是「必选能力」还是「可选扩展」：

| 角色 | 含义 | 推荐策略 |
|---|---|---|
| **必选（Core Bundle）** | 每个环境都必须有，如 PCB 尺寸解析是主流程一环 | **预装进 Profile 模板**（与 `dshmarket` 同级） |
| **可选（Add-on）** | 部分客户/环境才开 | **插件市场 + 管理端开关**，或部署参数控制 |
| **WorkBuddy 自有能力** | 只服务本应用、要热插拔、不走 DSH 生态 | 改写为 `features/pcb-helper`（**另起一套**，见 §6） |

`dsh-pcb-helper` 若作为 **PCB 产品标配工具**，应按 **必选 Core Bundle** 设计；若只是验证 DSH 插件流程，保持可选即可。

---

## 2. 总体架构：三层分离

```text
┌─────────────────────────────────────────────────────────────┐
│  L1 插件制品层（dsh-pcb-helper 仓库）                          │
│  · 版本号 · npm/tarball · cordis.patch.yml · lib/            │
└──────────────────────────┬──────────────────────────────────┘
                           │  pin 版本
┌──────────────────────────▼──────────────────────────────────┐
│  L2 应用清单层（DSH-ZR-WorkBuddy 仓库）                        │
│  · dsh-ecosystem-bundles.yml  声明「本应用依赖哪些 DSH Bundle」 │
│  · 打包脚本 / wire 脚本 / 部署单元 读同一份清单                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ 首次启动 / 部署 / 升级时执行
┌──────────────────────────▼──────────────────────────────────┐
│  L3 运行时 Profile 层（~/.dsh 或 一体包 DSH_HOME）             │
│  · package.json dependencies + dsh.profile.bundles           │
│  · pnpm install → dsh web 启动 → 工具注册                      │
└─────────────────────────────────────────────────────────────┘
```

**原则**：开发者在 L1 发版；产品在 L2 **声明依赖**；L3 由脚本**自动 materialize**，人不手敲 `dsh plugin add`。

---

## 3. 推荐方案：声明式 Bundle 清单 + 自动接线

### 3.1 在 WorkBuddy 仓增加清单文件

路径建议：

```text
DSH-ZR-WorkBuddy/apps/zr-workbuddy/config/dsh-ecosystem-bundles.yml
```

示例：

```yaml
# 本应用上线时必须预装的 DSH 生态 Bundle（非 features/，非 mes-bridge）
version: 1

required:
  - name: dsh-pcb-helper
    version: "0.1.0"          # 上线 pin 住 semver
    source: npm               # npm | link | file
    # source: link 时：
    # path: apps/zr-workbuddy/external/dsh-pcb-helper

optional: []                  # 将来可选插件放这里
```

### 3.2 统一接线脚本（开发 / 服务器 / CI 共用）

新增脚本（WorkBuddy 侧，概念名）：

```bash
scripts/wire-ecosystem-bundles.sh --profile web
```

职责：

1. 读取 `dsh-ecosystem-bundles.yml`
2. 对每个 `required` 项执行等价于 `dsh plugin --profile web add <spec>`
3. `pnpm install` in profile
4. `--dump-config` 校验 `# == dsh-pcb-helper` 存在
5. 可选 `--restart` 调 `host.sh restart-web`

**开发机**：`host.sh wire` 末尾调用此脚本（bridge 装完后自动装生态 Bundle）。  
**CI / 预发**：部署流水线在「宿主单元」收尾时调用同一脚本。

### 3.3 与现有 `plugin.sh install bridge` 的关系

| 脚本 | 对象 | 机制 |
|---|---|---|
| `plugin.sh install bridge` | `mes-bridge` 唯一常驻 Cordis | 写 `cordis.patch.yml` insert |
| `wire-ecosystem-bundles.sh` | DSH 生态 Bundle（`dsh.bundle`） | 写 `dsh.profile.bundles` + npm/link 依赖 |

**不要**把 `dsh-pcb-helper` 并进 `plugin.sh install bridge`；两类插件机制不同，混用难维护。

---

## 4. 三种上线形态的具体做法

### 4.1 一体桌面包（Electron unified，参考 dshmarket）

WorkBuddy 已对 `dshmarket` 做了预装，**pcb-helper 可复制同一模式**：

| 步骤 | 位置 | 做什么 |
|---|---|---|
| ① 制品进包 | `scripts/package-desktop.sh` | 增加 `stage_dsh_pcb_helper`：把 `dsh-pcb-helper@0.1.0` npm 包或本地 tarball 解到 `desktop/runtime/bundles/dsh-pcb-helper/` |
| ② 首次启动写入 Profile | `desktop/main.js` → `ensureWorkBuddyWire()` | 像写 `dshmarket` 一样：若 bundles 无 `dsh-pcb-helper`，则写入 `dependencies` + `bundles` |
| ③ pnpm install | 同上 | 用内嵌 pnpm 在隔离 profile 里装依赖 |
| ④ 验收 | 安装包冒烟 | 启动日志含 `[pcb-helper] 插件已加载` |

**版本 pin**：桌面 `package.json` 或清单里写死 `0.1.0`，发版时 bump，与引擎版本一起打 tag。

### 4.2 服务器 / SSH 部署（code_deploy 单元）

在 [P1 按单元部署](file:///Users/hebo/ai_projects/DSH-ZR-WorkBuddy/docs/功能实现/P1-自动化部署-按单元增量.md) 中增加部署单元：

```text
dsh-bundle:pcb-helper
```

| 项 | 说明 |
|---|---|
| 同步内容 | 插件 npm 包或 `external/dsh-pcb-helper` 目录 + 清单 YAML |
| 收尾命令 | `wire-ecosystem-bundles.sh --profile web` |
| 探活 | `dsh --dump-config` grep pcb-helper；可选 HTTP 对话探针 |
| 与 bridge 关系 | 默认 `auto_restart_bridge=true` 时一并重启宿主；业务成败仍看引擎 |

**增量部署**：仅 bump 插件版本时，只命中 `dsh-bundle:pcb-helper` 单元，不全量 rsync。

### 4.3 私有化 npm / 内网 tarball（多环境一致）

上线前将 `dsh-pcb-helper` **发布到私有 npm 或制品库**：

```bash
cd dsh-pcb-helper
pnpm build
pnpm pack   # → dsh-pcb-helper-0.1.0.tgz
# 推到 Verdaccio / GitHub Packages / 内网 Artifactory
```

清单改为：

```yaml
required:
  - name: dsh-pcb-helper
    version: "0.1.0"
    source: npm    # 解析到私有 registry
```

各环境 `wire-ecosystem-bundles.sh` 只认 **name + version**，不依赖开发者本机绝对路径。

---

## 5. 版本与升级策略

```text
插件发版 (dsh-pcb-helper 0.1.1)
    ↓
WorkBuddy 清单 bump version
    ↓
桌面 re-package / 服务器部署 dsh-bundle 单元
    ↓
wire 脚本：dsh plugin add 或 pnpm update（同包名新版本）
    ↓
restart-web → 用户无感获得新工具
```

| 策略 | 做法 |
|---|---|
| **Pin 精确版本** | 生产清单写 `"0.1.0"`，可复现 |
| **兼容升级** | 预发用 `^0.1.0`，生产仍 pin |
| **回滚** | 清单改回旧版本 + 重新 wire + restart |
| **与 mes-bridge 解耦** | 插件升级**不必**动 bridge/features |

---

## 6. 备选：改写为 WorkBuddy feature（一般不推荐）

若 PCB 工具**只属于 WorkBuddy 引擎域**、不需要独立 DSH 生态分发，可放在 `features/pcb-helper/`：

| 对比 | DSH Bundle（当前） | WorkBuddy feature |
|---|---|---|
| 安装 | Profile bundles | 引擎 `install-feature` / 随仓部署 |
| 热插拔 | 需 restart Host | ~1s 热载，无需重启 DSH |
| 独立分发 | 可 npm 给其他 DSH 用户 | 绑死 WorkBuddy 契约 |
| 上线自动化 | wire + 打包预装 | code_deploy `feature:pcb-helper` 单元 |

WorkBuddy 架构铁律：**生态第三方默认走 DSH Bundle**；只有明确「不对外、只要热插拔」时才改 feature。

---

## 7. 推荐落地路线（分阶段）

### 阶段 P0 — 验证（当前）

- [x] 插件可 `dsh plugin add` 手动安装
- [x] 文档：[dsh-pcb-helper-WorkBuddy安装.md](./dsh-pcb-helper-WorkBuddy安装.md)

### 阶段 P1 — 声明式清单（1～2 天）

- [ ] WorkBuddy 增加 `dsh-ecosystem-bundles.yml`
- [ ] 实现 `wire-ecosystem-bundles.sh`
- [ ] `host.sh wire` 末尾调用；开发机「装应用 = 插件也在」

### 阶段 P2 — 制品发布（1 天）

- [ ] `dsh-pcb-helper` 发布到私有 npm 或固定 tarball
- [ ] CI：`pnpm build` + `pnpm pack` + 上传制品库
- [ ] 清单改为 npm source，去掉 link 绝对路径

### 阶段 P3 — 一体包预装（2～3 天）

- [ ] `package-desktop.sh` stage 插件
- [ ] `desktop/main.js` 预写 bundles（对齐 dshmarket）
- [ ] 桌面安装包冒烟：新用户无需手工 add

### 阶段 P4 — 部署单元（按需）

- [ ] `code_deploy` 增加 `dsh-bundle:*` 单元
- [ ] 预发/生产部署流水线自动 wire + restart

---

## 8. 决策表（给产品 / 架构）

| 问题 | 建议 |
|---|---|
| 插件是否每个客户必装？ | 是 → **required** + 预装；否 → optional + 插件市场 |
| 是否独立卖给其他 DSH 用户？ | 是 → 保持 **DSH Bundle**，发 npm |
| 是否要免重启热更新？ | 是 → 考虑 **feature 重写**；否 → 保持 Bundle |
| 上线谁负责装插件？ | **脚本 / 安装包**，不是运维手敲命令 |
| 版本谁 pin？ | **WorkBuddy 清单**，不是 profile 里手改 |

---

## 9. 一句话结论

> **不要把「装插件」留给上线后的人工操作；在 WorkBuddy 仓用一份 `dsh-ecosystem-bundles.yml` 声明依赖，由打包脚本（桌面）和 wire/部署脚本（服务器）在启动前自动写入 Profile。**

插件仓只负责 **发版本好的 npm 包**；应用仓负责 **pin 版本 + 自动接线**。这与 WorkBuddy 已有 `dshmarket` 预装、`mes-bridge` wire 的模式一致，只是把 pcb-helper 纳入同一套「清单驱动」体系。

---

*文档版本：v1.0*
