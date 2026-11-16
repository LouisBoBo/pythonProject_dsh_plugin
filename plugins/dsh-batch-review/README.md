# dsh-batch-review（方案 B）

从 WorkBuddy `engine/app/code_review` **裁剪**迁入的本批审码旁路核。

## 硬边界

- **只服务** Git 交付审码闸；**不**进写码 `begin/continue`
- **不**用 Cursor 审码
- 不把 LLM Key 写进插件推送配置 / `config.json`

## 正本

`DSH_WorkBuddy/apps/zr-workbuddy/engine/app/code_review/`  
变更优先改正本，再同步裁剪包。

## LLM（公司网关）

解析顺序：

1. WorkBuddy `config.yaml` 已配 **非官网** `base_url` → 用之  
2. 否则公司模型网关：`ZR_GATEWAY_TOKEN` + `{ZR_MODEL_GATEWAY_URL|默认公司 origin}/api/ai`，模型默认 `standard`  

旁路**禁止**走 `api.deepseek.com`。

```bash
PYTHONPATH=src python -m dsh_batch_review llm-status
PYTHONPATH=src python -m dsh_batch_review review --workspace D:\path\to\repo --files a.ts,b.ts
```

## 用法

```bash
cd plugins/dsh-batch-review
pip install -e .   # 或 pip install PyYAML
PYTHONPATH=src python -m dsh_batch_review version
PYTHONPATH=src python -m dsh_batch_review parse-findings tests/fixtures/sample_findings.txt
PYTHONPATH=src python -m pytest tests -q
```

## 与写码插件开关

`dsh-cursor-chat`：`gitDeliverReviewBackend` / 环境变量 `CURSOR_CHAT_GIT_REVIEW_BACKEND`

| 值 | 行为 |
| --- | --- |
| `embedded`（**默认**） | 子进程调本包 `review`（公司网关；需 `DSH_BATCH_REVIEW_ROOT` 或开发仓同级目录） |
| `off` | 跳过审码，确认后直接 commit |
| `workbuddy` | 旧 HTTP 调本机引擎 `:8000` |
