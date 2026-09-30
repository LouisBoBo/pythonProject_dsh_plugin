# Cursor 对话写码插件（多轮）

> 与冻结的 `@zhongruan/dsh-cursor-coding` **并存**；本文件只描述新包。

## 定位

- 体感：像跟 Cursor 聊；用户**原话 + 截图**进 Agent 多模态；同会话 `zr_cchat_continue` **优先 resume**
- 非一体化流水线；不替换旧写码插件

## 贴图

`zr_cchat_begin` / `continue` 参数 `images`：本机路径 / base64 / url → Cursor SDK `agent.send({ text, images })`。

## 隔离一览

| 项 | 新包 | 旧包 |
|----|------|------|
| npm | `@zhongruan/dsh-cursor-chat` | `@zhongruan/dsh-cursor-coding` |
| 工具 | `zr_cchat_*` | `zr_cursor_*` |
| HTTP | `:18789` / `/api/cursor-chat/*` | `:18788` / `/api/cursor-coding/*` |
| 数据 | `~/.zhongruan/cursor-chat` | `~/.zhongruan/cursor-coding` |
| Cordis | `cursor-chat` | `cursor-coding` |
| 设置页 | 「Cursor 对话写码」 | 「Cursor 写码」 |

## 主工具

- `zr_cchat_begin` / `zr_cchat_continue` / `zr_cchat_status` / `zr_cchat_cancel`（及 wait/finish/apply/jobs 辅助）

## 验证

```powershell
powershell -NoProfile -File scripts\verify-cursor-chat.ps1
```

Mock 自检：`CURSOR_CHAT_MOCK=1` + `npm run self-test`（已在本机通过）。
