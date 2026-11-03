---
name: piv-review-changes
description: 第 7 步·复核：只看本次改动 diff，查验收标准、明显 bug、密钥泄露与范围膨胀。
whenToUse: 机器验证通过后、提交之前。
---

# 复核改动（第 7 步）

## 范围
- 只审本次写码触及的文件（优先用 Job 返回的 changed/deleted；缺失时用 git status）。
- 不是 Git 仓库或没有改动：标记 skipped，不阻塞后续。

## 检查项
1. 是否满足 PRD 的验收标准。
2. 是否引入明显 bug、死代码、调试残留。
3. 是否泄露密钥：私钥、API Token、明文口令赋值。
4. 是否超出非目标或 `change_limit`（超出记 warning）。

## 判定
- `blockers` 非空 → 第 7 步失败，进入打回循环。
- 只有 `warnings` → 通过，把提醒写进事件。
- 模型不可用时退化为静态检查，并明确标注「已降级」，不假装做了语义复核。
