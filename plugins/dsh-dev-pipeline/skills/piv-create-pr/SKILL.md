---
name: piv-create-pr
description: 第 9 步·开 PR：推送后使用 GitHub CLI 创建 PR，已存在则复用链接。
whenToUse: 提交并推送成功后。
---

# 开 PR（第 9 步）

## 前置
- 配置 `prProvider=skip` → 跳过。
- 非 Git 仓库、无 origin、远端不是 GitHub、未安装 `gh`、提交未推送 → 跳过并说明原因。
- 当前在 `main` / `master` → 跳过，避免直接对主干开 PR。

## 流程
1. `gh pr list --head <branch> --json url,number --limit 1` 查已有 PR。
2. 已有则直接复用链接。
3. 没有则 `gh pr create`，标题取 PRD 的 `what`，正文包含需求、实现、验收标准、机器验证与复核结论。
4. 解析 stdout 中的 URL 作为交付物。

## 失败
创建失败视为不可打回失败：停止流水线，给出 `gh` 原始输出，便于排查登录、权限或分支保护。
