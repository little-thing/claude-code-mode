/** Claude 式会话右侧面板：自绘 tile 布局 + 原生 tab body。
 *
 * DSH 原生右侧栏的渲染器只支持 1–2 个水平 pane（DockLayout 的 TabLayout 会
 * throw），所以这里接管 `rightbar.session` 的渲染：布局由我们画，内容仍走
 * 原生 `sidebar.right.pane.tab` slot（文件树/终端/浏览器/Git 都是原生 body）。
 *
 * 布局仍以原生 `sidebarRight` store 的 `LayoutState` 为唯一真相：tab 记录和
 * `useTabInfo` 都依赖它。落位规则（上下 / 新列）和关闭/聚焦由 layout.js 的
 * 纯函数算出新布局后写回 store——DSH 的公开 split 只支持向右，这里绕过它。
 */

import * as React from 'react'
import { Tooltip } from '../../shared/ui/tooltip.js'
import {
  activateTab, closeTab, isGuideOnly, nextTabId, placeTab, shouldCollapse,
} from './layout.js'
import { JOBS_KIND } from './jobs-panel.js'
import { distribute, MIN_COLUMN_PX, MIN_ROW_PX } from '../../shared/panel-widths.js'

const h = React.createElement

/** 拖动分隔条时一列能保留的最小比例（原生 resizeSplit 还会再夹到 0.2）。 */
const MIN_SHARE = 0.18

/** 宽于这个值才画多列；分屏右栏 240px 时只显示一个 pane。 */
const COMPACT_WIDTH = 320

/** 会话级持久化：每个会话一个 key（`<prefix>.<sessionId>`），和 DSH 的
 * `defineStore({ persist })` + `create(scopeKey)` 惯例一致（原生右栏也是
 * `dsh.sidebar-right.v1.<sessionId>`）。
 *
 * 内存里布局仍写在原生 `sidebarRight` 的 session-scoped store 里（唯一真相）；
 * 但原生 `dsh.sidebar-right.v1.<sessionId>` 的 zod 校验只接受
 * `paneN/splitN/tabN` 且根 split 必须是 row+2，多列/上下结构会被
 * `clearSidebarLayout` 清掉，所以持久化用插件自己的会话级 key。
 */
const SESSION_STORAGE_PREFIX = 'ct.sidePanel.session.v1'
/** 旧版本：一个大 map（无后缀）与两个分开的 key，只做一次性迁移。 */
const LEGACY_SESSION_MAP_KEY = 'ct.sidePanel.session.v1'
const LEGACY_LAYOUT_KEY = 'ct.sidePanel.layout.v1'
const LEGACY_MAXIMIZED_KEY = 'ct.sidePanel.maximized.v1'

function sessionStorageKey(sessionId) {
  return `${SESSION_STORAGE_PREFIX}.${sessionId}`
}

