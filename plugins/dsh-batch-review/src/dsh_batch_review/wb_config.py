"""只读 WorkBuddy config.yaml（系统配置），禁止插件 config.json 当凭证账本。"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

_PROVIDERS = ("deepseek", "ollama", "openai_compat")


def candidate_config_paths() -> list[Path]:
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

    push(os.environ.get("WORKBUDDY_CONFIG") or "")
    push(os.environ.get("DSH_WORKBUDDY_CONFIG") or "")
    appdata = os.environ.get("APPDATA") or ""
    if appdata:
        push(Path(appdata) / "zr-workbuddy-desktop" / "persist" / "config.yaml")
        push(
            Path(appdata)
            / "zr-workbuddy-desktop"
            / "runtime-app"
            / "apps"
            / "zr-workbuddy"
            / "engine"
            / "config"
            / "config.yaml"
        )
    # 源码仓相对旁路包（开发机）：…/AICodes/DSH_Plugins/…/dsh_batch_review → AICodes
    here = Path(__file__).resolve()
    if len(here.parents) > 6:
        push(
            here.parents[6]
            / "DSH_WorkBuddy"
            / "apps"
            / "zr-workbuddy"
            / "engine"
            / "config"
            / "config.yaml"
        )
    return out


def load_workbuddy_config() -> dict[str, Any]:
    try:
        import yaml  # type: ignore
    except ImportError as e:
        raise RuntimeError("需要 PyYAML 才能读取 WorkBuddy config.yaml") from e

    for p in candidate_config_paths():
        if not p.is_file():
            continue
        raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        if isinstance(raw, dict):
            raw["_config_path"] = str(p)
            return raw
    return {}


def _default_slot(provider: str) -> dict[str, str]:
    if provider == "ollama":
        return {"api_key": "", "base_url": "http://127.0.0.1:11434", "model": ""}
    if provider == "openai_compat":
        # 网关槽：禁止填官网默认；空 base_url = 未配置
        return {"api_key": "", "base_url": "", "model": ""}
    # deepseek 槽也不在旁路里写死官网；空 base_url 视为未配网关/端点
    return {"api_key": "", "base_url": "", "model": ""}


def resolve_llm_cfg(cfg: dict[str, Any] | None) -> dict[str, str] | None:
    """对齐 WorkBuddy resolve_llm_cfg；base_url/api_key/model 缺一不可（网关必填 base_url）。"""
    root = cfg if isinstance(cfg, dict) else {}
    src = root.get("deepseek") if isinstance(root.get("deepseek"), dict) else {}
    provider = str(src.get("provider") or "deepseek").strip().lower()
    if provider not in _PROVIDERS:
        provider = "deepseek"

    by_in = src.get("by_provider") if isinstance(src.get("by_provider"), dict) else {}
    slot = _default_slot(provider)
    raw_slot = by_in.get(provider) if isinstance(by_in.get(provider), dict) else None
    if isinstance(raw_slot, dict):
        if raw_slot.get("api_key") is not None:
            slot["api_key"] = str(raw_slot.get("api_key") or "")
        if raw_slot.get("base_url"):
            slot["base_url"] = str(raw_slot.get("base_url") or "").strip()
        if raw_slot.get("model") is not None:
            slot["model"] = str(raw_slot.get("model") or "").strip()
    # legacy 顶层回填
    if not slot["api_key"] and src.get("api_key"):
        slot["api_key"] = str(src.get("api_key") or "")
    if not slot["base_url"] and src.get("base_url"):
        slot["base_url"] = str(src.get("base_url") or "").strip()
    if not slot["model"] and src.get("model"):
        slot["model"] = str(src.get("model") or "").strip()

    base = slot["base_url"].strip().rstrip("/")
    key = slot["api_key"].strip()
    model = slot["model"].strip()
    if provider == "ollama":
        if not base:
            base = "http://127.0.0.1:11434"
        if not model:
            return None
        return {"provider": provider, "api_key": key, "base_url": base, "model": model}

    # 网关 / 兼容 / deepseek：必须显式 base_url，禁止旁路默认官网
    if not base or not key or not model:
        return None
    return {"provider": provider, "api_key": key, "base_url": base, "model": model}


def resolve_review_llm(cfg: dict[str, Any] | None = None) -> dict[str, str] | None:
    """审码专用：WB 非官网配置优先，否则公司 DSH 网关（ZR_GATEWAY_TOKEN）。"""
    from .dsh_gateway import prefer_review_llm

    root = cfg if isinstance(cfg, dict) else load_workbuddy_config()
    return prefer_review_llm(resolve_llm_cfg(root))


def llm_ready_detail(cfg: dict[str, Any] | None) -> tuple[bool, str]:
    from .dsh_gateway import llm_source_detail

    llm = resolve_review_llm(cfg)
    if llm:
        return True, llm_source_detail(llm)
    return (
        False,
        "LLM 未就绪：请登录公司网关（ZR_GATEWAY_TOKEN），或在 WorkBuddy 系统配置填写非官网 base_url",
    )
