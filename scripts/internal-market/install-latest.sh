#!/usr/bin/env bash
# 强制把公司市场「当前最新」插件装进本机 dsh Profile（覆盖旧版缓存）
#
# 解决问题：市场已是新版本，但 ~/.dsh/profiles/web 里仍锁在旧 ^x.y.z，
# 「重装」不升级 → 设置页仍是旧界面。
#
# 用法:
#   ./scripts/internal-market/install-latest.sh                 # 全部公司插件
#   ./scripts/internal-market/install-latest.sh dsh-remote-review
#   PREFER_LOCAL=1 ./scripts/internal-market/install-latest.sh # 强制只用本地 plugins.json
#
# 环境变量（可选）:
#   DSH_PROFILE=web
#   COMPANY_NPM_REGISTRY=http://175.178.238.31/dsh-plugins/npm/
#   DSHM_REGISTRY_URL=http://175.178.238.31/dsh-plugins/plugins.json
#   PREFER_LOCAL=1   # 不拉远程，只用 company-registry/plugins.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REG_DIR="$ROOT/company-registry"
PROFILE="${DSH_PROFILE:-web}"
WEB="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/$PROFILE}"
NPM_REG="${COMPANY_NPM_REGISTRY:-http://175.178.238.31/dsh-plugins/npm/}"
MARKET_URL="${DSHM_REGISTRY_URL:-http://175.178.238.31/dsh-plugins/plugins.json}"
PREFER_LOCAL="${PREFER_LOCAL:-0}"

if [[ ! -d "$WEB" ]]; then
  echo "错误: 找不到 Profile 目录: $WEB" >&2
  exit 1
fi

mkdir -p "$WEB/node_modules/@zhongruan"

NPMRC="$WEB/.npmrc"
if [[ ! -f "$NPMRC" ]] || ! grep -q '^@zhongruan:registry=' "$NPMRC" 2>/dev/null; then
  {
    echo "@zhongruan:registry=${NPM_REG%/}/"
    echo "strict-ssl=false"
  } >>"$NPMRC"
  echo "==> 已写入 $NPMRC（@zhongruan 走公司私服）"
fi

FILTER="${1:-}"
export ROOT REG_DIR MARKET_URL FILTER PREFER_LOCAL
export COMPANY_NPM_REGISTRY="$NPM_REG"
python3 <<'PY'
import json, os, sys, urllib.request
from pathlib import Path

reg = Path(os.environ["REG_DIR"])
market_url = os.environ["MARKET_URL"]
filt = (os.environ.get("FILTER") or "").strip()
prefer_local = os.environ.get("PREFER_LOCAL", "0") == "1"

def parse_ver(v: str):
    parts = []
    for p in str(v).split("."):
        try:
            parts.append(int(p))
        except ValueError:
            parts.append(0)
    return tuple(parts)

def newer(a: str, b: str) -> bool:
    return parse_ver(a) > parse_ver(b)

def fetch_remote():
    with urllib.request.urlopen(market_url, timeout=15) as r:
        return json.loads(r.read().decode()).get("plugins") or []

def load_local():
    local = reg / "plugins.json"
    if not local.is_file():
        return []
    return json.loads(local.read_text(encoding="utf-8")).get("plugins") or []

def by_name(plugins):
    out = {}
    for p in plugins:
        name = str(p.get("name") or p.get("npm") or "")
        ver = str(p.get("version") or "")
        if name.startswith("@zhongruan/") and ver:
            out[name] = p
    return out

local_map = by_name(load_local())
remote_map = {}
src = "local-only"
if prefer_local:
    src = f"local:{reg / 'plugins.json'} (PREFER_LOCAL=1)"
else:
    try:
        remote_map = by_name(fetch_remote())
        src = f"remote:{market_url}"
        if local_map:
            src += f" + merge local:{reg / 'plugins.json'}"
    except Exception as e:
        if not local_map:
            print(f"错误: 无法读取远程市场且无本地 plugins.json: {e}", file=sys.stderr)
            sys.exit(1)
        src = f"local-fallback:{reg / 'plugins.json'} ({e})"
        print(f"警告: 远程市场不可用，回退本地: {e}", flush=True)

# 同名取版本更高者；远程优先于同版本本地
merged = dict(local_map)
for name, p in remote_map.items():
    if name not in merged or newer(str(p.get("version")), str(merged[name].get("version"))):
        merged[name] = p
    elif str(p.get("version")) == str(merged[name].get("version")):
        merged[name] = p  # 同版本用远程条目

print(f"==> 市场来源: {src}", flush=True)

def match(name: str, short: str, filt: str) -> bool:
    if not filt:
        return True
    f = filt.strip()
    if f in (name, short):
        return True
    if f.startswith("@zhongruan/"):
        return name == f
    if f.startswith("zhongruan/"):
        return name == "@" + f
    return short == f or name.endswith("/" + f)

