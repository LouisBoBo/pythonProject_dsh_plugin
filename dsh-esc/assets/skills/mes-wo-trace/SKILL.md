---
id: mes-wo-trace
name: 工单全程追溯
description: 按工单号把 SMT→DIP→组装→测试的进度、报工、不良一次拉齐，给车间主管看这块板卡在哪。
category: 生产运营
icon: https://api.dicebear.com/9.x/icons/svg?seed=WoTrace&backgroundColor=e0e7ff
triggers:
  - 工单追溯
  - 工单进度
  - 这块板
  - 查工单
requiredConnectorIds:
  - mes
optionalConnectorIds:
  - mcp-chart
---

# 工单全程追溯 SOP

用户给出工单号或料号时使用。只读 MES，不改工单。

## 取数

1. `zr_esc_mes_query` `kind=work_order`，`keyword=工单号或料号`。
2. 再取 `kind=wip`，在在制列表里对同一工单/料号。
3. 需要品质时再取 `kind=yield`、`kind=scrap`（同一日期或该工单关联日期）。
4. 失败写出 `error.code`，禁止编造工序进度。

## 判读

| 现象 | 工艺含义 |
|------|----------|
| 停在 SMT / 贴片 | 缺件、供料、锡膏或首件未过 |
| 停在 DIP / 插件 | 波峰、AOI 虚焊或连锡待修 |
| 停在组装 | 连接器、螺丝、功能半成品 |
| 停在测试 / 维修 | 功能不良回流，看缺陷名 |
| 工单已完工但无入库 | 报工与仓储不同步，先核单据不要判欠产 |

找不到工单：写「MES 无此单」，列出工具返回的相近单，不要猜。

## 输出（表格优先）

```
# 工单追溯
| 工单 | 料号 | 当前工序 | 产线区段 | 状态 | 计划/实际 | 证据 |
## 工艺落点
短段：这块板卡在哪、会堵哪条链。
## 建议
| 优先级 | 动作 | 谁来验证 |
```

有工序节点且图表已启用：`funnel` 画工序通过量（从大到小），或 `column` 画各站停留。数字必须来自工具。
