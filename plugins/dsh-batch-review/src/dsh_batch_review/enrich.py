"""轻量源码规则补种 findings（对齐 simplified ide_review/enrich.py）。

LLM 空数组 ≠ 代码无问题：先对 file_contents 跑规则，再交给报告汇总。
方法论仍以 Viprasol 为准；此处只补高信号、可正则判定的风险，禁止另造检查体系。
"""
from __future__ import annotations

import re
from typing import Any

from .findings import ReviewFinding

_LOOPBACK = re.compile(
    r"https?://(?:127\.0\.0\.1|localhost|0\.0\.0\.0|::1)(?::\d+)?",
    re.I,
)
_PRIVATE_IP = re.compile(
    r"https?://(?:"
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"192\.168\.\d{1,3}\.\d{1,3}|"
    r"172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}"
    r")(?::\d+)?",
    re.I,
)
_ENV_SECRET = re.compile(
    r"""(password|passwd|secret|api[_-]?key)\s*=\s*["']?\$\{?[A-Za-z_][A-Za-z0-9_]*\}?["']?""",
    re.I,
)

# (severity P0/P1/P2, rule_id, pattern, title, description, fix)
_LINE_RULES: list[tuple[str, str, re.Pattern[str], str, str, str]] = [
    (
        "P0",
        "java-sql-string-concat",
        re.compile(
            r"(createStatement\s*\(|\.execute(Query|Update)?\s*\(\s*[\"'][^\"']*[\"']\s*\+|"
            r"Statement\.execute|[\"']\s*SELECT\b[^\"']*[\"']\s*\+)",
            re.I,
        ),
        "疑似 SQL 字符串拼接",
        "存在注入风险（OWASP A03 / CWE-89）",
        "改用参数化查询 / PreparedStatement，禁止拼接用户输入",
    ),
    (
        "P0",
        "java-runtime-exec",
        re.compile(r"Runtime\.getRuntime\s*\(\s*\)\s*\.exec\s*\(|ProcessBuilder\s*\("),
        "出现 Runtime.exec / ProcessBuilder",
        "存在命令注入风险",
        "避免拼接外部输入；使用白名单参数或安全 API",
    ),
    (
        "P0",
        "dangerous-eval",
        re.compile(r"\beval\s*\("),
        "出现 eval()",
        "存在任意代码执行风险",
        "改为安全解析，避免 eval",
    ),
    (
        "P1",
        "hardcoded-secret",
        re.compile(
            r"(password|passwd|secret|api[_-]?key)\s*=\s*[\"'][^\"'$][^\"']{3,}[\"']",
            re.I,
        ),
        "疑似硬编码口令/密钥",
        "密钥写入源码易泄露",
        "改为环境变量或密钥管理服务",
    ),
    (
        "P0",
        "public-ip-http-url",
        re.compile(r"http://\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?", re.I),
        "出现公网 IP 的明文 HTTP URL",
        "源码/配置中硬编码公网 IP 且为 http://，存在明文传输与未授权访问风险",
        "改为 https 域名，并确认鉴权与网络隔离",
    ),
    (
        "P1",
        "public-ip-https-url",
        re.compile(r"https://\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?", re.I),
        "出现公网 IP 的 HTTPS URL",
        "硬编码公网 IP 不利于证书与运维治理；确认是否应使用域名",
        "改为域名，并确认证书与网络隔离",
    ),
    (
        "P1",
        "java-print-stack-trace",
        re.compile(r"\.printStackTrace\s*\("),
        "printStackTrace 可能泄露内部信息",
        "异常栈可能进入日志/控制台",
        "使用统一日志框架记录异常",
    ),
    (
        "P2",
        "python-bare-except",
        re.compile(r"except\s*:"),
        "裸 except 吞掉全部异常",
        "可能掩盖真实错误，不利于排查",
        "改为 except Exception 或具体异常类型，并记录日志",
    ),
    (
        "P2",
        "todo-fixme-marker",
        re.compile(r"\b(TODO|FIXME|HACK)\b"),
        "残留 TODO/FIXME/HACK 标记",
        "未完成事项或临时方案残留在源码中",
        "补齐实现并删除标记，或登记到任务系统",
    ),
]

# 规则 band → ReviewFinding.severity（再经 _SEV_TO_P：P0→critical→高危，P1→medium→中危，P2→low→低危）
_SEV_MAP = {"P0": "critical", "P1": "medium", "P2": "low"}


