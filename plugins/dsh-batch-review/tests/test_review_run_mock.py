"""审码跑批：注入假 LLM，不打真实网关。"""
from __future__ import annotations

from pathlib import Path

from dsh_batch_review.dsh_gateway import is_official_vendor_url, prefer_review_llm
from dsh_batch_review.llm_bridge import chat_url, extract_completion_text
from dsh_batch_review.review_run import run_batch_review
from dsh_batch_review.wb_config import resolve_llm_cfg


def test_resolve_llm_requires_base_url_no_official_default():
    # 禁止旁路在缺 base_url 时默认官网
    assert (
        resolve_llm_cfg(
            {
                "deepseek": {
                    "provider": "deepseek",
                    "api_key": "sk-x",
                    "base_url": "",
                    "model": "deepseek-chat",
                }
            }
        )
        is None
    )
    ok = resolve_llm_cfg(
        {
            "deepseek": {
                "provider": "openai_compat",
                "api_key": "sk-gw",
                "base_url": "http://127.0.0.1:9/v1-gateway",
                "model": "corp-model",
            }
        }
    )
    assert ok is not None
    assert "127.0.0.1:9" in ok["base_url"]
    assert "api.deepseek.com" not in ok["base_url"]


def test_prefer_skips_official_uses_company(monkeypatch):
    assert is_official_vendor_url("https://api.deepseek.com")
    monkeypatch.setenv("ZR_GATEWAY_TOKEN", "tok-test")
    monkeypatch.setenv("ZR_MODEL_GATEWAY_URL", "http://113.90.149.166:19772")
    monkeypatch.delenv("DSH_BATCH_REVIEW_ALLOW_ANY_GATEWAY", raising=False)
    monkeypatch.delenv("DSH_BATCH_REVIEW_MODEL", raising=False)
    official = {
        "provider": "deepseek",
        "api_key": "sk-official",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
    }
    got = prefer_review_llm(official)
    assert got is not None
    assert got["provider"] == "zr-gateway"
    assert got["api_key"] == "tok-test"
    assert got["base_url"].endswith("/api/ai")
    assert "113.90.149.166" in got["base_url"]
    assert got["model"] == "standard"


def test_prefer_rejects_unlisted_host(monkeypatch):
    monkeypatch.delenv("DSH_BATCH_REVIEW_ALLOW_ANY_GATEWAY", raising=False)
    monkeypatch.delenv("ZR_GATEWAY_TOKEN", raising=False)
    monkeypatch.setenv("ZR_MODEL_GATEWAY_URL", "")
    got = prefer_review_llm(
        {
            "provider": "openai_compat",
            "api_key": "sk",
            "base_url": "http://evil.example/v1",
            "model": "m",
        }
    )
    assert got is None


def test_prefer_keeps_non_official_wb(monkeypatch):
    monkeypatch.delenv("DSH_BATCH_REVIEW_ALLOW_ANY_GATEWAY", raising=False)
    wb = {
        "provider": "openai_compat",
        "api_key": "sk-wb",
        "base_url": "http://127.0.0.1:9/v1",
        "model": "corp",
    }
    got = prefer_review_llm(wb)
    assert got is not None
    assert got["api_key"] == "sk-wb"
    assert "127.0.0.1" in got["base_url"]


def test_chat_url_company_and_v1():
    assert chat_url("http://113.90.149.166:19772/api/ai").endswith("/api/ai/chat/completions")
    assert chat_url("http://x/v1") == "http://x/v1/chat/completions"
    assert chat_url("http://x").endswith("/v1/chat/completions")


def test_extract_gateway_wrapped():
    body = {
        "success": True,
        "data": {
            "Success": True,
            "Datas": {
                "choices": [{"message": {"role": "assistant", "content": "  hi  "}}],
            },
        },
    }
    assert extract_completion_text(body) == "hi"


def test_run_batch_with_mock_chat(tmp_path: Path, monkeypatch):
    src = tmp_path / "a.py"
    src.write_text("x = 1\n", encoding="utf-8")
    monkeypatch.setenv("DSH_BATCH_REVIEW_ALLOW_ANY_GATEWAY", "1")

    def fake_load():
        return {
            "_config_path": "test",
            "deepseek": {
                "provider": "openai_compat",
                "api_key": "sk-test",
                "base_url": "http://gateway.test/v1",
                "model": "m",
            },
        }

    monkeypatch.setattr("dsh_batch_review.review_run.load_workbuddy_config", fake_load)

    fake_raw = """摘要：无高危。

:::code_review_findings
[{"file":"a.py","line":1,"severity":"low","title":"示例","description":"命名"}]
:::
"""

    def fake_chat(llm_cfg, messages, **kwargs):
        assert "gateway.test" in llm_cfg["base_url"]
        assert messages and messages[0]["role"] == "system"
        return fake_raw

    out = run_batch_review(
        workspace=str(tmp_path),
        files=["a.py"],
        chat_fn=fake_chat,
    )
    assert out["unavailable"] is False
    assert out["ran"] is True
    assert out["passed"] is True
    assert out["high_count"] == 0
    assert out["low_count"] == 1
    assert out["engine"] == "embedded"


