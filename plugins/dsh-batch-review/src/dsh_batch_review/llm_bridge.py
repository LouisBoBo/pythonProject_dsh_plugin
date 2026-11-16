"""经网关 base_url 调 chat/completions。禁止写死官网 URL。"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Callable

ChatFn = Callable[[dict[str, str], list[dict[str, str]], dict[str, Any]], str | None]


def chat_url(base_url: str) -> str:
    """
    - 公司网关 `{origin}/api/ai` → `/chat/completions`（大小写不敏感）
    - 已以 `/v1` 结尾 → `/chat/completions`
    - 其它 OpenAI 兼容 → 补 `/v1/chat/completions`
    """
    b = (base_url or "").strip().rstrip("/")
    if not b:
        return ""
    lower = b.lower()
    if lower.endswith("/api/ai"):
        return b + "/chat/completions"
    if lower.endswith("/v1"):
        return b + "/chat/completions"
    return b + "/v1/chat/completions"


def _message_content(msg: dict[str, Any] | None) -> str | None:
    if not isinstance(msg, dict):
        return None
    content = str(msg.get("content") or "").strip()
    if content:
        return content
    for k in ("reasoning_content", "reasoning", "thinking"):
        alt = str(msg.get(k) or "").strip()
        if alt:
            return alt
    return None


def _from_openai_completion(body: dict[str, Any]) -> str | None:
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    first = choices[0] if isinstance(choices[0], dict) else None
    if not isinstance(first, dict):
        return None
    return _message_content(first.get("message") if isinstance(first.get("message"), dict) else None)


def extract_completion_text(body: Any) -> str | None:
    """兼容裸 OpenAI JSON，以及公司网关 FunctionResult / 宿主外层包装。"""
    if not isinstance(body, dict):
        return None
    direct = _from_openai_completion(body)
    if direct:
        return direct

    # 宿主外层 → data(FunctionResult) → Datas(上游)
    data = body.get("data") if isinstance(body.get("data"), dict) else None
    candidates: list[Any] = []
    if data is not None:
        candidates.append(data)
        if isinstance(data.get("Datas"), (dict, str)):
            candidates.append(data.get("Datas"))
        if isinstance(data.get("Data"), (dict, str)):
            candidates.append(data.get("Data"))
    if isinstance(body.get("Datas"), (dict, str)):
        candidates.append(body.get("Datas"))
    if isinstance(body.get("Data"), (dict, str)):
        candidates.append(body.get("Data"))

    for item in candidates:
        obj = item
        if isinstance(obj, str):
            try:
                obj = json.loads(obj)
            except json.JSONDecodeError:
                text = obj.strip()
                if text:
                    return text
                continue
        if isinstance(obj, dict):
            got = _from_openai_completion(obj)
            if got:
                return got
            # 偶发 Datas 再套一层 FunctionResult
            nested = obj.get("Datas") if isinstance(obj.get("Datas"), dict) else None
            if nested:
                got = _from_openai_completion(nested)
                if got:
                    return got
    return None


def chat_completions(
    llm_cfg: dict[str, str],
    messages: list[dict[str, str]],
    *,
    max_tokens: int = 4096,
    temperature: float = 0.2,
    timeout: float = 180.0,
) -> str | None:
    """POST 网关/兼容端点。base 必须来自配置或公司网关解析结果。"""
    provider = (llm_cfg.get("provider") or "").strip().lower()
    base = (llm_cfg.get("base_url") or "").strip()
    model = (llm_cfg.get("model") or "").strip()
    key = (llm_cfg.get("api_key") or "").strip()
    if not base or not model:
        return None
    if provider != "ollama" and not key:
        return None

    url = chat_url(base)
    if not url:
        return None
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if provider != "ollama":
        headers["Authorization"] = f"Bearer {key}"

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    # 仅直连 deepseek 厂商槽时关 thinking；公司网关勿加
    if provider == "deepseek":
        payload["thinking"] = {"type": "disabled"}

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8", errors="replace"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, OSError):
        return None

    return extract_completion_text(body)
