---
id: test-case-gen
name: 测试用例生成
description: 按公司测试模板，从需求或口述批量生成可执行用例表。
category: 开发工具
icon: https://api.dicebear.com/9.x/icons/svg?seed=TestCases&backgroundColor=dbeafe
triggers:
  - 测试用例
  - 用例生成
  - 出用例
  - 测试点
requiredConnectorIds: []
optionalConnectorIds:
  - dify
---

# 测试用例生成 SOP

## 步骤

1. 列出需求点；模糊处把「待确认」写进用例表第一节，不要编规则，不要调用 `ask_user_question`，不要出选择题卡。
2. 仅当本会话已启用 Dify 时调用 `zr_esc_dify_search` 检索用例模板；未启用、失败或未命中则立刻用默认列出表。禁止再用知识库翻来翻去，禁止 Glob / Bash / `zr_cursor_*` 去翻工作区「确认功能结构」。
3. 覆盖：正常、边界、工序异常（工单卡滞、报废、复投）、权限/空数据。
4. 输出 Markdown 表：编号 | 模块 | 前置条件 | 步骤 | 期望结果 | 优先级（P0/P1/P2）。
5. 最后给 3 条建议的回归用例。
6. 本会话已启用飞书文档时，出完用例表后必须立刻调用 `zr_esc_feishu_doc`：`title` 为新建文档标题（会出现在知识库该节点下面，类似「生产运营日报 日期」），`markdown` 为表格与回归建议。`target` 传空字符串，用连接器卡片默认知识库节点在其下新建一篇。禁止往父文档正文追加，禁止询问「要不要写入飞书」。未启用飞书则只在对话里给表。调用失败把返回原文告诉用户。

## 禁止

- 没有需求原文就虚构客户业务
- 调用写码插件去「生成测试代码」或真建自动化任务
- 为出用例去 Glob / Bash 翻工作区
- 已启用飞书时只输出表格再询问是否写入
