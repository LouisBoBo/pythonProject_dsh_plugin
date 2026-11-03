---
name: piv-commit
description: 第 8 步·提交：只提交本次写码触及的文件，按配置 push，禁止提交明文密钥。
whenToUse: 复核通过后、准备开 PR 或部署之前。
---

# 提交（第 8 步）

## 步骤
1. 非 Git 仓库 → skipped。
2. 收集 `git status`；若写码 Job 报告了 changed/deleted，只提交这些路径，避免带上工作区其它改动。
3. 对本次 diff 做密钥扫描，命中即拒绝提交。
4. `git add -A -- <paths>`，确认暂存区有变化后再 `git commit`。
5. 提交信息：`feat|fix: <PRD.what>`，正文带 run id。
6. `push=true` 且有 origin 时 `git push -u origin <branch>`。

## 失败
- `git add` / `git commit` 失败：基建失败，停止。
- `git push` 失败：停止并给出远端输出，不进入写码打回循环。
- 无远端、分离头指针、`push=false`：正常提交但不推送，记录原因。