def test_run_batch_high_blocks(tmp_path: Path, monkeypatch):
    (tmp_path / "b.js").write_text("eval(x)\n", encoding="utf-8")
    monkeypatch.setenv("DSH_BATCH_REVIEW_ALLOW_ANY_GATEWAY", "1")
    monkeypatch.setattr(
        "dsh_batch_review.review_run.load_workbuddy_config",
        lambda: {
            "deepseek": {
                "provider": "openai_compat",
                "api_key": "sk",
                "base_url": "http://gw/v1",
                "model": "m",
            }
        },
    )

    def fake_chat(llm_cfg, messages, **kwargs):
        return """:::code_review_findings
[{"file":"b.js","line":1,"severity":"high","title":"危险 eval","description":"RCE"}]
:::"""

    out = run_batch_review(workspace=str(tmp_path), files=["b.js"], chat_fn=fake_chat)
    assert out["passed"] is False
    assert out["high_count"] >= 1


def test_run_batch_falls_back_company_when_wb_official(tmp_path: Path, monkeypatch):
    (tmp_path / "c.py").write_text("print(1)\n", encoding="utf-8")
    monkeypatch.setattr(
        "dsh_batch_review.review_run.load_workbuddy_config",
        lambda: {
            "deepseek": {
                "provider": "deepseek",
                "api_key": "sk-official",
                "base_url": "https://api.deepseek.com",
                "model": "deepseek-chat",
            }
        },
    )
    monkeypatch.setenv("ZR_GATEWAY_TOKEN", "tok")
    monkeypatch.setenv("ZR_MODEL_GATEWAY_URL", "http://113.90.149.166:19772")
    monkeypatch.delenv("DSH_BATCH_REVIEW_ALLOW_ANY_GATEWAY", raising=False)

    def fake_chat(llm_cfg, messages, **kwargs):
        assert llm_cfg["provider"] == "zr-gateway"
        assert "113.90.149.166" in llm_cfg["base_url"]
        return """:::code_review_findings
[{"file":"c.py","line":1,"severity":"low","title":"ok","description":"n"}]
:::"""

    out = run_batch_review(workspace=str(tmp_path), files=["c.py"], chat_fn=fake_chat)
    assert out["passed"] is True
    assert out["unavailable"] is False


def test_missing_findings_block_unavailable(tmp_path: Path, monkeypatch):
    (tmp_path / "d.py").write_text("x=1\n", encoding="utf-8")
    monkeypatch.setenv("DSH_BATCH_REVIEW_ALLOW_ANY_GATEWAY", "1")
    monkeypatch.setattr(
        "dsh_batch_review.review_run.load_workbuddy_config",
        lambda: {
            "deepseek": {
                "provider": "openai_compat",
                "api_key": "sk",
                "base_url": "http://127.0.0.1:9/v1",
                "model": "m",
            }
        },
    )
    out = run_batch_review(
        workspace=str(tmp_path),
        files=["d.py"],
        chat_fn=lambda *a, **k: "看起来有注入风险，但我不输出机器块",
    )
    assert out["unavailable"] is True
    assert out["passed"] is False


def test_skipped_file_blocks(tmp_path: Path, monkeypatch):
    (tmp_path / "ok.py").write_text("x=1\n", encoding="utf-8")
    monkeypatch.setenv("DSH_BATCH_REVIEW_ALLOW_ANY_GATEWAY", "1")
    monkeypatch.setattr(
        "dsh_batch_review.review_run.load_workbuddy_config",
        lambda: {
            "deepseek": {
                "provider": "openai_compat",
                "api_key": "sk",
                "base_url": "http://127.0.0.1:9/v1",
                "model": "m",
            }
        },
    )
    out = run_batch_review(
        workspace=str(tmp_path),
        files=["ok.py", "missing.py"],
        chat_fn=lambda *a, **k: ':::code_review_findings\n[]\n:::',
    )
    assert out["unavailable"] is True
    assert "未能纳入审码" in str(out.get("detail") or "")
