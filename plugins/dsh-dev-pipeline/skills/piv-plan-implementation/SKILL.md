---
name: piv-plan-implementation
description: 第 4 步·实现计划：validation-first，先定怎么验，再定改哪里。
whenToUse: PRD 已冻结，准备让写码 Agent 动手之前。
---

# 规划实现（第 4 步）

## 目标
把 PRD 转成可执行、可验证、范围可控的实现计划。

## 产出
- `problem`：这次要解决的核心问题。
- `changes`：按顺序的改动点（文件/模块 + 怎么改），1～8 条。
- `validations`：可执行验证命令，优先复用工程已有脚本。
- `paths`：预计触碰的相对路径。

## 验证命令安全
- 只允许单条命令：拒绝 `;`、`&&`、`|`、反引号、`$()`、重定向。
- 合并顺序：配置 `validateCommands` → 自动探测 → 模型建议，去重后最多 6 条。
- 没有可用命令时，第 6 步标记 skipped，而不是伪造 PASS。

## 打回轮次
若存在 `implement_fix_mandate`，先把「必须修复」并入改动点，再规划新改动。
