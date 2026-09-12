# DSH 如何发现可装插件，以及装完如何使用

> 笔记：公司插件市场（`plugins.json` + 私有 npm）与对话调用链路说明。

## 1. DSH 怎么知道「有什么插件可装」

不是扫本机源码，而是读**插件市场目录**：

1. WorkBuddy / DSH 启动时带上公司市场地址（`DSHM_REGISTRY_URL`），例如：  
   `http://175.178.238.31/dsh-plugins/plugins.json`
2. **设置 → 插件市场**（`dshmarket`）去拉这份 `plugins.json`
3. 清单里每一项（名字、描述、`npm` 包名、版本）就是「可安装列表」

因此：`upload.sh` 更新服务器上的 `plugins.json` + `npm/` 后，市场里就会多 / 少 / 变更插件；**没进这份 JSON，市场里就看不到**。

安装时：点安装 → 按条目里的 `npm`（如 `@zhongruan/dsh-weather`）从私有 registry 下 tgz → 装进当前 profile（例如 `~/.dsh/profiles/web`）。

### 相关路径（本仓库 / 服务器）

| 角色 | 路径 |
| --- | --- |
| 本地生成物 | `company-registry/plugins.json`、`company-registry/npm/`、`company-registry/artifacts/` |
| 线上目录 | `/www/wwwroot/dsh-plugins/` |
| 市场 URL | `http://175.178.238.31/dsh-plugins/plugins.json` |

说明：`plugins.json` 是**目录清单**，不是插件包本身；真正的包在 `npm/@zhongruan/...` 与 `artifacts/*.tgz`。

## 2. 装完之后「什么时候用、怎么用」

安装 ≠ 用户手动点工具名，而是：

1. **加载**：DSH / 宿主重启或加载 profile 时，按包里的 `cordis.patch.yml` 把插件插进运行时，执行 `apply()`，用 `ctx.tools.register(...)` 注册工具（如 `weather_query`、`weather_forecast`）。
2. **何时调用**：用户正常聊天时，模型根据：
   - 工具自己的 **description**（写清楚「问天气就调我」）
   - 可选：**路由 Skill**（如 WorkBuddy 的 `zr-workbuddy-routing`）

   决定要不要调、调哪个工具、参数填什么。
3. **怎么用（对用户）**：自然语言即可。例如「明日深圳天气如何」→ 模型选 `weather_forecast` → 插件里跑代码（调 Open-Meteo）→ 结果回给模型再回答用户。

### 开发侧要点

| 环节 | 靠什么 |
| --- | --- |
| 市场能看见 | 服务器 `plugins.json` + npm 元数据 |
| 装得上 | 私有 npm tarball + profile `.npmrc` 作用域 |
| 聊得起来 | 工具 description（+ 路由 Skill），用户不用记工具名 |

## 一句话

市场用 `plugins.json` 告诉 DSH「能装啥」；装进 profile 后工具进 Agent 工具箱；对话时由模型按描述 / 路由自动调用。
