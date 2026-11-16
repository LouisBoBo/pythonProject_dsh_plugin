"""公司模型网关（DSH 桌面壳 DEFAULT_GATEWAY / ZR_GATEWAY_TOKEN）。

与 WorkBuddy persist 里可能残留的 api.deepseek.com 无关：审码旁路优先走本机已登录的网关会话。
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

# 与 desktop/shell model-gateway.ts DEFAULT_GATEWAY_BASE_URL 对齐
DEFAULT_GATEWAY_ORIGIN = "http://113.90.149.166:19772"
GATEWAY_CREDENTIAL_REF = "ZR_GATEWAY_TOKEN"
DEFAULT_GATEWAY_MODEL = "standard"

_OFFICIAL_MARKERS = (
    "api.deepseek.com",
    "api.openai.com",
)

# 携带 ZR_GATEWAY_TOKEN 时仅允许这些 host（可用 DSH_BATCH_REVIEW_GATEWAY_HOSTS 追加，逗号分隔）
_DEFAULT_GATEWAY_HOSTS = frozenset(
    {
        "113.90.149.166",
        "127.0.0.1",
        "localhost",
    }
)


def is_official_vendor_url(base_url: str) -> bool:
    b = (base_url or "").strip().lower()
    if not b:
        return False
    return any(m in b for m in _OFFICIAL_MARKERS)


def _gateway_host_allowlist() -> set[str]:
    hosts = set(_DEFAULT_GATEWAY_HOSTS)
    extra = (os.environ.get("DSH_BATCH_REVIEW_GATEWAY_HOSTS") or "").strip()
    for part in extra.split(","):
        h = part.strip().lower()
        if h:
            hosts.add(h)
    return hosts


def is_allowed_gateway_url(base_url: str) -> bool:
    """防 SSRF：公司令牌不得发往任意 URL。测试可设 DSH_BATCH_REVIEW_ALLOW_ANY_GATEWAY=1。"""
    if (os.environ.get("DSH_BATCH_REVIEW_ALLOW_ANY_GATEWAY") or "").strip() == "1":
        return True
    raw = (base_url or "").strip()
    if not raw:
        return False
    if is_official_vendor_url(raw):
        return False
    try:
        parsed = urlparse(raw if "://" in raw else f"http://{raw}")
    except ValueError:
        return False
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    if not host:
        return False
    # 云元数据等常见 SSRF 目标
    if host in {"169.254.169.254", "metadata.google.internal"}:
        return False
    return host in _gateway_host_allowlist()


def gateway_chat_base(origin: str) -> str:
    """`{origin}/api/ai`；若已带 /api/ai 则不重复。"""
    raw = (origin or "").strip().rstrip("/")
    if not raw:
        return ""
    lower = raw.lower()
    if lower.endswith("/api/ai"):
        return raw
    return raw + "/api/ai"


def candidate_dsh_homes() -> list[Path]:
    out: list[Path] = []
    seen: set[str] = set()

    def push(raw: str | Path) -> None:
        p = Path(str(raw or "")).expanduser()
        if not str(p):
            return
        key = str(p.resolve()) if p.exists() else str(p)
        if key in seen:
            return
        seen.add(key)
        out.append(p)

    push(os.environ.get("DSH_HOME") or "")
    local = os.environ.get("LOCALAPPDATA") or ""
    if local:
        push(Path(local) / "ZR_DSH" / "dsh-home")
    push(Path.home() / ".dsh")
    appdata = os.environ.get("APPDATA") or ""
    if appdata:
        push(Path(appdata) / "zr-workbuddy-desktop" / "dsh-home")
    return out


def read_gateway_token() -> str:
    env_tok = (os.environ.get("ZR_GATEWAY_TOKEN") or "").strip()
    if env_tok:
        return env_tok
    try:
        import yaml  # type: ignore
    except ImportError:
        return ""
    for home in candidate_dsh_homes():
        cred = home / ".credentials.yaml"
        if not cred.is_file():
            continue
        try:
            raw = yaml.safe_load(cred.read_text(encoding="utf-8")) or {}
        except OSError:
            continue
        if not isinstance(raw, dict):
            continue
        refs = raw.get("refs") if isinstance(raw.get("refs"), dict) else {}
        tok = str(refs.get(GATEWAY_CREDENTIAL_REF) or "").strip()
        if tok:
            return tok
    return ""


def resolve_company_gateway_llm() -> dict[str, str] | None:
    """读公司网关 origin + ZR_GATEWAY_TOKEN → OpenAI 兼容 base（…/api/ai）。"""
    origin = (os.environ.get("ZR_MODEL_GATEWAY_URL") or "").strip() or DEFAULT_GATEWAY_ORIGIN
    # 空字符串显式关网关（与桌面壳约定一致）
    if os.environ.get("ZR_MODEL_GATEWAY_URL") is not None and not (os.environ.get("ZR_MODEL_GATEWAY_URL") or "").strip():
        return None
    base = gateway_chat_base(origin)
    token = read_gateway_token()
    model = (os.environ.get("DSH_BATCH_REVIEW_MODEL") or DEFAULT_GATEWAY_MODEL).strip() or DEFAULT_GATEWAY_MODEL
    if not base or not token or not model:
        return None
    if not is_allowed_gateway_url(base):
        return None
    return {
        "provider": "zr-gateway",
        "api_key": token,
        "base_url": base,
        "model": model,
    }


def prefer_review_llm(wb_llm: dict[str, str] | None) -> dict[str, str] | None:
    """
    审码 LLM 选择：
    1) WorkBuddy 已配非官网、且 host 在允许列表内的 base_url → 用它
    2) 否则公司 DSH 网关（项目默认网关 + 本机登录令牌）
    3) 官网 DeepSeek URL / 任意外泄 host 一律不用
    """
    if isinstance(wb_llm, dict):
        base = str(wb_llm.get("base_url") or "").strip()
        key = str(wb_llm.get("api_key") or "").strip()
        model = str(wb_llm.get("model") or "").strip()
        provider = str(wb_llm.get("provider") or "").strip().lower()
        if (
            base
            and model
            and (key or provider == "ollama")
            and not is_official_vendor_url(base)
            and (provider == "ollama" or is_allowed_gateway_url(base))
        ):
            return {
                "provider": provider or "openai_compat",
                "api_key": key,
                "base_url": base.rstrip("/"),
                "model": model,
            }
    return resolve_company_gateway_llm()


def llm_source_detail(llm: dict[str, str] | None) -> str:
    if not llm:
        return "LLM 未就绪：无公司网关令牌，且 WorkBuddy 未配非官网 base_url"
    return (
        f"LLM 就绪 provider={llm.get('provider')} model={llm.get('model')} "
        f"base={llm.get('base_url')}"
    )


def as_public_status(llm: dict[str, str] | None, *, config_path: str = "") -> dict[str, Any]:
    return {
        "ok": bool(llm),
        "detail": llm_source_detail(llm),
        "config_path": config_path,
        "provider": (llm or {}).get("provider") or "",
        "model": (llm or {}).get("model") or "",
        "base_url": (llm or {}).get("base_url") or "",
    }
