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


def test_missing_findings_block_degrades_not_engine_down(tmp_path: Path, monkeypatch):
    """催收后仍无机器块：记低危格式异常并 ran，禁止整批标引擎不可用。"""
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
    assert out["unavailable"] is False
    assert out["ran"] is True
    assert out["passed"] is True  # 仅 low，不挡提交
    titles = [str(f.get("title") or "") for f in (out.get("findings") or [])]
    assert any("格式异常" in t or "结构化" in t for t in titles)


def test_deleted_file_reads_head_not_engine_down(tmp_path: Path, monkeypatch):
    """git 已删除的勾选文件须用 HEAD 原文纳入审码，禁止整批报未能纳入。"""
    import subprocess

    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "t@example.com"], cwd=tmp_path, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=tmp_path, check=True, capture_output=True)
    kept = tmp_path / "keep.py"
    gone = tmp_path / "gone.py"
    kept.write_text("a=1\n", encoding="utf-8")
    gone.write_text("b=2\n", encoding="utf-8")
    subprocess.run(["git", "add", "keep.py", "gone.py"], cwd=tmp_path, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=tmp_path, check=True, capture_output=True)
    gone.unlink()
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
    seen = {"body": ""}

    def chat(_llm, msgs, **_kw):
        for m in msgs:
            if m.get("role") == "user":
                seen["body"] += m.get("content") or ""
        return ":::code_review_findings\n[]\n:::"

    out = run_batch_review(workspace=str(tmp_path), files=["keep.py", "gone.py"], chat_fn=chat)
    assert out["unavailable"] is False
    assert out["ran"] is True
    assert "gone.py" in (out.get("reviewed_files") or [])
    assert "已从工作区删除" in seen["body"]
    assert "b=2" in seen["body"]


def test_skipped_file_does_not_block(tmp_path: Path, monkeypatch):
    """读不到的勾选文件直接放行，读得到的仍审，不拦整批。"""
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
    assert out["unavailable"] is False
    assert out["ran"] is True
    assert out["passed"] is True
    assert "ok.py" in (out.get("reviewed_files") or [])
    assert "missing.py" in (out.get("skipped_files") or [])
    assert out.get("unavailable_code") in (None, "")


def test_read_failure_does_not_hide_high(tmp_path: Path, monkeypatch):
    """读失败放行不得把同批里读到的高危一起放掉。"""
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
        chat_fn=lambda *a, **k: (
            ':::code_review_findings\n'
            '[{"file":"ok.py","line":1,"severity":"high","title":"危险 eval","description":"RCE"}]\n'
            ':::'
        ),
    )
    assert out["unavailable"] is False
    assert out["ran"] is True
    assert out["passed"] is False
    assert out["high_count"] >= 1
    assert "missing.py" in (out.get("skipped_files") or [])


def test_review_progress_reports_file_counts(tmp_path: Path, monkeypatch):
    """分片开始和结束都报已审/总数，最后一条必须到齐。"""
    for i in range(4):
        (tmp_path / f"f{i}.py").write_text(f"x={i}\n", encoding="utf-8")
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
    seen: list[tuple[int, int]] = []
    out = run_batch_review(
        workspace=str(tmp_path),
        files=[f"f{i}.py" for i in range(4)],
        chat_fn=lambda *a, **k: ":::code_review_findings\n[]\n:::",
        on_progress=lambda done, total: seen.append((done, total)),
    )
    assert out["passed"] is True
    assert seen[0] == (1, 4)
    assert (3, 4) in seen
    assert seen[-1] == (4, 4)


def test_all_unreadable_passes(tmp_path: Path, monkeypatch):
    """一个文件都读不到时也放行，不进入审码闸。"""
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

    def chat(*_a, **_k):
        raise AssertionError("没有可读文件时不应调用模型")

    out = run_batch_review(workspace=str(tmp_path), files=["missing.py"], chat_fn=chat)
    assert out["unavailable"] is False
    assert out["ran"] is True
    assert out["passed"] is True
    assert "missing.py" in (out.get("skipped_files") or [])


