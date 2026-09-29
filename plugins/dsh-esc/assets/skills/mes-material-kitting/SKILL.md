---
id: mes-material-kitting
name: 缺料齐套分析
description: 对照安全库存与在制，判断 LED/连接器/基板会先停 SMT 哪条线，不估算没有日耗的可生产天数。
category: 生产运营
icon: https://api.dicebear.com/9.x/icons/svg?seed=Kitting&backgroundColor=ffedd5
triggers:
  - 缺料
  - 齐套
  - 安全库存
  - 停料
  - 物料齐套
requiredConnectorIds:
  - mes
optionalConnectorIds:
  - mcp-chart
---

# 缺料齐套分析 SOP

物控 / 计划问「能不能开线、会不会停料」时用。只读库存与在制。

## 取数

1. `kind=inventory`（可不传日期）。
2. 有在制则 `kind=wip`，把未完工工单的料号与库存对上。
3. 需要工单明细再 `kind=work_order`。库存 `updated_at` 滞后则 **禁止** 推可生产天数。

## 判读（PCB 主料优先）

| 物料类型 | 典型名 | 先停哪段 |
|----------|--------|----------|
| 发光 / 阻容 | LED、电阻、电容 | SMT 贴片 |
| 连接器 | 排针、端子、插座 | 组装，其次 DIP |
| 基板 | PCB、FPC | 整条链开不了工 |
| 辅料 | 锡膏、助焊剂 | SMT / 波峰 |

规则：现存量=0 且安全库存>0 → P0 停料风险。现存量<安全库存 → P1。负缺口不画。不要把仓库总库存当成线边仓。

## 输出

```
# 缺料齐套
| 优先级 | 料号 | 品名 | 现存量 | 安全库存 | 缺口 | 可能停哪段 | 证据 |
## 与在制的关系
短段：哪些未完工工单会先碰到缺料。
## 建议
| 优先级 | 动作 | 谁来验证 |
```

图表已启用：低于安全库存的料用 `bar` 画缺口。标题写清单位。
