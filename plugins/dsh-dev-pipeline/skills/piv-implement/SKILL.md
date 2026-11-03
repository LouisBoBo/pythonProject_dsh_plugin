---
name: piv-implement
description: 第 5 步·写代码：把需求与计划交给对话写码插件（@zhongruan/dsh-cursor-chat），等待 Job 终态。
whenToUse: 计划冻结、准备改盘时；或写码 Job 卡住需要排查时。
---

# 写代码（第 5 步）

## 主路径
1. 探测写码服务：`GET http://127.0.0.1:18791/api/config`，再探 `/api/cursor-chat/pending-latest` 确认不是别的服务。
2. `POST /api/cursor-chat/pending` 建确认单。
3. `POST /api/hitl/issue`（action=`cursor-chat.confirm`）取 nonce。
4. `POST /api/cursor-chat/confirm` 开工，拿 `job_id`。
5. 轮询 `GET /api/cursor-chat/jobs/{id}` 到终态：`succeeded` / `failed` / `cancelled` / `blocked_no_runner`。

## 人工确认
- `autoRun=false` 或任务 `mode=manual` 时，只建确认单，不自动开工；等 `zr_pipeline_confirm`。
- 确认单过期就重新进入本步生成新的。

## 传给写码 Agent 的内容
需求、PRD、冻结计划、必须修复项；并明确：只改代码，不提交、不推送、不开 PR、不部署。

## 失败
- 插件不可达 / 端口不对 / 未配 Cursor Key：基建失败，直接停，不进入打回循环。
- `blocked_no_runner`：Cursor 没有可用执行器，直接停。
- 普通 `failed`：进入打回循环，最多 `maxFixRounds` 轮。
