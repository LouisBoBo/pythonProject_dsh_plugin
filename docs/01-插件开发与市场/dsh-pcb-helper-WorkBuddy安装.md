# dsh-pcb-helper 安装到 DSH-ZR-WorkBuddy

> 本文说明如何将 `dsh-pcb-helper` 插件安装到 [DSH-ZR-WorkBuddy](file:///Users/hebo/ai_projects/DSH-ZR-WorkBuddy) 项目中，并在 Studio（`:3080`）里正常使用。  
> 插件开发与打包见 [dsh插件开发.md](./dsh插件开发.md)。

---

## 1. 两条插件通道（不要混用）

WorkBuddy 仓库里有两套完全不同的插件机制：

| 类型 | 例子 | 安装方式 |
|---|---|---|
| **WorkBuddy 自有功能** | `code-dev`、`mes-ask` | 引擎 `features/` + `install-feature` |
| **DSH 生态插件** | `dsh-pcb-helper` | **`dsh plugin add` 或 Studio 插件中心** |

`dsh-pcb-helper` 是带 `dsh.bundle` 的 DSH 生态 Bundle，**必须**走 `dsh plugin add`，不能走下面两种方式：

| 错误做法 | 原因 |
|---|---|
| `scripts/plugin.sh install dsh-pcb-helper` | 仅用于 `plugins/mes-bridge` 等 bridge 常驻包 |
| `install-feature` 传 zip | 只能装 WorkBuddy `features/` 契约包，DSH Bundle 会校验失败 |
| 修改 `host/` 内核 | WorkBuddy 架构禁止把业务焊进宿主 |

---

## 2. 推荐安装流程

### 2.1 将插件放入 WorkBuddy 仓库

建议放在 `external/`，与 `plugins/mes-bridge` 分开，避免和 bridge 接线脚本混淆：

```bash
mkdir -p /Users/hebo/ai_projects/DSH-ZR-WorkBuddy/apps/zr-workbuddy/external

cp -r /Users/hebo/Desktop/中软项目/pythonProject_dsh_plugin/dsh-pcb-helper \
  /Users/hebo/ai_projects/DSH-ZR-WorkBuddy/apps/zr-workbuddy/external/dsh-pcb-helper
```

也可使用软链接（开发期少一份拷贝）：

```bash
ln -s /Users/hebo/Desktop/中软项目/pythonProject_dsh_plugin/dsh-pcb-helper \
  /Users/hebo/ai_projects/DSH-ZR-WorkBuddy/apps/zr-workbuddy/external/dsh-pcb-helper
```

### 2.2 构建插件

```bash
cd /Users/hebo/ai_projects/DSH-ZR-WorkBuddy/apps/zr-workbuddy/external/dsh-pcb-helper
pnpm install
pnpm build
```

确认生成 `lib/index.js`。

### 2.3 接线 WorkBuddy（首次或换机器）

```bash
cd /Users/hebo/ai_projects/DSH-ZR-WorkBuddy
scripts/host.sh wire
scripts/host.sh verify
```

`verify OK` 表示：

- `~/.dsh/link/DSH-ZR-WorkBuddy` 已指向本仓库
- `~/.dsh/profiles/web` 已挂上 `mes-bridge`

### 2.4 安装生态插件（关键步骤）

在 **WorkBuddy 仓库根目录** 执行：

```bash
cd /Users/hebo/ai_projects/DSH-ZR-WorkBuddy

dsh plugin --profile web add ./apps/zr-workbuddy/external/dsh-pcb-helper
```

该命令会：

1. 用 pnpm link 将插件链入 `~/.dsh/profiles/web/node_modules`
2. 在 profile 的 `dsh.profile.bundles` 中追加 `dsh-pcb-helper`
3. 自动加载插件包内的 `cordis.patch.yml`

> 这与 `mes-bridge` 通过 `cordis.patch.yml` insert 的接线方式不同；生态 Bundle 走 `bundles` 列表。

### 2.5 验证安装

```bash
dsh --profile web --dump-config | grep -A3 "dsh-pcb-helper"
```

期望输出：

```
# == dsh-pcb-helper
- id: pcb-helper
  name: dsh-pcb-helper
```

也可查看 profile 清单：

```bash
cat ~/.dsh/profiles/web/package.json
```

`dependencies` 中应有 `dsh-pcb-helper`，`bundles` 列表中亦应包含它。

### 2.6 启动 Studio

```bash
cd /Users/hebo/ai_projects/DSH-ZR-WorkBuddy
scripts/host.sh restart-web
# 首次启动可用：scripts/host.sh start-web
```

浏览器打开：**http://127.0.0.1:3080**

启动日志中应出现：

```
[pcb-helper] 插件已加载，注册了 pcb_parse_dimensions、pcb_count_bom 工具
```

### 2.7 对话测试

在 Studio 对话中输入：

```
请用 pcb_parse_dimensions 解析尺寸 120x80mm
```

```
请用 pcb_count_bom 统计以下 BOM：
R1,10
C2,20
U3,1
```

---

## 3. 从插件源码目录直接安装（不拷贝进 WorkBuddy）

若暂不放入 WorkBuddy 仓库，也可从当前插件工程路径安装：

```bash
cd /Users/hebo/Desktop/中软项目/pythonProject_dsh_plugin

# 先构建
cd dsh-pcb-helper && pnpm install && pnpm build && cd ..

# 安装到 web profile
dsh plugin --profile web add ./dsh-pcb-helper
```

WorkBuddy 日常仍须先 `scripts/host.sh wire`，再 `scripts/host.sh restart-web`。

---

## 4. 修改代码后更新

link 安装无需重复 `dsh plugin add`，改完构建并重启即可：

```bash
cd /Users/hebo/ai_projects/DSH-ZR-WorkBuddy/apps/zr-workbuddy/external/dsh-pcb-helper
pnpm build

cd /Users/hebo/ai_projects/DSH-ZR-WorkBuddy
scripts/host.sh restart-web
```

---

## 5. 卸载

```bash
dsh plugin --profile web remove dsh-pcb-helper
scripts/host.sh restart-web
```

---

## 6. 从旧路径迁移

若曾从 `pythonProject_dsh_plugin` 路径安装过，建议先卸载再按 WorkBuddy 内路径重装：

```bash
dsh plugin --profile web remove dsh-pcb-helper

cd /Users/hebo/ai_projects/DSH-ZR-WorkBuddy
dsh plugin --profile web add ./apps/zr-workbuddy/external/dsh-pcb-helper

scripts/host.sh restart-web
```

---

## 7. 常见问题

| 现象 | 处理 |
|---|---|
| 启动报 `Cannot find package '@deepseek-ai/dsh-tools'` | 在插件目录执行 `pnpm install && pnpm build`，确认 `dependencies` 含 DSH 包 |
| `verify` 失败 | 先 `scripts/host.sh wire`，确认 `~/.dsh/link/DSH-ZR-WorkBuddy` 存在 |
| 3080 端口占用 | `scripts/host.sh stop-web` 后重启，或 `dsh web --port 3081` |
| 插件装了但工具不可调用 | 看启动日志是否有 `[pcb-helper] 插件已加载`；无则检查 `dump-config` |
| 误用 `install-feature` | 该通道只适用于 `features/`，DSH Bundle 必须用 `dsh plugin add` |

---

## 8. 流程一览

```text
拷贝/链接到 WorkBuddy/external
        ↓
pnpm install && pnpm build
        ↓
scripts/host.sh wire && verify
        ↓
dsh plugin --profile web add ./apps/.../dsh-pcb-helper
        ↓
dump-config 验证
        ↓
scripts/host.sh restart-web
        ↓
Studio 对话测试工具
```

---

## 9. 相关文档

- 本仓库插件开发：[dsh插件开发.md](./dsh插件开发.md)
- WorkBuddy 目录说明：`DSH-ZR-WorkBuddy/docs/目录结构与用法说明.md`
- WorkBuddy 插件形态：`DSH-ZR-WorkBuddy/docs/最简产品形态.md`
- Studio 插件中心日常：`DSH-ZR-WorkBuddy/docs/host维护与更新.md`（步骤 A4）

---

*文档版本：v1.0 | 适用：DSH-ZR-WorkBuddy + dsh-pcb-helper 0.1.0*
