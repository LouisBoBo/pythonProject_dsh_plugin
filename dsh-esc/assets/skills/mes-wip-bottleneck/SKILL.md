---
id: mes-wip-bottleneck
name: 在制瓶颈分析
description: 按 SMT→DIP→组装→测试看在制堆积与空闲，区分真瓶颈和上游断料，避免把仓库积压当成某台贴片机故障。
category: 生产运营
icon: https://api.dicebear.com/9.x/icons/svg?seed=WipBottleneck&backgroundColor=fce7f3
triggers:
  - 在制瓶颈
  - WIP
  - 在制积压
  - 产线积压
  - 瓶颈分析
requiredConnectorIds:
  - mes
optionalConnectorIds:
  - mcp-chart
---

# 在制瓶颈分析 SOP

问「哪段堵住了、WIP 会不会爆」时用。

## 取数

1. `kind=wip`（在制工单，按工序/产线/状态分组）。
2. 需要对照产出再取 `kind=output`（近 7 日，Asia/Shanghai）。
3. 有库存线索再取 `kind=inventory`。utilization/oee 404 不能当成停线证据。

## 判读

把工单落到产线链，不要按车间名当五个工厂：

| 堆积位置 | 优先假设 | 不要误判 |
|----------|----------|----------|
| SMT 前或贴片很少 | 主料/锡膏/程序未发 | 贴片机坏了 |
| SMT 多、DIP 少 | DIP 人力或波峰能力 | SMT 超产是成绩 |
| DIP 多、组装少 | 连接器或缺件待料 | 焊接良率崩了（除非缺陷数据支持） |
| 测试/维修堆高 | 功能不良回流 | 产能不足（先看缺陷名） |
| 各段都少 | 排产未下或报工未入 | 全厂停线 |

多线同步高 WIP：先看主料与计划，不点名单台设备。

## 输出

```
# 在制瓶颈
| 产线区段 | 在制单数/数量 | 相对上下游 | 判断 | 证据 |
## 瓶颈结论
短段：真瓶颈在哪一段、是缺料还是能力。
## 建议
| 优先级 | 动作 | 谁来验证 |
```

图表已启用：区段 WIP 用 `column`；有时间序列用 `area`。禁止编造停留时长。