def _line_of(text: str, idx: int) -> int:
    return text.count("\n", 0, max(0, idx)) + 1


def _is_loopback_url(url: str) -> bool:
    return bool(_LOOPBACK.search(url or ""))


def _http_host(url: str) -> str:
    m = re.match(r"https?://([^/:]+)", (url or "").strip(), re.I)
    return (m.group(1) if m else "").strip().lower()


def _is_cluster_local_http(url: str) -> bool:
    """http://nginx、http://api:8080 等短主机名，多半是集群内服务名，不当公网明文。"""
    if _is_loopback_url(url):
        return True
    host = _http_host(url)
    if not host:
        return False
    if re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){3}", host):
        return False
    # 无点号 → 典型 K8s/Compose 服务名
    if "." not in host:
        return True
    # 明确内网后缀
    if host.endswith((".local", ".internal", ".svc", ".cluster.local")):
        return True
    return False

def _file_level_findings(rel: str, text: str) -> list[ReviewFinding]:
    """OpenAPI / Compose 等文件级高信号规则。"""
    out: list[ReviewFinding] = []
    lower = rel.lower().replace("\\", "/")
    name = lower.rsplit("/", 1)[-1]

    is_openapi = ("openapi" in name or "swagger" in name) and lower.endswith(
        (".yaml", ".yml", ".json")
    )
    if is_openapi:
        m_url = re.search(
            r"^\s*-\s*url:\s*(https?://[^\s#]+)",
            text,
            re.I | re.M,
        )
        if m_url:
            url = m_url.group(1).strip()
            line = _line_of(text, m_url.start())
            if url.lower().startswith("http://") and not _is_loopback_url(url):
                if _is_cluster_local_http(url):
                    out.append(
                        ReviewFinding(
                            file=rel,
                            line=line,
                            severity="medium",
                            title="OpenAPI servers 使用 HTTP（疑似内网服务名）",
                            description=(
                                f"servers.url 为 `{url}`。主机名像集群内服务，"
                                "不一定是公网暴露；仍建议生产走 TLS 或由网关终结。"
                            ),
                            code_snippet=m_url.group(0).rstrip(),
                            fix_suggestion="确认仅内网可达；对外暴露时改为 https 或网关 TLS",
                            fix_code=(
                                f"servers:\n  - url: {url.replace('http://', 'https://', 1)}\n"
                                "    description: 网关/TLS 后的地址"
                            ),
                        )
                    )
                else:
                    out.append(
                        ReviewFinding(
                            file=rel,
                            line=line,
                            severity="critical",
                            title="OpenAPI servers 使用明文 HTTP",
                            description=(
                                f"servers.url 为 `{url}`。公网或跨网明文传输可被窃听/篡改"
                                "（OWASP A02 / CWE-319）。"
                            ),
                            code_snippet=m_url.group(0).rstrip(),
                            fix_suggestion="配置 TLS，将 url 改为 https://，并验证证书有效",
                            fix_code=(
                                f"servers:\n  - url: {url.replace('http://', 'https://', 1)}\n"
                                "    description: TLS 终结后的对外地址"
                            ),
                        )
                    )
        has_paths = bool(re.search(r"^paths\s*:", text, re.M))
        has_schemes = bool(
            re.search(r"securitySchemes\s*:", text) or re.search(r"^\s*security\s*:", text, re.M)
        )
        if has_paths and not has_schemes:
            out.append(
                ReviewFinding(
                    file=rel,
                    line=_line_of(text, text.find("paths:")) if "paths:" in text else 1,
                    severity="critical",
                    title="OpenAPI 未定义任何鉴权（securitySchemes）",
                    description=(
                        "全篇未定义 securitySchemes / 全局 security。"
                        "在 servers 可达前提下，接口可被匿名调用（OWASP A01 / CWE-284）。"
                    ),
                    code_snippet="paths:\n  /api/...\n    get: ...",
                    fix_suggestion="增加 components.securitySchemes，并在全局或各 operation 声明 security；网关层同步校验",
                    fix_code=(
                        "components:\n  securitySchemes:\n    apiKey:\n"
                        "      type: apiKey\n      in: header\n      name: X-API-Key\n"
                        "security:\n  - apiKey: []"
                    ),
                )
            )

    if "docker-compose" in name or name.startswith("compose."):
        # 逐行看 ports 列表项，避免 IP 段里的「1:7474」误匹配
        in_ports = False
        for i, line in enumerate(text.splitlines(), start=1):
            if re.match(r"^\s*ports\s*:\s*$", line):
                in_ports = True
                continue
            if in_ports:
                if re.match(r"^\s+\S", line) is None and line.strip():
                    in_ports = False
                    continue
                m_item = re.match(
                    r"""^\s*-\s*["']([^"']+)["']\s*$|^\s*-\s*([^\s#]+)""",
                    line,
                )
                if not m_item:
                    continue
                val = (m_item.group(1) or m_item.group(2) or "").strip()
                if val.startswith("127.0.0.1:") or val.startswith("localhost:"):
                    continue
                if re.fullmatch(r"0\.0\.0\.0:\d+:\d+", val):
                    out.append(
                        ReviewFinding(
                            file=rel,
                            line=i,
                            severity="critical",
                            title="Compose 端口绑定 0.0.0.0 可能对公网暴露",
                            description="检测到 ports 映射到 0.0.0.0；若无前置鉴权，服务可被外网直连",
                            code_snippet=line.strip(),
                            fix_suggestion="改为 127.0.0.1 绑定，或置于内网 + 网关鉴权",
                            fix_code='ports:\n  - "127.0.0.1:8000:8000"',
                        )
                    )
                elif re.fullmatch(r"\d+:\d+", val):
                    out.append(
                        ReviewFinding(
                            file=rel,
                            line=i,
                            severity="high",
                            title="Compose 端口映射未限制本机回环",
                            description=(
                                "检测到 ports 映射（未写 127.0.0.1）。Docker 默认常听 0.0.0.0，"
                                "若主机对公网开放则服务可被直连；请确认网络隔离或显式绑定回环。"
                            ),
                            code_snippet=line.strip(),
                            fix_suggestion="显式绑定 127.0.0.1，或确认仅内网可达 + 网关鉴权",
                            fix_code='ports:\n  - "127.0.0.1:8000:8000"',
                        )
                    )

    return out


