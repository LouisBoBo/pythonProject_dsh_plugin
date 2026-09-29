import type { SchedulePreset, TemplateDef } from './types.js'

export const AUTOMATION_SCHEDULE_PRESETS: SchedulePreset[] = [
  { value: 'daily-0800', label: '每天 08:00', rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0' },
  { value: 'daily-0830', label: '每天 08:30', rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=30' },
  { value: 'daily-0900', label: '每天 09:00', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
  { value: 'daily-1800', label: '每天 18:00', rrule: 'FREQ=DAILY;BYHOUR=18;BYMINUTE=0' },
  { value: 'weekly-fr-1700', label: '每周五 17:00', rrule: 'FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=0' },
  { value: 'weekly-su-1000', label: '每周日 10:00', rrule: 'FREQ=WEEKLY;BYDAY=SU;BYHOUR=10;BYMINUTE=0' },
  { value: 'weekday-0900', label: '工作日 09:00', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0' },
]

const NEWS_PROMPT =
  '检索并整理今日 PCB+AI 领域重要新闻，聚焦 PCB+AI；输出 3–5 条中文摘要，每条含标题、要点与来源链接（如有）。'

const WEEKLY_PROMPT =
  '生成本周工作周报：仅依据系统注入的「本周代码变更依据」（git 提交与变更文件）归纳已完成工作；' +
  '聚焦本周新增/改动的功能与代码；进行中写尚未合入或待验证项；下周计划写 2～3 条可执行事项；' +
  '语气专业简洁，适合发给团队。禁止编造提交中不存在的功能。'

const MES_PROMPT =
  '生成【昨日生产运营日报】，面向领导阅读；必须真实查询当前 MES，禁止编造任何数字。\n\n' +
  '【查数步骤】（后台执行，结果写入「要点/细分」，不要把工具名写进正文）\n' +
  '1. inspect_mes_profile(user_intent="昨日生产运营日报")\n' +
  '2. list_query_metrics()\n' +
  '3. 工单：analyze_platform_brief 或 summarize_platform_data(group_by="状态")；query_metric("在制")；' +
  'query_metric("未完工")；query_metric("紧急未完工")；昨日完工用 analyze_time_trend 或 query_platform_data（有日期筛参时）\n' +
  '4. 设备稼动率（优先）：\n' +
  '   - 先 describe_entity 确认是否存在 device-utilization（设备利用率趋势）\n' +
  '   - 有则 query_platform_data(entity="device-utilization", filters={"period": "day"})\n' +
  '   - 返回 labels + values 时：在要点写平均利用率、最高/最低及对应时点；禁止口算 OEE\n' +
  '   - 若 device-oee 有数据，可在细分补充综合 OEE；device-oee 为 0 条则整段不写 OEE\n' +
  '5. 设备产出：query_metric("日产出") — 有数据才输出「设备产出」条\n' +
  '6. 品质：query_metric("工序良率") — 有数据才输出「工序良率」条\n' +
  '7. 内部可用 run_ops_scene("plant-exception-daily") 交叉核对，不要把核对过程写进正文\n\n' +
  '【正文格式】与 PCB 早报完全一致，仅输出查到的条目（编号连续，无数据条目不占号）：\n' +
  '**1. 工单概况**\n' +
  '要点：（一行核心数字，含昨日日期）\n' +
  '细分：（可选，状态分布）\n\n' +
  '**2. 设备稼动率**\n' +
  '要点：（device-utilization 有数据才写；平均/峰值/低谷利用率 %）\n' +
  '细分：（可选，device-oee 有数据才写）\n\n' +
  '**3. 设备产出**\n' +
  '要点：（有产量才写本条）\n\n' +
  '**4. 工序良率**\n' +
  '要点：（有良率才写本条）\n\n' +
  '**5. 需关注**\n' +
  '要点：（1～2 条业务提醒）\n\n' +
  '禁止：Markdown 表格、## 标题、> 引用、工具名/entity id/caveat/数据缺口/数据说明/「无接口」「0 条」类说明、标题外引言。'

const DIR_PROMPT =
  '扫描工作目录中自上次执行以来的新文件与变更，生成简明摘要（路径、时间、变更类型）；若无变更则说明「无新文件」。不要修改任何文件。'

export const AUTOMATION_TEMPLATES: TemplateDef[] = [
  {
    id: 'daily-ai-news',
    icon: 'news',
    title: '每日PCB+AI新闻推送',
    description:
      '检索并整理今日 PCB+AI 领域重要新闻，聚焦 PCB+AI；输出 3–5 条中文摘要，每条含标题、要点与来源链接（如有）。',
    prompt: NEWS_PROMPT,
    push_to_wecom: false,
    schedule_type: 'recurring',
    rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    scheduleLabel: '每天 09:00',
  },
  {
    id: 'weekly-work-report',
    icon: 'report',
    title: '每周工作周报',
    description: '每周五根据本周 git 提交与代码变更，汇总 ZR WorkBuddy 真实功能交付（不编造 MES 运维项）。',
    prompt: WEEKLY_PROMPT,
    push_to_wecom: false,
    schedule_type: 'recurring',
    rrule: 'FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=0',
    scheduleLabel: '每周五 17:00',
  },
  {
    id: 'mes-daily-production-report',
    icon: 'mes',
    title: '每日生产运营日报',
    description:
      '每天早上汇总昨日 MES 真实生产数据：工单、设备稼动率、产量、工序良率；早报式排版，面向领导阅读。',
    prompt: MES_PROMPT,
    push_to_wecom: false,
    schedule_type: 'recurring',
    rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
    scheduleLabel: '每天 08:00',
  },
  {
    id: 'dir-watch-digest',
    icon: 'calendar',
    title: '目录变更巡检',
    description: '工作日扫描工作目录新文件；无变更则输出「无新文件」。',
    prompt: DIR_PROMPT,
    push_to_wecom: false,
    schedule_type: 'recurring',
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0',
    scheduleLabel: '工作日 09:00',
  },
]

export const TEMPLATE_PIPELINE_IDS = new Set(AUTOMATION_TEMPLATES.map((t) => t.id))

export function getTemplate(id: string): TemplateDef | null {
  return AUTOMATION_TEMPLATES.find((t) => t.id === id) || null
}

export const PROMPT_SKELETON =
  '【目标】（一句话：要产出什么）\n' +
  '【数据来源】MES 查数 / 联网检索 / 本仓库 git\n' +
  '【查数或检索步骤】\n' +
  '1. …\n' +
  '2. …\n' +
  '【输出格式】\n' +
  '- 共几条；每条含标题、要点；（新闻类须保留来源链接）\n' +
  '- 查不到的数据整段省略，禁止编造\n' +
  '【禁止】Markdown 表格、工具名、写码/提交/部署'
