# @zhongruan/dsh-cursor-chat

对话式多轮写码插件（与 `@zhongruan/dsh-cursor-coding` **并存**，互不影响）。

## 隔离

| | 本插件 | 旧写码插件 |
|--|--------|------------|
| 包名 | `@zhongruan/dsh-cursor-chat` | `@zhongruan/dsh-cursor-coding` |
| 工具 | `zr_cchat_*` | `zr_cursor_*` |
| 端口 | `18789` | `18788` |
| 数据 | `~/.zhongruan/cursor-chat` | `~/.zhongruan/cursor-coding` |
| Cordis id | `cursor-chat` | `cursor-coding` |

## 行为

1. `zr_cchat_begin`：用户**原话**（+ 可选 `images` 截图）→ 确认卡 → Cursor 多模态 → 同步 → 正文结论  
2. `zr_cchat_continue`：同会话续改，**优先 `Agent.resume`**；可再带新图  
3. 确认前不写盘（HITL nonce）

### 贴图（路 A · 接近 IDE）

工具参数 `images`（JSON 字符串）示例：

```json
[{"path":"D:/shots/ui.png"}]
```

或 `data`+`mimeType` / `url`。执行时经 Cursor SDK：

`agent.send({ text, images: [{ data, mimeType }] })`

另拷进沙箱 `.cursor-chat-images/` 作 Read 兜底。

## 本地开发

```bash
cd plugins/dsh-cursor-chat
pnpm install   # 或 npm i
pnpm build
# mock 自检（不改真工程、不碰旧插件数据目录）
set CURSOR_CHAT_MOCK=1
pnpm self-test
```

Windows PowerShell：

```powershell
cd plugins\dsh-cursor-chat
npm install
npm run build
$env:CURSOR_CHAT_MOCK='1'
npm run self-test
```

## 安装到 DSH

在插件市场或 profile 中安装本包；**不要**卸载旧写码插件（除非你明确只想用对话版）。
