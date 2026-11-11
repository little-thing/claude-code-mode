/** 右侧面板的宽度规则：按 Claude 的 tile 树权重来（不是全都等分）。
 *
 * Claude 的判定：
 * - 外层 `row[chat(2), side-panel(flex)]`，面板宽 = flex/(2+flex)；
 * - 宽面板（file/preview/artifact/diff/pr/cr/watercolor/mcpapp）flex 3，其余（terminal/session/tasks…）flex 1；
 * - 每种类型会记住上一次拖过的宽度。
 *
 * DSH 的右栏列宽由 frame 决定（单屏没有公开的 setRightbar），所以单屏保持
 * frame 给的宽度；分屏时右栏宽度由 workspace-browser 这里读 share 计算。
 */

/** 默认 flex 3 的宽面板类型。 */
export const WIDE_PANEL_KINDS = new Set([
  'files', 'file', 'preview', 'artifact', 'diff', 'pr', 'cr', 'watercolor', 'mcpapp', 'document',
])

/** 聊天区的固定权重（Claude 里 chat flex 2）。 */
export const CHAT_FLEX = 2

/**
 * 一个面板类型的默认 flex 权重。
 * @param {string} kind tab 类型
 * @returns {number} 3 或 1
 */
export function paneFlex(kind) {
  return WIDE_PANEL_KINDS.has(kind) ? 3 : 1
}

/**
 * 面板相对整个会话屏的宽度占比：flex / (chat + flex)。
 * @param {string} kind tab 类型
 * @param {Record<string, number>} [remembered] 按类型记住的 flex
 * @returns {number} 0–1
 */
export function paneShare(kind, remembered = {}) {
  const flex = typeof remembered[kind] === 'number' && remembered[kind] > 0 ? remembered[kind] : paneFlex(kind)
  return flex / (CHAT_FLEX + flex)
}

/**
 * 当前布局里「可见的」面板类型：active pane 的 active tab（没有就用第一个非 guide pane）。
 * @param {any} layout 右栏布局（LayoutState）
 * @returns {string | undefined} tab kind
 */
export function activePaneKind(layout) {
  if (layout === undefined || layout === null) return undefined
  const panes = Object.values(layout.nodes ?? {}).filter((node) => node?.kind === 'pane' && node.host === 'dock')
  const active = panes.find((pane) => pane.id === layout.activePaneId)
  const kindOf = (pane) => {
    const tab = layout.tabs?.[pane?.activeTabId]
    return tab !== undefined && tab.kind !== 'guide' ? tab.kind : undefined
  }
  const fromActive = kindOf(active)
  if (fromActive !== undefined) return fromActive
  for (const pane of panes) {
    const kind = kindOf(pane)
    if (kind !== undefined) return kind
  }
  return undefined
}


/** 列/行的最小像素：Claude 的 minTileWidthPx / minTileBasePx。 */
export const MIN_COLUMN_PX = 280
export const MIN_ROW_PX = 100
/** 聊天区的最小宽度（Claude 的 overflowMin）。 */
export const MIN_CHAT_PX = 320

/**
 * 把 flex 权重按容器可用空间分配，并保证不低于最小尺寸；空间不足时按最小
 * 尺寸比例整体缩放（照搬 Claude 的 `yo()`）。
 * @param {number[]} weights flex 权重（相对值即可）
 * @param {number[]} mins 每项的最小像素
 * @param {number} avail 可用像素
 * @returns {number[]} 调整后的权重（总和为 items.length，直接当 flexGrow 用）
 */
export function distribute(weights, mins, avail) {
  const count = weights.length
  if (count === 0) return []
  if (!(avail > 0)) return weights.map(() => 1)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || count
  const pinned = new Set()
  let out = weights.map((weight) => (weight / totalWeight) * avail)
  for (;;) {
    const index = out.findIndex((value, i) => !pinned.has(i) && value < mins[i] - 0.5)
    if (index === -1) break
    pinned.add(index)
    const locked = [...pinned].reduce((sum, i) => sum + mins[i], 0)
    const freeWeight = weights.reduce((sum, weight, i) => (pinned.has(i) ? sum : sum + weight), 0)
    const remaining = avail - locked
    if (freeWeight <= 0 || remaining <= 0) {
      // 放不下：按最小尺寸比例整体压缩（Claude 的兜底分支）。
      const minTotal = mins.reduce((sum, min) => sum + min, 0) || 1
      out = mins.map((min) => (min / minTotal) * avail)
      break
    }
    out = weights.map((weight, i) => (pinned.has(i) ? mins[i] : (weight / freeWeight) * remaining))
  }
  const sum = out.reduce((a, b) => a + b, 0) || count
  return out.map((value) => (value / sum) * count)
}

/**
 * 面板区相对会话屏的占比：根 row 每列按 kind 的 flex 求和，chat 固定 2。
 * 加列时总 flex 变大 → 面板区变宽、会话被压缩（Claude 的 `Ts()` 初始结构）。
 * @param {any} layout 右栏布局
 * @param {Record<string, number>} [remembered] 按类型记住的 flex
 * @returns {number} 0–1
 */
export function panelRowShare(layout, remembered = {}) {
  if (layout === undefined || layout === null) return paneShare('files', remembered)
  const kindFlex = (kind) => {
    if (kind === undefined) return 1
    return typeof remembered[kind] === 'number' && remembered[kind] > 0 ? remembered[kind] : paneFlex(kind)
  }
  const panes = Object.values(layout.nodes ?? {}).filter((node) => node?.kind === 'pane' && node.host === 'dock')
  const kindOf = (pane) => {
    const tab = layout.tabs?.[pane?.activeTabId]
    return tab !== undefined && tab.kind !== 'guide' ? tab.kind : undefined
  }
  const root = layout.nodes?.[layout.rootId]
  if (root?.kind !== 'split' || root.axis !== 'row') {
    // 单列：整列按当前 kind 的 flex。
    const kind = kindOf(panes.find((pane) => pane.id === layout.activePaneId) ?? panes[0]) ?? activePaneKind(layout)
    const flex = kindFlex(kind)
    return flex / (CHAT_FLEX + flex)
  }
  const columnFlex = (childId) => {
    const child = layout.nodes?.[childId]
    if (child?.kind === 'pane') return kindFlex(kindOf(child))
    // column stack：取该列第一个非 guide pane 的 kind flex（一列上下两块共享一份列宽）。
    const inner = Object.values(layout.nodes ?? {}).find((node) => node?.kind === 'pane' && node.host === 'dock'
      && child?.children?.includes?.(node.id) && kindOf(node) !== undefined)
    return kindFlex(kindOf(inner))
  }
  const total = root.children.reduce((sum, childId) => sum + columnFlex(childId), 0) || 1
  return total / (CHAT_FLEX + total)
}
