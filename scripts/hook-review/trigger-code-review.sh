#!/usr/bin/env bash
# 用法: trigger-code-review.sh /abs/path/to/repo [focus]
# 依赖: WorkBuddy 引擎已启动且 code_review.enabled + LLM 就绪
set -euo pipefail

REPO_ROOT="$(cd "${1:?用法: $0 /abs/repo [focus]}" && pwd)"
FOCUS="${2:-post-commit auto review}"
ENGINE="${WORKBUDDY_ENGINE:-http://127.0.0.1:8000}"
LOG_DIR="${HOOK_REVIEW_LOG:-$HOME/.zhongruan/hook-review-logs}"
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/${STAMP}-$(basename "$REPO_ROOT").log"

{
  echo "== $(date +%Y-%m-%dT%H:%M:%S%z) repo=$REPO_ROOT =="
  if ! st="$(curl -sS -m 5 "$ENGINE/api/code-review/status" 2>/dev/null)"; then
    echo "引擎不可达: $ENGINE ，跳过"
    exit 0
  fi
  echo "status: $st"
  if ! python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("ok") else 1)' <<<"$st"; then
    echo "审码车道未就绪，跳过（检查 code_review.enabled / LLM / feature）"
    exit 0
  fi

  list_body="$(python3 -c 'import json,sys; print(json.dumps({"local_path":sys.argv[1],"scope":""}))' "$REPO_ROOT")"
  list_json="$(curl -sS -m 120 -X POST "$ENGINE/api/code-review/list" \
    -H 'Content-Type: application/json' -d "$list_body")"
  echo "list: $list_json"

  ticket="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("path_ticket") or "")' <<<"$list_json")"
  if [[ -z "$ticket" ]]; then
    echo "无 path_ticket，中止"
    exit 1
  fi

  run_body="$(python3 -c 'import json,sys; print(json.dumps({"local_path":sys.argv[1],"scope":"","focus":sys.argv[2],"path_ticket":sys.argv[3]},ensure_ascii=False))' "$REPO_ROOT" "$FOCUS" "$ticket")"
  run_json="$(curl -sS -m 900 -X POST "$ENGINE/api/code-review/run" \
    -H 'Content-Type: application/json' -d "$run_body")"
  echo "run: $run_json"
  echo "done"
} 2>&1 | tee -a "$LOG"