def test_untracked_dir_expands_not_engine_down(tmp_path: Path, monkeypatch):
    """``MOM/`` 一类未跟踪目录须展开内文件，禁止整批 unavailable。"""
    (tmp_path / "ok.py").write_text("x=1\n", encoding="utf-8")
    mom = tmp_path / "MOM" / "2026-11-09"
    mom.mkdir(parents=True)
    (mom / "note.md").write_text("# ok\n", encoding="utf-8")
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
    reviewed: list[str] = []

    def chat(_llm, msgs, **_kw):
        user = msgs[-1]["content"] if msgs else ""
        reviewed.append(user)
        return ":::code_review_findings\n[]\n:::"

    out = run_batch_review(
        workspace=str(tmp_path),
        files=["ok.py", "MOM"],
        chat_fn=chat,
    )
    assert out["unavailable"] is False
    assert out["ran"] is True
    assert out["passed"] is True
    assert "MOM/2026-11-09/note.md" in (out.get("reviewed_files") or [])
    assert "ok.py" in (out.get("reviewed_files") or [])


def test_missing_block_repairs_once(tmp_path: Path, monkeypatch):
    """主调用漏机器块时须催收一次，催收成功则放行。"""
    (tmp_path / "a.py").write_text("x=1\n", encoding="utf-8")
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
    calls = {"n": 0}

    def chat(_llm, msgs, **_kw):
        calls["n"] += 1
        if calls["n"] == 1:
            return "Long English analysis without fence…"
        return ":::code_review_findings\n[]\n:::"

    out = run_batch_review(workspace=str(tmp_path), files=["a.py"], chat_fn=chat)
    assert calls["n"] == 2
    assert out["unavailable"] is False and out["ran"] is True and out["passed"] is True


def test_non_code_passthrough_not_sent_to_llm(tmp_path: Path, monkeypatch):
    (tmp_path / "a.py").write_text("x=1\n", encoding="utf-8")
    (tmp_path / "note.md").write_text("# report\n", encoding="utf-8")
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
    seen_users: list[str] = []

    def chat(_llm, msgs, **_kw):
        for m in msgs:
            if m.get("role") == "user":
                seen_users.append(m.get("content") or "")
        return ":::code_review_findings\n[]\n:::"

    out = run_batch_review(
        workspace=str(tmp_path),
        files=["a.py", "note.md"],
        chat_fn=chat,
    )
    assert out["unavailable"] is False
    assert "note.md" in (out.get("reviewed_files") or [])
    assert all("note.md" not in u or "===== FILE: note.md =====" not in u for u in seen_users)


def test_rule_seed_and_official_report(tmp_path: Path, monkeypatch):
    (tmp_path / "u.sh").write_text('curl http://175.178.238.31/dsh-plugins/plugins.json\n', encoding="utf-8")
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
    seen_system = {"text": ""}

    def chat(_llm, msgs, **_kw):
        for m in msgs:
            if m.get("role") == "system":
                seen_system["text"] = m.get("content") or ""
        return ":::code_review_findings\n[]\n:::"

    out = run_batch_review(workspace=str(tmp_path), files=["u.sh"], chat_fn=chat)
    reply = out["reply"]
    assert out["unavailable"] is False
    assert out["passed"] is False
    assert out["high_count"] >= 1
    assert str(out["report_id"]).startswith("cr-")
    assert "代码审核汇总报告" in reply
    assert "审核人：Viprasol + workbuddy-gate-90（Skill `zr-workbuddy-code-review`）" in reply
    assert "public-ip-http-url" in reply
    assert "// ❌ 当前代码" in reply
    assert "一、总体评价" in reply
    assert "四、审核结论" in reply
    assert "❌ 审核不通过" in reply
    assert "Viprasol" in seen_system["text"]
    from dsh_batch_review.prompt import build_compact_gateway_system_prompt

    compact = build_compact_gateway_system_prompt()
    assert compact.find(":::code_review_findings") < compact.find("Viprasol")
