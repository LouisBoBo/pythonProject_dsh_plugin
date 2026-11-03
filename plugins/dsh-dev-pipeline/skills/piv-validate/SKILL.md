---
name: piv-validate
description: 第 6 步·机器验证：按计划执行验证命令，只认 exit code，不猜结果。
whenToUse: 写码完成后、准备复核或提交之前。
---

# 机器验证（第 6 步）

## 规则
- 只跑第 4 步冻结的 `validations`，顺序执行，单条最长 15 分钟。
- 判定：`exit_code === 0` 且未超时才算 PASS；否则 FAIL。
- 没有验证命令时标记 `skipped`，并在结果里说明原因，不伪造通过。
- 输出保留尾部摘要，失败时把失败命令与输出尾部交给打回循环。

## 失败处理
- 第 6 步失败属于可修复失败：跳到第 5 步重写，最多 `maxFixRounds` 轮。
- 打回时把失败命令写进 `must_fix`，让写码 Agent 知道先修哪里。

## 边界
- 不在本步改代码、不跳过失败命令、不把 skipped 当 pass。
