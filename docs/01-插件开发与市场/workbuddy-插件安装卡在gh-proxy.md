# WorkBuddy 插件市场安装卡住（下载中 · gh-proxy）

## 现象

设置 → 插件市场 → 安装公司插件时，按钮停在「安装中…」，进度显示：

`下载中 · https://gh-p...`（`gh-proxy.com`）

看起来像公司包装不了，其实 **卡在皮肤包 `dsh-whale-musume`**，不是 `@zhongruan/*` 私有源本身。

## 原因

1. 桌面端用独立 `DSH_HOME`：  
   `~/Library/Application Support/zr-workbuddy-desktop/dsh-home/`  
   （不是 `~/.dsh`）
2. 该 profile 的 `package.json` 里 `dsh-whale-musume` 写成了  
   `https://gh-proxy.com/https://codeload.github.com/...`
3. 市场装任意插件都会跑 `pnpm add`，pnpm **顺带重拉** whale → gh-proxy 慢/失败 → UI 一直转圈
4. 另：桌面 `npm_config_store_dir` 若与既有 store 不一致，还会触发 `ERR_PNPM_UNEXPECTED_STORE`

公司 npm（`http://175.178.238.31/dsh-plugins/npm/`）与 `.npmrc` 作用域配置本身是正常的。

## 已做修复（WorkBuddy desktop）

- `desktop/main.js`：`npm_config_store_dir` 改为 `pnpm-home/store`（与既有 node_modules 一致）
- 启动接线时 `ensureWhaleMusumeOffline`：把 whale 改成  
  `file:../../vendor/dsh-whale-musume`（本地副本），避免再走 gh-proxy

本机若仍是旧桌面进程，**重启 WorkBuddy 桌面应用** 后再装插件。

## 自检

```bash
# 桌面 profile 依赖应类似：
# "dsh-whale-musume": "file:../../vendor/dsh-whale-musume"

cat "$HOME/Library/Application Support/zr-workbuddy-desktop/dsh-home/profiles/web/package.json"

# 装公司插件不应再出现 gh-proxy
cd "$HOME/Library/Application Support/zr-workbuddy-desktop/dsh-home/profiles/web"
npm_config_store_dir="$HOME/Library/Application Support/zr-workbuddy-desktop/pnpm-home/store" \
  pnpm add @zhongruan/dsh-pcb-helper
```
