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
  '生成【昨日生产运营日报】，面向领导阅读；必须真实查询当前 MES，禁止编造任何数字。\n' +
  '正文只输出查到的条目：工单概况、设备稼动率、设备产出、工序良率、需关注。无数据的段整段省略。\n' +
  '禁止 Markdown 表格、编造字段、把工具名写进正文。'

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
    push_to_wecom: true,
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
    push_to_wecom: true,
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
    push_to_wecom: true,
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
  '【目标】\n\n【数据来源】必须真实查询/读取，禁止编造。\n\n【步骤】\n\n【输出格式】\n\n【禁止】写码、改文件、Git 提交、部署、泄露密钥\n'
