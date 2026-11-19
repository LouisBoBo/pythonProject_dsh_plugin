# @zhongruan/dsh-agent-context

任务上下文薄面板：在对话右侧展示本会话的环境（分支 / 行数）、改动文件、提交入口、ESC 技能摘要与产出。

## 边界

- **不**跑 Cursor、**不**自己 `git commit` / `push`
- 提交按钮调用写码插件 `POST /api/cursor-chat/git-deliver/begin-ui`，确认卡仍在对话区
- **不**写第二套会话 / 记忆库
- **不**做 Monaco Diff

## 依赖

- 推荐同时安装 `@zhongruan/dsh-cursor-chat`（≥ 0.3.83，含 `workspace-summary` / `begin-ui`）
- 可选 `@zhongruan/dsh-esc`（技能区只读）

## 开发

```bash
cd plugins/dsh-agent-context
pnpm install   # 或 npm i
pnpm build
pnpm test
```

默认只改仓库；本机安装与市场上架须另行口令。

方案见：`docs/14-任务上下文侧栏/任务上下文薄面板插件-可行性方案.md`
