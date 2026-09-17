本机审码链路已经是通的，不必再配飞书和应用。你现在要做的，是给**新项目**接上「push → Webhook → 审码 → 飞书」。

当前本机状态：

- 审码引擎 `http://127.0.0.1:8000` 已就绪  
- Webhook `http://127.0.0.1:18787` 已就绪，`feishuReady: true`  
- Secret、飞书 wiki 都已在 `~/.zhongruan/remote-review/config.json`

密钥只留在本机设置里，**不要写进新项目仓库**。

---

## 第 0 步：先用本机模拟（不接 GitHub）

在新项目目录里随便改点代码、`git init` 并至少有一次 commit 后，另开终端：

```bash
# 把 SECRET 换成「设置 → 远端审码」里的 Webhook 密钥
SECRET='你的密钥'
NEW_REPO='/绝对路径/你的新项目'

curl -sS -X POST http://127.0.0.1:18787/simulate \
  -H 'Content-Type: application/json' \
  -H "X-Remote-Review-Secret: $SECRET" \
  -d "{\"local_path\":\"$NEW_REPO\",\"focus\":\"local simulate\"}"
```

查任务：

```bash
curl -sS http://127.0.0.1:18787/jobs -H "X-Remote-Review-Secret: $SECRET"
```

期望：新任务 `status` 为 `feishu_ok`，并有 `https://www.feishu.cn/wiki/...`。飞书打开应是标题/列表/代码块，不是一整段白文。

这一步通了，说明引擎和飞书没问题，后面只差 GitHub 能打到本机。

---



## 第 1 步：建新 Git 仓（建议先公开）

第一次测试用 **GitHub 公开仓**，本机 `git clone` 不需要 Token。私有仓要额外配凭据，容易卡在 clone。

```bash
mkdir -p ~/Desktop/rr-demo && cd ~/Desktop/rr-demo
git init -b main
echo '# rr-demo' > README.md
git add README.md
git commit -m "init"

# 在 GitHub 新建空仓库 rr-demo（不要勾 README）
git remote add origin git@github.com:<你的账号>/rr-demo.git
git push -u origin main
```

---



## 第 2 步：把本机 18787 暴露给 GitHub

GitHub 打不到 `127.0.0.1`。联调用 ngrok（不要走公司公网机，那边到 GitHub 不通）。

另开一个终端：

```bash
ngrok http 18787
```

记下 HTTPS 地址，例如 `https://xxxx.ngrok-free.app`。  
完整 Payload 是：`https://xxxx.ngrok-free.app/webhook`

ngrok 关掉后地址会变，Webhook 要改。测试期间这个窗口不要关。

---



## 第 3 步：在新仓库加 GitHub Webhook

打开：GitHub 仓库 → **Settings → Webhooks → Add webhook**


| 项            | 填什么                                   |
| ------------ | ------------------------------------- |
| Payload URL  | `https://xxxx.ngrok-free.app/webhook` |
| Content type | `application/json`                    |
| Secret       | 与本机「设置 → 远端审码」里的密钥**完全一致**            |
| 事件           | 至少勾 **push**                          |
| Active       | 勾上                                    |


保存。Recent Deliveries 里点一次 ping，应是绿勾。红叉就是 URL / ngrok 没开 / 路径不是 `/webhook`。

---



## 第 4 步：改代码并 `git push`

只 commit **不会**触发 GitHub Webhook，必须 push。

```bash
cd ~/Desktop/rr-demo
echo 'def hello(): return 1' > app.py
git add app.py
git commit -m "add hello"
git push origin main
```

---



## 第 5 步：验收

1. GitHub → Webhooks → 这次 push 的 Delivery：**绿勾**，状态 2xx。
2. 本机任务：

```bash
curl -sS http://127.0.0.1:18787/jobs -H "X-Remote-Review-Secret: $SECRET"
```

应出现该仓库的新 job，最终 `feishu_ok`。  
3. 打开返回的飞书 wiki 链接，确认是结构化文档。

---



## 卡住时先看这里


| 现象                | 原因                                                                   |
| ----------------- | -------------------------------------------------------------------- |
| Delivery 红叉       | ngrok 没开、URL 少了 `/webhook`、Secret 不一致                                |
| Delivery 绿但没有 job | 本机 18787 不是当前这个进程；或路径不是 `/webhook`                                   |
| 有 job 但 clone 失败  | 私有仓；先改公开，或改用第 0 步的 `local_path` 模拟                                   |
| 只 commit 没有报告     | 第二种路径必须 **push**                                                     |
| `feishu_pending`  | 飞书权限；修好后 `POST /jobs/<id>/retry-feishu`                              |
| `curl :18787` 连不上 | 重启 WorkBuddy / `dsh web`，或 `cd dsh-remote-review && node lib/cli.js` |


---

建议顺序：**第 0 步用新项目绝对路径 simulate 一次 → 再做 GitHub + ngrok + push。**  
做到哪一步把终端输出贴过来，我按结果往下带。