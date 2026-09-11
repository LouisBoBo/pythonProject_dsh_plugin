# 远端审码：绕开腾讯云与 GitHub 双向不通

## 根因（本机实测）

| 方向 | 结果 |
| --- | --- |
| GitHub Webhook → `175.178.238.31:80` | Delivery 红叉，nginx 无 POST |
| 服务器 → `github.com` / `api.github.com` | **超时**（无法 clone） |
| 服务器 → 百度 / npmmirror | 正常 |
| 本机 Mac → 服务器 `/remote-review/webhook` | 正常 |

因此：**不能**再依赖「Webhook 直打公网 + 服务器 git clone」。

## 可行方案：GitHub Actions 推代码进机 + 本机触发

```text
git push
  → GitHub Actions（国外）checkout
  → SSH/rsync 到腾讯云工作区（走已放行的 22，与 deploy-staging 相同）
  → 在服务器 curl 127.0.0.1:18787/webhook（local_path）
  → 本机引擎审码 → 飞书
```

### 配置步骤

1. 复制工作流到业务仓：

```bash
cp scripts/remote-review/github-actions-trigger.yml \
  /path/to/pythonProject_zr_aicoding/.github/workflows/remote-review-trigger.yml
```

2. 仓库 Settings → Secrets and variables → Actions 增加：

| Secret | 值 |
| --- | --- |
| `STAGING_SSH_HOST` | `175.178.238.31`（可与部署共用） |
| `STAGING_SSH_USER` | `root` |
| `STAGING_SSH_KEY` | 部署用私钥全文 |
| `REMOTE_REVIEW_SECRET` | `M_Fy1KESBRLc1cct6ZtboWId7WP4elKL`（与服务器一致） |

3. 确认腾讯云防火墙 **放行外网 TCP 22**（deploy-staging 注释里已说明）。

4. **可关掉** GitHub 里指向 `175.178.238.31/remote-review/webhook` 的 Webhook（会一直红叉，无用）。

5. push 后看 Actions 是否绿；再打开 http://175.178.238.31/remote-review/jobs 。

## 已放弃

- smee.io 中继：服务器出站也连不上 smee.io / github.com  
- 公网 Payload URL：入站被拦；即便进来也无法 `git clone`  

业务仓工作流文件已就位（需你 commit + push，并配 Secret）：

`pythonProject_zr_aicoding/.github/workflows/remote-review-trigger.yml`
