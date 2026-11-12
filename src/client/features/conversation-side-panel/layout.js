/** 右侧面板的布局操作：落位规则与 split 树编辑。
 *
 * DSH 的 `store.actions.openContent` 只会向右 split（dockkit 的 `planSplitPane`
 * 固定 `axis: 'row'`），而 Claude 的规则是「第一块在右，第二块上下，第三块
 * 向右开新列」。所以这里直接对 `LayoutState` 做纯函数编辑，再由 side-panel
 * 写回原生 store（布局仍是唯一真相，tab body 仍走原生 slot）。
 *
 * id 用 `ctpane` / `ctsplit` 前缀：原生 mint 用 `pane<N>` / `split<N>`，
 * 两套互不冲突。
 */

/** 一个 pane 内显示的全部 tab。 */
export function paneTabs(layout, pane) {
  return pane.tabs.map((id) => layout.tabs[id]).filter((tab) => tab !== undefined)
}

/** 没有非 guide tab 的 pane（原生「开始」页占位）。 */
export function isGuideOnly(layout, pane) {
  return pane.tabs.every((id) => layout.tabs[id]?.kind === 'guide')
}

/** 找一个未占用的节点 id。 */
export function nextId(layout, prefix) {
  let index = 1
  while (layout.nodes[`${prefix}${index}`] !== undefined) index += 1
  return `${prefix}${index}`
}

/** 找一个未占用的 tab id。 */
export function nextTabId(layout) {
  let index = 1
  while (layout.tabs[`cttab${index}`] !== undefined) index += 1
  return `cttab${index}`
}

/** 空 pane 节点。 */
function newPane(id, tabId) {
  return { kind: 'pane', id, host: 'dock', tabs: [tabId], activeTabId: tabId, rect: undefined }
}

/** 把新列按等分加入一个 row split：旧列按 n/(n+1) 缩放，新列 1/(n+1)。 */
function appendColumn(layout, root, paneId) {
  const count = root.children.length
  const shrink = count / (count + 1)
  const sizes = root.sizes.map((size) => size * shrink).concat(1 / (count + 1))
  return {
    ...layout,
    nodes: {
      ...layout.nodes,
      [root.id]: { ...root, children: [...root.children, paneId], sizes },
    },
  }
}

/** 把某个 pane 换成 column [旧 pane, 新 pane]（上下各半）。 */
function wrapColumn(layout, parent, index, existingId, paneId) {
  const splitId = nextId(layout, 'ctsplit')
  const existingSize = parent.sizes[index] ?? 0.5
  const nodes = {
    ...layout.nodes,
    [paneId]: layout.nodes[paneId],
    [splitId]: { kind: 'split', id: splitId, axis: 'column', children: [existingId, paneId], sizes: [0.5, 0.5] },
  }
  const children = parent.children.slice()
  children[index] = splitId
  // column 占据原 pane 在父 split 中的整份空间，父层尺寸不变。
  nodes[parent.id] = { ...parent, children, sizes: parent.sizes.map((size, i) => (i === index ? existingSize : size)) }
  return { ...layout, nodes }
}

/**
 * 按 Claude 的规则放一个新 tab：
 * - 只有 guide 占位时，占用该 pane（guide 保留为 tab，不显示）；
 * - 根是单个 pane → 向右开新列；
 * - 根 row 的最后一个子节点是 pane → 与它组成上下 column；
 * - 最后一个子节点是 stack → 向右开新列；
 * - 根是 column → 包一层 row，再向右开新列。
 *
 * @param layout 当前布局
 * @param tab 新 tab 记录
 * @param options.paneId 指定落点 pane（`+` 新建同类 tab 时用）
 * @returns 新布局
 */
