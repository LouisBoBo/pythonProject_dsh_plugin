# MVP：IDE 提交 Hook → 自动触发本机审码

目标效果：用户在 IDE 里 **git commit** 后，本机自动任务监听到事件，调用 WorkBuddy 引擎已有审码工作流，产出「代码审核汇总报告」。

> 这不是 DSH 插件职责。插件不常驻监听。  
> 链路 = **Git Hook（触发）+ 本机脚本/守护（监听执行）+ 引擎审码 API（工作流）**。

---

## 1. 总览

```text
IDE / Git commit
    │
    ▼
.git/hooks/post-commit   （或 Cursor Hook）
    │  POST / 写队列文件
    ▼
本机触发器 trigger-code-review.sh
    │  ① POST /api/code-review/list  → path_ticket
    │  ② POST /api/code-review/run   → report
    ▼
WorkBuddy 引擎（默认 http://127.0.0.1:8000）
    │
    ▼
engine/data/code_review/reports/cr-….json（+ 可选通知）
```

| 环节 | 落点 | 说明 |
| --- | --- | --- |
| 提交触发 | `post-commit` | 只发「仓库路径 + commit」 |
| 自动任务 | 本机 shell / 小守护 | 调引擎，不进 DSH 对话 |
| 审码工作流 | 现有 `code-review` 引擎 | 直读磁盘 + LLM，无 Git 克隆 |
| 可选扩展 | 公司插件 | 以后只换「规则包」，不换 Hook |

---

## 2. 前置条件

1. 引擎在跑：`scripts/engine.sh zr-workbuddy ensure`（或桌面一体包已起引擎）
2. 配置中心：
   - `code_review.enabled = true`
   - LLM 已配置
   - feature `code-review` 已启用
3. 默认 **必须** `path_ticket`（企业门禁）。Hook 脚本按「先 list 再 run」即可，**不必**打开 `allow_agent_absolute_path`（该开关仅给裸路径开跑，自动化场景更危险）。

引擎基址（可环境变量覆盖）：

```bash
export WORKBUDDY_ENGINE="${WORKBUDDY_ENGINE:-http://127.0.0.1:8000}"
```

---

## 3. 引擎调用（最小序列）

### 3.1 就绪

```bash
curl -sS "$WORKBUDDY_ENGINE/api/code-review/status"
```

### 3.2 列文件并拿 ticket

```bash
curl -sS -X POST "$WORKBUDDY_ENGINE/api/code-review/list" \
  -H 'Content-Type: application/json' \
  -d "{\"local_path\":\"$REPO_ROOT\",\"scope\":\"\"}"
```

响应里取 `path_ticket`（以及可选 `files`）。

### 3.3 开跑（非流式，适合 Hook）

```bash
curl -sS -X POST "$WORKBUDDY_ENGINE/api/code-review/run" \
  -H 'Content-Type: application/json' \
  -d "{\"local_path\":\"$REPO_ROOT\",\"scope\":\"\",\"focus\":\"post-commit auto\",\"path_ticket\":\"$TICKET\"}"
```

UI 对话优先用 `/api/code-review/run/stream`（SSE）；**Hook 自动化用同步 `/run` 更简单**。

### 3.4 查报告

```bash
curl -sS "$WORKBUDDY_ENGINE/api/code-review/reports/$REPORT_ID"
```

---

## 4. 本机触发脚本

路径建议（可拷到各业务仓或放全局）：

`scripts/hook-review/trigger-code-review.sh`

（本仓库已提供样例：`pythonProject_dsh_plugin/scripts/hook-review/`）

```bash
#!/usr/bin/env bash
# 用法: trigger-code-review.sh /abs/path/to/repo [focus]
set -euo pipefail

REPO_ROOT="$(cd "${1:?repo path}" && pwd)"
FOCUS="${2:-post-commit auto review}"
ENGINE="${WORKBUDDY_ENGINE:-http://127.0.0.1:8000}"
LOG_DIR="${HOOK_REVIEW_LOG:-$HOME/.zhongruan/hook-review-logs}"
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/${STAMP}-$(basename "$REPO_ROOT").log"

{
  echo "== $(date -Iseconds) repo=$REPO_ROOT =="
  st="$(curl -sS -m 5 "$ENGINE/api/code-review/status" || true)"
  echo "status: $st"
  echo "$st" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' || {
    echo "审码车道未就绪，跳过（检查引擎 / code_review.enabled / LLM）"
    exit 0
  }

  list_json="$(curl -sS -m 60 -X POST "$ENGINE/api/code-review/list" \
    -H 'Content-Type: application/json' \
    -d "$(python3 -c "import json,sys; print(json.dumps({'local_path':sys.argv[1],'scope':''}))" "$REPO_ROOT")")"
  echo "list: $list_json"

  ticket="$(python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('path_ticket') or d.get('ticket') or '')" <<<"$list_json")"
  [[ -n "$ticket" ]] || { echo "无 path_ticket，中止"; exit 1; }

  run_json="$(curl -sS -m 600 -X POST "$ENGINE/api/code-review/run" \
    -H 'Content-Type: application/json' \
    -d "$(python3 - <<PY
import json
print(json.dumps({
  "local_path": "$REPO_ROOT",
  "scope": "",
  "focus": "$FOCUS",
  "path_ticket": "$ticket",
}, ensure_ascii=False))
PY
)")"
  echo "run: $run_json"
  echo "done"
} | tee -a "$LOG"
```