function parseStored(raw) {
  if (raw === null || raw === undefined) return undefined
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** 把旧版本三种 key 一次性迁移成每会话一个 key，然后删掉旧 key。 */
function migrateLegacyKeys() {
  try {
    const storage = globalThis.localStorage
    if (storage === undefined) return
    const legacyMap = parseStored(storage.getItem(LEGACY_SESSION_MAP_KEY))
    const legacyLayout = parseStored(storage.getItem(LEGACY_LAYOUT_KEY))
    const legacyMax = parseStored(storage.getItem(LEGACY_MAXIMIZED_KEY))
    if (legacyMap === undefined && legacyLayout === undefined && legacyMax === undefined) return
    const targets = new Map()
    for (const [sessionId, value] of Object.entries(legacyMap ?? {})) {
      if (value === null || typeof value !== 'object') continue
      targets.set(sessionId, {
        version: 1,
        layout: value.layout !== null && typeof value.layout === 'object' ? value.layout : undefined,
        maximized: typeof value.maximized === 'string' ? value.maximized : undefined,
      })
    }
    for (const [sessionId, value] of Object.entries(legacyLayout ?? {})) {
      if (value === null || typeof value !== 'object' || value.layout === undefined) continue
      const existing = targets.get(sessionId)
      targets.set(sessionId, { version: 1, layout: value.layout, maximized: existing?.maximized })
    }
    for (const [sessionId, paneId] of Object.entries(legacyMax ?? {})) {
      if (typeof paneId !== 'string') continue
      const existing = targets.get(sessionId)
      targets.set(sessionId, { version: 1, layout: existing?.layout, maximized: paneId })
    }
    for (const [sessionId, value] of targets) {
      if (storage.getItem(sessionStorageKey(sessionId)) === null) {
        storage.setItem(sessionStorageKey(sessionId), JSON.stringify(value))
      }
    }
    storage.removeItem(LEGACY_SESSION_MAP_KEY)
    storage.removeItem(LEGACY_LAYOUT_KEY)
    storage.removeItem(LEGACY_MAXIMIZED_KEY)
  } catch {
    /* 迁移失败时下次启动再试 */
  }
}

function readSessionState(sessionId) {
  try {
    migrateLegacyKeys()
    const value = parseStored(globalThis.localStorage?.getItem(sessionStorageKey(sessionId)))
    if (value === null || value === undefined || typeof value !== 'object' || value.version !== 1) return {}
    return {
      layout: value.layout !== null && typeof value.layout === 'object' ? value.layout : undefined,
      maximized: typeof value.maximized === 'string' ? value.maximized : undefined,
      slots: value.slots !== null && typeof value.slots === 'object' ? value.slots : undefined,
    }
  } catch {
    return {}
  }
}

function writeSessionState(sessionId, patch) {
  try {
    const storage = globalThis.localStorage
    if (storage === undefined) return
    const current = readSessionState(sessionId)
    const next = {
      version: 1,
      layout: patch.layout !== undefined ? patch.layout : current.layout,
      maximized: 'maximized' in patch ? patch.maximized : current.maximized,
      slots: 'slots' in patch ? patch.slots : current.slots,
    }
    if (next.layout === undefined && next.maximized === undefined && next.slots === undefined) {
      storage.removeItem(sessionStorageKey(sessionId))
    } else {
      storage.setItem(sessionStorageKey(sessionId), JSON.stringify(next))
    }
  } catch {
    /* 持久化失败不影响当前渲染 */
  }
}

function readMaximized(sessionId) {
  return readSessionState(sessionId).maximized
}

function writeMaximized(sessionId, paneId) {
  writeSessionState(sessionId, { maximized: paneId })
}

function readOwnLayout(sessionId) {
  return readSessionState(sessionId).layout
}

function writeOwnLayout(sessionId, layout) {
  writeSessionState(sessionId, { layout })
}

/** 页面地址方案与原生一致：`sidebar://<kind>`；multiple 类型再加一段 uuid。 */
function pageAddress(kind) {
  return `sidebar://${kind}`
}

function contentAddress(kind, multiple) {
  if (multiple !== true) return pageAddress(kind)
  return `${pageAddress(kind)}/${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`
}

function paneList(layout) {
  return Object.values(layout.nodes)
    .filter((node) => node.kind === 'pane' && node.host === 'dock')
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
}

/** 可关闭的 tab：guide 是常驻页，不能关。 */
function canCloseTab(layout, tabId) {
  const tab = layout.tabs[tabId]
  return tab !== undefined && tab.kind !== 'guide'
}

/** 读当前会话的原生布局（只读快照；store 仍是唯一真相）。 */
function readSurface(sbr, sessionId) {
  try {
    const store = sbr.adopted?.get(sessionId)?.store
    return { store, surface: store?.getSnapshot()?.bySession?.[sessionId] }
  } catch {
    return {}
  }
}

/** 把新布局写回原生 store（保持 surface 的 history/minted 字段不变）。 */
function writeLayout(sbr, sessionId, nextLayout) {
  const { store, surface } = readSurface(sbr, sessionId)
  if (store === undefined || surface === undefined) return false
  try {
    const snapshot = store.getSnapshot()
    store.store.set({ bySession: { ...snapshot.bySession, [sessionId]: { ...surface, layout: nextLayout } } })
    writeOwnLayout(sessionId, nextLayout)
    return true
  } catch (error) {
    console.warn('[conversation-side-panel] layout write failed', error)
    return false
  }
}

/**
 * 自绘面板的工厂。
 * @param {{ sbr: any, registry: any, seats: Map<string, any>, t: any }} deps 右栏服务、tab 注册表与 header 入口共享的座位表
 * @returns 面板组件
 */
export function createSidePanel({ sbr, registry, seats, t }) {
  /** 正在等待右栏 store materialize 的打开请求（避免连点重复放置）。 */
  const pendingOpens = new Set()

  /** 原生右边栏的展开/轨道/全屏上报。
   * 「打开」不再看独立的 expanded 值：没有菜单 item 面板时一律不占位，
   * 这样插件页/自动化任务页不会被会话右栏挤窄。 */
  function usePresentation(layout, props, rootRef) {
    const expanded = layout?.expanded === true
    const floats = layout?.floats?.length ?? 0
    const fullscreen = layout?.mode === 'fullscreen'
    const shown = (expanded || floats > 0) && !shouldCollapse(layout)
    const track = shown && !fullscreen
    React.useEffect(() => {
      props.syncPresentation({ shown, track, fullscreen })
    }, [shown, track, fullscreen, props.syncPresentation])
    /**
     * 自愈：原生 frame 的右栏列可能被分屏退出、热重载或别的入口改过，而
     * `shown` 本身没变化时上面的 effect 不会重跑，表现为「面板开着却看不到」
     * 或「面板关了仍占一列」。观察 frame 的 collapsed 属性，和当前 shown
     * 对不上就按当前状态再报一次。overlay 右栏不在原生 rightbar 列里，
     * closest 找不到 frame，自然跳过。
     */
    React.useEffect(() => {
      const root = rootRef.current
      const frame = typeof root?.closest === 'function'
        ? root.closest('[data-rightbar-col]')?.parentElement ?? null
        : null
      if (frame === null || typeof MutationObserver === 'undefined') return undefined
      const align = () => {
        if (frame.hasAttribute('data-rightbar-collapsed') === !shown) return
        props.syncPresentation({ shown, track, fullscreen })
      }
      const observer = new MutationObserver(align)
      observer.observe(frame, { attributes: true, attributeFilter: ['data-rightbar-collapsed'] })
      return () => observer.disconnect()
    }, [shown, track, fullscreen, props.syncPresentation, rootRef])
    return { expanded, fullscreen, shown }
  }

  /**
   * 把 tab 放进布局并写回原生 store。
   * @param sessionId 会话
   * @param definition tab 类型定义
   * @param surface 已 materialize 的右栏 surface
   * @param options.paneId 指定 pane（pane 头的「+」新建同类 tab）
   * @returns 是否写入成功
   */
  function placeInto(sessionId, definition, surface, options) {
    const layout = surface.layout
    const kind = definition.kind
    const address = contentAddress(kind, definition.multiple)
    const tab = { id: nextTabId(layout), kind, contentId: address, title: definition.title(address) }
    // 上次关掉的位置还在：回到原 pane 的原 index（Claude 的 slot 恢复）。
    const slot = options.paneId === undefined ? readSessionState(sessionId).slots?.[kind] : undefined
    const slotPane = slot === undefined ? undefined : layout.nodes[slot.paneId]
    const placement = slotPane?.kind === 'pane'
      ? { paneId: slot.paneId, index: slot.index }
      : options.paneId === undefined ? {} : { paneId: options.paneId }
    const next = placeTab(layout, tab, placement)
    if (!writeLayout(sbr, sessionId, next)) return false
    try {
      sbr.tabDomain.navigate(sessionId, tab.id, { address, params: undefined })
    } catch { /* 导航记录失败不影响 body 自己取默认内容 */ }
    return true
  }

  /**
   * 打开一个面板入口：按 Claude 的落位规则放进布局，再写回原生 store。
   * @param sessionId 会话
   * @param kind tab 类型
   * @param actions 原生 store actions（布局未 materialize 时先让它加载）
   * @param options.paneId 指定 pane（pane 头的「+」新建同类 tab）
   */
  function openPanel(sessionId, kind, actions, options = {}) {
    const definition = registry.get(kind)
    if (definition === undefined) return
    const attempt = () => {
      const { surface } = readSurface(sbr, sessionId)
      if (surface === undefined) return false
      return placeInto(sessionId, definition, surface, options)
    }
    if (attempt()) return
    // 这个会话的右栏 store 还没 materialize：先让它加载，随后重试放置。
    // 不要退回窗口级 `sbr.openTab`——它作用于当前选中的会话，会把面板开到
    // 别的屏（分屏 overlay 里表现就是「点了没反应」）。
    const key = `${sessionId}:${kind}`
    if (pendingOpens.has(key)) return
    pendingOpens.add(key)
    try { actions?.open?.(sessionId) } catch { /* 加载失败时等重试自然放弃 */ }
    let attempts = 0
    const retry = () => {
      if (!pendingOpens.has(key)) return
      if (attempt()) {
        pendingOpens.delete(key)
        return
      }
      attempts += 1
      if (attempts >= 20) {
        pendingOpens.delete(key)
        return
      }
      setTimeout(retry, 50)
    }
    setTimeout(retry, 0)
  }

  /** 关闭前记录 kind 的位置（Claude 的 closedPaneSlotsBySession），重开时回原位。 */
  function rememberSlot(sessionId, kind, paneId, index) {
    const state = readSessionState(sessionId)
    const slots = { ...(state.slots ?? {}) }
    if (kind === undefined || kind === 'guide') return
    slots[kind] = { paneId, index }
    writeSessionState(sessionId, { slots })
  }

  /** 关闭一个 tab；关掉最后一块时同一笔写回收起（不在渲染时抢收起，避免和分屏抢右栏）。 */
  function closePaneTab(sessionId, tabId) {
    const { surface } = readSurface(sbr, sessionId)
    if (surface === undefined) return
    const layout = surface.layout
    const pane = Object.values(layout.nodes).find((node) => node.kind === 'pane' && node.tabs.includes(tabId))
    const tab = layout.tabs[tabId]
    if (pane !== undefined && tab !== undefined) rememberSlot(sessionId, tab.kind, pane.id, pane.tabs.indexOf(tabId))
    const next = closeTab(layout, tabId)
    writeLayout(sbr, sessionId, shouldCollapse(next) ? { ...next, expanded: false } : next)
  }

  /** 关闭某个 kind 的面板（header 入口的 toggle 关闭）。 */
  function closeKind(sessionId, kind) {
    const { surface } = readSurface(sbr, sessionId)
    if (surface === undefined) return
    const layout = surface.layout
    const candidates = paneList(layout)
      .flatMap((pane) => pane.tabs.map((id) => ({ pane, tab: layout.tabs[id] })))
      .filter((entry) => entry.tab?.kind === kind && entry.tab.kind !== 'guide')
    const target = candidates.find((entry) => entry.pane.id === layout.activePaneId) ?? candidates[0]
    if (target === undefined) return
    rememberSlot(sessionId, kind, target.pane.id, target.pane.tabs.indexOf(target.tab.id))
    const next = closeTab(layout, target.tab.id)
    writeLayout(sbr, sessionId, shouldCollapse(next) ? { ...next, expanded: false } : next)
  }

  /** 切换 pane 内的 active tab。 */
  function activatePaneTab(sessionId, paneId, tabId) {
    const { surface } = readSurface(sbr, sessionId)
    if (surface === undefined) return
    writeLayout(sbr, sessionId, activateTab(surface.layout, paneId, tabId))
  }

  /** 一个 pane 的标题栏 + 内容。 */
  function PanelPane({
    layout, pane, sessionId, actions, renderSlot, occurrence, useStore, useTabNavigation,
    useShortcuts, useTabTypes, active, retainTab, maximized, onToggleMaximize, t: paneT,
  }) {
    const tabs = pane.tabs.map((id) => layout.tabs[id]).filter((tab) => tab !== undefined)
    const activeTab = layout.tabs[pane.activeTabId] ?? tabs[tabs.length - 1]
    const definition = activeTab === undefined ? undefined : useTabTypes((types) => types.find((item) => item.kind === activeTab.kind))
    const shortcuts = useShortcuts((catalog) => catalog)
    const occ = activeTab === undefined ? undefined : occurrence(activeTab)
    const hookContext = React.useMemo(() => (activeTab === undefined || occ === undefined ? undefined : {
      tabId: activeTab.id,
      title: false,
      fullscreen: false,
      active,
      signal: occ.signal,
      actions: occ.tabActions,
      shortcuts,
      useStore,
      useTabNavigation,
    }), [activeTab, occ, active, shortcuts, useStore, useTabNavigation])

    if (activeTab === undefined) {
      return h('section', { className: 'ct-sp-pane', 'data-ct-sp-pane': pane.id }, h(EmptyPane, { t: paneT }))
    }

    return h('section', {
      className: 'ct-sp-pane',
      'data-ct-sp-pane': pane.id,
      'data-ct-sp-pane-active': layout.activePaneId === pane.id || undefined,
      'data-ct-sp-maximized': maximized || undefined,
    },
      h('header', { className: 'ct-sp-pane-head' },
        h('div', { className: 'ct-sp-tabs', role: 'tablist' },
          tabs.map((tab) => h(Tooltip, {
            key: tab.id,
            label: tab.title,
            side: 'bottom',
            delayMs: 400,
            portal: true,
            asChild: true,
          }, h('button', {
            type: 'button',
            role: 'tab',
            'aria-selected': tab.id === activeTab.id,
            className: 'ct-sp-tab',
            'data-ct-sp-tab': tab.id,
            'data-active': tab.id === activeTab.id || undefined,
            onClick: () => activatePaneTab(sessionId, pane.id, tab.id),
          }, h('span', { className: 'ct-sp-tab-icon' }, h(PaneGlyph, { kind: tab.kind })),
            h('span', { className: 'ct-sp-tab-label' }, tab.title))))),
        h('div', { className: 'ct-sp-pane-actions' },
          definition?.multiple === true
            ? h(Tooltip, {
              label: '新建一个',
              side: 'bottom',
              delayMs: 400,
              portal: true,
            }, h('button', {
              type: 'button',
              className: 'ct-sp-icon-button',
              'aria-label': '新建一个',
              onClick: () => openPanel(sessionId, activeTab.kind, actions, { paneId: pane.id }),
            }, h(PlusGlyph, null)))
            : null,
          h(Tooltip, {
            label: maximized ? '还原面板' : '最大化面板',
            side: 'bottom',
            delayMs: 400,
            portal: true,
          }, h('button', {
            type: 'button',
            className: 'ct-sp-icon-button',
            'aria-label': maximized ? '还原面板' : '最大化面板',
            onClick: () => onToggleMaximize(pane.id),
          }, h(MaximizeGlyph, { active: maximized }))),
          canCloseTab(layout, activeTab.id)
            ? h(Tooltip, {
              label: '关闭面板',
              side: 'bottom',
              delayMs: 400,
              portal: true,
            }, h('button', {
              type: 'button',
              className: 'ct-sp-icon-button',
              'aria-label': '关闭面板',
              onClick: () => closePaneTab(sessionId, activeTab.id),
            }, h(CloseGlyph, null)))
            : null)),
      h('div', { className: 'ct-sp-pane-body' },
        hookContext === undefined
          ? h(EmptyPane, { t: paneT })
          : renderSlot('sidebar.right.pane.tab', {}, { entryKey: definition?.id ?? activeTab.kind, hookContext, fallback: h(UnavailablePane, { t: paneT }) })))
  }

  /** 空 pane 的占位：没有 tab 时的提示。 */
  function EmptyPane({ t: paneT }) {
    return h('div', { className: 'ct-sp-empty' }, h('span', null, paneT('emptyPane')))
  }

  function UnavailablePane({ t: paneT }) {
    return h('p', { className: 'ct-sp-empty' }, paneT('unavailable'))
  }

  /** 面板主体：按原生 layout 的 split 树递归渲染。guide 常驻 store，但有空面板时不再占列。 */
  function Tree({ nodeId, hideGuide, ...rest }) {
    const node = rest.layout.nodes[nodeId]
    if (node === undefined) return null
    if (node.kind === 'pane') {
      if (hideGuide && node.tabs.every((id) => rest.layout.tabs[id]?.kind === 'guide')) return null
      return h(PanelPane, { key: node.id, pane: node, ...rest })
    }
    return h(Split, { key: node.id, node, hideGuide, ...rest })
  }

  /** 一个 split：子列按 sizes 排布，列之间是可拖拽的分隔条。 */
  function Split({ node, hideGuide, ...rest }) {
    const axis = node.axis === 'row' ? 'row' : 'column'
    const [preview, setPreview] = React.useState(undefined)
    const previewRef = React.useRef(undefined)
    const rootRef = React.useRef(null)
    const gesture = React.useRef(undefined)
    const sizes = preview ?? node.sizes
    const applyPreview = (next) => { previewRef.current = next; setPreview(next) }
    // Claude 的 tile 最小尺寸：每列 280px、每行 100px；空间不足时按均分下限压缩，避免溢出。
    const [box, setBox] = React.useState({ w: 0, h: 0 })
    React.useLayoutEffect(() => {
      const element = rootRef.current
      if (element === null || typeof ResizeObserver === 'undefined') return undefined
      const update = () => setBox({ w: element.clientWidth, h: element.clientHeight })
      update()
      const observer = new ResizeObserver(update)
      observer.observe(element)
      return () => { observer.disconnect() }
    }, [])
    const cells = node.children
      .map((childId, index) => ({ childId, size: sizes[index] ?? 1 }))
      .filter(({ childId }) => {
        const child = rest.layout.nodes[childId]
        if (!hideGuide || child?.kind !== 'pane') return true
        return !child.tabs.every((id) => rest.layout.tabs[id]?.kind === 'guide')
      })
    const total = cells.reduce((sum, cell) => sum + cell.size, 0) || 1
    // 按 Claude 的 yo()：先按权重分，低于最小尺寸的锁定，空间不足按最小尺寸比例压缩。
    const avail = axis === 'row' ? box.w : box.h
    const adjusted = distribute(cells.map((cell) => cell.size / total), cells.map(() => (axis === 'row' ? MIN_COLUMN_PX : MIN_ROW_PX)), avail)

    const beginDrag = (boundary, event) => {
      const element = rootRef.current
      if (element === null) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const span = axis === 'row' ? rect.width : rect.height
      const start = axis === 'row' ? event.clientX : event.clientY
      gesture.current = { boundary, start, span, origin: cells.map((cell) => cell.size / total) }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }

    React.useEffect(() => {
      const move = (event) => {
        const active = gesture.current
        if (active === undefined || active.span <= 0) return
        const delta = ((axis === 'row' ? event.clientX : event.clientY) - active.start) / active.span
        const base = active.origin[active.boundary]
        const next = active.origin[active.boundary + 1]
        if (base === undefined || next === undefined) return
        const pair = base + next
        if (pair < MIN_SHARE * 2) return
        const lower = Math.max(MIN_SHARE, Math.min(pair - MIN_SHARE, base + delta))
        const updated = [...active.origin]
        updated[active.boundary] = lower
        updated[active.boundary + 1] = pair - lower
        applyPreview(updated)
      }
      const end = () => {
        const active = gesture.current
        gesture.current = undefined
        const committed = previewRef.current
        previewRef.current = undefined
        setPreview(undefined)
        if (active === undefined || committed === undefined) return
        const next = {
          ...rest.layout,
          nodes: {
            ...rest.layout.nodes,
            [node.id]: { ...node, sizes: normalize(committed) },
          },
        }
        writeLayout(sbr, rest.sessionId, next)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
      return () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
      }
    })

    const children = []
    cells.forEach(({ childId, size }, index) => {
      children.push(h('div', {
        key: childId,
        className: 'ct-sp-cell',
        style: { flexGrow: adjusted[index] ?? size / total, flexBasis: 0 },
      }, h(Tree, { ...rest, hideGuide, nodeId: childId })))
      if (index < cells.length - 1) {
        children.push(h('div', {
          key: `${childId}:divider`,
          className: `ct-sp-divider ct-sp-divider-${axis}`,
          role: 'separator',
          'aria-orientation': axis === 'row' ? 'vertical' : 'horizontal',
          'data-ct-sp-divider': `${node.id}:${index}`,
          onPointerDown: (event) => beginDrag(index, event),
        }))
      }
    })

    return h('div', {
      ref: rootRef,
      key: node.id,
      className: `ct-sp-split ct-sp-split-${axis}`,
      'data-ct-sp-split': node.id,
      'data-ct-sp-dragging': preview === undefined ? undefined : true,
    }, children)
  }

  /** 面板根组件，替换原生 `RightbarSeat` 的渲染。 */
  function SidePanel(props) {
    const {
      sessionId, width, active, useStore, occurrence,
      useTabTypes, useTabNavigation, useShortcuts, renderSlot, retainTab, actions, Native, t: panelT,
    } = props
    const surface = useStore((state) => state.bySession[sessionId])
    const layout = surface?.layout
    // rootRef 先于上报创建：自愈观察需要从 root 向上找原生 frame。
    const rootRef = React.useRef(null)
    const presentation = usePresentation(layout, props, rootRef)
    // pane 级最大化：只影响渲染，不写 store；状态按会话持久化。
    const [maximized, setMaximizedState] = React.useState(() => readMaximized(sessionId))
    const setMaximized = React.useCallback((value) => {
      setMaximizedState(value)
      writeMaximized(sessionId, value)
    }, [sessionId])
    const [ownWidth, setOwnWidth] = React.useState(0)
    React.useLayoutEffect(() => {
      const element = rootRef.current
      if (element === null || typeof ResizeObserver === 'undefined') return undefined
      const update = () => setOwnWidth(element.getBoundingClientRect().width)
      update()
      const observer = new ResizeObserver(update)
      observer.observe(element)
      return () => { observer.disconnect() }
    }, [presentation.shown])
    const compact = ownWidth > 0 && ownWidth < COMPACT_WIDTH
    // 窄宽也不隐藏 pane：Claude 的口径是「放不下就按最小尺寸比例压缩」，
    // 列/行的压缩由 Split 里的 distribute() 完成。

    // 原生持久化不认我们的结构：启动时用自己存的那份恢复一次。
    const restoredRef = React.useRef(false)
    React.useEffect(() => {
      if (restoredRef.current || layout === undefined) return
      restoredRef.current = true
      if (!shouldCollapse(layout)) return
      const saved = readOwnLayout(sessionId)
      if (saved === undefined) return
      writeLayout(sbr, sessionId, saved)
    }, [layout, sessionId])

    // 最大化目标在渲染时校验（pane 不存在/变成 guide 就当没最大化）；
    // 不主动清理存储：刷新时布局恢复晚于首次渲染，清理会把持久化状态误抹掉。

    // header 工具条与面板共享同一个 session 的 actions。
    React.useEffect(() => {
      seats.set(sessionId, {
        actions,
        openPanel: (kind) => openPanel(sessionId, kind, actions),
        closeKind: (kind) => closeKind(sessionId, kind),
        isOpen: (kind) => {
          const layout = readSurface(sbr, sessionId).surface?.layout
          if (layout?.expanded !== true) return false
          return Object.values(layout.nodes).some((node) => node.kind === 'pane' && node.host === 'dock'
            && node.tabs.some((id) => {
              const tab = layout.tabs[id]
              return tab !== undefined && tab.kind === kind && tab.kind !== 'guide'
            }))
        },
        layout: () => readSurface(sbr, sessionId).surface?.layout,
        subscribe: (listener) => {
          const store = readSurface(sbr, sessionId).store
          return store === undefined ? () => {} : store.subscribe(listener)
        },
      })
      return () => { seats.delete(sessionId) }
    }, [sessionId, actions])

    // 「展开但没有任何可显示的面板」是残留状态（关闭最后一个面板的路径、
    // 或持久化恢复都可能留下）：不占位，并把 expanded 收回，避免一列空白。
    React.useEffect(() => {
      if (layout === undefined || layout.expanded !== true) return
      if (!shouldCollapse(layout)) return
      try { actions.setExpanded(sessionId, false) } catch { /* 收回失败时仍渲染为不占位 */ }
    }, [layout, actions, sessionId])

    if (layout === undefined) {
      // 原生 store 还没 materialize 这个会话：先交给原生，等 state 到位再接管。
      return h(Native, props)
    }

    const panelMark = {
      'data-sidebar-right-panel': presentation.fullscreen ? 'fullscreen' : 'push',
      'data-sidebar-right-session': sessionId,
    }

    if (shouldCollapse(layout)) {
      // 没有任何可显示的面板：不占位。残留的 expanded 由下面的 effect 收回。
      return h('div', {
        ref: rootRef,
        className: 'ct-sp-root',
        'data-ct-sp-collapsed': true,
        style: { display: 'none' },
      })
    }

    if (!presentation.shown) {
      return h('div', {
        ref: rootRef,
        className: 'ct-sp-root',
        'data-ct-sp-collapsed': true,
        ...panelMark,
        style: { width: '100%', height: '100%', '--dsh-sidebar-width': `${width}px` },
      })
    }

    const maximizedPane = maximized !== undefined && layout.nodes[maximized]?.kind === 'pane'
      && !isGuideOnly(layout, layout.nodes[maximized]) ? layout.nodes[maximized] : undefined
    const singlePane = undefined
    const paneProps = {
      sessionId,
      actions,
      renderSlot,
      occurrence,
      useStore,
      useTabNavigation,
      useShortcuts,
      useTabTypes,
      active,
      retainTab,
      t: panelT,
      onToggleMaximize: (paneId) => setMaximized(maximized === paneId ? undefined : paneId),
    }

    const body = maximizedPane !== undefined
      ? h(PanelPane, { ...paneProps, key: maximizedPane.id, layout, pane: maximizedPane, maximized: true })
      : h(Tree, {
          ...paneProps,
          layout,
          nodeId: layout.rootId,
          maximized: false,
          hideGuide: true,
        })

    return h('div', {
      ref: rootRef,
      className: 'ct-sp-root',
      'data-ct-sp-root': true,
      'data-ct-sp-compact': compact || undefined,
      'data-ct-sp-maximized': maximizedPane !== undefined || undefined,
      'data-ct-sp-fullscreen': presentation.fullscreen || undefined,
      ...panelMark,
      'data-sidebar-right-open': true,
      style: { width: '100%', height: '100%', '--dsh-sidebar-width': `${width}px` },
    }, body)
  }

  return SidePanel
}

function normalize(sizes) {
  const total = sizes.reduce((sum, size) => sum + size, 0) || 1
  return sizes.map((size) => size / total)
}

/** pane 标题图标：用极简字形，按 kind 区分，避免依赖各 tab 类型的内嵌图标。 */
function PaneGlyph({ kind }) {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }
  const stroke = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (kind) {
    case 'terminal':
      return h('svg', common, h('path', { d: 'M2.5 3.5 6.8 8l-4.3 4.5', ...stroke }), h('path', { d: 'M8.5 12.5h5', ...stroke }))
    case 'files':
      return h('svg', common, h('path', { d: 'M2.5 4.5h4l1.2 1.5h5.8v6.5h-11z', ...stroke }))
    case 'browser':
      return h('svg', common, h('circle', { cx: 8, cy: 8, r: 5.5, ...stroke }), h('path', { d: 'M2.5 8h11', ...stroke }))
    case 'guide':
      return h('svg', common, h('circle', { cx: 8, cy: 8, r: 5.5, ...stroke }), h('path', { d: 'M8 5v3.2l2 1.4', ...stroke }))
    case JOBS_KIND:
      return h('svg', common,
        h('path', { d: 'm8 2.4 5.4 2.9L8 8.2 2.6 5.3 8 2.4Z', ...stroke }),
        h('path', { d: 'm2.6 8.2 5.4 2.9 5.4-2.9', ...stroke }),
        h('path', { d: 'm2.6 11 5.4 2.9L13.4 11', ...stroke }))
    default:
      return h('svg', common, h('rect', { x: 3, y: 3, width: 10, height: 10, rx: 2, ...stroke }))
  }
}

/** 新建同类 tab 的「+」。 */
function PlusGlyph() {
  return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    h('path', { d: 'M8 3.5v9M3.5 8h9', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))
}

/** pane 最大化 / 还原。 */
function MaximizeGlyph({ active }) {
  if (active) {
    return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
      h('path', { d: 'M6 2.5v3.5H2.5M10 2.5V6h3.5M6 13.5V10H2.5M10 13.5V10h3.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
  }
  return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    h('path', { d: 'M2.5 6V2.5H6M13.5 6V2.5H10M2.5 10v3.5H6M13.5 10v3.5H10', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

function CloseGlyph() {
  return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    h('path', { d: 'm4 4 8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))
}