def seed_findings_from_files(files: list[dict[str, Any]]) -> list[ReviewFinding]:
    """对已读文件跑规则，返回补种 findings。"""
    out: list[ReviewFinding] = []
    seen: set[tuple[str, str, int | None, str]] = set()

    for item in files:
        rel = str(item.get("path") or "").strip()
        text = str(item.get("content") or "")
        if not rel or not text:
            continue

        for f in _file_level_findings(rel, text):
            key = (f.file, f.title, f.line, f.severity)
            if key in seen:
                continue
            seen.add(key)
            out.append(f)

        for i, line in enumerate(text.splitlines(), start=1):
            for sev, rule, pattern, title, desc, fix in _LINE_RULES:
                m = pattern.search(line)
                if not m:
                    continue
                if rule in {"public-ip-http-url", "public-ip-https-url"}:
                    # 跳过回环 / RFC1918 内网；OpenAPI 文件级已覆盖
                    if _is_loopback_url(m.group(0)) or _PRIVATE_IP.search(m.group(0)):
                        continue
                    if "openapi" in rel.lower() or "swagger" in rel.lower():
                        continue
                if rule == "hardcoded-secret" and _ENV_SECRET.search(line):
                    continue
                key = (rel, title, i, rule)
                if key in seen:
                    continue
                seen.add(key)
                out.append(
                    ReviewFinding(
                        file=rel,
                        line=i,
                        severity=_SEV_MAP.get(sev, "medium"),
                        title=title,
                        description=f"{desc}（规则 {rule}）",
                        code_snippet=line.strip()[:500],
                        fix_suggestion=fix,
                        fix_code="",
                    )
                )
    return out


def merge_findings(
    primary: list[ReviewFinding],
    seeded: list[ReviewFinding],
) -> list[ReviewFinding]:
    """合并 LLM 与规则 findings；同文件同标题同行去重，保留更高严重度与更完整描述。"""
    rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    by_key: dict[tuple[str, str, int | None], ReviewFinding] = {}
    for f in list(seeded) + list(primary):
        key = (f.file, f.title, f.line)
        old = by_key.get(key)
        if not old:
            by_key[key] = f
            continue
        old_r = rank.get(old.severity, 9)
        new_r = rank.get(f.severity, 9)
        if new_r < old_r:
            by_key[key] = f
            continue
        if new_r == old_r and (
            len(f.description) + len(f.fix_code) > len(old.description) + len(old.fix_code)
        ):
            by_key[key] = f
    return list(by_key.values())
