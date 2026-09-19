---
id: after-sales-ticket
name: 售后工单分析
description: 按 SOP 分析售后/客诉工单：取数、归类、根因假设与对策，严重则提示升级 8D。
category: 品质质量
icon: https://api.dicebear.com/9.x/icons/svg?seed=AfterSales&backgroundColor=fee2e2
triggers:
  - 售后工单
  - 分析工单
  - 客诉
  - 不良分析
  - WO-
requiredConnectorIds:
  - mes
optionalConnectorIds:
  - dify
---

# 售后工单分析 SOP

仅在用户要分析售后、客诉、现场不良工单时使用本手册。

## 步骤

1. 抽出工单号、料号、不良现象、发生工序（用户没给的标「待确认」）。
2. 调用 `zr_esc_mes_query`，`kind=work_order`，`keyword=工单号`。需要良率则再调 `kind=yield`；报废用 `kind=scrap`。
3. 若 Dify 已启用且已配置 datasetId，用 `zr_esc_dify_search` 查相似对策；未配置则跳过，写明「未检索知识库」。
4. 按结构输出：
   - 问题分类（来料/工艺/设备/作业/设计）
   - 临时围堵
   - 根因假设（每条标注证据来自 MES / 用户原文 / 未证实）
   - 建议对策
   - 是否建议开 8D（是则提示 pcb_8d_create，不要伪造 8D 报告）
5. MES 返回 `connector_unconfigured` / `connect_failed` / `mes_failed` 时：只出分析框架，数字处写「无数据」，禁止编造良率与数量。

## 禁止

- 调用写码、审码、部署、自动化写接口
- 用用户原话猜测 kind（必须用枚举）
- 把 mock 演示数据说成客户真实产线（source=mock 时标明演示）