---

## 5. Git `post-commit` Hook

在目标仓库：

```bash
# .git/hooks/post-commit
#!/usr/bin/env bash
ROOT="$(git rev-parse --show-toplevel)"
TRIGGER="${HOOK_REVIEW_TRIGGER:-$HOME/ai_projects/DSH-ZR-WorkBuddy/scripts/hook-review/trigger-code-review.sh}"
# 后台跑，不阻塞 commit 返回
nohup "$TRIGGER" "$ROOT" "commit $(git rev-parse --short HEAD)" \
  >>"${HOOK_REVIEW_LOG:-$HOME/.zhongruan/hook-review-logs}/hook.out" 2>&1 &
```

```bash
chmod +x .git/hooks/post-commit
chmod +x "$TRIGGER"
```

说明：

- 用 **`post-commit`**（提交已成功）而不是 `pre-commit`，避免审码慢拖死提交。
- 若只要「本次变更文件」，可在 Hook 里 `git diff-tree --no-commit-id --name-only -r HEAD`，把相对路径传给 `run` 的 `files` 字段（需改脚本拼 JSON）。

---

## 6. 可选：队列化（多仓 / 防抖）

Hook 很频繁时，不要每次同步跑 LLM：

1. Hook 只写一行事件到 `~/.zhongruan/hook-review-queue/*.json`  
   `{ "repo", "commit", "ts" }`
2. 常驻 `watch` / `launchd` 每 N 秒消费队列，同仓合并，再调 `trigger-code-review.sh`

MVP 可先 **Hook 直接调 trigger**；压测后再加队列。

---

## 7. 和「对话审码 / 远端 push / DSH 插件」的关系

| 入口 | 行为 |
| --- | --- |
| 对话「审核代码」 | 选目录卡 → SSE `/run/stream`（人确认） |
| IDE commit Hook（**第一种**，本文） | 无 UI → list + `/run`（依赖本机引擎） |
| 远端 push（**第二种**） | 服务器拉仓 → 同一套审码 API；见 [remote-push-服务器审码-方案确认.md](./remote-push-服务器审码-方案确认.md) |
| DSH 公司插件 | **不负责监听**；以后可做「规则包」给引擎加载 |

提交车道（`code-commit`）与审码车道分开：Hook 触发的是 **审码报告**，不会自动 `git push`。

文档总目录：[../README.md](../README.md)。

---

## 8. 验收清单

- [ ] 引擎 `status` 返回 `ok: true`
- [ ] 手工跑 `trigger-code-review.sh /某仓库` 能出 `report_id`
- [ ] 该仓配置 `post-commit` 后，本地 `git commit` 日志目录出现新 log
- [ ] `engine/data/code_review/reports/` 出现新报告
- [ ] 引擎未启动时 Hook **安静跳过**（脚本已 `exit 0`），不打断开发

---

## 9. 安全注意

- `path_ticket` 一次性、进程内有效；Hook 在同一脚本内 list→run 即可。
- 不要对不可信路径打开 `allow_agent_absolute_path`。
- Hook 仅建议装在**开发者本机信任仓库**；不要把引擎端口裸暴露到公网。
- 日志可能含路径与片段，目录默认 `~/.zhongruan/hook-review-logs/`。

---

## 10. 下一步（非 MVP）

1. Hook 传入「仅本次 commit 变更文件」缩小审码范围  
2. 完成后桌面通知 / 回写 WorkBuddy 会话  
3. 与 `code-commit` 门禁联动（审码 findings 作为提交前置）  
4. 规则包公司插件化（引擎加载，Hook 仍不变）
