---
name: piv-deploy
description: 第 10 步·部署上线：执行配置的部署命令并按健康检查判定，未配置则明确跳过。
whenToUse: PR 创建成功，或本地流程需要直接上线时。
---

# 部署上线（第 10 步）

## 配置
在 `~/.dsh/dev-pipeline/config.json` 或 `<workspace>/.dsh/dev-pipeline.json` 中提供：

```json
{
  "deploy": {
    "command": "bash scripts/deploy.sh",
    "healthUrl": "http://127.0.0.1:8080/health",
    "timeoutMs": 600000
  }
}
```

## 判定
- 未配置 `deploy.command` → skipped，不假装已上线。
- 命令 exit code 非 0 或超时 → 重试，最多 `maxDeployAttempts` 次。
- 配置了 `healthUrl` → 命令成功后轮询最多 60 秒，2xx/3xx 才算健康。
- 全部尝试失败 → 流水线失败（不可打回），保留最后一次输出。

## 安全
- 部署命令是用户配置的可信命令，插件不内置任何业务地址或凭据。
- 命令在工程目录执行，超时后先 SIGTERM 再 SIGKILL。
