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

1. 列出需求点；模糊处先给「待确认」不要编规则。
2. 若 Dify 已配置，检索用例模板或工艺规范；未配置则使用下列默认列。
3. 覆盖：正常、边界、工序异常（工单卡滞、报废、复投）、权限/空数据。
4. 输出 Markdown 表：编号 | 模块 | 前置条件 | 步骤 | 期望结果 | 优先级（P0/P1/P2）。
5. 最后给 3 条建议的回归用例。

## 禁止

- 没有需求原文就虚构客户业务
- 调用写码插件去「生成测试代码」（本技能只出用例文档）
