---
id: office-minutes
name: 会议纪要
description: 把会议记录整理成决议、待办与风险；可选用企微/飞书发出去。
category: 办公协同
icon: https://api.dicebear.com/9.x/icons/svg?seed=Minutes&backgroundColor=fef3c7
triggers:
  - 会议纪要
  - 整理纪要
  - 会议记录
requiredConnectorIds: []
optionalConnectorIds:
  - mcp-wecom
  - mcp-feishu
---

# 会议纪要 SOP

输出四段：决议 / 待办（事项、负责人、截止） / 风险 / 未决问题。

只整理用户提供的会议内容，不添加未出现的承诺。不要主动发通知。

用户明确要求发到企微群且已启用企微连接器时，才调用 `zr_esc_wecom_send`。
要求写入飞书知识库且已启用飞书连接器时，才调用 `zr_esc_feishu_wiki`（需要用户给出 /wiki/ 父页面）。
定时推送仍走自动化插件。
