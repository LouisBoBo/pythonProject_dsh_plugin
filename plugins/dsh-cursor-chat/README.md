# @zhongruan/dsh-cursor-chat

对话式多轮写码（现行交付，市场 latest 以 `package.json` 为准）。

**完整功能与使用说明（推荐）**：[`docs/05-功能使用手册说明/Cursor对话写码插件-多轮.md`](../../docs/05-功能使用手册说明/Cursor对话写码插件-多轮.md)

与旧包 `@zhongruan/dsh-cursor-coding` **可并存**，互不影响。

## 隔离

| | 本插件 | 旧写码插件 |
|--|--------|------------|
| 包名 | `@zhongruan/dsh-cursor-chat` | `@zhongruan/dsh-cursor-coding` |
| 工具 | `zr_cchat_*` | `zr_cursor_*` |
| 端口 | `18791` | `18788` |
| 数据 | `~/.zhongruan/cursor-chat` | `~/.zhongruan/cursor-coding` |
| Cordis id | `cursor-chat` | `cursor-coding` |
| 设置页 | Cursor 对话写码 | Cursor 写码 |

## 能力摘要

- **写码**：澄清 → 确认（HITL）→ 沙箱 Cursor 改盘 → 同步 → 正文结论；续改优先 `Agent.resume`；可贴图  
- **删除**：页面 / 菜单验尸走 `projectLayout`，适配嵌套工程  
- **运维**：重启 / 测试 / 日志 / 装依赖 / 排障不进沙箱；重启优先项目命令，认不出再降级 Cursor SDK  
- **交付审计**：`param_contract` / `schema_drift` / `api_mount` / 菜单等可自动续修再验；落盘硬闸挡假绿  
- **进度卡**：用户选择题、改动文件可点开右侧工作区  

## 本地开发

```powershell
cd plugins\dsh-cursor-chat
npm run build
$env:CURSOR_CHAT_MOCK='1'
$env:CURSOR_CHAT_SELFTEST='1'
npm run self-test
```

正式写码禁止只设 `CURSOR_CHAT_MOCK=1`（无 SELFTEST 会被剥掉，且不得静默假交付）。

## 安装

设置 → 插件市场 → 安装 / 更新本包。正式上架：`./scripts/internal-market/pack.sh dsh-cursor-chat` 再 `upload.sh`。
