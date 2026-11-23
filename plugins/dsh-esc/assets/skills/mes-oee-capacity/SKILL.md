---
id: mes-oee-capacity
name: 设备稼动与 OEE
description: 按可用率×性能率×质量率拆 OEE，对照稼动与产出；接口缺失就标盲区，不用产量跌幅冒充停线。
category: 生产运营
icon: https://api.dicebear.com/9.x/icons/svg?seed=OeeCapacity&backgroundColor=d1fae5
triggers:
  - OEE
  - 稼动率
  - 设备利用率
  - 停机分析
  - 综合效率
requiredConnectorIds:
  - mes
optionalConnectorIds:
  - mcp-chart
---

# 设备稼动与 OEE SOP

设备 / 生产问稼动、OEE、是不是停机时用。公式只写工具给得出的分项。

## 取数

1. `kind=capacity`（利用率 / 稼动，period=day）。
2. `kind=oee`（OEE 及可用率/性能率/质量率）。
3. 对照 `kind=output`，日期跟用户窗口（没说才近 7 日）。某接口 HTTP 404：该节标盲区，**禁止**用产出跌幅代替停线结论。

## 判读

OEE = 可用率 × 性能率 × 质量率。缺哪项写哪项，不要用一个综合分硬拆。

| 分项低 | 车间含义 | PCB 线索 |
|--------|----------|----------|
| 可用率 | 故障、换线、等料 | 等料要对照库存，不先判贴片机坏 |
| 性能率 | 速度低于标准、微停 | SMT 抛料、供料暂停 |
| 质量率 | 一次合格差 | 与缺陷落点技能分开写，这里只点到质量率 |

全厂同步低稼动：优先排产/主料/报工，不点名单设备。

## 输出

```
# 稼动与 OEE
| 设备或产线 | 稼动 | OEE | 可用率 | 性能率 | 质量率 | 证据 |
## 与产出对照
短段：稼动低是否伴随产出低；单位不一致则不谈达产。
## 盲区
列出 404 / 缺分项。
## 建议
| 优先级 | 动作 | 谁来验证 |
```

图表已启用：稼动时间序列 `line`；有 OEE 三率且 ≥3 点用 `radar`（align 同尺度）。不要把计划和稼动画在未声明的同一轴。

## 落盘资料库（必须）

正文写完后调用一次 `zr_mom_save`：`directory`=当前工程根目录，`filename`=`OEE与稼动_<窗口起>_<窗口止>.md`，`title`=正文一级标题，`content`=完整 Markdown（含表格与图片链接）。成功后末尾加一行「报告已存资料库：<relativePath>」；工具不可用或失败写「未落盘：<code> <message>」，不要假装已保存，不要用 Bash 绕过。用户明确说不用存时跳过。