out = []
npm_base = os.environ.get("COMPANY_NPM_REGISTRY", "http://175.178.238.31/dsh-plugins/npm").rstrip("/")
for name, p in sorted(merged.items()):
    ver = str(p.get("version") or "")
    short = name.split("/", 1)[1]
    if not match(name, short, filt):
        continue
    tgz = name.replace("@", "").replace("/", "-") + f"-{ver}.tgz"
    local_art = reg / "artifacts" / tgz
    scope, pkg = name[1:].split("/", 1)
    remote_tgz = f"{npm_base}/@{scope}/{pkg}/-/{pkg}-{ver}.tgz"
    out.append({
        "name": name,
        "version": ver,
        "short": short,
        "localTgz": str(local_art) if local_art.is_file() else "",
        "remoteTgz": remote_tgz,
    })

if filt and not out:
    print(f"错误: 过滤器「{filt}」未匹配到任何公司插件", file=sys.stderr)
    sys.exit(1)
if not out:
    print("错误: 没有可安装的 @zhongruan/* 插件", file=sys.stderr)
    sys.exit(1)

Path("/tmp/zr-install-latest.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
for x in out:
    print(f"  将安装 {x['name']}@{x['version']}", flush=True)
PY

install_one() {
  local name="$1" version="$2" short="$3" local_tgz="$4" remote_tgz="$5"
  local dest="$WEB/node_modules/@zhongruan/$short"
  local tmp tgz

  echo "==> 强制安装 $name@$version"
  tmp="$(mktemp -d)"
  tgz="$tmp/pkg.tgz"

  if [[ -n "$local_tgz" && -f "$local_tgz" ]]; then
    echo "  使用本地制品: $local_tgz"
    cp "$local_tgz" "$tgz"
  else
    echo "  下载: $remote_tgz"
    curl -fsSL -o "$tgz" "$remote_tgz"
  fi

  # 安全解压：归档内每一路径都必须在 package/ 下（防路径穿越）
  if ! tar -tzf "$tgz" | awk '
    BEGIN { ok=0; bad=0 }
    {
      if ($0 ~ /^\.?\.?\//) { bad=1; exit }
      if ($0 !~ /^package(\/|$)/) { bad=1; exit }
      ok=1
    }
    END { exit (bad || !ok) ? 1 : 0 }
  '; then
    echo "错误: tgz 布局异常（须全部为 package/…，且无路径穿越）" >&2
    rm -rf "$tmp"
    exit 1
  fi

  rm -rf "$dest"
  mkdir -p "$WEB/node_modules/@zhongruan"
  tar -xzf "$tgz" -C "$tmp"
  if [[ -d "$tmp/package" ]]; then
    mv "$tmp/package" "$dest"
  else
    echo "错误: tgz 内无 package/ 目录" >&2
    rm -rf "$tmp"
    exit 1
  fi
  rm -rf "$tmp"

  local got
  got="$(node -p "require('$dest/package.json').version")"
  if [[ "$got" != "$version" ]]; then
    echo "错误: 解压后版本为 $got，期望 $version" >&2
    exit 1
  fi
  echo "  OK → $dest ($got)"
}

# 先全部装完，再写 package.json，避免中途失败导致声明与 node_modules 不一致
while IFS= read -r line; do
  name="${line%%|*}"
  rest="${line#*|}"
  version="${rest%%|*}"
  rest="${rest#*|}"
  short="${rest%%|*}"
  rest="${rest#*|}"
  local_tgz="${rest%%|*}"
  remote_tgz="${rest#*|}"
  install_one "$name" "$version" "$short" "$local_tgz" "$remote_tgz"
done < <(python3 -c "
import json
from pathlib import Path
for x in json.loads(Path('/tmp/zr-install-latest.json').read_text()):
    print('|'.join([x['name'], x['version'], x['short'], x.get('localTgz') or '', x['remoteTgz']]))
")

export WEB
python3 <<'PY'
import json, os
from pathlib import Path

items = json.loads(Path("/tmp/zr-install-latest.json").read_text(encoding="utf-8"))
web = Path(os.environ["WEB"])
pkg_path = web / "package.json"
pkg = json.loads(pkg_path.read_text(encoding="utf-8")) if pkg_path.is_file() else {"dependencies": {}}
deps = pkg.setdefault("dependencies", {})
for it in items:
    deps[it["name"]] = it["version"]
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"==> 已钉死依赖版本写入 {pkg_path}", flush=True)
PY

if [[ -d "$WEB/.dsh-market" ]]; then
  python3 <<'PY'
import json, os
from pathlib import Path
web = Path(os.environ["WEB"])
items = json.loads(Path("/tmp/zr-install-latest.json").read_text(encoding="utf-8"))
patch = web / "cordis.patch.yml"
text = patch.read_text(encoding="utf-8") if patch.is_file() else ""
missing = [it["name"] for it in items if it["name"] not in text]
if missing:
    print("提示: cordis.patch.yml 可能未包含: " + ", ".join(missing))
    print("      请在 WorkBuddy 插件市场再点一次「安装/启用」，或确认 hot patch 已写入。")
else:
    print("==> cordis.patch.yml 已引用本次插件")
PY
fi

echo ""
echo "==> 安装完成。请完全退出并重启 WorkBuddy，再打开设置页确认版本。"
echo "    检查示例:"
echo "    node -p \"require('$HOME/.dsh/profiles/$PROFILE/node_modules/@zhongruan/dsh-remote-review/package.json').version\""
