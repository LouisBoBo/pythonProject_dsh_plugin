# @zhongruan/dsh-dev-pipeline

需求到上线的十步一体化流水线，独立 DSH 插件。不依赖 WorkBuddy 引擎；写码交给
[`@zhongruan/dsh-cursor-chat`](../dsh-cursor-chat)（默认 `http://127.0.0.1:18791`）。

## 十步

| # | 步骤 | 做什么 |
|---|---|---|
| 1 | 需求采集 | 清洗用户原话（含附图），写进账本 |
| 2 | 需求理解 · PRD-lite | 做什么 / 怎么干 / 验收标准 / 非目标 / 改动上限 |
| 3 | 读库上下文 | 技术栈、顶层目录、关键文件摘录、风险 |
| 4 | 规划实现 | validation-first 计划；验证命令只允许单条 |
| 5 | 写代码 | 调对话写码插件：确认单 → 开工 → 等 Job 终态 |
| 6 | 机器验证 | 只认 exit code；无命令则 skipped |
| 7 | 复核 | 只看本次 diff：验收、明显 bug、密钥、范围 |
| 8 | 提交 | 只提交本次触及文件；按配置 push |
| 9 | 开 PR | GitHub CLI；已有 PR 则复用链接 |
| 10 | 部署 | 配置的部署命令 + 可选健康检查；未配置则 skipped |

第 5～8 步失败会打回第 5 步重写，最多 `maxFixRounds` 轮（默认 3）。写码服务网络中断属于基础设施异常，会自动重试同一步（最多 2 次），不占用打回轮次。第 9、10 步失败直接终止。

## 前置

1. DSH 宿主已能正常聊天（`ctx.llm` 可用，用于 PRD / 规划 / 复核）。
2. 安装并启用 `@zhongruan/dsh-cursor-chat`，其服务监听 `127.0.0.1:18791`。
   - 未安装时前四步仍可跑，第 5 步会明确失败。
3. 可选：`git`、`gh`（开 PR）、部署命令所需工具。

## 安装

插件中心安装（公司市场收录后）：

```
dsh plugin --profile web add @zhongruan/dsh-dev-pipeline
```

本地包安装：

```bash
cd plugins/dsh-dev-pipeline
npm ci && npm run build
npm pack
dsh plugin --profile web add ./zhongruan-dsh-dev-pipeline-0.1.0.tgz
```

安装后重启宿主。`cordis.patch.yml` 会以 `dev-pipeline` 为 id 注入组合树。

## 工具

| 工具 | 用途 |
|---|---|
| `zr_pipeline_start` | 一句话开跑；立即返回 run_id，后台执行 |
| `zr_pipeline_status` | 十步状态、失败详情、PR/部署结果 |
| `zr_pipeline_advance` | 继续 paused / waiting 的任务 |
| `zr_pipeline_confirm` | 确认第 5 步写码开工（`autoRun=false` 或 `mode=manual`） |
| `zr_pipeline_cancel` | 取消；写码中会同时请求取消 Cursor Job |
| `zr_pipeline_list` | 最近任务列表 |
| `zr_pipeline_config` | 当前生效配置与提醒 |

示例：

> 用一体化流水线把这个需求做完：订单导出增加按日期筛选
>
> 流水线跑到哪了？
>
> 确认开工

## 配置

宿主级 `~/.dsh/dev-pipeline/config.json`，工程级 `<workspace>/.dsh/dev-pipeline.json`（后者覆盖前者）。

```json
{
  "cursorChatBase": "http://127.0.0.1:18791",
  "maxFixRounds": 3,
  "maxDeployAttempts": 3,
  "autoRun": true,
  "push": true,
  "prProvider": "auto",
  "validateCommands": ["npm run test"],
  "deploy": {
    "command": "bash scripts/deploy.sh",
    "healthUrl": "http://127.0.0.1:8080/health",
    "timeoutMs": 600000
  },
  "llm": { "provider": "", "model": "" }
}
```

环境变量：`DEV_PIPELINE_DATA_ROOT`、`DEV_PIPELINE_CURSOR_BASE`、`DEV_PIPELINE_MAX_FIX_ROUNDS`、
`DEV_PIPELINE_MAX_DEPLOY_ATTEMPTS`、`DEV_PIPELINE_AUTO_RUN`、`DEV_PIPELINE_PUSH`。

- 验证命令允许单条可执行命令；含 `;`、`&&`、`|`、反引号、`$()`、重定向的会被丢弃。
- `deploy.command` 为空时第 10 步明确 skipped，不假装上线。
- `llm` 留空时按宿主默认提供方与模型。

## 数据

`~/.dsh/dev-pipeline/`：

```
config.json
runs/<run-id>.json      # 运行态、十步状态、事件（最多 500 条）
epics/<epic-id>.json    # 需求、PRD、上下文、计划、各步产物
```

宿主重启时，遗留的 `running/queued` 任务会改为 `paused`，可用 `zr_pipeline_advance` 继续。

## 边界

- 只改工程目录内的文件；写码阶段明确禁止提交、推送、开 PR、部署。
- 同一工程同时只允许一个进行中的任务；确需重跑时传 `restart: true`，会先取消旧任务。
- 附图支持本机绝对路径与 `data:image` base64，第 5 步转交写码服务；不支持 http(s) 链接。
- 提交只包含本次写码实际落盘并仍在工程里的文件，避免带上工作区其它改动。
- 不内置任何业务地址、密钥或部署脚本；全部来自配置。
- 写码复用 cursor-chat 的既有写盘通道，不在本插件里另造一套。

## 开发

```bash
npm ci
npm run build
npm run self-test
```

`self-test` 不访问网络，不调用模型和写码服务。

## 发布

```bash
npm publish
```

`publishConfig` 指向公司私有 registry `http://175.178.238.31/dsh-plugins/npm/`。
发布前确认版本号、`compat-matrix.json` 与市场元数据。
