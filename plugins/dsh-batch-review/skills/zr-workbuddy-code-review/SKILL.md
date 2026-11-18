---
name: zr-workbuddy-code-review
description: >-
  专业级代码评审（vendor：Viprasol Tech code-review-skill，MIT）+ WorkBuddy 门禁叠层。
  本机目录直读审码（非 Git / 非 VS Code Bridge）：list → 分批读 → 终稿
  「代码审核汇总报告」（高/中/低危 + ❌/✅）。配合 mes_code_review_*。
  勿用于 MES 查数、写码改仓。
---

# 本机审码（P0-3 · Vendor 方法论，不自造）

> **来源**：与 simplified-workbuddy 同源  
> - [Viprasol-Tech/code-review-skill](https://github.com/Viprasol-Tech/code-review-skill)（MIT）→ `references/viprasol-skill.md`  
> - 公司门禁 → `references/workbuddy-gate-90.md`  
> **原则**：**不自造**上游检查清单；引擎 LLM 与 DSH Agent 均须按上述两份执行。

## 必须先做

1. **读取并严格执行** `references/viprasol-skill.md`。
2. **再读取并严格执行** `references/workbuddy-gate-90.md`。
3. Critical/High（及映射后的高危/中危）必须含：触发条件、**问题代码**、**修复建议**、**修复代码**、**验证步骤**；低危也须四段（可更短）。
4. 问题总览数量必须与正文条目数一致。
5. **用户可见输出一律中文**；禁止英文旁白。代码/路径/CVE/CWE 可保留原文。
6. 每条正文统一：问题描述 → `// ❌ 当前代码` → 修改建议 → `// ✅ 正确做法`（完整相对路径）。

## 严重度映射（公司中文报告）

| Viprasol | 内部 band | 汇总报告展示 | 是否阻塞合并 |
|----------|-----------|--------------|--------------|
| Critical / High（gate 上调） | **P0** | 🔴 高危 | 是 |
| Medium / High（未上调） | **P1** | 🟡 中危 | 建议合入前修 |
| Low / Nit | **P2** | 🟢 低危 | 否 |

终稿由引擎 `format_findings_report` 套壳；LLM 只产出结构化 findings，**不要**自写报告标题。

## 本仓取码流程（对齐 simplified ide-code-review，无 Bridge）

1. `mes_code_review_check(local_path)` / 对话确认卡选目录  
2. 引擎 `local_files` 筛选功能源码（排除文档/样式/敏感路径）  
3. **分批**读码并审查（每批约 8 文件、最多 3 路并行；SSE 过程进度 + 终稿逐行 `token`）  
4. 合并 findings + 源码规则补种 → 终稿第一行必须是 `代码审核汇总报告`

Agent 工具：`mes_code_review_status` / `check` / `list` / `run` / `report`。

## 输出纪律（硬）

- 过程旁白由系统进度卡展示；终稿勿写英文过渡句  
- 终稿壳（系统生成）：`代码审核汇总报告` → 审核文件/日期/审核人 → 一、总体评价 → 二、详细问题清单（「问题1…N」+ ❌/✅）→ 四、审核结论  
- **禁止**只列文件名+一句话；禁止无代码块的空话修复  
- **禁止**把 `127.0.0.1` / `localhost` / RFC1918 内网、`$ENV` 环境变量占位当成公网 IP / 硬编码密钥  
- 全部 LLM 失败时不得「审核通过」；须标明审查不完整  

## 勿做

- 不要用 git diff / VS Code Bridge（P0-3）  
- 不要把「提交前 diff 审码」说成已支持（P0-2）  
- 不要改写 `references/viprasol-skill.md` 检查项正文；升级时用上游覆盖  
