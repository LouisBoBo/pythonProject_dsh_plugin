#!/usr/bin/env python3
"""把生产日报图表渲成 PNG，对照 WorkBuddy analyzer 的离线 matplotlib 口径。"""
from __future__ import annotations

import json
import os
import re
import sys

os.environ.setdefault(
    "MPLCONFIGDIR",
    os.path.join(os.path.expanduser("~"), ".zhongruan", "automations", ".mplcache"),
)
os.makedirs(os.environ["MPLCONFIGDIR"], exist_ok=True)

try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
except Exception as e:
    json.dump({"ok": False, "error": f"未安装 matplotlib，无法生成飞书图表：{e}"}, sys.stdout, ensure_ascii=False)
    sys.exit(0)

_FONT_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "C:\\Windows\\Fonts\\msyh.ttc",
]
for _p in _FONT_CANDIDATES:
    if os.path.exists(_p):
        try:
            font_manager.fontManager.addfont(_p)
            _name = font_manager.FontProperties(fname=_p).get_name()
            plt.rcParams["font.sans-serif"] = [_name, "DejaVu Sans"]
            break
        except Exception:
            continue
plt.rcParams["axes.unicode_minus"] = False

PALETTE = ["#4f46e5", "#16a34a", "#d97706", "#dc2626", "#0891b2", "#7c3aed"]


def _fmt(v: float, unit: str) -> str:
    if unit == "%":
        return f"{v:.2f}%"
    return f"{int(round(v))}{unit}"


def _bar(chart: dict, path: str) -> tuple[int, int]:
    items = chart["items"]
    labels = [str(x["label"]) for x in items][::-1]
    values = [float(x["value"]) for x in items][::-1]
    colors = [PALETTE[i % len(PALETTE)] for i in range(len(items))][::-1]
    unit = str(chart.get("unit") or "")
    h = max(2.4, 0.52 * len(items) + 1.35)
    fig, ax = plt.subplots(figsize=(7.2, h), dpi=120)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("#f8fafc")
    ax.barh(labels, values, color=colors, height=0.42)
    vmax = max(values) if values else 1
    if unit == "%":
        ax.set_xlim(0, max(100, vmax * 1.08))
    else:
        ax.set_xlim(0, vmax * 1.18 if vmax else 1)
    for y, v in enumerate(values):
        ax.text(v, y, " " + _fmt(v, unit), va="center", fontsize=9, color="#1e293b")
    ax.set_title(str(chart.get("title") or ""), fontsize=13, pad=10, color="#1e293b", loc="left")
    ax.tick_params(labelsize=10, colors="#64748b")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color("#e2e8f0")
    ax.spines["bottom"].set_color("#e2e8f0")
    fig.tight_layout()
    fig.savefig(path, dpi=120, bbox_inches="tight", facecolor="white")
    w, hpx = fig.get_size_inches() * fig.dpi
    plt.close(fig)
    return int(w), int(hpx)


def _pie(chart: dict, path: str) -> tuple[int, int]:
    items = chart["items"]
    labels = [str(x["label"]) for x in items]
    values = [float(x["value"]) for x in items]
    colors = [PALETTE[i % len(PALETTE)] for i in range(len(items))]
    unit = str(chart.get("unit") or "")
    fig, ax = plt.subplots(figsize=(7.2, 3.8), dpi=120)
    fig.patch.set_facecolor("white")
    legend = [f"{lab} {_fmt(val, unit)}" for lab, val in zip(labels, values)]
    ax.pie(
        values,
        labels=None,
        startangle=90,
        counterclock=False,
        colors=colors,
        wedgeprops={"edgecolor": "white", "linewidth": 1.6},
    )
    ax.legend(legend, loc="center left", bbox_to_anchor=(0.95, 0.5), frameon=False, fontsize=10)
    ax.set_title(str(chart.get("title") or ""), fontsize=13, pad=10, color="#1e293b", loc="left")
    ax.axis("equal")
    fig.tight_layout()
    fig.savefig(path, dpi=120, bbox_inches="tight", facecolor="white")
    w, hpx = fig.get_size_inches() * fig.dpi
    plt.close(fig)
    return int(w), int(hpx)


def _line(chart: dict, path: str) -> tuple[int, int]:
    items = chart["items"]
    labels = [str(x["label"]) for x in items]
    values = [float(x["value"]) for x in items]
    fig, ax = plt.subplots(figsize=(7.2, 3.4), dpi=120)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("#f8fafc")
    ax.plot(labels, values, marker="o", markersize=3.2, linewidth=1.8, color=PALETTE[0])
    if str(chart.get("unit") or "") == "%":
        ax.set_ylim(0, max(100, max(values) if values else 1))
    ax.set_title(str(chart.get("title") or ""), fontsize=13, pad=10, color="#1e293b", loc="left")
    if len(labels) > 8:
        ax.tick_params(axis="x", rotation=45, labelsize=8)
    else:
        ax.tick_params(labelsize=9)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=120, bbox_inches="tight", facecolor="white")
    w, hpx = fig.get_size_inches() * fig.dpi
    plt.close(fig)
    return int(w), int(hpx)


def main() -> None:
    raw = sys.stdin.read()
    payload = json.loads(raw or "{}")
    outdir = str(payload.get("outdir") or "")
    charts = payload.get("charts") or []
    if not outdir:
        json.dump({"ok": False, "error": "缺少 outdir"}, sys.stdout, ensure_ascii=False)
        return
    os.makedirs(outdir, exist_ok=True)
    files = []
    for chart in charts:
        if not isinstance(chart, dict) or not chart.get("items"):
            continue
        cid = re.sub(r"\.\.", "", str(chart.get("id") or ""))
        cid = re.sub(r"[^A-Za-z0-9._-]", "", cid)[:64] or f"chart-{len(files) + 1}"
        path = os.path.abspath(os.path.join(outdir, f"{cid}.png"))
        root = os.path.abspath(outdir)
        if os.path.commonpath([path, root]) != root:
            continue
        kind = str(chart.get("type") or "bar")
        try:
            if kind == "pie":
                w, h = _pie(chart, path)
            elif kind == "line":
                w, h = _line(chart, path)
            else:
                w, h = _bar(chart, path)
        except Exception as e:
            json.dump({"ok": False, "error": f"渲染 {cid} 失败：{e}"}, sys.stdout, ensure_ascii=False)
            return
        files.append({"id": cid, "path": path, "width": w, "height": h, "title": str(chart.get("title") or "")})
    json.dump({"ok": True, "files": files}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
