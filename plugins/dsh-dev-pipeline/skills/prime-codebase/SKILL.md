---
name: prime-codebase
description: 第 3 步·读库：扫描工程目录，产出技术栈、顶层目录、关键文件摘录与风险。
whenToUse: 进入陌生工程、写码前需要上下文，或想快速了解仓库结构时。
---

# 读库上下文（第 3 步）

## 目标
在不读全仓的前提下，给后续规划与写码一份可靠的最小上下文。

## 采集
- 顶层目录（忽略 `.git`、`node_modules`、`dist`、`target`、`vendor`、虚拟环境等）。
- 技术栈：node/pnpm/yarn、maven、gradle、go、python、rust、typescript。
- 关键文件：`AGENTS.md`、`README*`、`package.json`、`pom.xml`、`build.gradle*`、`go.mod`、`pyproject.toml`、`requirements.txt`、`Cargo.toml`、`Makefile`、compose 文件。
- 风险：缺 `AGENTS.md`、非 Git 仓库、无源码目录、未识别技术栈、关键配置缺失。

## 边界
- 单文件摘录有上限，总量有上限；二进制文件跳过。
- 只读，不改工程；不执行工程脚本。

## 产出
`epic.context_pack = { summary, dirs, stack, key_files, must_read, risks }`
