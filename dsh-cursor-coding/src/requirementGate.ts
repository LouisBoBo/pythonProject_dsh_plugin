/**
 * 写码诉求门禁（兜底，非提示词）：
 * - 空诉求硬拦
 * - 明显「新增/删除页面·菜单·入口」须先澄清；仅传 clarified=true 不够，message 须带澄清痕迹
 * - 题目怎么出交模型自拟；增列/修 bug 等小改不硬拦
 */

export function truthy(v: unknown): boolean {
  if (v === true || v === 1) return true
  const s = String(v ?? '')
    .trim()
    .toLowerCase()
  return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === '确认' || s === 'ok'
}

function compact(message: string): string {
  return String(message || '').replace(/\s+/g, '')
}

/** 小改：增列/改字段/修样式等，即使含「新增」也不强制澄清 */
export function looksLikeSmallUiTweak(message: string): boolean {
  const t = compact(message)
  if (!t) return false
  if (/新增一列|加一列|增加一列|多一列|加列|增列/.test(t)) return true
  if (/(改|调整|加大|缩小|修改).{0,8}(按钮|文案|标题|颜色|样式|宽度|高度|字号|图标)/.test(t)) return true
  if (/(修复|修一下|报错|请求失败|bug|Bug|BUG)/.test(t)) return true
  if (/(筛选|过滤|分页|排序).{0,6}(加上|增加|新增|调整)/.test(t)) return true
  return false
}

/**
 * 新增或删除「界面/菜单/报表入口」——产品强制澄清。
 * 不含「新增一列」等小改。
 */
export function looksLikeAddOrDeletePageMenu(message: string): boolean {
  const t = compact(message)
  if (!t) return false
  if (looksLikeSmallUiTweak(t)) return false

  // 删除菜单 / 页面 / 报表入口
  if (
    /(删除|去掉|移除|下线|卸掉).{0,24}(菜单|子菜单|页面|界面|路由|入口)/.test(t) ||
    /(菜单|子菜单|页面|界面|路由|入口).{0,24}(删除|去掉|移除|下线)/.test(t)
  ) {
    return true
  }
  // 「删除…报表」且带菜单/中心语境（放宽字距，覆盖「删除设备维修、…点检报表」）
  if (/(删除|去掉|移除).{0,40}(报表)/.test(t) && /(菜单|报表中心|中心|导航|侧栏|路由)/.test(t)) {
    return true
  }

  // 新增页面 / 菜单 / 报表入口（整页级）
  if (
    /(新增|增加|添加|新建|做一[个张]|从零).{0,28}(菜单|子菜单|页面|界面|路由|入口|[页界面]{1,2})/.test(t) ||
    /(菜单|子菜单).{0,16}(新增|增加|添加|新建)/.test(t)
  ) {
    if (/(菜单|子菜单|页面|界面|路由|入口)/.test(t)) return true
    if (/(新增|增加|添加|新建).{0,28}(页)/.test(t) && /(报表|中心|模块|功能|看板)/.test(t)) return true
  }
  if (
    /(新增|增加|添加|新建).{0,24}(报表)/.test(t) &&
    /(菜单|报表中心|中心|页面|界面|导航|侧栏|页)/.test(t)
  ) {
    return true
  }

  return false
}

/**
 * 文案兜底：像「已经过选择题」的结论痕迹。
 * 不得把用户原话里的「彻底删除 / 删除菜单」算进去——那是诉求本身。
 * 主路径请用 clarifyFlow.decideCodingGate（认 DSH ask_user 会话事件）。
 */
export function hasClarifyEvidence(message: string): boolean {
  const t = String(message || '')
  if (t.length < 12) return false
  if (
    /澄清|用户已选|用户选择|已确认[:：]|结论[:：]|只删|仅删|连同|一并|保留路由|保留页面|只去菜单|含页面|含路由|含接口/.test(
      t,
    )
  ) {
    return true
  }
  // 答完选择题后的常见结论（「选项」太容易误伤原话，这里不单用）
  return (
    t.length >= 24 &&
    /(菜单入口|页面文件|对应页面|对应路由|文件\/路由|仅菜单|只删菜单|连页面|带接口|范围[:：]|路由一并|入口\+|入口＋)/.test(
      t,
    )
  )
}

/**
 * 须澄清：空诉求；或新增/删除入口且（未 clarified，或 clarified 但 message 无澄清痕迹）。
 */
export function needsRequirementClarify(message: string, clarified?: unknown): boolean {
  const msg = String(message || '').trim()
  if (!msg) return true
  if (!looksLikeAddOrDeletePageMenu(msg)) return false
  // 入口级变更：必须 message 里能看出澄清结果，禁止只靠 clarified 空转
  if (truthy(clarified) && hasClarifyEvidence(msg)) return false
  return true
}

/**
 * 本会话已有写码任务时，默认把后续非空诉求当续改上下文（挂 parent）。
 */
export function looksLikeFollowUp(message: string): boolean {
  return Boolean(String(message || '').trim())
}
