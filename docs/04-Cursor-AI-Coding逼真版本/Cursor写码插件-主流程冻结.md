# Cursor 写码插件 · 主流程冻结（0.6.7）

> **状态：已冻结**  
> 包：`@zhongruan/dsh-cursor-coding@0.6.7`  
> 口径：整体流程已对齐产品验收，**禁止再改主流程形态**；仅允许在不改变步骤顺序与职责边界的前提下做细节优化（文案、滚动、性能、边界 bug）。

---

## 冻结主流程（一步一步）

```text
1. 需求澄清（大改/新增/删除报表·页面·菜单）
   → DSH 原生 ask_user_question（模型按理解出选择题卡）
   → 用户勾选提交
   → 禁止：长文反问、插件自造澄清表单、先 begin

2. 确认卡（HITL）
   → zr_cursor_begin（clarified=true；小改可直接 begin）
   → 只出确认卡，并阻塞到用户点击「确认并用 Cursor 开写」
   → 确认前：不写码、不调 finish、聊天正文零输出、助手禁止复述/报状态

3. 进度卡（过程）
   → 用户点确认后才开工（沙箱 → Cursor → 自动同步）
   → 卡内只展示思考/工具过程
   → 禁止：卡内展示「说明方案/结论」与正文重复

4. 正文结论
   → zr_cursor_finish(job_id|workspace) 等进度与同步结束后
   → 仅此时把「本轮结论」写入聊天正文
   → 追问在对话框继续（续改走 zr_cursor_continue，同样确认卡）
```

---

## 职责边界（勿混）

| 阶段 | 谁出 UI | 聊天正文 |
| --- | --- | --- |
| 澄清 | DSH `ask_user_question` | 空（勿复述选项表） |
| 确认 | 插件确认卡 | 空 |
| 写码过程 | 插件进度卡 | 空 |
| 收口 | `zr_cursor_finish` | 仅「本轮结论」 |

| 做 | 不做 |
| --- | --- |
| Cursor SDK Local 写码 | Agent Write/Bash 改用户工程 |
| 确认前阻塞 | 确认前并行 finish / 自动开写 |
| 自动同步 + 前端刷新（默认） | 过程中往正文倒状态/token |
| 删除页/菜单 = 写码（先澄清） | 把删除当例外跳过澄清 |

---

## 后续只允许的「细节优化」

- 文案、加载态、滚动、卡内信息密度  
- 超时/对账/SSE 稳定性、token 传递稳健性  
- write_scope、同步/刷新策略微调  
- 自测与文档同步  

**不允许**（除非产品书面改冻结口径）：

- 取消确认卡或确认前自动开写  
- 把澄清改回长文列表 / 插件自造问卷顶替 `ask_user_question`  
- 进度未结束就往聊天正文输出结论或过程复述  
- 卡内再塞「说明方案/结论」与正文双份  
- 用 `zr_cursor_jobs/status/wait` 代替主路径  

---

## 相关入口

- 插件：`dsh-cursor-coding/`  
- 路由提示：`mes-bridge` → `buildCodeDevPrompt`（DSH Cursor 分支）  
- Skills：`zr-workbuddy-code-dev` / `zr-workbuddy-routing`  