export function placeTab(layout, tab, options = {}) {
  const tabs = { ...layout.tabs, [tab.id]: tab }
  const nodes = { ...layout.nodes }
  const panes = Object.values(layout.nodes).filter((node) => node.kind === 'pane' && node.host === 'dock')
  const base = { ...layout, tabs, expanded: true, activePaneId: layout.activePaneId }

  // `+` / slot 恢复：同一个 pane 里再加一个 tab（可指定 index）。
  if (options.paneId !== undefined) {
    const pane = layout.nodes[options.paneId]
    if (pane?.kind !== 'pane') return base
    const at = typeof options.index === 'number'
      ? Math.min(Math.max(0, options.index), pane.tabs.length)
      : pane.tabs.length
    const tabsOfPane = [...pane.tabs]
    tabsOfPane.splice(at, 0, tab.id)
    nodes[pane.id] = { ...pane, tabs: tabsOfPane, activeTabId: tab.id }
    return { ...base, nodes, activePaneId: pane.id }
  }

  const guidePanes = panes.filter((pane) => isGuideOnly(layout, pane))
  if (panes.length === 1 && guidePanes.length === 1) {
    const pane = guidePanes[0]
    // 原生「开始」tab 不再保留：直接换成新面板，避免 pane 头出现「开始」chip。
    const kept = pane.tabs.filter((id) => layout.tabs[id]?.kind !== 'guide')
    for (const id of pane.tabs) {
      if (layout.tabs[id]?.kind === 'guide') delete tabs[id]
    }
    nodes[pane.id] = { ...pane, tabs: [...kept, tab.id], activeTabId: tab.id }
    return { ...base, nodes, activePaneId: pane.id }
  }

  const newPaneId = nextId(layout, 'ctpane')
  nodes[newPaneId] = newPane(newPaneId, tab.id)
  const root = layout.nodes[layout.rootId]

  if (root.kind === 'pane') {
    // 右栏内第二个面板：与第一个上下叠（Claude 的 row[chat, column[A, B]]）。
    const splitId = nextId(layout, 'ctsplit')
    nodes[splitId] = { kind: 'split', id: splitId, axis: 'column', children: [root.id, newPaneId], sizes: [0.5, 0.5] }
    return { ...base, rootId: splitId, nodes, activePaneId: newPaneId }
  }

  if (root.axis === 'row') {
    const lastIndex = root.children.length - 1
    const lastId = root.children[lastIndex]
    const last = layout.nodes[lastId]
    if (last?.kind === 'pane') {
      // wrapColumn 返回的是整棵新布局，只取它的 nodes。
      const wrapped = wrapColumn({ ...layout, nodes, tabs }, root, lastIndex, lastId, newPaneId)
      return { ...base, activePaneId: newPaneId, nodes: wrapped.nodes }
    }
    // 最后一个子节点是 stack：根 row 追加新列（新 pane 节点要一起带进树里）。
    return { ...appendColumn({ ...base, nodes }, root, newPaneId), activePaneId: newPaneId }
  }

  // 根是 column（嵌套结构）：外包一层 row，再把新列放在右边。
  const splitId = nextId(layout, 'ctsplit')
  nodes[splitId] = { kind: 'split', id: splitId, axis: 'row', children: [root.id, newPaneId], sizes: [0.5, 0.5] }
  return { ...base, rootId: splitId, nodes, activePaneId: newPaneId }
}

/** 切到一个 pane 里的某个 tab（原生 store 的 focusTab 等效）。 */
export function activateTab(layout, paneId, tabId) {
  const pane = layout.nodes[paneId]
  if (pane?.kind !== 'pane' || !pane.tabs.includes(tabId)) return layout
  return {
    ...layout,
    activePaneId: paneId,
    nodes: { ...layout.nodes, [paneId]: { ...pane, activeTabId: tabId } },
  }
}

/** 关闭一个 tab；pane 空了就从树里摘掉（两个子节点的 split 折叠成一个）。 */
export function closeTab(layout, tabId) {
  const pane = Object.values(layout.nodes).find((node) => node.kind === 'pane' && node.tabs.includes(tabId))
  if (pane === undefined) return layout
  const tabs = { ...layout.tabs }
  delete tabs[tabId]
  const remaining = pane.tabs.filter((id) => id !== tabId)
  if (remaining.length > 0) {
    const activeTabId = pane.activeTabId === tabId ? remaining[remaining.length - 1] : pane.activeTabId
    return { ...layout, tabs, nodes: { ...layout.nodes, [pane.id]: { ...pane, tabs: remaining, activeTabId } } }
  }
  // 最后一个 tab 关掉：还有别的 pane 时摘掉它（父 split 折叠）；
  // 只剩这一个 pane 时保留空 pane，避免 rootId 指向不存在的节点。
  const panes = Object.values(layout.nodes).filter((node) => node.kind === 'pane' && node.host === 'dock')
  const nodes = { ...layout.nodes }
  if (panes.length <= 1) {
    nodes[pane.id] = { ...pane, tabs: [], activeTabId: undefined }
    return { ...layout, tabs, nodes }
  }
  delete nodes[pane.id]
  const parent = Object.values(nodes).find((node) => node.kind === 'split' && node.children.includes(pane.id))
  if (parent === undefined) {
    return { ...layout, tabs, nodes, rootId: layout.rootId }
  }
  const index = parent.children.indexOf(pane.id)
  const children = parent.children.filter((id) => id !== pane.id)
  const sizes = parent.sizes.filter((_, i) => i !== index)
  if (children.length === 1) {
    // 折叠：父 split 被唯一的孩子替换。
    const survivor = children[0]
    const grand = Object.values(nodes).find((node) => node.kind === 'split' && node.children.includes(parent.id))
    if (grand === undefined) {
      delete nodes[parent.id]
      return { ...layout, tabs, nodes, rootId: survivor }
    }
    const gi = grand.children.indexOf(parent.id)
    const grandChildren = grand.children.slice()
    grandChildren[gi] = survivor
    delete nodes[parent.id]
    nodes[grand.id] = { ...grand, children: grandChildren }
    return { ...layout, tabs, nodes }
  }
  nodes[parent.id] = { ...parent, children, sizes: normalizeSizes(sizes) }
  return { ...layout, tabs, nodes }
}

function normalizeSizes(sizes) {
  const total = sizes.reduce((sum, size) => sum + size, 0) || 1
  return sizes.map((size) => size / total)
}

/** 只有 guide（或没有可显示的 pane）时，右栏应该收起。 */
export function shouldCollapse(layout) {
  if (layout === undefined) return false
  const panes = Object.values(layout.nodes).filter((node) => node.kind === 'pane' && node.host === 'dock')
  return panes.every((pane) => isGuideOnly(layout, pane))
}
