---
id: mes-yield-defect
name: 工序良率与缺陷落点
description: 把巡检良率、综合不良和缺陷 TOP 落到 SMT/DIP/组装/测试，不把 KPI 为 0 误判成工序崩了。
category: 品质质量
icon: https://api.dicebear.com/9.x/icons/svg?seed=YieldDefect&backgroundColor=fee2e2
triggers:
  - 缺陷落点
  - 不良分布
  - 报废分析
  - 工序良率
  - 虚焊
  - 漏件
requiredConnectorIds:
  - mes
optionalConnectorIds:
  - mcp-chart
---

# 工序良率与缺陷落点 SOP

质量 / 工艺问「哪道工序在漏、缺陷算谁的」时用。严重闭环只提示已安装的 `pcb_8d_*`，本技能不写 8D。

## 取数

1. `kind=yield`（综合 KPI + 工序良率）。
2. `kind=scrap`（缺陷 TOP / 分布）。
3. 用户给了工单再补 `kind=work_order`。日期默认近 7 日。

## 判读

| 缺陷/现象 | 落点 |
|-----------|------|
| 偏移、漏件、少锡 | SMT / 锡膏 / 供料器 |
| 虚焊、连锡、桥接 | DIP / AOI / 波峰 |
| 短路、装反、漏装连接器 | 组装 |
| 功能不良、一次合格低 | 测试漏出，要回追上游 |

分层：巡检工序良率平稳、综合不良抬头 → 先查产出结构、低量日抽样或 KPI 字段为 0，**不要**写「某道工序崩了」。良率与不良率口径相反时在表里写清，禁止相加。

## 输出

```
# 品质落点
| 工序 | 区段 | 良率 | TOP 缺陷 | 件数 | 工艺落点 | 证据 |
## 分层说明
短段：巡检 vs 综合不良是否同向。
## 建议
| 优先级 | 动作 | 谁来验证 |
```

图表已启用：缺陷件数 `funnel`（从大到小）或 `pie`；≥3 道工序良率用 `radar`。图跟在表后。
