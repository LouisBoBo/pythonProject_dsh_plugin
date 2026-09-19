import type { MesKind, QueryResult } from '../types.js'

export const MOCK_WORK_ORDER = {
  work_order_no: 'WO-20260918-01',
  product_name: 'PCB-A100 多层板',
  product_code: 'PCB-A100',
  status: 'in_progress',
  status_label: '生产中',
  production_line: 'SMT-2',
  current_process: 'AOI',
  process_route: ['开料', '钻孔', '电镀', '蚀刻', '阻焊', '丝印', 'AOI', '成型'],
  qty: 500,
  qty_done: 320,
  qty_ng: 8,
  customer: '演示客户',
  created_at: '2026-09-18T08:12:00+08:00',
  symptom: 'AOI 报焊盘少锡，批次内集中在 B 面 QFN 封装',
}

export const MOCK_YIELD = {
  range: '2026-09-17 ~ 2026-09-18',
  overall_yield: 0.972,
  process_yield: [
    { process: '钻孔', yield: 0.994 },
    { process: '电镀', yield: 0.989 },
    { process: '蚀刻', yield: 0.986 },
    { process: 'AOI', yield: 0.975 },
    { process: '成型', yield: 0.991 },
  ],
}

export const MOCK_SCRAP = {
  range: '2026-09-17 ~ 2026-09-18',
  scrap_qty: 14,
  top_defects: [
    { defect: '焊盘少锡', qty: 8 },
    { defect: '阻焊溢胶', qty: 3 },
    { defect: '孔偏', qty: 2 },
    { defect: '其它', qty: 1 },
  ],
}

export const MOCK_WIP = {
  in_progress: 6,
  items: [
    { work_order_no: 'WO-20260918-01', current_process: 'AOI', qty: 500 },
    { work_order_no: 'WO-20260917-14', current_process: '成型', qty: 200 },
    { work_order_no: 'WO-20260917-09', current_process: '电镀', qty: 800 },
  ],
}

export const MOCK_OEE = {
  oee: 68.4,
  availability: 82.1,
  performance: 88.0,
  quality: 94.7,
}

export const MOCK_CAPACITY = {
  period: 'day',
  points: [
    { time: '08:00', value: 61 },
    { time: '10:00', value: 78 },
    { time: '12:00', value: 54 },
    { time: '14:00', value: 81 },
    { time: '16:00', value: 73 },
  ],
}

export const MOCK_OUTPUT = {
  date: '2026-09-18',
  actual_qty_sum: 30806,
}

export const MOCK_INVENTORY = {
  total: 3,
  items: [
    { material_name: '铝基板 PCB', quantity: 120, safety_stock: 200, warehouse_name: '一号原料仓', unit: '片' },
    { material_name: '贴片电容 1μF', quantity: 3200, safety_stock: 3000, warehouse_name: '一号原料仓', unit: 'pcs' },
    { material_name: '白光 LED 5050', quantity: 0, safety_stock: 500, warehouse_name: '一号原料仓', unit: 'pcs' },
  ],
}

export function mockQuery(kind: MesKind, keyword: string): QueryResult {
  if (kind === 'work_order') {
    const key = keyword.trim()
    if (key && key !== MOCK_WORK_ORDER.work_order_no && !MOCK_WORK_ORDER.product_code.includes(key)) {
      return {
        ok: true,
        source: 'mock',
        detail: `mock 中未找到工单「${key}」。演示工单号：${MOCK_WORK_ORDER.work_order_no}`,
        data: { items: [] },
      }
    }
    return {
      ok: true,
      source: 'mock',
      detail: `mock 工单 ${MOCK_WORK_ORDER.work_order_no}，当前卡在 ${MOCK_WORK_ORDER.current_process}`,
      data: MOCK_WORK_ORDER,
    }
  }
  if (kind === 'yield') {
    return { ok: true, source: 'mock', detail: `mock 综合良率 ${(MOCK_YIELD.overall_yield * 100).toFixed(1)}%`, data: MOCK_YIELD }
  }
  if (kind === 'scrap') {
    return { ok: true, source: 'mock', detail: `mock 报废 ${MOCK_SCRAP.scrap_qty} pcs`, data: MOCK_SCRAP }
  }
  if (kind === 'oee') {
    return { ok: true, source: 'mock', detail: `mock OEE ${MOCK_OEE.oee}%`, data: MOCK_OEE }
  }
  if (kind === 'capacity') {
    return { ok: true, source: 'mock', detail: 'mock 设备利用率（日）', data: MOCK_CAPACITY }
  }
  if (kind === 'output') {
    return { ok: true, source: 'mock', detail: `mock 日产出 ${MOCK_OUTPUT.actual_qty_sum}`, data: MOCK_OUTPUT }
  }
  if (kind === 'inventory') {
    return { ok: true, source: 'mock', detail: `mock 库存 ${MOCK_INVENTORY.total} 条`, data: MOCK_INVENTORY }
  }
  return { ok: true, source: 'mock', detail: `mock 在制工单 ${MOCK_WIP.in_progress} 张`, data: MOCK_WIP }
}
