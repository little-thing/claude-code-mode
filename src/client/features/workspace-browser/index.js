/** workspace-browser：数据驱动的会话工作区列表。
 *
 * 替代原生 WorkspaceBrowser 的登录方式：注册到 `sidebar.workspaces` slot，
 * 直接消费客户端服务（sessions.list / workspaces.list / uiWorkspace），
 * 不再依赖原生会话行 DOM，也不再有 watermark 分页。
 *
 * 这一版覆盖：工作区分组/折叠、两级 fork 树、父行折叠、选中、打开、新建、
 * 会话更多菜单（置顶/重命名/分叉/归档/复制 ID）、归档筛选、标题搜索、
 * 工作区新建/重命名/删除。拖拽、悬浮预览、原生快捷操作和第三方行操作
 * slot 仍在迁移中。
 */

import * as React from 'react'
import { Tooltip } from '../../shared/ui/tooltip.js'
import { formatRelativeTime as formatTime, useRelativeNow as useNow } from '../../shared/time.js'
import browserCss from './workspace-browser.css'
import { SessionShell } from './session-shell.js'
import { isFeatureEnabled } from '../../core/preferences.js'

const h = React.createElement

const ARCHIVED_FILTERS = [
  { id: 'default', label: '隐藏已归档' },
  { id: 'show', label: '全部对话（显示已归档）' },
  { id: 'only', label: '仅显示已归档' },
]

const GROUP_OPTIONS = [
  { id: 'folder', label: '文件夹' },
  { id: 'date', label: '日期' },
  { id: 'status', label: '状态' },
  { id: 'environment', label: '环境', disabled: true },
  { id: 'none', label: '无' },
]

const ORDER_OPTIONS = [
  { id: 'updated', label: '上次更新' },
  { id: 'created', label: '创建日期' },
  { id: 'name', label: '名称' },
]

const VIEW_STORAGE_KEY = 'ct.workspace-view.v1'
const SECTIONS_STORAGE_KEY = 'ct.sections.v1'
/** 更名前的键前缀（claude-theme.*）：只读兜底，新写入一律用 `ct.`。 */
const LEGACY_STORAGE_PREFIX = 'claude-theme.'
const CONVERSATION_DRAFT_STORAGE_PREFIX = 'dsh.conversation.'
const DEFAULT_VIEW = { groupBy: 'folder', orderBy: 'updated', direction: 'desc', archivedFilter: 'default' }
const SECTION_DEFAULT_VIEW = { groupBy: 'none', orderBy: 'updated', direction: 'desc', archivedFilter: 'default' }
const SEARCH_TABS = [
  { id: 'all', label: '全部' },
  { id: 'sessions', label: '会话' },
  { id: 'projects', label: '项目' },
  { id: 'automation', label: '自动化任务' },
  { id: 'actions', label: '操作' },
]

const SECTION_GROUP_OPTIONS = [
  { id: 'date', label: '日期' },
  { id: 'status', label: '状态' },
  { id: 'environment', label: '环境', disabled: true },
  { id: 'none', label: '无' },
]

/* 分屏视图 ------------------------------------------------------------------
 * 原生 main+rightbar 留在左/上屏；其余会话注册到 frame 的 `shell.overlay`，
 * 每个 overlay 包一层 SessionProvider，在 pane scope 下渲染完整原生
 * `main.conversation` 子 slot。不接管 main keyed 面板。
 */
const SPLIT_MAX_PANES = 4
const SPLIT_EDGE_RATIO = 0.72
const SPLIT_RETAIN_SOURCE = 'splitView'
const SPLIT_STORAGE_KEY = 'ct.splitView.v2'
const SPLIT_NATIVE_BOTTOM_SHARE = 0.5
const SPLIT_MIN_SHARE = 0.2
const SPLIT_MAX_SHARE = 0.8
const RIGHTBAR_SLOT = 'rightbar'
const RIGHTBAR_SESSION_SLOT = 'rightbar.session'
const RIGHTBAR_OVERLAY_WIDTH = 240
/** 分屏时右栏占该屏宽度的比例（Claude 的侧栏占比约四成）。
 * 分屏只决定「屏」的尺寸，屏内右栏按比例自适应，不再写死像素宽度。 */
const SPLIT_RIGHTBAR_SHARE = 0.4
/** 右栏在极窄屏上的防挤压下限（不是布局常量，只是保护）。 */
const SPLIT_RIGHTBAR_MIN = 180
const RIGHTBAR_GUIDE_KIND = 'guide'
const RIGHTBAR_GUIDE_ADDRESS = 'sidebar://guide'
/** 原生 conversation+rightbar 分屏：它是左/上屏，也是唯一带右侧栏的一屏。 */
const ROOT_CELL_ID = 'root'
/** 首次左右/上下分屏时原生屏保留的比例；右侧栏要在左屏里留下来。 */
const SPLIT_NATIVE_ROW_SHARE = 0.5
const SPLIT_NATIVE_COLUMN_SHARE = 0.5
/** DSH 主内容区的锚点；display:contents，需要向上找有尺寸的列容器。 */
const MAIN_SLOT_SELECTOR = '[data-slot="main"]'
const RIGHTBAR_SLOT_SELECTOR = '[data-slot="rightbar"]'

/* 原生侧栏壳适配 -------------------------------------------------------------
 * 0.2.2 运行时侧栏的结构（展开态）：
 *   [data-slot="sidebar"] > .sidebarCol > .root
 *     > .logoRow(品牌 + 折叠按钮) > button.newSession > nav.panelList
 *     > .regionArea > [data-slot="sidebar.workspaces"] > .ct-wb
 *     > .footArea
 * 新版把 panelList 收进 scrollRegion；这里统一打 data-ct-sidebar-* 标记，
 * CSS 只依赖标记，不依赖构建后的哈希类名。标记集中在本函数，升级时只改这里。
 */
const SIDEBAR_SEAT_SELECTOR = '[data-slot="sidebar.workspaces"]'
const SIDEBAR_SETTINGS_SELECTOR = '[data-slot="sidebar.settings"]'
const SIDEBAR_BRAND_SELECTOR = '[data-slot="sidebar.brand.mark"], [data-slot="sidebar.brand.name"]'
const SIDEBAR_COLLAPSED_WIDTH = 120
const SIDEBAR_MARK_ATTRIBUTES = [
  'data-ct-sidebar-root',
  'data-ct-sidebar-new',
  'data-ct-sidebar-panels',
  'data-ct-sidebar-foot',
  'data-ct-sidebar-logo',
  'data-ct-sidebar-toggle',
  'data-ct-sidebar-region',
  'data-ct-sidebar-scroll',
  'data-ct-sidebar-scrollarea',
  'data-ct-sidebar-scrollregion',
  'data-ct-sidebar-scrolled',
  'data-ct-sidebar-collapsed',
]

function normalizeSectionView(value) {
  const source = value !== null && typeof value === 'object' ? value : {}
  return {
    groupBy: SECTION_GROUP_OPTIONS.some((option) => option.id === source.groupBy && !option.disabled) ? source.groupBy : SECTION_DEFAULT_VIEW.groupBy,
    orderBy: ORDER_OPTIONS.some((option) => option.id === source.orderBy && !option.disabled) ? source.orderBy : SECTION_DEFAULT_VIEW.orderBy,
    direction: source.direction === 'asc' ? 'asc' : 'desc',
    archivedFilter: ARCHIVED_FILTERS.some((option) => option.id === source.archivedFilter) ? source.archivedFilter : SECTION_DEFAULT_VIEW.archivedFilter,
  }
}

/**
 * 读本地存储：新键优先，缺失时回退到更名前的旧键。
 * @param {string} key
 * @returns {string | null}
 */
function readStorage(key) {
  try {
    const value = window.localStorage.getItem(key)
    if (value !== null) return value
    if (!key.startsWith('ct.')) return null
    return window.localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${key.slice(3)}`)
  } catch {
    return null
  }
}

function loadViewState() {
  try {
    const saved = JSON.parse(readStorage(VIEW_STORAGE_KEY) ?? '{}')
    return {
      groupBy: GROUP_OPTIONS.some((option) => option.id === saved.groupBy && !option.disabled) ? saved.groupBy : DEFAULT_VIEW.groupBy,
      orderBy: ORDER_OPTIONS.some((option) => option.id === saved.orderBy && !option.disabled) ? saved.orderBy : DEFAULT_VIEW.orderBy,
      direction: saved.direction === 'asc' ? 'asc' : 'desc',
      archivedFilter: ARCHIVED_FILTERS.some((option) => option.id === saved.archivedFilter) ? saved.archivedFilter : DEFAULT_VIEW.archivedFilter,
    }
  } catch {
    return { ...DEFAULT_VIEW }
  }
}

function loadSections() {
  try {
    const value = JSON.parse(readStorage(SECTIONS_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    return value
      .filter((section) => section !== null && typeof section === 'object' && typeof section.id === 'string' && typeof section.workspaceId === 'string')
      .map((section) => ({
        id: section.id,
        workspaceId: section.workspaceId,
        title: typeof section.title === 'string' && section.title !== '' ? section.title : '新建部分',
        collapsed: section.collapsed === true,
        createdAt: Number.isFinite(section.createdAt) ? section.createdAt : Date.now(),
        updatedAt: Number.isFinite(section.updatedAt) ? section.updatedAt : Date.now(),
        sessionIds: Array.isArray(section.sessionIds) ? section.sessionIds.filter((id) => typeof id === 'string') : [],
        view: normalizeSectionView(section.view),
      }))
  } catch {
    return []
  }
}

function saveSections(sections) {
  try {
    window.localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(sections))
  } catch {
    /* 本地存储不可用时只保留内存状态 */
  }
}

function readPersistedDraftText(sessionId) {
  try {
    const raw = window.localStorage.getItem(`${CONVERSATION_DRAFT_STORAGE_PREFIX}${sessionId}`)
    if (raw === null) return ''
    const value = JSON.parse(raw)
    const draft = value?.draft
    if (typeof draft === 'string') return draft
    if (draft !== null && typeof draft === 'object' && typeof draft.text === 'string') return draft.text
  } catch {
    /* 草稿存储不可读时按空草稿处理 */
  }
  return ''
}

function clearPersistedDraft(sessionId) {
  try {
    const key = `${CONVERSATION_DRAFT_STORAGE_PREFIX}${sessionId}`
    const raw = window.localStorage.getItem(key)
    if (raw === null) return
    const value = JSON.parse(raw)
    value.draft = { text: '', references: [] }
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 清理失败不影响新建 */
  }
}

function saveViewState(view) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view))
  } catch {
    /* 本地存储不可用时只保留内存状态 */
  }
}

export const id = 'workspace-browser'

/* 右侧栏 surface：DSH 的 rightbar 是单个 root 列，但 rightbar 入口组件拿到的
 * renderSlot 绑定可以渲染其声明的 rightbar.session 子 slot。这里捕获该绑定，
 * 让每个 overlay 分屏也渲染一份真实、独立的右侧栏；同时为 overlay 会话抑制
 * 窗口级 layout 汇报，避免多个 seat 抢窗口右栏。这是内部适配，不是公开 API。 */
const rightbarSurfaceListeners = new Set()
let rightbarSurfaceSnapshot = null

/**
 * 两次捕获的右栏绑定是否等价。
 *
 * 入口组件每次 render 都会执行捕获 effect；renderSlot / SessionProvider 的引用
 * 不变就不该通知订阅者（SplitOverlay）。无差别通知会让 overlay 在入口每次
 * 渲染时同步重渲染，恢复分屏后叠成主线程长任务。
 * @param {any} left 上一次的快照
 * @param {any} right 新快照
 * @returns {boolean}
 */
function sameRightbarSurface(left, right) {
  if (left === right) return true
  if (left === null || right === null) return false
  return left.renderSlot === right.renderSlot && left.SessionProvider === right.SessionProvider
}

function setRightbarSurface(snapshot) {
  if (sameRightbarSurface(rightbarSurfaceSnapshot, snapshot)) return
  rightbarSurfaceSnapshot = snapshot
  for (const listener of [...rightbarSurfaceListeners]) listener()
}

function useRightbarSurface() {
  return React.useSyncExternalStore(
    React.useCallback((listener) => {
      rightbarSurfaceListeners.add(listener)
      return () => rightbarSurfaceListeners.delete(listener)
    }, []),
    () => rightbarSurfaceSnapshot,
  )
}

/* 原生 main.conversation 的入口绑定（不是捕获组件 props）。
 * main 入口的 renderSlot 可以渲染它声明的 main.conversation 子 slot；
 * 在 overlay 的 SessionProvider 下调用时，SlotOutlet 会按 pane scope 重新解析，
 * 因此拿到完整原生根（高度/flex/phase/滚动），而不是主屏捕获的 props。 */
const mainConversationListeners = new Set()
let mainConversationSnapshot = null

/**
 * 两次捕获的主会话绑定是否等价（renderSlot 引用不变就不通知）。
 * @param {any} left 上一次的快照
 * @param {any} right 新快照
 * @returns {boolean}
 */
function sameMainConversationSurface(left, right) {
  if (left === right) return true
  if (left === null || right === null) return false
  return left.renderSlot === right.renderSlot && left.SessionProvider === right.SessionProvider
}

function setMainConversationSurface(snapshot) {
  if (sameMainConversationSurface(mainConversationSnapshot, snapshot)) return
  mainConversationSnapshot = snapshot
  for (const listener of [...mainConversationListeners]) listener()
}

function useMainConversationSurface() {
  return React.useSyncExternalStore(
    React.useCallback((listener) => {
      mainConversationListeners.add(listener)
      return () => mainConversationListeners.delete(listener)
    }, []),
    () => mainConversationSnapshot,
  )
}

function installRightbarSurface(ctx, split) {
  const patched = new WeakSet()
  const patches = []
  const patch = () => {
    const mainEntry = ctx.slots.entries('main').find(entry => entry.options?.key === 'conversation')
    if (mainEntry !== undefined && !patched.has(mainEntry)) {
      patched.add(mainEntry)
      const originalComponent = mainEntry.component
      const Wrapper = function ClaudeThemeMainCapture(props) {
        // renderer 的 renderSlot 绑定是 identity-stable per entry，挂载时捕获一次即可。
        // 不能在每次 render 的 effect 里重新 set：入口重渲染会把订阅者（SplitOverlay）
        // 反复推起来，再叠加 rightbar/session 的更新就成同步重渲染环。
        const latest = React.useRef(props)
        latest.current = props
        React.useEffect(() => {
          setMainConversationSurface({
            renderSlot: latest.current.renderSlot,
            SessionProvider: latest.current.SessionProvider,
          })
        }, [])
        return h(originalComponent, props)
      }
      mainEntry.component = Wrapper
      patches.push({ entry: mainEntry, component: originalComponent, inject: mainEntry.inject })
    }
    const rightbarEntry = ctx.slots.entries(RIGHTBAR_SLOT)[0]
    if (rightbarEntry !== undefined && !patched.has(rightbarEntry)) {
      patched.add(rightbarEntry)
      const originalComponent = rightbarEntry.component
      const Wrapper = function ClaudeThemeRightbarCapture(props) {
        // 同上：renderSlot / SessionProvider 在入口生命周期内稳定，只捕获一次。
        const latest = React.useRef(props)
        latest.current = props
        React.useEffect(() => {
          setRightbarSurface({ renderSlot: latest.current.renderSlot, SessionProvider: latest.current.SessionProvider })
        }, [])
        return h(originalComponent, props)
      }
      rightbarEntry.component = Wrapper
      patches.push({ entry: rightbarEntry, component: originalComponent, inject: rightbarEntry.inject })
    }
    const seatEntry = ctx.slots.entries(RIGHTBAR_SESSION_SLOT)[0]
    if (seatEntry !== undefined && !patched.has(seatEntry)) {
      patched.add(seatEntry)
      const originalComponent = seatEntry.component
      const originalInject = seatEntry.inject
      const WrappedInject = (sessionId, actions) => {
        const face = originalInject?.(sessionId, actions) ?? {}
        // 统一会话壳：所有会话的右栏都在壳内按自己的 store 排布，不再由
        // 窗口级 layout 决定列宽。这些注入全是窗口级 controller，壳内必须
        // 断开，否则多个壳会互相抢同一个 rightbar 列。
        return {
          ...face,
          syncPresentation: () => {},
          reportAutoFullscreen: () => {},
          measureRoom: () => {},
          openTab: () => {},
          splitPane: () => {},
          toggleFullscreen: () => {},
        }
      }
      const Wrapper = function ClaudeThemeRightbarSeat(props) {
        const { sessionId, actions, openTab, useStore } = props
        const overlaySeat = split.isExtraSession(sessionId)
        const activeOverlaySeat = overlaySeat && props.active === true
        const surface = typeof useStore === 'function'
          ? useStore((state) => state.bySession[sessionId])
          : undefined
        const expanded = surface?.layout?.expanded === true
        const fullscreen = surface?.layout?.mode === 'fullscreen'
        const tabCount = activeOverlaySeat && surface !== undefined ? Object.keys(surface.layout.tabs ?? {}).length : -1
        const openGuide = React.useCallback((cellId) => {
          try {
            actions.openContent(sessionId, {
              kind: RIGHTBAR_GUIDE_KIND,
              contentId: RIGHTBAR_GUIDE_ADDRESS,
              title: '开始',
              cellId,
              revealIfOpened: false,
            }, () => {})
          } catch {
            /* 打不开 guide 时保留空右栏 */
          }
        }, [actions, sessionId])
        // actions/openGuide 是原生 seat 每次渲染新建的对象/闭包，不能放进 effect
        // 依赖：否则每次渲染都重新 open/openContent，store 同步通知又把 seat 推起来，
        // 分屏恢复时叠成同步重渲染环。这里用 ref 取最新值，只在 active/标签数变化时执行。
        const actionsRef = React.useRef(actions)
        actionsRef.current = actions
        const sessionIdRef = React.useRef(sessionId)
        sessionIdRef.current = sessionId
        const openGuideRef = React.useRef(openGuide)
        openGuideRef.current = openGuide
        React.useLayoutEffect(() => {
          if (!activeOverlaySeat) return
          try {
            // 只 materialize；展开状态完全使用该 session 自己的 rightbar 状态。
            actionsRef.current.open(sessionIdRef.current)
          } catch {
            /* overlay 右栏初始化失败时保留空位，不拖垮分屏 */
          }
        }, [activeOverlaySeat])
        React.useLayoutEffect(() => {
          if (activeOverlaySeat && tabCount === 0) openGuideRef.current()
        }, [activeOverlaySeat, tabCount])
        const patchedOpenTab = React.useCallback((kind, options) => {
          if (!activeOverlaySeat) {
            openTab(kind, options)
            return
          }
          // 窗口级 openTab 会作用到 mounted session；overlay 只允许重开自己的 guide。
          if (kind !== RIGHTBAR_GUIDE_KIND) return
          openGuide(options?.cellId)
        }, [activeOverlaySeat, openGuide, openTab])
        const patchedSplit = React.useCallback((cellId) => {
          if (!activeOverlaySeat) return
          try { actions.splitPane(sessionId, cellId) } catch { /* ignore */ }
        }, [actions, activeOverlaySeat, sessionId])
        const patchedFullscreen = React.useCallback(() => {
          if (!activeOverlaySeat) return
          try { actions.setMode(sessionId, fullscreen ? 'push' : 'fullscreen') } catch { /* ignore */ }
        }, [actions, activeOverlaySeat, fullscreen, sessionId])
        return h(originalComponent, {
          ...props,
          openTab: activeOverlaySeat ? patchedOpenTab : props.openTab,
          splitPane: activeOverlaySeat ? patchedSplit : props.splitPane,
          toggleFullscreen: activeOverlaySeat ? patchedFullscreen : props.toggleFullscreen,
        })
      }
      seatEntry.inject = WrappedInject
      seatEntry.component = Wrapper
      patches.push({ entry: seatEntry, component: originalComponent, inject: originalInject })
    }
  }
  patch()
  const stopMain = ctx.slots.subscribe('main', patch)
  const stopRightbar = ctx.slots.subscribe(RIGHTBAR_SLOT, patch)
  const stopSeat = ctx.slots.subscribe(RIGHTBAR_SESSION_SLOT, patch)
  return () => {
    stopMain()
    stopRightbar()
    stopSeat()
    for (const saved of patches) {
      if (saved.entry.component !== undefined) saved.entry.component = saved.component
      if (saved.inject !== undefined) saved.entry.inject = saved.inject
    }
    setRightbarSurface(null)
  }
}

/* overlay 右栏的开关状态不依赖 rightbar.session 的组件渲染。
 * 之前它挂在 rightbar.session 的 Wrapper effect 里，任何接管该 seat 渲染的插件
 * （conversation-side-panel）都会让 control 失效，导致分屏右栏宽度停在旧值。
 * 这里直接订阅每个 overlay 会话的右栏 store，和谁渲染无关。 */

/* ==== 会话壳网格 ==========================================================
 * 每个会话一个壳：壳内是完整原生会话 + 自己的右栏；分屏只决定壳的 rect。
 * 这里不再改 frame 的 grid，也不读写窗口级 rightbar 列。
 */

/**
 * 壳用会话引用：主壳会话由 split 的 rootSessionId 决定（单屏时回退到
 * mainView），不跟随窗口级选中会话——否则聚焦 overlay 时主壳会换成同一会话。
 */
function useRetainedSession(sessions, sessionId) {
  const [held, setHeld] = React.useState(undefined)
  React.useEffect(() => {
    if (typeof sessionId !== 'string' || sessionId === '') {
      setHeld(undefined)
      return undefined
    }
    let reference
    try {
      reference = sessions.retain(sessionId, { source: 'shell' })
    } catch {
      setHeld(undefined)
      return undefined
    }
    reference.ready?.catch?.(() => {})
    setHeld({ sessionId, reference })
    return () => {
      try { reference.release() } catch { /* 幂等 */ }
    }
  }, [sessions, sessionId])
  return held
}

/** 壳网格的纯几何：输入内容区尺寸与 split 快照，输出每个壳的 rect。 */
function computeShellRects(width, height, snapshot) {
  const contentW = Math.max(0, width)
  const contentH = Math.max(0, height)
  const visible = snapshot.visible === true && contentW > 0 && contentH > 0
  const mode = snapshot.mode === 'column' ? 'column' : 'row'
  const hasBottom = snapshot.bottomCellId !== null && snapshot.bottomCellId !== undefined
  const bottomShare = snapshot.bottomShare ?? SPLIT_NATIVE_BOTTOM_SHARE
  const nativeWidth = !visible
    ? contentW
    : mode === 'column' ? contentW : contentW * (snapshot.nativeShare ?? SPLIT_NATIVE_ROW_SHARE)
  const nativeHeight = !visible
    ? contentH
    : hasBottom
      ? contentH * (1 - bottomShare)
      : mode === 'row' ? contentH : contentH * (snapshot.columnShare ?? SPLIT_NATIVE_COLUMN_SHARE)
  const overlayRegion = mode === 'row'
    ? { x: nativeWidth, y: 0, w: Math.max(0, contentW - nativeWidth), h: contentH }
    : { x: 0, y: nativeHeight, w: contentW, h: Math.max(0, contentH - nativeHeight) }
  const overlays = new Map()
  if (visible && snapshot.extraTree !== null) {
    const rects = computeOverlayRects(
      snapshot.extraTree,
      overlayRegion.w,
      overlayRegion.h,
      new Map(),
      { x: 0, y: 0, w: overlayRegion.w, h: overlayRegion.h },
      bottomShare,
    )
    for (const [cellId, rect] of rects) {
      overlays.set(cellId, { x: overlayRegion.x + rect.x, y: overlayRegion.y + rect.y, w: rect.w, h: rect.h })
    }
  }
  return {
    native: { x: 0, y: 0, w: nativeWidth, h: nativeHeight },
    bottom: hasBottom && visible
      ? { x: 0, y: nativeHeight, w: nativeWidth, h: Math.max(0, contentH - nativeHeight) }
      : null,
    overlays,
    overlayRegion,
    contentW,
    contentH,
    mode,
    hasBottom,
    visible,
  }
}

class ShellErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error === null) return this.props.children
    return h('pre', {
      'data-ct-shell-error': String(this.state.error?.stack ?? this.state.error),
      style: { margin: 0, padding: 12, fontSize: 11, whiteSpace: 'pre-wrap', color: 'var(--dsw-alias-state-error-primary)' },
    }, String(this.state.error?.stack ?? this.state.error))
  }
}

/** 分屏分割线拖拽手柄：pointer capture，拖动时实时更新 shell cell 比例。 */
function SplitResizeHandle({ orientation, style, onDrag }) {
  const [dragging, setDragging] = React.useState(false)
  const draggingRef = React.useRef(false)
  const onMouseDown = (event) => {
    event.preventDefault()
    event.stopPropagation()
    draggingRef.current = true
    setDragging(true)
    onDrag(event)
    const onMove = (moveEvent) => {
      if (!draggingRef.current) return
      moveEvent.preventDefault()
      onDrag(moveEvent)
    }
    const onUp = () => {
      draggingRef.current = false
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  return h('div', {
    className: `ct-split-resizer${dragging ? ' is-dragging' : ''}`,
    'data-orientation': orientation,
    style,
    onMouseDown,
  })
}

/** 壳网格：只决定每个壳的位置和大小，不参与任何屏内状态。 */
function ShellGrid({ surface, split, sessions, fallback }) {
  const snapshot = useStore(split.store)
  const sessionSnap = useStore(sessions.list)
  const mainViewId = sessionSnap.ids.find((id) => (sessionSnap.byId[id]?.retainedBy?.mainView ?? 0) > 0)
  const nativeId = snapshot.visible && typeof snapshot.rootSessionId === 'string'
    ? snapshot.rootSessionId
    : mainViewId
  const held = useRetainedSession(sessions, nativeId)
  // 归档会让会话引用立即失效，而 useRetainedSession 的 state 要到 effect 之后才清空：
  // 中间这一帧如果把旧 reference 交给 SessionProvider，原生 ScopeArea 会在渲染时抛
  // "Session reference ... is released"。只在 held 与当前 nativeId 一致时挂壳。
  const main = held !== undefined && held.sessionId === nativeId ? held : undefined
  const rootRef = React.useRef(null)
  const [box, setBox] = React.useState({ w: 0, h: 0 })
  React.useLayoutEffect(() => {
    const element = rootRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return undefined
    const update = () => setBox({ w: element.clientWidth, h: element.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const geometry = React.useMemo(() => computeShellRects(box.w, box.h, snapshot), [box.w, box.h, snapshot])
  const shells = []
  if (main !== undefined) {
    shells.push({
      key: main.sessionId,
      cellId: ROOT_CELL_ID,
      sessionId: main.sessionId,
      reference: main.reference,
      rect: geometry.native,
      focused: !snapshot.visible || snapshot.focusedCellId === ROOT_CELL_ID,
    })
  }
  if (snapshot.visible && geometry.bottom !== null) {
    const record = split.cell(snapshot.bottomCellId)
    if (record !== undefined) {
      shells.push({
        key: record.cellId,
        cellId: record.cellId,
        sessionId: record.sessionId,
        reference: record.reference,
        rect: geometry.bottom,
        focused: snapshot.focusedCellId === record.cellId,
      })
    }
  }
  if (snapshot.visible) {
    for (const leaf of collectSplitLeaves(snapshot.extraTree)) {
      const record = split.cell(leaf.cellId)
      const rect = geometry.overlays.get(leaf.cellId)
      if (record === undefined || rect === undefined) continue
      shells.push({
        key: record.cellId,
        cellId: record.cellId,
        sessionId: record.sessionId,
        reference: record.reference,
        rect,
        focused: snapshot.focusedCellId === record.cellId,
      })
    }
  }

  const handles = []
  if (snapshot.visible && box.w > 0) {
    const native = geometry.native
    const localRect = () => rootRef.current?.getBoundingClientRect() ?? null
    if (snapshot.mode === 'row' && snapshot.extraTree !== null) {
      handles.push(h(SplitResizeHandle, {
        key: 'resize-native',
        orientation: 'vertical',
        style: { left: `${native.w - 3}px`, top: 0, height: `${geometry.contentH}px` },
        onDrag: (event) => {
          const rect = localRect()
          if (rect !== null) split.setShare('native', (event.clientX - rect.left) / geometry.contentW)
        },
      }))
    }
    if (snapshot.bottomCellId !== null && snapshot.bottomCellId !== undefined) {
      handles.push(h(SplitResizeHandle, {
        key: 'resize-bottom',
        orientation: 'horizontal',
        style: { left: 0, top: `${native.h - 3}px`, width: `${native.w}px` },
        onDrag: (event) => {
          const rect = localRect()
          if (rect !== null) split.setShare('bottom', 1 - (event.clientY - rect.top) / geometry.contentH)
        },
      }))
    } else if (snapshot.mode === 'column' && snapshot.extraTree !== null) {
      handles.push(h(SplitResizeHandle, {
        key: 'resize-column',
        orientation: 'horizontal',
        style: { left: 0, top: `${native.h - 3}px`, width: `${geometry.contentW}px` },
        onDrag: (event) => {
          const rect = localRect()
          if (rect !== null) split.setShare('column', (event.clientY - rect.top) / geometry.contentH)
        },
      }))
    }
    if (snapshot.extraTree !== null && snapshot.extraTree.type === 'split' && snapshot.extraTree.direction === 'column' && snapshot.extraTree.children.length === 2) {
      const region = geometry.overlayRegion
      const share = snapshot.bottomShare ?? SPLIT_NATIVE_BOTTOM_SHARE
      const y = region.y + region.h * (1 - share)
      handles.push(h(SplitResizeHandle, {
        key: 'resize-overlay-column',
        orientation: 'horizontal',
        style: { left: `${region.x}px`, top: `${y - 3}px`, width: `${region.w}px` },
        onDrag: (event) => {
          const rect = localRect()
          if (rect !== null) split.setShare('bottom', 1 - (event.clientY - rect.top - region.y) / region.h)
        },
      }))
    }
  }

  if (shells.length === 0) {
    // 没有主壳（例如归档当前会话后原生 clearMain 清掉 mainView、冷启动还没有
    // 选中会话）：把主区交还原生 main.conversation 入口。它会按 session-maybe
    // 渲染「新会话」hero，而不是留一块空白。
    return h('div', {
      ref: rootRef,
      className: 'ct-shell-grid',
      'data-ct-shell-grid': true,
      'data-ct-shell-empty': true,
    }, typeof fallback === 'function' ? fallback() : null)
  }

  return h('div', { ref: rootRef, className: 'ct-shell-grid', 'data-ct-shell-grid': true },
    shells.map((shell) => h('div', {
      key: shell.key,
      className: 'ct-shell-cell',
      'data-ct-shell-cell': shell.cellId,
      'data-ct-shell-focused': shell.focused || undefined,
      'data-ct-shell-edge-x': shell.rect.x > 0 || undefined,
      'data-ct-shell-edge-y': shell.rect.y > 0 || undefined,
      'data-ct-shell-native-bottom': shell.rect === geometry.bottom ? '' : undefined,
      style: {
        left: `${shell.rect.x}px`,
        top: `${shell.rect.y}px`,
        width: `${shell.rect.w}px`,
        height: `${shell.rect.h}px`,
      },
      onPointerDownCapture: () => split.focusPane(shell.cellId),
    }, h(ShellCellSessionContext.Provider, { value: shell.sessionId },
      h(SessionShell, {
        sessionId: shell.sessionId,
        reference: shell.reference,
        SessionProvider: surface?.SessionProvider,
        mainSurface: surface,
        rightbarSurface: surface?.rightbar ?? null,
      })))),
    handles)
}

/**
 * 接管 main 的 `conversation` 入口：会话视图（panelId === null）渲染壳网格；
 * 插件页 / 查看全部等其它 key 的 main 入口不受影响。
 */
function installMainShell(ctx, split, services) {
  const patched = new WeakSet()
  const patches = []
  const patch = () => {
    const mainEntry = ctx.slots.entries('main').find((entry) => entry.options?.key === 'conversation')
    if (mainEntry === undefined || patched.has(mainEntry)) return
    patched.add(mainEntry)
    const originalComponent = mainEntry.component
    const Wrapper = function ClaudeThemeShellRoot(props) {
      const rightbar = useRightbarSurface()
      const latest = React.useRef(props)
      latest.current = props
      React.useEffect(() => {
        setMainConversationSurface({
          renderSlot: latest.current.renderSlot,
          SessionProvider: latest.current.SessionProvider,
        })
      }, [])
      const surface = React.useMemo(() => ({
        renderSlot: props.renderSlot,
        SessionProvider: props.SessionProvider,
        rightbar: rightbar === null || rightbar === undefined
          ? null
          : { renderSlot: rightbar.renderSlot, SessionProvider: rightbar.SessionProvider },
      }), [props.renderSlot, props.SessionProvider, rightbar])
      return h(ShellErrorBoundary, null, h(ShellGrid, {
        surface,
        split,
        sessions: services.sessions,
        // 空壳网格（没有主壳会话）时回退到原生主面板：归档当前会话后
        // DSH 会 clearMain，原生在这里显示「新会话」界面，不能被我们吞掉。
        fallback: () => h(originalComponent, props),
      }))
    }
    mainEntry.component = Wrapper
    patches.push({ entry: mainEntry, component: originalComponent, wrapper: Wrapper })
  }
  patch()
  const stop = ctx.slots.subscribe('main', patch)
  return () => {
    stop()
    for (const saved of patches) {
      if (saved.entry.component === saved.wrapper) saved.entry.component = saved.component
    }
  }
}

/* 关闭按钮挂在原生 session header 的 corner，位置在 header 右上角（最右）。
 * 由分屏壳功能提供，只在分屏时出现；单屏保留原生右栏开关，不显示关闭。 */
const ShellCellSessionContext = React.createContext(null)

function HeaderCloseButton({ sessionId, split }) {
  const visible = React.useSyncExternalStore(
    split.store.subscribe,
    () => split.store.getSnapshot().visible,
  )
  if (!visible) return null
  // 壳内 header 的 SessionProvider 已经给出该壳的会话；context 作为兜底。
  const paneSessionId = React.useContext(ShellCellSessionContext)
  const targetSessionId = paneSessionId ?? sessionId
  return h(Tooltip, {
    label: '关闭会话',
    side: 'bottom',
    delayMs: 400,
    portal: true,
  }, h('button', {
    type: 'button',
    className: 'ct-split-pane-close',
    'aria-label': '关闭会话',
    'data-ct-split-pane-close': '',
    onClick: (event) => {
      event.stopPropagation()
      try { split.closeSession(targetSessionId) } catch { /* ignore */ }
    },
  }, '×'))
}

function installHeaderClose(ctx, split) {
  const patched = new WeakSet()
  const patches = []
  const patch = () => {
    const corner = ctx.slots.entries('conversation.session.header.corner')[0]
    if (corner === undefined || patched.has(corner)) return
    patched.add(corner)
    const original = corner.component
    const Wrapper = function ClaudeThemeHeaderClose(props) {
      return h(
        React.Fragment,
        null,
        h(original, props),
        h(HeaderCloseButton, { ...props, split }),
      )
    }
    corner.component = Wrapper
    patches.push({ entry: corner, component: original, wrapper: Wrapper, inject: corner.inject })
  }
  patch()
  const stop = ctx.slots.subscribe('conversation.session.header.corner', patch)
  return () => {
    stop()
    for (const saved of patches) {
      // 只恢复自己打的补丁：热重载时新实例可能已经先包了一层，
      // 无条件写回会把新包装覆盖掉，header 关闭按钮/右栏行为就丢了。
      if (saved.entry.component === saved.wrapper) saved.entry.component = saved.component
      if (saved.inject !== undefined) saved.entry.inject = saved.inject
    }
  }
}

/**
 * 给原生侧栏壳打标记：根、品牌行、新建、面板列表、区域、底部。
 * 只做标记，不改 DOM 结构；样式全部在 workspace-browser.css 里按标记生效。
 * @returns {() => void} teardown
 */
function installSidebarShell() {
  let disposed = false
  let frame = 0
  let resize = null
  let observedRoot = null
  let scrollWrapper = null

  // 滚动容器的上下沿状态：顶部在离开 0 之后才画分隔条，底部始终画。
  // 这里只盯真正的滚动容器，分组/会话行本身不参与判断，任何侧栏内容滚起来都适用。
  const syncScrollEdge = () => {
    if (scrollWrapper === null || !scrollWrapper.isConnected) return
    const root = scrollWrapper.closest('[data-ct-sidebar-root]')
    if (root === null) return
    const scrolled = scrollWrapper.scrollTop > 0
    if (root.hasAttribute('data-ct-sidebar-scrolled') !== scrolled) {
      root.toggleAttribute('data-ct-sidebar-scrolled', scrolled)
    }
  }

  const attachScrollWrapper = (wrapper) => {
    if (scrollWrapper === wrapper) {
      syncScrollEdge()
      return
    }
    scrollWrapper?.removeEventListener('scroll', syncScrollEdge)
    scrollWrapper = wrapper
    scrollWrapper.addEventListener('scroll', syncScrollEdge, { passive: true })
    syncScrollEdge()
  }

  const restoreWrapper = () => {
    const wrapper = document.querySelector('[data-ct-sidebar-scroll]')
    if (wrapper === null) return
    const parent = wrapper.parentElement
    if (parent === null) {
      wrapper.remove()
      return
    }
    // 插件卸载时把中间内容放回侧栏根，原生布局完整恢复。
    for (const child of [...wrapper.children]) parent.insertBefore(child, wrapper)
    wrapper.remove()
  }

  const decorate = () => {
    if (disposed) return
    const seat = document.querySelector(SIDEBAR_SEAT_SELECTOR)
    // 只有本插件的工作区列表已经渲染时才接管原生壳；插件没跑（slot 注册失败/
    // 服务缺失）时侧栏保持原生，符合“功能可摘除”。
    if (seat === null || seat.querySelector('.ct-wb') === null) return
    // 根：从座位向上找侧栏列；跳过我们自己的中间滚动容器（它也有按钮）。
    let root = seat.parentElement
    while (
      root !== null
      && root !== document.body
      && (root.hasAttribute('data-ct-sidebar-scroll')
        || ![...root.children].some((child) => child.tagName === 'BUTTON' || child.tagName === 'NAV' || child.hasAttribute('data-ct-sidebar-scroll')))
    ) {
      root = root.parentElement
    }
    if (root === null || root === document.body) return
    for (const other of document.querySelectorAll('[data-ct-sidebar-root]')) {
      if (other !== root) {
        other.removeAttribute('data-ct-sidebar-root')
        other.removeAttribute('data-ct-sidebar-scrolled')
      }
    }
    root.setAttribute('data-ct-sidebar-root', '')

    // 重新查找时兼容「已包装」与「被 React 移回 root」两种位置。
    const newSession = root.querySelector('[data-ct-sidebar-new]') ?? root.querySelector(':scope > button')
    const panels = root.querySelector('[data-ct-sidebar-panels]') ?? root.querySelector(':scope > nav')
    const region = seat.parentElement
    // 品牌行：桌面端折叠态的品牌图标也走 sidebar.brand.mark slot，但它嵌在
    // 折叠按钮里（rail 图标）。不能把它的容器（macOS 的 topStrip）当成品牌行，
    // 否则 topStrip 会被打上 logo 标记，展开态按「删掉 logo」的样式被隐藏，
    // 顶部 header 连同交通灯让位一起消失。
    const brand = root.querySelector(SIDEBAR_BRAND_SELECTOR)
    const brandInToggle = brand !== null && brand.closest('[data-sidebar-toggle]') !== null
    const logoRow = brand === null || brandInToggle ? null : (brand.closest('[data-window-drag]') ?? brand.parentElement)
    const settingsSeat = root.querySelector(SIDEBAR_SETTINGS_SELECTOR)
    let foot = settingsSeat
    while (foot !== null && foot.parentElement !== root) foot = foot.parentElement
    if (foot === root) foot = null

    // 中间滚动容器：header 与底部在它外面，滚动区域天然排除头尾。
    let wrapper = root.querySelector(':scope > [data-ct-sidebar-scroll]')
    if (wrapper === null) {
      wrapper = document.createElement('div')
      wrapper.setAttribute('data-ct-sidebar-scroll', '')
      if (logoRow !== null && logoRow.parentElement === root) logoRow.after(wrapper)
      else root.prepend(wrapper)
    }
    const desired = [newSession, panels, region].filter((node) => node !== null && node !== undefined)
    const children = [...wrapper.children]
    const ordered = desired.length === children.length && desired.every((node, index) => children[index] === node)
    if (!ordered) {
      for (const node of desired) wrapper.appendChild(node)
    }
    attachScrollWrapper(wrapper)

    if (newSession !== null && newSession !== undefined) newSession.setAttribute('data-ct-sidebar-new', '')
    if (panels !== null && panels !== undefined) panels.setAttribute('data-ct-sidebar-panels', '')
    if (region !== null && region !== undefined) region.setAttribute('data-ct-sidebar-region', '')
    if (foot !== null) foot.setAttribute('data-ct-sidebar-foot', '')
    // 折叠/展开会在「品牌行」与「rail 图标」之间切换，旧标记留在别的元素上
    // 会在展开态按空品牌行隐藏它；只保留当前品牌行的标记。
    for (const other of root.querySelectorAll('[data-ct-sidebar-logo]')) {
      if (other !== logoRow) other.removeAttribute('data-ct-sidebar-logo')
    }
    if (logoRow !== null && root.contains(logoRow) && logoRow.tagName === 'DIV') {
      const toggle = [...logoRow.querySelectorAll('button')].find((button) => !button.contains(brand))
      if (toggle !== undefined) toggle.setAttribute('data-ct-sidebar-toggle', '')
      logoRow.setAttribute('data-ct-sidebar-logo', toggle === undefined ? 'empty' : 'toggle')
    }
    // 新版 DSH：scrollArea 自己滚动，需要一起解除。
    const scrollArea = root.querySelector('[data-sidebar-scrollport]')
    if (scrollArea !== null) {
      scrollArea.setAttribute('data-ct-sidebar-scrollarea', '')
      scrollArea.parentElement?.setAttribute('data-ct-sidebar-scrollregion', '')
    }
    // 折叠态（56px rail）保持原生布局；展开态才用中间滚动容器和统一行样式。
    root.setAttribute('data-ct-sidebar-collapsed', root.getBoundingClientRect().width < SIDEBAR_COLLAPSED_WIDTH ? 'true' : 'false')
    if (root !== observedRoot) {
      resize?.disconnect()
      observedRoot = root
      resize = new ResizeObserver(() => { schedule() })
      resize.observe(root)
    }
  }

  const schedule = () => {
    if (disposed || frame !== 0) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      decorate()
    })
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  schedule()

  return () => {
    disposed = true
    observer.disconnect()
    resize?.disconnect()
    scrollWrapper?.removeEventListener('scroll', syncScrollEdge)
    scrollWrapper = null
    if (frame !== 0) window.cancelAnimationFrame(frame)
    restoreWrapper()
    for (const element of document.querySelectorAll(SIDEBAR_MARK_ATTRIBUTES.map((name) => `[${name}]`).join(','))) {
      for (const name of SIDEBAR_MARK_ATTRIBUTES) element.removeAttribute(name)
    }
  }
}

/**
 * @param {any} ctx client root context
 * @returns {() => void}
 */
export function install(ctx) {
  if (document.getElementById('ct-workspace-browser') === null) {
    const style = document.createElement('style')
    style.id = 'ct-workspace-browser'
    style.textContent = browserCss
    document.head.appendChild(style)
  }

  // 原生侧栏壳的标记独立于服务注入：即使数据服务还没就绪，也要先就位。
  let disposeSidebarShell = () => {}
  try {
    disposeSidebarShell = installSidebarShell()
  } catch (error) {
    console.warn('claude-code-mode: sidebar shell adapter unavailable', error)
  }

  const dispose = ctx.inject(['slots', 'sessions', 'workspaces', 'uiWorkspace', 'layout', 'conversation', 'remote.schedule', 'sidebarRight'], (scope) => {
    const services = {
      sessions: scope.get('sessions'),
      workspaces: scope.get('workspaces'),
      ui: scope.get('uiWorkspace'),
      layout: scope.get('layout'),
      conversation: scope.get('conversation'),
      remote: scope.get('remote.schedule'),
    }
    // 分屏控制器先于组件创建：侧栏拖拽、右键入口和 overlay 分屏共享同一份会话引用。
    // 分屏是 `split-view` 开关控制的子能力：关掉时用占位控制器，主区保持原生单屏。
    const splitEnabled = isFeatureEnabled('split-view')
    const split = splitEnabled ? createSplitController(services) : createDisabledSplit(services)
    let disposeRightbarSurface = () => {}
    let disposeHeaderClose = () => {}
    let disposeMainShell = () => {}
    if (splitEnabled) {
      try {
        disposeRightbarSurface = installRightbarSurface(scope, split)
      } catch (error) {
        console.warn('claude-code-mode: native surface adapter unavailable', error)
      }
      try {
        disposeMainShell = installMainShell(scope, split, services)
      } catch (error) {
        console.warn('claude-code-mode: session shell unavailable', error)
      }
      try {
        disposeHeaderClose = installHeaderClose(scope, split)
      } catch (error) {
        console.warn('claude-code-mode: split cell close unavailable', error)
      }
    }
    const Browser = createBrowser({ ...services, split })
    const SessionsPanel = createSessionsPanel(services)
    const disposeSidebar = scope.slots.inject('sidebar.workspaces', () =>
      scope.slots.register({ name: 'sidebar.workspaces', priority: -100 }, Browser),
    )
    const disposePanel = scope.slots.inject('main', () =>
      scope.slots.register({ name: 'main', key: 'ct-sessions' }, SessionsPanel),
    )
    // 会话视图由会话壳网格接管（main 的 conversation key）；分屏只决定壳的
    // rect，不再使用 shell.overlay 的绝对定位叠加，也不再改 frame 的 grid。
    if (splitEnabled) {
      split.restoreFromStorage()
    } else {
      // 分屏关掉时清掉持久化布局：重新打开分屏从单屏开始，而不是恢复旧的多屏。
      try { window.localStorage.removeItem(SPLIT_STORAGE_KEY) } catch { /* ignore */ }
    }
    return () => {
      disposeSidebar()
      disposePanel()
      disposeMainShell()
      disposeRightbarSurface()
      disposeHeaderClose()
      split.dispose()
    }
  })

  return () => {
    if (typeof dispose === 'function') dispose()
    disposeSidebarShell()
    document.getElementById('ct-workspace-browser')?.remove()
  }
}

function createSessionsPanel({ sessions, workspaces, ui, layout }) {
  const sessionsStore = sessions.list
  const workspacesStore = workspaces.list

  return function SessionsPanel() {
    const sessionSnap = useStore(sessionsStore)
    const workspaceSnap = useStore(workspacesStore)
    const now = useNow()
    const [tab, setTab] = React.useState('active')
    const [query, setQuery] = React.useState('')
    const archivedIds = React.useMemo(() => new Set(workspaceSnap.archivedSessionIds ?? []), [workspaceSnap.archivedSessionIds])
    const currentId = sessionSnap.ids.find((id) => (sessionSnap.byId[id]?.retainedBy?.mainView ?? 0) > 0)
    const labelById = React.useMemo(() => {
      const labels = new Map()
      for (const workspace of workspaceSnap.items ?? []) {
        for (const sessionId of workspace.sessionIds ?? []) labels.set(sessionId, workspace.title || basename(workspace.path ?? ''))
      }
      return labels
    }, [workspaceSnap])
    const rows = React.useMemo(() => {
      const q = query.trim().toLowerCase()
      return sessionSnap.ids
        .map((id) => sessionSnap.byId[id])
        .filter((summary) => summary !== undefined && !summary.blank)
        .filter((summary) => (tab === 'archived' ? archivedIds.has(summary.id) : !archivedIds.has(summary.id)))
        .filter((summary) => q === '' || `${summary.title ?? ''} ${labelById.get(summary.id) ?? ''}`.toLowerCase().includes(q))
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    }, [sessionSnap, archivedIds, tab, query, labelById])

    useMissingSessionTitles(sessions, rows)

    const close = () => layout.selectPanel(null)
    const open = (summary) => {
      layout.selectPanel(null)
      ui.openSession(summary.id)
    }
    const start = () => {
      const workspace = workspaceSnap.items?.find((item) => item.workspaceId !== undefined)
      layout.selectPanel(null)
      if (workspace !== undefined) ui.startSession(workspace.workspaceId)
      else ui.startSession()
    }

    return h(
      'div',
      { className: 'ct-sessions-page' },
      h(
        'header',
        { className: 'ct-sessions-head' },
        h('h1', null, '会话'),
        h(Tooltip, {
          label: '关闭',
          side: 'bottom',
          delayMs: 400,
          portal: true,
        }, h('button', { type: 'button', className: 'ct-sessions-close', 'aria-label': '关闭会话列表', onClick: close }, '×')),
      ),
      h(
        'div',
        { className: 'ct-sessions-toolbar' },
        h(
          'div',
          { className: 'ct-sessions-tabs', role: 'tablist' },
          h('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'active', className: `ct-sessions-tab${tab === 'active' ? ' is-active' : ''}`, onClick: () => setTab('active') }, '活跃'),
          h('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'archived', className: `ct-sessions-tab${tab === 'archived' ? ' is-active' : ''}`, onClick: () => setTab('archived') }, '已归档'),
        ),
        h('input', {
          className: 'ct-sessions-search',
          type: 'search',
          placeholder: '搜索会话',
          value: query,
          onChange: (event) => setQuery(event.target.value),
          'aria-label': '搜索会话',
        }),
        h('button', { type: 'button', className: 'ct-sessions-new', onClick: start }, '新建会话'),
      ),
      h(
        'div',
        { className: 'ct-sessions-list', role: 'list' },
        rows.length === 0
          ? h('div', { className: 'ct-sessions-empty' }, query === '' ? (tab === 'archived' ? '暂无已归档会话' : '暂无会话') : '没有匹配的会话')
          : rows.map((summary) =>
              h(
                'button',
                {
                  key: summary.id,
                  type: 'button',
                  role: 'listitem',
                  className: `ct-sessions-item${summary.id === currentId ? ' is-current' : ''}`,
                  onClick: () => open(summary),
                },
                h('span', { className: 'ct-sessions-item-main' }, sessionTitle(summary)),
                h('span', { className: 'ct-sessions-item-workspace' }, labelById.get(summary.id) ?? basename(summary.cwd ?? '')),
                h('span', { className: 'ct-sessions-item-time' }, formatTime(summary.updatedAt, now)),
              ),
            ),
      ),
    )
  }
}

function createBrowser({ sessions, workspaces, ui, layout, conversation, remote, split }) {
  const sessionsStore = sessions.list
  const workspacesStore = workspaces.list

  return function WorkspaceBrowser(props) {
    const useSessionStatus = props?.useSessionStatus
    const renderSlot = props?.renderSlot
    const rawSessionSnap = useStore(sessionsStore)
    const workspaceSnap = useStore(workspacesStore)
    const splitSnap = useStore(split.store)
    const statusSnapshot = typeof useSessionStatus === 'function' ? useSessionStatus((snapshot) => snapshot) : null
    const [createdAtById, setCreatedAtById] = React.useState(() => new Map())
    const [lineageParentById, setLineageParentById] = React.useState(() => new Map())

    React.useEffect(() => {
      let active = true
      const load = async () => {
        try {
          const response = await fetch('/claude-code-mode/lineage.json', { cache: 'no-store' })
          if (!response.ok) return
          const value = await response.json()
          if (!active || !Array.isArray(value?.items)) return
          const nextCreatedAt = new Map()
          const nextParents = new Map()
          for (const item of value.items) {
            if (item === null || typeof item !== 'object' || typeof item.id !== 'string') continue
            if (Number.isFinite(item.createdAt)) nextCreatedAt.set(item.id, item.createdAt)
            if (typeof item.parent === 'string' && item.parent !== '') nextParents.set(item.id, item.parent)
          }
          setCreatedAtById(nextCreatedAt)
          setLineageParentById(nextParents)
        } catch {
          /* 创建日期拿不到时排序回退到更新时间 */
        }
      }
      load()
      const timer = window.setInterval(load, 15_000)
      return () => {
        active = false
        window.clearInterval(timer)
      }
    }, [])
    // DSH 0.2.2 的普通 fork 不再写 header.parentSession；宿主已补回新 fork，
    // 并对历史分叉返回 parent。客户端只给缺少 parentId 的条目补上，原生数据优先。
    const sessionSnap = React.useMemo(
      () => applyLineageParents(rawSessionSnap, lineageParentById),
      [rawSessionSnap, lineageParentById],
    )
    // 桌面端与 dsh web 是两个宿主进程，各自持有自己的 sessions/workspaces 内存快照；
    // 另一进程新建的会话不会通过事件推过来，只能主动向本进程宿主拉一次基线。
    React.useEffect(() => {
      if (typeof sessions.refresh !== 'function') return undefined
      const refresh = () => {
        try {
          const result = sessions.refresh()
          if (result !== null && typeof result === 'object' && typeof result.catch === 'function') result.catch(() => {})
        } catch {
          /* 刷新失败保持当前快照 */
        }
      }
      const onVisibility = () => {
        if (document.visibilityState === 'visible') refresh()
      }
      window.addEventListener('focus', refresh)
      document.addEventListener('visibilitychange', onVisibility)
      const timer = window.setInterval(refresh, 30_000)
      return () => {
        window.removeEventListener('focus', refresh)
        document.removeEventListener('visibilitychange', onVisibility)
        window.clearInterval(timer)
      }
    }, [sessions])
    const now = useNow()
    const [expandedGroups, setExpandedGroups] = React.useState(null)
    const [collapsedBranches, setCollapsedBranches] = React.useState(() => new Set())
    const initialView = React.useMemo(loadViewState, [])
    const [groupBy, setGroupBy] = React.useState(initialView.groupBy)
    const [orderBy, setOrderBy] = React.useState(initialView.orderBy)
    const [direction, setDirection] = React.useState(initialView.direction)
    const [archivedFilter, setArchivedFilter] = React.useState(initialView.archivedFilter)
    const [viewMenu, setViewMenu] = React.useState(null)
    const [viewSubmenu, setViewSubmenu] = React.useState(null)
    const [sections, setSections] = React.useState(loadSections)
    const [sectionMenu, setSectionMenu] = React.useState(null)
    const [groupMenu, setGroupMenu] = React.useState(null)
    const [dialog, setDialog] = React.useState(null)
    const dialogInputRef = React.useRef(null)
    const newSessionRef = React.useRef(() => {})
    const lastDraftBlankRef = React.useRef(null)
    const draftAttachmentCache = React.useRef(new Map())
    const pendingSectionRef = React.useRef(null)
    const [sectionDropId, setSectionDropId] = React.useState(null)
    const [searchOpen, setSearchOpen] = React.useState(false)
    const [searchTab, setSearchTab] = React.useState('all')
    const [searchSelection, setSearchSelection] = React.useState(0)
    const [automationTasks, setAutomationTasks] = React.useState([])
    const [query, setQuery] = React.useState('')
    const searchInputRef = React.useRef(null)
    const [remoteSearch, setRemoteSearch] = React.useState({ query: '', status: 'idle', items: [], hasMore: false })
    const [menu, setMenu] = React.useState(null)
    const [workspaceMenu, setWorkspaceMenu] = React.useState(null)
    const [hoverCard, setHoverCard] = React.useState(null)
    const [dragState, setDragState] = React.useState(null)
    const [splitDrop, setSplitDrop] = React.useState(null)
    const [groupDropKey, setGroupDropKey] = React.useState(null)
    const [workspaceDrop, setWorkspaceDrop] = React.useState(null)
    const [dragHint, setDragHint] = React.useState(null)
    const [listDropActive, setListDropActive] = React.useState(false)
    const dragHintRef = React.useRef('')
    const [pinDropActive, setPinDropActive] = React.useState(false)
    const hoverTimer = React.useRef(0)
    const [toast, setToast] = React.useState('')

    const sessionMenuState = React.useMemo(
      () => [menu !== null, (open) => { if (!open) setMenu(null) }],
      [menu],
    )

    const showToast = React.useCallback((message) => {
      setToast(message)
      window.clearTimeout(showToast.timer)
      showToast.timer = window.setTimeout(() => setToast(''), 2600)
    }, [])

    React.useEffect(() => () => window.clearTimeout(showToast.timer), [showToast])

    React.useEffect(() => {
      saveViewState({ groupBy, orderBy, direction, archivedFilter })
    }, [groupBy, orderBy, direction, archivedFilter])

    React.useEffect(() => {
      saveSections(sections)
    }, [sections])

    React.useEffect(() => {
      if (dialog?.type !== 'text') return undefined
      const frame = window.requestAnimationFrame(() => dialogInputRef.current?.focus())
      return () => window.cancelAnimationFrame(frame)
    }, [dialog])

    React.useEffect(() => {
      if (dialog === null) return undefined
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          setDialog(null)
        }
      }
      window.addEventListener('keydown', onKeyDown, true)
      return () => window.removeEventListener('keydown', onKeyDown, true)
    }, [dialog])

    const openTextDialog = (config) => {
      setDialog({ type: 'text', value: '', placeholder: '', confirmLabel: '确定', ...config })
    }

    const openConfirmDialog = (config) => {
      setDialog({ type: 'confirm', confirmLabel: '确定', danger: false, ...config })
    }

    const submitDialog = () => {
      if (dialog === null) return
      if (dialog.type === 'text') {
        const value = dialog.value.trim()
        if (value === '') return
        const submit = dialog.onSubmit
        setDialog(null)
        submit(value)
        return
      }
      const confirm = dialog.onConfirm
      setDialog(null)
      confirm()
    }


    const clearHover = React.useCallback(() => {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = 0
      setHoverCard(null)
    }, [])

    const scheduleHover = React.useCallback((summary, workspace, element) => {
      if (menu !== null || workspaceMenu !== null || dragState !== null) return
      window.clearTimeout(hoverTimer.current)
      const rect = element.getBoundingClientRect()
      hoverTimer.current = window.setTimeout(() => {
        const top = Math.max(8, Math.min(rect.top, window.innerHeight - 180))
        const left = Math.min(rect.right + 8, window.innerWidth - 308)
        setHoverCard({ summary, workspace, top, left })
      }, 700)
    }, [menu, workspaceMenu, dragState])

    React.useEffect(() => () => window.clearTimeout(hoverTimer.current), [])
    React.useEffect(() => {
      if (menu !== null || workspaceMenu !== null) clearHover()
    }, [menu, workspaceMenu, clearHover])


    React.useEffect(() => {
      if (menu === null && workspaceMenu === null && viewMenu === null && sectionMenu === null && groupMenu === null) return undefined
      const onPointerDown = (event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        if (target.closest('.ct-wb-menu') !== null) return
        if (target.closest('[data-ct-wb-popup-anchor]') !== null) return
        if (target.closest('[data-ct-wb-view-trigger]') !== null) return
        if (target.closest('[data-ct-wb-session-trigger]') !== null) return
        if (target.closest('.ct-wb-view-menu') !== null) return
        setMenu(null)
        setWorkspaceMenu(null)
        setViewMenu(null)
        setViewSubmenu(null)
        setSectionMenu(null)
        setGroupMenu(null)
        setSectionDropId(null)
      }
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          setMenu(null)
          setWorkspaceMenu(null)
          setViewMenu(null)
        }
      }
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('keydown', onKeyDown, true)
      return () => {
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('keydown', onKeyDown, true)
      }
    }, [menu, workspaceMenu, viewMenu, sectionMenu, groupMenu])

    const byId = sessionSnap.byId
    const allIds = sessionSnap.ids
    const currentId = allIds.find((sessionId) => (byId[sessionId]?.retainedBy?.mainView ?? 0) > 0)
    // 分屏时侧栏高亮跟随聚焦屏；原生屏就是当前 mainView 会话。
    const splitFocusedSessionId = splitSnap.visible
      ? (splitSnap.focusedCellId === ROOT_CELL_ID ? currentId : split.cell(splitSnap.focusedCellId)?.sessionId)
      : undefined
    const highlightedId = splitFocusedSessionId ?? currentId
    // 分屏时侧栏把所有 cell 会话都标成选中；当前聚焦的那个仍是 is-current。
    const splitSelectedIds = React.useMemo(() => {
      const ids = new Set()
      if (!splitSnap.visible) return ids
      if (currentId !== undefined) ids.add(currentId)
      for (const leaf of collectSplitLeaves(splitSnap.extraTree)) {
        const sessionId = split.cell(leaf.cellId)?.sessionId
        if (sessionId !== undefined) ids.add(sessionId)
      }
      const bottomId = splitSnap.bottomCellId
      if (bottomId !== null && bottomId !== undefined) {
        const sessionId = split.cell(bottomId)?.sessionId
        if (sessionId !== undefined) ids.add(sessionId)
      }
      return ids
    }, [splitSnap, currentId])

    React.useEffect(() => {
      if (currentId === undefined) return
      const summary = sessionSnap.byId[currentId]
      if (summary?.blank === true) lastDraftBlankRef.current = currentId
    }, [currentId, sessionSnap])
    React.useEffect(() => {
      if (currentId === undefined || conversation?.input?.shell === undefined) return undefined
      let shell
      try {
        shell = conversation.input.shell(currentId)
      } catch {
        return undefined
      }
      if (shell === undefined) return undefined
      let observedAttachments = false
      const capture = () => {
        const ids = [...(shell.snapshot?.attachmentIds ?? [])]
        if (ids.length > 0) {
          const files = conversation.resolveDraftAttachments(ids).map((attachment) => attachment.file)
          if (files.length === ids.length) {
            draftAttachmentCache.current.set(currentId, files)
            observedAttachments = true
          }
          return
        }
        if (observedAttachments) draftAttachmentCache.current.delete(currentId)
      }
      capture()
      const unsubscribe = shell.state?.subscribe?.(capture)
      const cached = draftAttachmentCache.current.get(currentId)
      if (cached !== undefined && cached.length > 0 && (shell.snapshot?.attachmentIds?.length ?? 0) === 0) {
        const drafts = conversation.createDrafts(currentId, cached)
        const ids = drafts.map((draft) => draft.id)
        if (!shell.addAttachments(ids)) conversation.releaseDraftAttachments?.(drafts)
        else conversation.rebindDraftFiles?.(currentId, ids)
      }
      return () => {
        unsubscribe?.()
      }
    }, [currentId, conversation])

    const archivedIds = React.useMemo(() => new Set(workspaceSnap.archivedSessionIds ?? []), [workspaceSnap.archivedSessionIds])
    const pinnedIds = React.useMemo(() => new Set(workspaceSnap.pinnedSessionIds ?? []), [workspaceSnap.pinnedSessionIds])

    const searchQuery = query.trim()

    React.useEffect(() => {
      if (searchQuery === '') {
        setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false })
        return undefined
      }
      const controller = new AbortController()
      const timer = window.setTimeout(() => {
        if (typeof sessions.search !== 'function') {
          setRemoteSearch({ query: searchQuery, status: 'error', items: [], hasMore: false })
          return
        }
        setRemoteSearch((previous) => ({ ...previous, query: searchQuery, status: 'loading' }))
        sessions
          .search(searchQuery, controller.signal)
          .then((result) => {
            if (controller.signal.aborted) return
            if (result === null || result === undefined || result.ok === false) {
              setRemoteSearch({ query: searchQuery, status: 'error', items: [], hasMore: false })
              return
            }
            const value = result.value ?? {}
            setRemoteSearch({
              query: searchQuery,
              status: 'ready',
              items: Array.isArray(value.items) ? value.items : [],
              hasMore: value.hasMore === true,
            })
          })
          .catch(() => {
            if (!controller.signal.aborted) setRemoteSearch({ query: searchQuery, status: 'error', items: [], hasMore: false })
          })
      }, 250)
      return () => {
        window.clearTimeout(timer)
        controller.abort()
      }
    }, [sessions, searchQuery])

    // 搜索走独立的 flat 结果视图；分组树始终基于完整快照，不能先被 query 过滤掉。
    const groups = React.useMemo(
      () => buildGroups(workspaceSnap, sessionSnap, { currentId, activeId: highlightedId, archivedIds, pinnedIds, archivedFilter, query: '' }),
      [workspaceSnap, sessionSnap, currentId, highlightedId, archivedIds, pinnedIds, archivedFilter],
    )

    const pinnedRootIds = React.useMemo(() => {
      const roots = new Set()
      for (const id of pinnedIds) {
        const summary = byId[id]
        if (summary !== undefined) roots.add(treeRoot(summary, byId).id)
      }
      return roots
    }, [pinnedIds, byId])

    const pinnedMemberIds = React.useMemo(() => {
      const members = new Set()
      if (pinnedRootIds.size === 0) return members
      for (const id of allIds) {
        const summary = byId[id]
        if (summary !== undefined && pinnedRootIds.has(treeRoot(summary, byId).id)) members.add(summary.id)
      }
      return members
    }, [allIds, byId, pinnedRootIds])

    const pinnedMembers = React.useMemo(() => {
      if (pinnedMemberIds.size === 0) return []
      return allIds
        .map((id) => byId[id])
        .filter((summary) => summary !== undefined && pinnedMemberIds.has(summary.id))
        .filter((summary) => (archivedFilter === 'only' ? archivedIds.has(summary.id) : !archivedIds.has(summary.id)))
    }, [allIds, byId, pinnedMemberIds, archivedFilter, archivedIds])

    const pinnedGroup = React.useMemo(() => {
      if (pinnedIds.size === 0 && (dragState === null || dragState.pinnable !== true)) return undefined
      return {
        key: '__pinned__',
        title: '已置顶',
        workspaceId: undefined,
        path: undefined,
        pinned: true,
        kind: 'pinned',
        preview: pinnedIds.size === 0,
        members: pinnedMembers,
      }
    }, [pinnedIds, dragState, pinnedMembers])

    const sortSpec = React.useMemo(
      () => ({ orderBy, direction, createdAtById }),
      [orderBy, direction, createdAtById],
    )

    const assignedIds = React.useMemo(() => {
      const ids = new Set()
      for (const section of sections) {
        for (const id of section.sessionIds) ids.add(id)
      }
      return ids
    }, [sections, workspaceSnap])

    const baseGroups = React.useMemo(() => {
      const visible = (summary) => {
        if (summary === undefined || summary.blank) return false
        if (archivedFilter === 'only') return archivedIds.has(summary.id)
        if (archivedFilter === 'default') return !archivedIds.has(summary.id)
        return true
      }
      if (groupBy === 'folder') {
        return groups.map((group) => ({
          ...group,
          kind: 'workspace',
          members: group.members.filter((summary) => !pinnedMemberIds.has(summary.id) && !assignedIds.has(summary.id)),
        }))
      }
      const members = []
      for (const sessionId of allIds) {
        const summary = byId[sessionId]
        if (summary === undefined || pinnedMemberIds.has(summary.id) || assignedIds.has(summary.id) || !visible(summary)) continue
        members.push(summary)
      }
      if (groupBy === 'date') return buildDateGroups(members, sortSpec)
      if (groupBy === 'status') return buildStatusGroups(members, statusSnapshot, sortSpec)
      return [{ key: 'all', title: '全部会话', kind: 'flat', flat: true, members }]
    }, [groupBy, groups, pinnedMemberIds, assignedIds, archivedFilter, archivedIds, allIds, byId, sortSpec, statusSnapshot])

    const sectionGroups = React.useMemo(() => {
      return sections
        .map((section) => {
          const view = normalizeSectionView(section.view)
          const members = section.sessionIds
            .map((id) => byId[id])
            .filter((summary) => summary !== undefined && !pinnedMemberIds.has(summary.id))
            .filter((summary) => (view.archivedFilter === 'only' ? archivedIds.has(summary.id) : view.archivedFilter === 'default' ? !archivedIds.has(summary.id) : true))
          return {
            key: `section:${section.id}`,
            title: section.title,
            kind: 'section',
            sectionId: section.id,
            workspaceId: section.workspaceId,
            sectionCreatedAt: section.createdAt,
            sectionUpdatedAt: section.updatedAt,
            view,
            members,
          }
        })
        .sort((left, right) => (left.sectionCreatedAt ?? 0) - (right.sectionCreatedAt ?? 0))
    }, [sections, workspaceSnap, byId, pinnedMemberIds, archivedIds])

    const allGroups = React.useMemo(
      () => [
        ...(pinnedGroup === undefined ? [] : [pinnedGroup]),
        ...sectionGroups,
        ...baseGroups,
      ],
      [baseGroups, pinnedGroup, sectionGroups],
    )

    // 侧栏会渲染的会话（含折叠分组）：只给这些会话补标题，不遍历全部历史。
    const titleCandidates = React.useMemo(() => {
      const list = []
      const seen = new Set()
      for (const group of allGroups) {
        for (const summary of group.members) {
          if (seen.has(summary.id)) continue
          seen.add(summary.id)
          list.push(summary)
        }
      }
      return list
    }, [allGroups])

    useMissingSessionTitles(sessions, titleCandidates)

    // 视图的默认展开仍跟随原生主视图，分屏切换焦点不折叠其他分组。
    const currentGroupKey = React.useMemo(() => {
      if (currentId === undefined) return undefined
      const group = allGroups.find((candidate) => candidate.members.some((session) => session.id === currentId))
      return group?.key
    }, [allGroups, currentId])

    React.useEffect(() => {
      setExpandedGroups(null)
      setCollapsedBranches(new Set())
    }, [groupBy])

    // 分组的默认展开：当前会话所在分组 + 置顶 + 分区。这份默认值只在视图刚建立时
    // 写进 expandedGroups 一次；之后展开状态只由用户点击分组头改变。归档/关闭当前
    // 会话会让 currentGroupKey 消失，但展开状态已经落到 state，不会跟着自动收起。
    const defaultExpandedGroups = React.useMemo(() => {
      const next = new Set()
      if (currentGroupKey !== undefined) next.add(currentGroupKey)
      if (pinnedGroup !== undefined) next.add('__pinned__')
      for (const group of allGroups) {
        if (group.kind !== 'workspace') next.add(group.key)
      }
      return next
    }, [currentGroupKey, pinnedGroup, allGroups])

    React.useEffect(() => {
      if (expandedGroups !== null || currentGroupKey === undefined) return
      setExpandedGroups(new Set(defaultExpandedGroups))
    }, [expandedGroups, currentGroupKey, defaultExpandedGroups])

    const effectiveExpanded = expandedGroups ?? defaultExpandedGroups

    React.useEffect(() => {
      if (pinnedIds.size === 0) return
      setExpandedGroups((previous) => {
        if (previous === null || previous.has('__pinned__')) return previous
        const next = new Set(previous)
        next.add('__pinned__')
        return next
      })
    }, [pinnedIds.size])

    React.useEffect(() => {
      // Claude 的全局快捷键：Cmd/Ctrl+K 搜索，Cmd/Ctrl+N 新建会话。
      const onKeyDown = (event) => {
        const key = event.key.toLowerCase()
        // DSH 的新会话快捷键是 Alt+Cmd/Ctrl+N；同样走草稿保留逻辑。
        if (key === 'n' && event.altKey && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          event.stopImmediatePropagation()
          newSessionRef.current()
          return
        }
        const modifier = event.metaKey || event.ctrlKey
        if (!modifier || event.altKey) return
        if (key === 'k' && !event.shiftKey) {
          event.preventDefault()
          setSearchOpen(true)
          setSearchTab('all')
          setSearchSelection(0)
          window.requestAnimationFrame(() => searchInputRef.current?.focus())
          return
        }
        if (key === 'n' && !event.shiftKey) {
          event.preventDefault()
          newSessionRef.current()
        }
      }
      window.addEventListener('keydown', onKeyDown, true)
      return () => window.removeEventListener('keydown', onKeyDown, true)
    }, [])


    const searchResults = React.useMemo(
      () =>
        buildSearchResults({
          sessionSnap,
          workspaceSnap,
          archivedFilter,
          archivedIds,
          pinnedIds,
          query: searchQuery,
          remote: remoteSearch,
          limit: sessions.searchResultLimit ?? 50,
        }),
      [sessionSnap, workspaceSnap, archivedFilter, archivedIds, pinnedIds, searchQuery, remoteSearch, sessions.searchResultLimit],
    )

    React.useEffect(() => {
      if (!searchOpen) return undefined
      setSearchSelection(0)
      const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0)
      return () => window.clearTimeout(timer)
    }, [searchOpen])

    const recentSearchResults = React.useMemo(() => {
      if (searchQuery !== '') return searchResults
      const labels = new Map()
      for (const workspace of workspaceSnap.items ?? []) {
        for (const sessionId of workspace.sessionIds ?? []) labels.set(sessionId, workspace.title || basename(workspace.path ?? ''))
      }
      return sessionSnap.ids
        .map((id) => sessionSnap.byId[id])
        .filter((summary) => summary !== undefined && summary.blank !== true && !archivedIds.has(summary.id))
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
        .slice(0, 12)
        .map((summary) => ({
          id: summary.id,
          title: sessionTitle(summary),
          workspace: labels.get(summary.id) ?? basename(summary.cwd ?? ''),
          updatedAt: summary.updatedAt,
        }))
    }, [searchQuery, searchResults, sessionSnap, workspaceSnap, archivedIds])

    React.useEffect(() => {
      let schedule
      try {
        schedule = remote?.schedule ?? remote
      } catch {
        schedule = undefined
      }
      if (schedule?.catalog === undefined) return undefined
      let active = true
      const load = () => {
        try {
          Promise.resolve(schedule.catalog()).then((result) => {
            if (active && result?.ok && Array.isArray(result.value)) setAutomationTasks(result.value)
          }).catch(() => {})
        } catch {
          /* 自动化目录不可用时保持空列表 */
        }
      }
      load()
      let unsubscribe
      try {
        unsubscribe = remote.$on?.('schedule/changed', load)
      } catch {
        unsubscribe = undefined
      }
      return () => {
        active = false
        unsubscribe?.()
      }
    }, [remote, searchOpen])

    // 会话切到别的分组（例如从搜索结果打开、点侧栏会话）时自动展开目标分组；
    // 这里只加不减，归档/关闭当前会话不会把任何分组收起来。
    React.useEffect(() => {
      if (currentGroupKey === undefined) return
      setExpandedGroups((previous) => {
        if (previous === null || previous.has(currentGroupKey)) return previous
        const next = new Set(previous)
        next.add(currentGroupKey)
        return next
      })
    }, [currentGroupKey])

    const toggleGroup = (key) => {
      const next = new Set(effectiveExpanded)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      setExpandedGroups(next)
    }

    const toggleBranch = (sessionId) => {
      setCollapsedBranches((previous) => {
        const next = new Set(previous)
        if (next.has(sessionId)) next.delete(sessionId)
        else next.add(sessionId)
        return next
      })
    }

    const openSession = (summary) => {
      if (summary === undefined) return
      if (archivedIds.has(summary.id)) {
        showToast('已归档对话暂时无法查看，请先取消归档')
        return
      }
      // 分屏期间 Claude 的约定：点侧栏会话只替换当前聚焦的那一屏。
      if (split.isVisible()) {
        const result = split.openFocused(summary.id)
        if (result?.mode === 'error') showToast(messageOf(result.error))
        else if (result?.mode === 'native') ui.openSession(summary.id)
        return
      }
      if ((summary.retainedBy?.mainView ?? 0) > 0) return
      ui.openSession(summary.id)
    }

    const openInSplit = (summary) => {
      if (summary === undefined) return
      if (archivedIds.has(summary.id)) {
        showToast('已归档对话暂时无法查看，请先取消归档')
        return
      }
      // 会话已经在主视图/某个 cell 里时，不再触发分屏，也不报错。
      if (split.isSessionOpen(summary.id)) return
      const result = split.openInSplit(summary.id)
      if (result?.mode === 'error') showToast(messageOf(result.error))
      else if (result?.mode === 'max-replace') showToast('分屏已满，已替换当前分屏')
    }

    const createSession = (workspaceId, sectionId = undefined) => {
      if (sectionId !== undefined) {
        const token = {}
        pendingSectionRef.current = { sectionId, workspaceId, fromId: currentId, token }
        window.setTimeout(() => {
          if (pendingSectionRef.current?.token === token) pendingSectionRef.current = null
        }, 4000)
      }
      newSessionRef.current(workspaceId)
    }

    const renameSession = (summary) => {
      openTextDialog({
        title: '重命名会话',
        label: '会话名称',
        value: summary.title ?? '',
        placeholder: '会话名称',
        confirmLabel: '保存',
        onSubmit: async (title) => {
          if (title === (summary.title ?? '')) return
          try {
            const result = await sessions.using(summary.id, { source: 'workspaceOperation' }, (reference) =>
              reference.binding.session.rename(title),
            )
            if (!result.ok) throw new Error(result.error.message)
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error))
          }
        },
      })
    }

    const archiveSession = async (summary) => {
      // 原生屏归档后 mainView 会被清空，removeSession 已经拿不到它；先记住归属。
      const wasNative = (summary.retainedBy?.mainView ?? 0) > 0
      const afterArchive = () => {
        if (!split.isVisible()) return
        if (wasNative) split.exitSplit()
        else split.removeSession(summary.id)
      }
      try {
        await ui.archiveSession(summary.id)
        afterArchive()
        showToast('会话已归档')
      } catch {
        // Claude 归档不弹确认；运行中的会话直接按“停止并归档”处理。
        try {
          await ui.archiveSession(summary.id, { stopActivity: true })
          afterArchive()
          showToast('会话已归档')
        } catch (reason) {
          showToast(reason instanceof Error ? reason.message : String(reason))
        }
      }
    }

    const forkSession = async (summary) => {
      try {
        await ui.forkSession(summary.id)
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error))
      }
    }

    const copySessionId = async (summary) => {
      try {
        await navigator.clipboard.writeText(summary.id)
        showToast('Session ID 已复制')
      } catch {
        showToast('复制失败')
      }
    }

    const workspaceIdOfSession = (sessionId) => workspaceSnap.items?.find((item) => item.sessionIds.includes(sessionId))?.workspaceId
    const findDraftBlank = React.useCallback(() => {
      const sessionId = lastDraftBlankRef.current
      if (sessionId === null) return undefined
      const summary = sessionSnap.byId[sessionId]
      if (summary === undefined || summary.blank !== true || archivedIds.has(summary.id)) return undefined
      let shell
      try {
        shell = conversation?.input?.shell?.(summary.id)
      } catch {
        shell = undefined
      }
      const draft = shell?.draftSnapshot
      const attachmentIds = shell === undefined ? [] : [...(shell.snapshot?.attachmentIds ?? [])]
      const cachedFiles = draftAttachmentCache.current.get(summary.id) ?? []
      const text = draft?.text ?? readPersistedDraftText(summary.id)
      if ((text ?? '').trim() === '' && attachmentIds.length === 0 && cachedFiles.length === 0 && (draft?.references?.length ?? 0) === 0) return undefined
      return { summary, text: text ?? '', draft, attachmentIds, cachedFiles }
    }, [sessionSnap, archivedIds, conversation])

    const carryDraftToWorkspace = (source, targetWorkspaceId) => {
      if (conversation?.input?.shell === undefined || typeof ui.openWorkspace !== 'function') return false
      let from
      try {
        from = conversation.input.shell(source.summary.id)
      } catch {
        return false
      }
      const draft = from.draftSnapshot
      const liveIds = [...(from.snapshot?.attachmentIds ?? [])]
      const liveFiles = conversation.resolveDraftAttachments?.(liveIds)?.map((attachment) => attachment.file) ?? []
      const files = source.cachedFiles?.length > 0 ? source.cachedFiles : liveFiles
      try {
        ui.openWorkspace(targetWorkspaceId, (nextId) => {
          const next = conversation.input.shell(nextId)
          let created = []
          if (files.length > 0) {
            created = conversation.createDrafts(nextId, files)
            const ids = created.map((item) => item.id)
            if (!next.addAttachments(ids)) {
              conversation.releaseDraftAttachments?.(created)
              return
            }
            conversation.rebindDraftFiles?.(nextId, ids)
          }
          if (draft.text !== '') {
            next.setDraft(draft)
            from.setDraft('')
          }
          for (const id of [...(from.snapshot?.attachmentIds ?? [])]) from.removeAttachment(id)
          draftAttachmentCache.current.delete(source.summary.id)
          clearPersistedDraft(source.summary.id)
        })
        return true
      } catch {
        return false
      }
    }

    const startNewSessionPreservingDraft = React.useCallback((explicitWorkspaceId) => {
      const targetWorkspaceId = explicitWorkspaceId ?? (currentId === undefined ? undefined : workspaceIdOfSession(currentId))
      const draft = findDraftBlank()
      if (draft === undefined) {
        if (targetWorkspaceId !== undefined) ui.startSession(targetWorkspaceId)
        else ui.startSession()
        return
      }
      const draftWorkspaceId = workspaceIdOfSession(draft.summary.id)
      if (targetWorkspaceId === undefined || draftWorkspaceId === undefined || targetWorkspaceId === draftWorkspaceId) {
        ui.openSession(draft.summary.id)
        return
      }
      // 草稿在另一个项目：优先按 DSH 原生的 workspace-switch 逻辑迁移完整草稿（含附件）。
      if (!carryDraftToWorkspace(draft, targetWorkspaceId)) {
        ui.startSession(targetWorkspaceId, { prompt: draft.text, clearPreviousDraft: false })
        clearPersistedDraft(draft.summary.id)
      }
    }, [currentId, findDraftBlank, ui, workspaceSnap, carryDraftToWorkspace])

    React.useEffect(() => {
      newSessionRef.current = startNewSessionPreservingDraft
    }, [startNewSessionPreservingDraft])

    React.useEffect(() => {
      split.setNewSessionHandler?.((workspaceId) => newSessionRef.current(workspaceId))
      return () => split.setNewSessionHandler?.(undefined)
    }, [split])

    React.useEffect(() => {
      const onClick = (event) => {
        if (event.button !== 0) return
        const target = event.target
        if (!(target instanceof Element)) return
        const button = target.closest('button')
        if (button === null || button.closest('.ct-wb') !== null) return
        const label = button.getAttribute('aria-label')
        if (label !== '新建会话' && label !== '新会话' && label !== 'New session' && label !== 'New Session') return
        event.preventDefault()
        event.stopImmediatePropagation()
        startNewSessionPreservingDraft()
      }
      document.addEventListener('click', onClick, true)
      return () => document.removeEventListener('click', onClick, true)
    }, [startNewSessionPreservingDraft])


    const createSection = (workspaceId) => {
      if (workspaceId === undefined) return
      setViewMenu(null)
      setViewSubmenu(null)
      setWorkspaceMenu(null)
      setSectionMenu(null)
      openTextDialog({
        title: '新建部分',
        label: '分区名称',
        placeholder: '分区名称',
        confirmLabel: '创建分区',
        onSubmit: (title) => {
          const now = Date.now()
          const sectionId = `section-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`
          setSections((previous) => [
            ...previous,
            {
              id: sectionId,
              workspaceId,
              title,
              collapsed: false,
              createdAt: now,
              updatedAt: now,
              sessionIds: [],
              view: { ...SECTION_DEFAULT_VIEW },
            },
          ])
          // 新建的分区默认展开；展开状态已经落到 state 时，新 key 要显式补进去。
          setExpandedGroups((previous) => {
            if (previous === null) return previous
            const next = new Set(previous)
            next.add(`section:${sectionId}`)
            return next
          })
        },
      })
    }

    const renameSection = (section) => {
      setSectionMenu(null)
      openTextDialog({
        title: '重命名分区',
        label: '分区名称',
        value: section.title,
        placeholder: '分区名称',
        confirmLabel: '保存',
        onSubmit: (title) => {
          if (title === section.title) return
          setSections((previous) => previous.map((item) => item.id === section.id ? { ...item, title, updatedAt: Date.now() } : item))
        },
      })
    }

    const deleteSection = (section) => {
      setSectionMenu(null)
      openConfirmDialog({
        title: '删除分区',
        message: `删除「${section.title}」？分区里的会话会回到项目，不会被删除。`,
        confirmLabel: '删除分区',
        danger: true,
        onConfirm: () => setSections((previous) => previous.filter((item) => item.id !== section.id)),
      })
    }

    const treeSessionIds = (sessionId) => {
      const summary = byId[sessionId]
      if (summary === undefined) return []
      const root = treeRoot(summary, byId)
      return allIds.filter((id) => byId[id] !== undefined && treeRoot(byId[id], byId).id === root.id)
    }

    const assignSessionTreeToSection = (sessionId, sectionId) => {
      const summary = byId[sessionId]
      if (summary === undefined) return
      const root = treeRoot(summary, byId)
      const treeIds = allIds.filter((id) => byId[id] !== undefined && treeRoot(byId[id], byId).id === root.id)
      setSections((previous) => previous.map((item) => {
        const ids = item.id === sectionId ? [...new Set([...item.sessionIds, ...treeIds])] : item.sessionIds.filter((id) => !treeIds.includes(id))
        return { ...item, sessionIds: ids, updatedAt: Date.now() }
      }))
    }

    React.useEffect(() => {
      const pending = pendingSectionRef.current
      if (pending === null || currentId === undefined) return
      const summary = sessionSnap.byId[currentId]
      const workspaceId = workspaceIdOfSession(currentId)
      if (currentId !== pending.fromId && (summary?.blank !== true || workspaceId !== pending.workspaceId)) {
        pendingSectionRef.current = null
        return
      }
      if (workspaceId !== pending.workspaceId) return
      if (summary?.blank !== true) return
      pendingSectionRef.current = null
      assignSessionTreeToSection(currentId, pending.sectionId)
      showToast('新会话已放入分区')
    }, [currentId, sessionSnap, workspaceSnap])

    const assignToSection = async (section) => {
      if (dragState === null || dragState.pinnable !== true) return
      const summary = byId[dragState.id]
      const wasPinned = dragState.pinned
      if (wasPinned && summary !== undefined) await unpinTree(summary, { silent: true })
      assignSessionTreeToSection(dragState.id, section.sectionId ?? section.id)
      setSectionDropId(null)
      clearDrag()
      showToast(wasPinned ? `已移入「${section.title}」并取消置顶` : `已移到「${section.title}」`)
    }

    const toggleSectionBranches = (section, collapse) => {
      const members = section.sessionIds.map((id) => byId[id]).filter(Boolean)
      const rows = buildTree(members, sortSpec)
      const rootIds = rows.filter((row) => row.depth === 0 && row.children.length > 0).map((row) => row.summary.id)
      setCollapsedBranches((previous) => {
        const next = new Set(previous)
        for (const id of rootIds) {
          if (collapse) next.add(id)
          else next.delete(id)
        }
        return next
      })
      setSectionMenu(null)
    }

    const archiveSection = async (section) => {
      setSectionMenu(null)
      const members = section.sessionIds.map((id) => byId[id]).filter(Boolean)
      for (const summary of members) {
        try {
          await ui.archiveSession(summary.id)
        } catch {
          try { await ui.archiveSession(summary.id, { stopActivity: true }) } catch { /* 单条失败不阻断其余 */ }
        }
      }
      showToast('分区会话已归档')
    }

    const toggleWorkspaceBranches = (group, collapse) => {
      const rows = buildTree(group.members, sortSpec)
      const rootIds = rows.filter((row) => row.depth === 0 && row.children.length > 0).map((row) => row.summary.id)
      setCollapsedBranches((previous) => {
        const next = new Set(previous)
        for (const id of rootIds) {
          if (collapse) next.add(id)
          else next.delete(id)
        }
        return next
      })
      setWorkspaceMenu(null)
    }

    const archiveWorkspace = async (group) => {
      setWorkspaceMenu(null)
      for (const summary of group.members) {
        try {
          await ui.archiveSession(summary.id)
        } catch {
          try { await ui.archiveSession(summary.id, { stopActivity: true }) } catch { /* 单条失败不阻断 */ }
        }
      }
      showToast('项目会话已归档')
    }

    const createSectionFromMenu = () => {
      const current = allGroups.find((group) => group.key === currentGroupKey && group.workspaceId !== undefined)
      const fallback = allGroups.find((group) => group.workspaceId !== undefined)
      const workspaceId = workspaceIdOfSession(currentId) ?? current?.workspaceId ?? fallback?.workspaceId ?? workspaceSnap.items?.[0]?.workspaceId
      setViewMenu(null)
      setViewSubmenu(null)
      if (workspaceId !== undefined) createSection(workspaceId)
    }

    const toggleAnyGroupBranches = (group, collapse) => {
      const rows = buildTree(group.members, sortSpec)
      const rootIds = rows.filter((row) => row.depth === 0 && row.children.length > 0).map((row) => row.summary.id)
      setCollapsedBranches((previous) => {
        const next = new Set(previous)
        for (const id of rootIds) {
          if (collapse) next.add(id)
          else next.delete(id)
        }
        return next
      })
      setGroupMenu(null)
    }

    const archiveAnyGroup = async (group) => {
      setGroupMenu(null)
      for (const summary of group.members) {
        try {
          await ui.archiveSession(summary.id)
        } catch {
          try { await ui.archiveSession(summary.id, { stopActivity: true }) } catch { /* 单条失败不阻断 */ }
        }
      }
      showToast('分组会话已归档')
    }

    const openGroupMenu = (event, group) => {
      event.preventDefault()
      event.stopPropagation()
      const width = 196
      const rect = event.currentTarget.getBoundingClientRect()
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
      const top = Math.min(rect.bottom + 6, window.innerHeight - 260)
      setGroupMenu({ group, left, top, width })
    }

    const openSectionMenu = (event, group) => {
      event.preventDefault()
      event.stopPropagation()
      const section = sections.find((item) => item.id === group.sectionId)
      if (section === undefined) return
      const width = 196
      const rect = event.currentTarget.getBoundingClientRect()
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
      const top = Math.min(rect.bottom + 6, window.innerHeight - 360)
      setSectionMenu({ section, left, top, width })
    }

    const pinTree = async (summary) => {
      const root = treeRoot(summary, byId)
      try {
        await ui.pinSession(root.id)
        showToast('会话已置顶')
      } catch (error) {
        showToast(messageOf(error))
      }
    }

    const unpinTree = async (summary, options = {}) => {
      const root = treeRoot(summary, byId)
      const ids = [...pinnedIds].filter((id) => byId[id] !== undefined && treeRoot(byId[id], byId).id === root.id)
      try {
        await Promise.all(ids.map((id) => ui.unpinSession(id)))
        if (options.silent !== true) showToast('已取消置顶')
      } catch (error) {
        showToast(messageOf(error))
      }
    }

    const sessionMenuItems = (summary) => {
      const archived = archivedIds.has(summary.id)
      const root = treeRoot(summary, byId)
      const isParent = root.id === summary.id
      const pinned = pinnedRootIds.has(root.id)
      return [
        isParent
          ? pinned
            ? { label: '取消置顶', run: () => unpinTree(summary) }
            : { label: '置顶会话', run: () => pinTree(summary) }
          : null,
        { label: '重命名', run: () => renameSession(summary) },
        { label: '分叉会话', run: () => forkSession(summary) },
        split.enabled === false || split.isSessionOpen(summary.id)
          ? null
          : { label: '在分屏中打开', run: () => openInSplit(summary) },
        archived
          ? { label: '取消归档', run: () => ui.unarchiveSession(summary.id).catch((error) => showToast(messageOf(error))) }
          : { label: '归档会话', run: () => archiveSession(summary) },
        { label: '复制 Session ID', run: () => copySessionId(summary) },
      ]
    }

    const openSessionMenu = (event, summary) => {
      event.preventDefault()
      event.stopPropagation()
      const fromPointer = event.type === 'contextmenu'
      if (!fromPointer && menu !== null && menu.session?.id === summary.id) {
        setMenu(null)
        return
      }
      setWorkspaceMenu(null)
      setViewMenu(null)
      setSectionMenu(null)
      setGroupMenu(null)
      const width = 208
      const rect = event.currentTarget.getBoundingClientRect()
      const anchorX = fromPointer ? event.clientX : rect.right
      const anchorY = fromPointer ? event.clientY : rect.bottom + 6
      const left = Math.max(8, Math.min(anchorX - (fromPointer ? 0 : width), window.innerWidth - width - 8))
      const top = Math.max(8, Math.min(anchorY, window.innerHeight - 260))
      setMenu({ session: summary, left, top, width })
    }

    const addWorkspace = async () => {
      try {
        const path = await ui.pickDirectory()
        if (path === null || path === undefined) return
        await workspaces.create({ path })
      } catch (error) {
        showToast(messageOf(error))
      }
    }

    const openWorkspaceMenu = (event, group) => {
      event.preventDefault()
      event.stopPropagation()
      const width = 180
      const fromPointer = event.type === 'contextmenu'
      const rect = event.currentTarget.getBoundingClientRect()
      const anchorX = fromPointer ? event.clientX : rect.right
      const anchorY = fromPointer ? event.clientY : rect.bottom + 6
      const left = Math.max(8, Math.min(anchorX - (fromPointer ? 0 : width), window.innerWidth - width - 8))
      const top = Math.max(8, Math.min(anchorY, window.innerHeight - 120))
      setWorkspaceMenu({ group, left, top, width })
    }

    const renameWorkspace = (group) => {
      if (group.workspaceId === undefined) return
      setWorkspaceMenu(null)
      openTextDialog({
        title: '重命名工作区',
        label: '工作区名称',
        value: group.title,
        placeholder: '工作区名称',
        confirmLabel: '保存',
        onSubmit: async (title) => {
          if (title === group.title) return
          try {
            await workspaces.rename(group.workspaceId, title)
          } catch (error) {
            showToast(messageOf(error))
          }
        },
      })
    }

    const deleteWorkspace = (group) => {
      if (group.workspaceId === undefined) return
      setWorkspaceMenu(null)
      openConfirmDialog({
        title: '删除工作区',
        message: `删除「${group.title}」？会话和文件不会被删除。`,
        confirmLabel: '删除工作区',
        danger: true,
        onConfirm: async () => {
          try {
            await workspaces.delete(group.workspaceId)
          } catch (error) {
            showToast(messageOf(error))
          }
        },
      })
    }

    const renderSessionMenu = () => {
      if (menu === null) return null
      if (typeof renderSlot === 'function') {
        const slotted = renderSlot(
          'sidebar.workspaces.session.menu.item',
          { sessionId: menu.session.id, displayTitle: sessionTitle(menu.session) },
          { hookContext: sessionMenuState },
        )
        const hasEntries = Array.isArray(slotted) ? slotted.length > 0 : slotted !== null && slotted !== undefined
        if (hasEntries) return slotted
      }
      return sessionMenuItems(menu.session).filter(Boolean).map((item) =>
        h(
          'button',
          {
            key: item.label,
            type: 'button',
            role: 'menuitem',
            className: 'ct-wb-menu-item',
            onClick: () => {
              setMenu(null)
              item.run()
            },
          },
          item.label,
        ),
      )
    }

    const showDragHint = (key, text, event) => {
      if (dragHintRef.current !== key) dragHintRef.current = key
      setDragHint({ text, x: event.clientX + 12, y: event.clientY + 12 })
    }

    const clearDragHint = () => {
      dragHintRef.current = ''
      setDragHint(null)
    }

    const clearDrag = () => {
      setDragState(null)
      setSplitDrop(null)
      setPinDropActive(false)
      setGroupDropKey(null)
      setWorkspaceDrop(null)
      dragHintRef.current = ''
    }

    // 主内容区落点：拖拽层覆盖 main+rightbar；右侧栏算在左/上原生屏里。
    const handleSplitDragOver = (event) => {
      if (split.enabled === false) return
      if (dragState === null || dragState.kind !== 'session') return
      if (split.isSessionOpen(dragState.id)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      if (dragHintRef.current !== '') clearDragHint()
      const target = resolveSplitDropTarget(event.clientX, event.clientY, splitSnap)
      if (target === null) {
        setSplitDrop(null)
        return
      }
      setSplitDrop({ target, x: event.clientX, y: event.clientY })
    }

    const handleSplitDragLeave = (event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return
      setSplitDrop(null)
    }

    const handleSplitDrop = (event) => {
      if (split.enabled === false) return
      if (dragState === null || dragState.kind !== 'session') return
      event.preventDefault()
      event.stopPropagation()
      // 会话已经打开：不出现分屏框、不落点、不报错。
      if (split.isSessionOpen(dragState.id)) {
        setSplitDrop(null)
        clearDrag()
        return
      }
      const target = splitDrop?.target ?? resolveSplitDropTarget(event.clientX, event.clientY)
      const result = split.drop(dragState.id, target)
      if (result?.mode === 'error') showToast(messageOf(result.error))
      else if (result?.mode === 'max-replace') showToast('分屏已满，已替换当前分屏')
      setSplitDrop(null)
      clearDrag()
    }

    const renderSplitDropLayer = () => {
      // 分屏关闭：拖拽到主区不出现落点层（会话仍可拖去改归属/置顶）。
      if (split.enabled === false) return null
      if (dragState === null || dragState.kind !== 'session') return null
      if (split.isSessionOpen(dragState.id)) return null
      const area = findContentAreaRect()
      if (area === null) return null
      const target = splitDrop?.target ?? null
      const preview = target === null ? null : splitDropPreviewRect(target, splitSnap)
      const hint = target === null
        ? ''
        : target.atMax === true
          ? '分屏已满（左右两列 · 上下两行）· 替换当前分屏'
          : target.zone === 'replace'
            ? '在此打开'
            : '在分屏视图中打开'
      return h(
        'div',
        {
          className: 'ct-split-drop-layer',
          'data-ct-split-drop': '',
          style: {
            left: `${area.left}px`,
            top: `${area.top}px`,
            width: `${area.width}px`,
            height: `${area.height}px`,
          },
          onDragEnter: handleSplitDragOver,
          onDragOver: handleSplitDragOver,
          onDragLeave: handleSplitDragLeave,
          onDrop: handleSplitDrop,
        },
        preview === null
          ? null
          : h(
              'div',
              {
                className: 'ct-split-drop-preview',
                'data-zone': target.zone,
                style: {
                  left: `${preview.left}px`,
                  top: `${preview.top}px`,
                  width: `${preview.width}px`,
                  height: `${preview.height}px`,
                },
              },
              h('span', { className: 'ct-split-drop-pill' }, target.zone === 'replace' ? '在此打开' : '分屏视图'),
            ),
        hint === ''
          ? null
          : h(
              'div',
              {
                className: 'ct-split-drop-hint',
                style: {
                  left: `${Math.min((splitDrop?.x ?? 0) + 14, window.innerWidth - 250)}px`,
                  top: `${Math.min((splitDrop?.y ?? 0) + 16, window.innerHeight - 44)}px`,
                },
              },
              hint,
            ),
      )
    }

    const listAcceptsDrop = () => dragState !== null && dragState.pinnable === true && (dragState.pinned === true || dragState.sectionId !== undefined)

    const groupAcceptsDrop = (group) => {
      if (!listAcceptsDrop()) return false
      return group.workspaceId === undefined || dragState.workspaceId === undefined || group.workspaceId === dragState.workspaceId
    }

    const dropToConversationList = async (source) => {
      const summary = byId[source.id]
      if (summary === undefined) {
        clearDrag()
        return
      }
      const treeIds = treeSessionIds(source.id)
      const sourceSection = sections.find((item) => item.id === source.sectionId)
      if (source.pinned || source.sectionId !== undefined) {
        setSections((previous) => previous.map((item) => ({
          ...item,
          sessionIds: item.sessionIds.filter((id) => !treeIds.includes(id)),
          updatedAt: Date.now(),
        })))
      }
      if (source.pinned) await unpinTree(summary, { silent: true })
      clearDrag()
      if (source.pinned) showToast('已取消置顶')
      else if (sourceSection !== undefined) showToast(`已从「${sourceSection.title}」移除`)
    }

    const listEventIsProtected = (event) => Boolean(event.target?.closest?.('.ct-wb-group.is-pinned, .ct-wb-group.is-section'))

    const dragOverConversationList = (event) => {
      if (!listAcceptsDrop() || listEventIsProtected(event)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      setListDropActive(true)
      setPinDropActive(false)
      setSectionDropId(null)
      const hint = groupDropHint()
      if (hint !== '') showDragHint('list', hint, event)
    }

    const dragLeaveConversationList = (event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return
      setListDropActive(false)
      clearDragHint()
    }

    const dropOnConversationList = async (event) => {
      if (!listAcceptsDrop() || listEventIsProtected(event)) return
      event.preventDefault()
      event.stopPropagation()
      const source = dragState
      setListDropActive(false)
      clearDragHint()
      if (source !== null) await dropToConversationList(source)
    }

    const groupDropHint = () => {
      if (dragState === null) return ''
      if (dragState.pinned) return '松开以取消置顶'
      if (dragState.sectionId !== undefined) {
        const source = sections.find((item) => item.id === dragState.sectionId)
        if (source !== undefined) return `松开以从「${source.title}」中移除`
      }
      return ''
    }

    const dragOverGroupTarget = (event, group) => {
      if (!groupAcceptsDrop(group)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      setGroupDropKey(group.key)
      setPinDropActive(false)
      setSectionDropId(null)
      const hint = groupDropHint()
      const token = `group:${group.key}`
      if (hint !== '') showDragHint(token, hint, event)
    }

    const dragLeaveGroupTarget = (event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return
      setGroupDropKey(null)
      clearDragHint()
    }

    const dropOnGroupTarget = async (event, group) => {
      if (!groupAcceptsDrop(group)) return
      event.preventDefault()
      event.stopPropagation()
      const source = dragState
      setGroupDropKey(null)
      clearDragHint()
      if (source !== null) await dropToConversationList(source)
    }

    // 拖拽可置顶、取消置顶，或把会话移入/移出分区；不允许拖拽排序。
    const startSessionDrag = (event, summary) => {
      if (archivedIds.has(summary.id)) {
        event.preventDefault()
        return
      }
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', summary.id)
      // 原生拖拽图会在 React 隐藏原行之后才截图，导致出现空白块；这里先用行克隆生成有内容的拖拽图。
      try {
        const source = event.currentTarget
        const rect = source.getBoundingClientRect()
        const ghost = source.cloneNode(true)
        ghost.classList.remove('is-dragging', 'is-current')
        ghost.style.position = 'fixed'
        ghost.style.left = `${rect.left}px`
        ghost.style.top = `${rect.top}px`
        ghost.style.width = `${rect.width}px`
        ghost.style.height = `${rect.height}px`
        ghost.style.margin = '0'
        ghost.style.boxSizing = 'border-box'
        ghost.style.background = 'var(--dsw-alias-bg-layer-1)'
        ghost.style.border = '0'
        ghost.style.borderRadius = '6px'
        ghost.style.boxShadow = 'none'
        ghost.style.pointerEvents = 'none'
        ghost.style.zIndex = '9999'
        ghost.setAttribute('data-ct-wb-drag-image', 'true')
        document.body.appendChild(ghost)
        event.dataTransfer.setDragImage(ghost, Math.max(0, event.clientX - rect.left), Math.max(0, event.clientY - rect.top))
        window.setTimeout(() => ghost.remove(), 0)
      } catch {
        /* 不支持时退回浏览器默认拖拽图 */
      }
      // 只有 tree root（父会话）能改变归属；子会话可以拖动，但不响应落点。
      const root = treeRoot(summary, byId)
      const pinnable = root.id === summary.id
      const workspaceId = workspaceSnap.items?.find((item) => item.sessionIds.includes(summary.id))?.workspaceId
      const section = sections.find((item) => item.sessionIds.includes(root.id))
      setDragState({
        kind: 'session',
        id: summary.id,
        title: sessionTitle(summary),
        pinnable,
        workspaceId: workspaceId ?? section?.workspaceId,
        pinned: pinnedRootIds.has(root.id),
        sectionId: section?.id,
      })
      setPinDropActive(false)
      setGroupDropKey(null)
      dragHintRef.current = ''
      clearHover()
    }

    // 项目分组拖拽排序：只动工作区在 Host registry 里的顺序，不动会话顺序。
    const canReorderWorkspaceGroup = (group) =>
      groupBy === 'folder' && group.kind === 'workspace' && group.workspaceId !== undefined

    const commitWorkspaceReorder = async (source, target) => {
      if (source === null || source.kind !== 'workspace' || target === null) return
      const order = (workspaceSnap.items ?? []).map((item) => item.workspaceId)
      const sourceIndex = order.indexOf(source.workspaceId)
      const targetIndex = order.indexOf(target.id)
      if (sourceIndex === -1 || targetIndex === -1) return
      const anchorId = target.half === 'before' ? target.id : order[targetIndex + 1]
      if (anchorId === source.workspaceId) return
      const anchorIndex = anchorId === undefined ? order.length : order.indexOf(anchorId)
      // 落点在自身前后一格时顺序不变，不写 Host。
      if (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1) return
      if (typeof workspaces.insertBefore !== 'function') {
        showToast('当前 DSH 版本不支持项目排序')
        return
      }
      try {
        await workspaces.insertBefore(source.workspaceId, anchorId)
      } catch (error) {
        showToast(messageOf(error))
      }
    }

    const workspaceTargetAt = (event, group) => {
      if (!canReorderWorkspaceGroup(group)) return null
      const rect = event.currentTarget.getBoundingClientRect()
      return {
        id: group.workspaceId,
        half: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
      }
    }

    const startWorkspaceDrag = (event, group) => {
      if (!canReorderWorkspaceGroup(group) || event.target?.closest?.('button')) {
        event.preventDefault()
        return
      }
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', group.workspaceId)
      setDragState({ kind: 'workspace', workspaceId: group.workspaceId, title: group.title })
      setWorkspaceDrop(null)
      setPinDropActive(false)
      setGroupDropKey(null)
      setSectionDropId(null)
      setListDropActive(false)
      dragHintRef.current = ''
      clearHover()
    }

    const dragOverWorkspaceTarget = (event, group) => {
      if (dragState === null || dragState.kind !== 'workspace') return false
      event.preventDefault()
      event.stopPropagation()
      const valid = canReorderWorkspaceGroup(group) && group.workspaceId !== dragState.workspaceId
      event.dataTransfer.dropEffect = valid ? 'move' : 'none'
      if (!valid) {
        setWorkspaceDrop(null)
        return true
      }
      const target = workspaceTargetAt(event, group)
      if (target !== null) setWorkspaceDrop(target)
      setPinDropActive(false)
      setGroupDropKey(null)
      setSectionDropId(null)
      setListDropActive(false)
      clearDragHint()
      return true
    }

    const dragLeaveWorkspaceTarget = (event) => {
      if (dragState === null || dragState.kind !== 'workspace') return false
      if (event.currentTarget.contains(event.relatedTarget)) return true
      setWorkspaceDrop(null)
      return true
    }

    const dropWorkspaceTarget = async (event, group) => {
      if (dragState === null || dragState.kind !== 'workspace') return false
      event.preventDefault()
      event.stopPropagation()
      const source = dragState
      const target = workspaceDrop !== null && workspaceDrop.id === group.workspaceId
        ? workspaceDrop
        : workspaceTargetAt(event, group)
      setWorkspaceDrop(null)
      clearDrag()
      await commitWorkspaceReorder(source, target)
      return true
    }

    const endWorkspaceDrag = () => {
      if (dragState === null || dragState.kind !== 'workspace') return
      const source = dragState
      const target = workspaceDrop
      setWorkspaceDrop(null)
      clearDrag()
      if (target !== null) void commitWorkspaceReorder(source, target)
    }

    const dragOverPinTarget = (event) => {
      if (dragState === null || dragState.pinnable !== true || dragState.pinned === true) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      setPinDropActive(true)
      setGroupDropKey(null)
      setSectionDropId(null)
      setListDropActive(false)
      clearDragHint()
    }

    const dragLeavePinTarget = (event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return
      setPinDropActive(false)
      clearDragHint()
    }

    const dropOnPinTarget = async (event) => {
      if (dragState === null || dragState.pinnable !== true || dragState.pinned === true) return
      event.preventDefault()
      event.stopPropagation()
      const summary = byId[dragState.id]
      clearDrag()
      if (summary !== undefined) await pinTree(summary)
    }

    const targetSection = viewMenu?.sectionId === undefined ? undefined : sections.find((section) => section.id === viewMenu.sectionId)
    const activeView = targetSection === undefined
      ? { groupBy, orderBy, direction, archivedFilter }
      : normalizeSectionView(targetSection.view)
    const groupChoices = targetSection === undefined ? GROUP_OPTIONS : SECTION_GROUP_OPTIONS

    const closeViewMenu = () => {
      setViewSubmenu(null)
      setViewMenu(null)
    }

    const updateView = (patch) => {
      if (targetSection === undefined) {
        if (patch.groupBy !== undefined) setGroupBy(patch.groupBy)
        if (patch.orderBy !== undefined) setOrderBy(patch.orderBy)
        if (patch.direction !== undefined) setDirection(patch.direction)
        if (patch.archivedFilter !== undefined) setArchivedFilter(patch.archivedFilter)
      } else {
        setSections((previous) => previous.map((section) => section.id === targetSection.id
          ? { ...section, view: normalizeSectionView({ ...normalizeSectionView(section.view), ...patch }), updatedAt: Date.now() }
          : section))
      }
      closeViewMenu()
    }

    const resetView = () => {
      if (targetSection === undefined) {
        setGroupBy(DEFAULT_VIEW.groupBy)
        setOrderBy(DEFAULT_VIEW.orderBy)
        setDirection(DEFAULT_VIEW.direction)
        setArchivedFilter(DEFAULT_VIEW.archivedFilter)
      } else {
        setSections((previous) => previous.map((section) => section.id === targetSection.id
          ? { ...section, view: { ...SECTION_DEFAULT_VIEW }, updatedAt: Date.now() }
          : section))
      }
      closeViewMenu()
    }

    const openViewSubmenu = (kind, event) => {
      if (viewMenu === null) return
      const width = 210
      const rect = event.currentTarget.getBoundingClientRect()
      let left = viewMenu.left + 236 + 4
      if (left + width > window.innerWidth - 8) left = Math.max(8, viewMenu.left - width - 4)
      const top = Math.max(8, Math.min(rect.top, window.innerHeight - 320))
      setViewSubmenu({ kind, left, top })
    }

    const renderViewSubmenu = () => {
      if (viewMenu === null || viewSubmenu === null) return null
      const item = (label, active, action, options = {}) =>
        h(
          'button',
          {
            key: options.key ?? label,
            type: 'button',
            role: 'menuitemradio',
            'aria-checked': active,
            disabled: options.disabled === true,
            title: options.title,
            className: `ct-wb-menu-item${active ? ' is-checked' : ''}${options.disabled ? ' is-disabled' : ''}`,
            onClick: options.disabled ? undefined : action,
          },
          h('span', { className: 'ct-wb-check' }, active ? '✓' : ''),
          label,
        )
      let children = []
      if (viewSubmenu.kind === 'group') {
        children = groupChoices.map((option) =>
          h(
            React.Fragment,
            { key: option.id },
            option.id === 'none' ? h('div', { className: 'ct-wb-menu-separator' }) : null,
            item(option.label, activeView.groupBy === option.id, () => updateView({ groupBy: option.id }), { disabled: option.disabled === true, key: `group-${option.id}` }),
          ),
        )
      } else if (viewSubmenu.kind === 'order') {
        children = [
          ...ORDER_OPTIONS.map((option) =>
            item(
              option.label,
              activeView.orderBy === option.id,
              () => updateView({ orderBy: option.id }),
              {
                key: `order-${option.id}`,
                disabled: option.disabled === true || (option.id === 'created' && createdAtById.size === 0),
                title: option.id === 'created' && createdAtById.size === 0 ? '重启 DSH 后可用' : undefined,
              },
            ),
          ),
          h('div', { className: 'ct-wb-menu-separator', key: 'direction-separator' }),
          item('降序', activeView.direction === 'desc', () => updateView({ direction: 'desc' }), { key: 'direction-desc' }),
          item('升序', activeView.direction === 'asc', () => updateView({ direction: 'asc' }), { key: 'direction-asc' }),
        ]
      } else {
        children = ARCHIVED_FILTERS.map((option) =>
          item(option.label, activeView.archivedFilter === option.id, () => updateView({ archivedFilter: option.id }), { key: `filter-${option.id}` }),
        )
      }
      return h(
        'div',
        {
          className: 'ct-wb-menu ct-wb-view-submenu',
          role: 'menu',
          style: { left: `${viewSubmenu.left}px`, top: `${viewSubmenu.top}px`, width: '210px' },
        },
        children,
      )
    }

    const renderViewMenu = () => {
      if (viewMenu === null) return null
      const groupLabel = groupChoices.find((option) => option.id === activeView.groupBy)?.label ?? (targetSection === undefined ? '文件夹' : '无')
      const orderLabel = ORDER_OPTIONS.find((option) => option.id === activeView.orderBy)?.label ?? '上次更新'
      const row = (kind, label, value) =>
        h(
          'button',
          {
            key: kind,
            type: 'button',
            role: 'menuitem',
            'aria-haspopup': 'menu',
            'aria-expanded': viewSubmenu?.kind === kind,
            className: `ct-wb-view-row${viewSubmenu?.kind === kind ? ' is-open' : ''}`,
            onMouseEnter: (event) => openViewSubmenu(kind, event),
            onClick: (event) => openViewSubmenu(kind, event),
          },
          h('span', { className: 'ct-wb-view-row-label' }, label),
          h('span', { className: 'ct-wb-view-row-value' }, value),
          h('span', { className: 'ct-wb-view-row-chevron', 'aria-hidden': 'true' }, iconChevron(false)),
        )
      return h(
        React.Fragment,
        null,
        h(
          'div',
          {
            className: 'ct-wb-menu ct-wb-view-menu',
            role: 'menu',
            style: { left: `${viewMenu.left}px`, top: `${viewMenu.top}px`, width: '236px' },
          },
          row('group', '分组依据', groupLabel),
          row('order', '排序方式', orderLabel),
          row('display', '显示', ''),
          h('div', { className: 'ct-wb-menu-separator' }),
          h('button', {
            type: 'button',
            role: 'menuitem',
            className: 'ct-wb-menu-item',
            onClick: createSectionFromMenu,
          }, '新建部分'),
          targetSection === undefined
            ? h('button', {
                type: 'button',
                role: 'menuitem',
                className: 'ct-wb-menu-item',
                onClick: () => { setViewMenu(null); addWorkspace() },
              }, '添加工作区…')
            : null,
          h('div', { className: 'ct-wb-menu-separator' }),
          h('button', {
            type: 'button',
            role: 'menuitem',
            className: 'ct-wb-menu-item',
            onClick: resetView,
          }, '恢复默认设置'),
          h('button', {
            type: 'button',
            role: 'menuitem',
            className: 'ct-wb-menu-item',
            onClick: openAllSessions,
          }, '查看全部'),
        ),
        renderViewSubmenu(),
      )
    }

    const openViewMenu = (event, sectionId = undefined) => {
      event.preventDefault()
      event.stopPropagation()
      if (viewMenu !== null && viewMenu.sectionId === sectionId) {
        closeViewMenu()
        return
      }
      setMenu(null)
      setWorkspaceMenu(null)
      setSectionMenu(null)
      setGroupMenu(null)
      setViewSubmenu(null)
      const width = 236
      const rect = event.currentTarget.getBoundingClientRect()
      setViewMenu({
        left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        top: Math.min(rect.bottom + 6, window.innerHeight - 420),
        sectionId,
      })
    }

    const openAllSessions = () => {
      setViewMenu(null)
      try {
        layout.selectPanel('ct-sessions')
      } catch (error) {
        showToast(messageOf(error))
      }
    }

    const closeSearch = () => {
      setSearchOpen(false)
      setQuery('')
      setSearchTab('all')
      setSearchSelection(0)
    }

    const openSearch = () => {
      setSearchTab('all')
      setSearchSelection(0)
      setSearchOpen(true)
      window.requestAnimationFrame(() => searchInputRef.current?.focus())
    }

    const toggleSearch = () => {
      if (searchOpen) closeSearch()
      else openSearch()
    }

    const searchMode = false
    const visibleGroups = allGroups

    const normalizedQuery = query.trim()
    const searchSessionItems = (normalizedQuery === '' ? recentSearchResults : searchResults).map((result) => ({
      key: `search-session:${result.id}`,
      id: result.id,
      kind: 'session',
      title: result.title,
      meta: [result.workspace, formatTime(result.updatedAt, now)].filter(Boolean).join(' · '),
      summary: byId[result.id],
    }))
    const searchProjectItems = (workspaceSnap.items ?? [])
      .filter((workspace) => {
        if (normalizedQuery === '') return true
        const q = normalizedQuery.toLowerCase()
        return (workspace.title ?? '').toLowerCase().includes(q) || (workspace.path ?? '').toLowerCase().includes(q)
      })
      .map((workspace) => ({
        key: `search-project:${workspace.workspaceId}`,
        id: workspace.workspaceId,
        kind: 'project',
        title: workspace.title || basename(workspace.path ?? ''),
        meta: workspace.path ?? '',
      }))
    const searchAutomationItems = automationTasks
      .filter((task) => {
        if (normalizedQuery === '') return true
        const q = normalizedQuery.toLowerCase()
        return [task.title, task.prompt, task.sessionId].some((value) => typeof value === 'string' && value.toLowerCase().includes(q))
      })
      .map((task) => ({
        key: `search-automation:${task.id}`,
        id: task.id,
        kind: 'automation',
        title: task.title || (typeof task.prompt === 'string' ? task.prompt.slice(0, 80) : '自动化任务'),
        meta: [task.status === 'active' ? '已开启' : task.status === 'ended' ? '已结束' : task.status, task.scheduledAt ? formatTime(Date.parse(task.scheduledAt), now) : ''].filter(Boolean).join(' · '),
      }))

    const searchActionItems = [
      { key: 'search-action:new', id: 'new', kind: 'action', title: '新建会话', meta: '在当前项目创建' },
      { key: 'search-action:automation', id: 'automation', kind: 'action', title: '自动化任务', meta: '打开自动化任务列表' },
      { key: 'search-action:add', id: 'add', kind: 'action', title: '添加工作区…', meta: '选择一个目录' },
      { key: 'search-action:all', id: 'all', kind: 'action', title: '查看全部会话', meta: '打开完整会话页' },
    ].filter((item) => normalizedQuery === '' || `${item.title} ${item.meta}`.toLowerCase().includes(normalizedQuery.toLowerCase()))

    const openProjectResult = (workspaceId) => {
      closeSearch()
      setGroupBy('folder')
      const group = groups.find((candidate) => candidate.workspaceId === workspaceId)
      if (group !== undefined) {
        setExpandedGroups((previous) => new Set([...(previous ?? effectiveExpanded), group.key]))
      }
    }

    const runSearchItem = (item) => {
      if (item === undefined) return
      if (item.kind === 'session') {
        const summary = byId[item.id]
        if (summary !== undefined) {
          closeSearch()
          openSession(summary)
        }
      } else if (item.kind === 'project') {
        openProjectResult(item.id)
      } else if (item.kind === 'automation') {
        closeSearch()
        try {
          layout.selectPanel('schedules')
        } catch (error) {
          showToast(messageOf(error))
        }
      } else if (item.id === 'automation') {
        closeSearch()
        try {
          layout.selectPanel('schedules')
        } catch (error) {
          showToast(messageOf(error))
        }
      } else if (item.id === 'new') {
        closeSearch()
        newSessionRef.current()
      } else if (item.id === 'add') {
        closeSearch()
        addWorkspace()
      } else {
        closeSearch()
        openAllSessions()
      }
    }

    const searchSections = []
    const flatSearchItems = []
    const addSearchSection = (label, items) => {
      if (items.length === 0) return
      for (const item of items) item.flatIndex = flatSearchItems.length + items.indexOf(item)
      flatSearchItems.push(...items)
      searchSections.push({ label, items })
    }
    if (searchTab === 'all' || searchTab === 'sessions') {
      addSearchSection(normalizedQuery === '' ? '最近使用' : '会话', searchSessionItems)
    }
    if (searchTab === 'all' || searchTab === 'projects') addSearchSection('项目', searchProjectItems)
    if (searchTab === 'all' || searchTab === 'automation') addSearchSection('自动化任务', searchAutomationItems)
    if (searchTab === 'all' || searchTab === 'actions') addSearchSection('操作', searchActionItems)
    const selectedSearchItem = flatSearchItems[Math.min(searchSelection, Math.max(0, flatSearchItems.length - 1))]
    const activeSearchTabLabel = SEARCH_TABS.find((tab) => tab.id === searchTab)?.label ?? '全部'
    const searchRemoteLoading = remoteSearch.status === 'loading' && remoteSearch.query === normalizedQuery && (searchTab === 'all' || searchTab === 'sessions')

    const switchSearchTab = (tab) => {
      setSearchTab(tab)
      setSearchSelection(0)
    }

    const handleSearchKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSearch()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (flatSearchItems.length === 0) return
        event.preventDefault()
        setSearchSelection((previous) => {
          const current = Math.min(previous, flatSearchItems.length - 1)
          return event.key === 'ArrowDown' ? (current + 1) % flatSearchItems.length : (current - 1 + flatSearchItems.length) % flatSearchItems.length
        })
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const current = SEARCH_TABS.findIndex((tab) => tab.id === searchTab)
        const next = (current + (event.key === 'ArrowRight' ? 1 : -1) + SEARCH_TABS.length) % SEARCH_TABS.length
        switchSearchTab(SEARCH_TABS[next].id)
        return
      }
      if (event.key === 'Enter' && selectedSearchItem !== undefined) {
        event.preventDefault()
        runSearchItem(selectedSearchItem)
      }
    }


    return h(
      'div',
      { className: 'ct-wb' },
      h(
        Tooltip,
        {
          label: '搜索会话（⌘K）',
          side: 'bottom',
          delayMs: 400,
          portal: true,
        },
        h(
          'button',
          {
            type: 'button',
            className: `ct-wb-search-entry${searchOpen ? ' is-open' : ''}`,
            'aria-label': searchOpen ? '关闭搜索' : '搜索会话',
            'aria-keyshortcuts': 'Meta+K Control+K',
            onClick: toggleSearch,
          },
          h('span', { className: 'ct-wb-search-entry-icon', 'aria-hidden': 'true' }, iconSearch()),
          h('span', { className: 'ct-wb-search-entry-label' }, '搜索'),
          h('span', { className: 'ct-wb-search-entry-shortcut', 'aria-hidden': 'true' }, '⌘K'),
        ),
      ),
      h(
            'div',
            {
              className: `ct-wb-list${listDropActive ? ' is-list-drop' : ''}`,
              role: 'tree',
              'aria-label': '会话',
              onDragOver: dragOverConversationList,
              onDragLeave: dragLeaveConversationList,
              onDrop: dropOnConversationList,
            },
            visibleGroups.length === 0
              ? h(
                  'div',
                  { className: 'ct-wb-empty' },
                  h('span', null, archivedFilter === 'only' ? '暂无已归档会话' : '暂无会话'),
                  h('button', { type: 'button', className: 'ct-wb-empty-action', onClick: addWorkspace }, '添加工作区'),
                )
              : visibleGroups.map((group) =>
                  renderGroup({
                    group,
                    expanded: effectiveExpanded.has(group.key),
                    collapsedBranches,
                    currentId: highlightedId,
                    selectedIds: splitSelectedIds,
                    currentWorkspaceId: workspaceIdOfSession(highlightedId ?? currentId),
                    pinnedIds,
                    archivedIds,
                    now,
                    onToggleGroup: toggleGroup,
                    onToggleBranch: toggleBranch,
                    onOpenSession: openSession,
                    onCreate: createSession,
                    onOpenMenu: openSessionMenu,
                    onOpenWorkspaceMenu: openWorkspaceMenu,
                    onOpenSectionMenu: openSectionMenu,
                    onOpenGroupMenu: openGroupMenu,
                    onOpenViewMenu: openViewMenu,
                    sectionDropId,
                    groupDropKey,
                    workspaceDrop,
                    workspaceReorder: groupBy === 'folder',
                    onWorkspaceDragStart: startWorkspaceDrag,
                    onWorkspaceDragEnd: endWorkspaceDrag,
                    onWorkspaceDragOver: dragOverWorkspaceTarget,
                    onWorkspaceDragLeave: dragLeaveWorkspaceTarget,
                    onWorkspaceDrop: dropWorkspaceTarget,
                    onGroupDragOver: dragOverGroupTarget,
                    onGroupDragLeave: dragLeaveGroupTarget,
                    onGroupDrop: dropOnGroupTarget,
                    onSectionDragOver: (event, section) => {
                      if (dragState === null || dragState.pinnable !== true) return
                      event.preventDefault()
                      event.stopPropagation()
                      event.dataTransfer.dropEffect = 'move'
                      setSectionDropId(section.sectionId)
                      setPinDropActive(false)
                      setGroupDropKey(null)
                      setListDropActive(false)
                      clearDragHint()
                    },
                    onSectionDragLeave: (event) => {
                      if (event.currentTarget.contains(event.relatedTarget)) return
                      setSectionDropId(null)
                      clearDragHint()
                    },
                    onSectionDrop: (event, section) => {
                      event.preventDefault()
                      event.stopPropagation()
                      assignToSection(section)
                    },
                    searchMode,
                    useSessionStatus,
                    renderSlot,
                    sortSpec,
                    statusSnapshot,
                    onHoverStart: scheduleHover,
                    onHoverEnd: clearHover,
                    dragState,
                    pinDropActive,
                    onPinDragEnter: dragOverPinTarget,
                    onPinDragOver: dragOverPinTarget,
                    onPinDragLeave: dragLeavePinTarget,
                    onPinDrop: dropOnPinTarget,
                    onSessionDragStart: startSessionDrag,
                    onSessionDragEnd: clearDrag,
                  }),
                ),
          ),
      renderViewMenu(),
      sectionMenu !== null
        ? h(
            'div',
            {
              className: 'ct-wb-menu',
              role: 'menu',
              style: { left: `${sectionMenu.left}px`, top: `${sectionMenu.top}px`, width: `${sectionMenu.width}px` },
            },
            [
              { label: '新建会话', run: () => createSession(workspaceIdOfSession(currentId) ?? sectionMenu.section.workspaceId, sectionMenu.section.id) },
              { label: '全选', disabled: true, title: '多选正在接入' },
              { label: '重命名分区', run: () => renameSection(sectionMenu.section) },
              { label: '全部折叠', run: () => toggleSectionBranches(sectionMenu.section, true) },
              { label: '全部展开', run: () => toggleSectionBranches(sectionMenu.section, false) },
              { label: '全部归档', run: () => archiveSection(sectionMenu.section) },
              { label: '删除所有会话', disabled: true, title: 'DSH 暂不支持永久删除会话' },
              { label: '删除分区', run: () => deleteSection(sectionMenu.section), danger: true },
            ].map((item) =>
              h(
                'button',
                {
                  key: item.label,
                  type: 'button',
                  role: 'menuitem',
                  disabled: item.disabled === true,
                  title: item.title,
                  className: `ct-wb-menu-item${item.disabled ? ' is-disabled' : ''}${item.danger ? ' is-danger' : ''}`,
                  onClick: item.disabled ? undefined : () => {
                    setSectionMenu(null)
                    item.run()
                  },
                },
                item.label,
              ),
            ),
          )
        : null,
      groupMenu !== null
        ? h(
            'div',
            {
              className: 'ct-wb-menu',
              role: 'menu',
              style: { left: `${groupMenu.left}px`, top: `${groupMenu.top}px`, width: `${groupMenu.width}px` },
            },
            [
              { label: '全部折叠', run: () => toggleAnyGroupBranches(groupMenu.group, true) },
              { label: '全部展开', run: () => toggleAnyGroupBranches(groupMenu.group, false) },
              { label: '全部归档', run: () => archiveAnyGroup(groupMenu.group) },
              { label: '删除所有会话', disabled: true, title: 'DSH 暂不支持永久删除会话' },
              { label: '分组和排序…', run: () => { const menu = groupMenu; setGroupMenu(null); setViewMenu({ left: menu.left, top: menu.top }) } },
            ].map((item) =>
              h(
                'button',
                {
                  key: item.label,
                  type: 'button',
                  role: 'menuitem',
                  disabled: item.disabled === true,
                  title: item.title,
                  className: `ct-wb-menu-item${item.disabled ? ' is-disabled' : ''}`,
                  onClick: item.disabled ? undefined : () => { setGroupMenu(null); item.run() },
                },
                item.label,
              ),
            ),
          )
        : null,
      workspaceMenu !== null
        ? h(
            'div',
            {
              className: 'ct-wb-menu',
              role: 'menu',
              style: { left: `${workspaceMenu.left}px`, top: `${workspaceMenu.top}px`, width: `${workspaceMenu.width}px` },
            },
            [
              { label: '新建会话', run: () => createSession(workspaceMenu.group.workspaceId) },
              { label: '全选', disabled: true, title: '多选正在接入' },
              { label: '全部折叠', run: () => toggleWorkspaceBranches(workspaceMenu.group, true) },
              { label: '全部展开', run: () => toggleWorkspaceBranches(workspaceMenu.group, false) },
              { label: '全部归档', run: () => archiveWorkspace(workspaceMenu.group) },
              { label: '重命名工作区', run: () => renameWorkspace(workspaceMenu.group) },
              { label: '删除所有会话', disabled: true, title: 'DSH 暂不支持永久删除会话' },
              { label: '删除工作区', run: () => deleteWorkspace(workspaceMenu.group), danger: true },
            ].map((item) =>
              h(
                'button',
                {
                  key: item.label,
                  type: 'button',
                  role: 'menuitem',
                  disabled: item.disabled === true,
                  title: item.title,
                  className: `ct-wb-menu-item${item.disabled ? ' is-disabled' : ''}${item.danger ? ' is-danger' : ''}`,
                  onClick: item.disabled ? undefined : () => {
                    setWorkspaceMenu(null)
                    item.run()
                  },
                },
                item.label,
              ),
            ),
          )
        : null,
      menu !== null
        ? h(
            'div',
            {
              className: 'ct-wb-menu ct-wb-session-menu',
              role: 'menu',
              style: { left: `${menu.left}px`, top: `${menu.top}px`, width: `${menu.width}px` },
            },
            renderSessionMenu(),
          )
        : null,
      dialog !== null
        ? h(
            'div',
            {
              className: 'ct-dialog-backdrop',
              onPointerDown: (event) => {
                if (event.target === event.currentTarget) setDialog(null)
              },
            },
            h(
              'div',
              {
                className: 'ct-dialog',
                role: dialog.type === 'confirm' ? 'alertdialog' : 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'ct-dialog-title',
              },
              h('h2', { id: 'ct-dialog-title', className: 'ct-dialog-title' }, dialog.title),
              dialog.type === 'text'
                ? h(
                    'label',
                    { className: 'ct-dialog-field' },
                    h('span', { className: 'ct-dialog-label' }, dialog.label),
                    h('input', {
                      ref: dialogInputRef,
                      className: 'ct-dialog-input',
                      value: dialog.value,
                      placeholder: dialog.placeholder,
                      onChange: (event) => setDialog((previous) => previous === null ? previous : { ...previous, value: event.target.value }),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                          event.preventDefault()
                          submitDialog()
                        }
                      },
                    }),
                  )
                : h('p', { className: 'ct-dialog-message' }, dialog.message),
              h(
                'div',
                { className: 'ct-dialog-actions' },
                h('button', { type: 'button', className: 'ct-dialog-button', onClick: () => setDialog(null) }, '取消'),
                h(
                  'button',
                  {
                    type: 'button',
                    className: `ct-dialog-button is-primary${dialog.danger ? ' is-danger' : ''}`,
                    disabled: dialog.type === 'text' && dialog.value.trim() === '',
                    onClick: submitDialog,
                  },
                  dialog.confirmLabel,
                ),
              ),
            ),
          )
        : null,
      searchOpen
        ? h(
            'div',
            {
              className: 'ct-search-backdrop',
              onPointerDown: (event) => {
                if (event.target === event.currentTarget) closeSearch()
              },
            },
            h(
              'div',
              {
                className: 'ct-search-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-label': '搜索',
                onKeyDown: handleSearchKeyDown,
              },
              h(
                'div',
                { className: 'ct-search-head' },
                h('span', { className: 'ct-search-head-icon', 'aria-hidden': 'true' }, iconSearch()),
                h('input', {
                  ref: searchInputRef,
                  className: 'ct-search-input',
                  type: 'text',
                  autoFocus: true,
                  placeholder: '搜索会话、项目或操作…',
                  value: query,
                  onChange: (event) => {
                    setQuery(event.target.value)
                    setSearchSelection(0)
                  },
                  'aria-label': '搜索',
                }),
                h('button', { type: 'button', className: 'ct-search-close', 'aria-label': '关闭搜索', onClick: closeSearch }, '×'),
              ),
              h(
                'div',
                { className: 'ct-search-tabs', role: 'tablist' },
                SEARCH_TABS.map((tab) =>
                  h(
                    'button',
                    {
                      key: tab.id,
                      type: 'button',
                      role: 'tab',
                      'aria-selected': searchTab === tab.id,
                      className: `ct-search-tab${searchTab === tab.id ? ' is-active' : ''}`,
                      onClick: () => switchSearchTab(tab.id),
                    },
                    tab.label,
                  ),
                ),
              ),
              h(
                'div',
                { className: 'ct-search-body' },
                searchSections.length === 0
                  ? h(
                      'div',
                      { className: 'ct-search-empty' },
                      searchRemoteLoading
                        ? '搜索中…'
                        : normalizedQuery === ''
                          ? '没有匹配结果'
                          : `在 ${activeSearchTabLabel} 中未找到与“${normalizedQuery}”相关的结果`,
                      normalizedQuery !== '' && !searchRemoteLoading && searchTab !== 'all'
                        ? h(
                            'button',
                            { type: 'button', className: 'ct-search-empty-action', onClick: () => switchSearchTab('all') },
                            '搜索全部',
                          )
                        : null,
                    )
                  : searchSections.map((section) =>
                      h(
                        'section',
                        { className: 'ct-search-section', key: section.label },
                        h('div', { className: 'ct-search-section-label' }, section.label),
                        section.items.map((item) =>
                          h(
                            'button',
                            {
                              key: item.key,
                              type: 'button',
                              role: 'option',
                              'aria-selected': item.flatIndex === selectedSearchItem?.flatIndex,
                              className: `ct-search-result${item.flatIndex === selectedSearchItem?.flatIndex ? ' is-selected' : ''}`,
                              onMouseEnter: () => setSearchSelection(item.flatIndex),
                              onClick: () => runSearchItem(item),
                            },
                            h(
                              'span',
                              { className: 'ct-search-result-icon', 'aria-hidden': 'true' },
                              item.kind === 'project' ? iconFolder(false) : item.kind === 'automation' ? iconStatus() : item.kind === 'action' ? iconPlus() : iconSession(),
                            ),
                            h('span', { className: 'ct-search-result-title' }, item.title),
                            h('span', { className: 'ct-search-result-meta' }, item.meta),
                          ),
                        ),
                      ),
                    ),
                normalizedQuery !== '' && remoteSearch.status === 'loading' && searchSections.length > 0
                  ? h('div', { className: 'ct-search-status' }, '正在搜索更多内容…')
                  : null,
                remoteSearch.hasMore ? h('div', { className: 'ct-search-status' }, `仅显示前 ${sessions.searchResultLimit ?? 50} 条结果`) : null,
              ),
              h(
                'div',
                { className: 'ct-search-footer' },
                h('span', null, '关闭 ', h('kbd', null, 'Esc')),
                h('span', null, '切换类型 ', h('kbd', null, '←'), h('kbd', null, '→')),
                h('span', null, '选择 ', h('kbd', null, '↑'), h('kbd', null, '↓')),
                h('span', null, '打开 ', h('kbd', null, '↵')),
              ),
            ),
          )
        : null,
      renderSplitDropLayer(),
      dragHint !== null
        ? h('div', {
            className: 'ct-wb-drag-hint',
            role: 'status',
            style: {
              left: `${Math.min(dragHint.x, window.innerWidth - 220)}px`,
              top: `${Math.min(dragHint.y, window.innerHeight - 48)}px`,
            },
          }, dragHint.text)
        : null,
      toast !== '' ? h('div', { className: 'ct-wb-toast', role: 'status' }, toast) : null,
      hoverCard !== null
        ? h(
            'div',
            {
              className: 'ct-wb-hover-card',
              style: { left: `${hoverCard.left}px`, top: `${hoverCard.top}px` },
              role: 'tooltip',
            },
            h('div', { className: 'ct-wb-hover-title' }, sessionTitle(hoverCard.summary)),
            h('div', { className: 'ct-wb-hover-time' }, formatTime(hoverCard.summary.updatedAt, now)),
            h('div', { className: 'ct-wb-hover-status' }, hoverCard.summary.running ? '运行中' : '空闲'),
            hoverCard.workspace !== undefined ? h('div', { className: 'ct-wb-hover-workspace' }, hoverCard.workspace) : null,
            hoverCard.summary.cwd !== undefined ? h('div', { className: 'ct-wb-hover-path' }, hoverCard.summary.cwd) : null,
          )
        : null,
    )
  }
}

function renderSearchResult({ result, currentId, now, archivedIds, onOpen }) {
  return h(
    'div',
    {
      key: result.id,
      className: `ct-wb-search-row${result.id === currentId ? ' is-current' : ''}${result.archived ? ' is-archived' : ''}`,
      role: 'treeitem',
      onClick: onOpen,
    },
    h(
      'span',
      { className: 'ct-wb-slot', 'aria-hidden': 'true' },
      result.running ? h('span', { className: 'ct-wb-status is-running' }) : null,
      result.archived ? h('span', { className: 'ct-wb-status is-archived' }) : null,
    ),
    h(
      'span',
      { className: 'ct-wb-search-body' },
      h('span', { className: 'ct-wb-search-title' }, result.title),
      h(
        'span',
        { className: 'ct-wb-search-meta' },
        h('span', { className: 'ct-wb-search-workspace' }, result.workspace),
        result.snippet !== undefined ? h('span', { className: 'ct-wb-search-snippet' }, result.snippet) : null,
      ),
    ),
    h('span', { className: 'ct-wb-time' }, formatTime(result.updatedAt, now)),
  )
}

function SessionLeading({ summary, archived, useSessionStatus, renderSlot }) {
  const statuses = typeof useSessionStatus === 'function' ? useSessionStatus((snapshot) => snapshot) : null
  const status = statuses?.get?.(summary.id)
  const running = status?.running ?? summary.running === true
  const pending = status?.pendingInteraction !== undefined && status.pendingInteraction !== null
  const unread = status?.completionUnread === true
  if (pending || running || unread || archived) {
    return h('span', {
      className: `ct-wb-status${pending ? ' is-pending' : running ? ' is-running' : unread ? ' is-unread' : ' is-archived'}`,
      'aria-label': pending ? '等待交互' : running ? '运行中' : unread ? '有未读结果' : '已归档',
    })
  }
  if (typeof renderSlot !== 'function') return null
  return renderSlot('sidebar.session.row.leading', { sessionId: summary.id })
}

/** 一行工作区 + 它的会话树。 */
function renderGroup({
  group,
  expanded,
  collapsedBranches,
  currentId,
  selectedIds,
  currentWorkspaceId,
  pinnedIds,
  archivedIds,
  now,
  onToggleGroup,
  onToggleBranch,
  onOpenSession,
  onCreate,
  onOpenMenu,
  onOpenWorkspaceMenu,
  onOpenSectionMenu,
  onOpenGroupMenu,
  onOpenViewMenu,
  sectionDropId,
  groupDropKey,
  workspaceDrop,
  workspaceReorder,
  onWorkspaceDragStart,
  onWorkspaceDragEnd,
  onWorkspaceDragOver,
  onWorkspaceDragLeave,
  onWorkspaceDrop,
  onGroupDragOver,
  onGroupDragLeave,
  onGroupDrop,
  onSectionDragOver,
  onSectionDragLeave,
  onSectionDrop,
  searchMode,
  useSessionStatus,
  renderSlot,
  onHoverStart,
  onHoverEnd,
  dragState,
  pinDropActive,
  onPinDragEnter,
  onPinDragOver,
  onPinDragLeave,
  onPinDrop,
  onSessionDragStart,
  onSessionDragEnd,
  sortSpec,
  statusSnapshot,
}) {
  const isPinned = group.pinned === true
  const isFlat = group.flat === true
  const isSection = group.kind === 'section'
  const isWorkspace = group.kind === 'workspace'
  const sectionView = isSection && group.view !== undefined ? normalizeSectionView(group.view) : undefined
  const localSortSpec = sectionView === undefined ? sortSpec : { ...sortSpec, orderBy: sectionView.orderBy, direction: sectionView.direction }
  const rows = buildTree(group.members, localSortSpec).map((row) => ({ ...row, workspace: isPinned ? '已置顶' : group.title }))
  const groupExpanded = isPinned && dragState?.kind === 'session' ? true : expanded
  const renderRows = (list) => {
    const nodes = []
    for (const [index, row] of list.entries()) {
      const next = list[index + 1]
      const isLastChild = row.depth > 0 && (next === undefined || next.depth === 0 || next.rootId !== row.rootId)
      nodes.push(
        renderSessionRow({
          row,
          isLastChild,
          currentId,
          selectedIds,
          collapsedBranches,
          pinnedIds,
          archivedIds,
          now,
          searchMode,
          useSessionStatus,
          renderSlot,
          onHoverStart,
          onHoverEnd,
          dragState,
          onSessionDragStart,
          onSessionDragEnd,
          onToggleBranch,
          onOpenSession,
          onOpenMenu,
          statusSnapshot,
        }),
      )
      if (!searchMode && row.depth === 0 && row.children.length > 0 && collapsedBranches.has(row.summary.id)) {
        nodes.push(
          renderCollapsedSummary({
            count: row.children.length,
            rootId: row.summary.id,
            onToggleBranch,
          }),
        )
      }
    }
    return nodes
  }
  const rowNodes = renderRows(rows)
  const sectionSubgroups = sectionView !== undefined && sectionView.groupBy === 'date'
    ? buildDateGroups(group.members, localSortSpec)
    : sectionView !== undefined && sectionView.groupBy === 'status'
      ? buildStatusGroups(group.members, statusSnapshot, localSortSpec)
      : undefined
  if (isFlat) {
    return h(
      'section',
      { className: 'ct-wb-group ct-wb-group-flat', key: group.key },
      h(
        'div',
        { className: 'ct-wb-rows', role: 'group' },
        rowNodes.length === 0 ? h('div', { className: 'ct-wb-empty' }, '暂无会话') : rowNodes,
      ),
    )
  }
  const icon = isPinned
    ? h('span', { className: 'ct-wb-folder', 'aria-hidden': 'true' }, iconPin())
    : group.kind === 'date'
      ? h('span', { className: 'ct-wb-group-icon', 'aria-hidden': 'true' }, iconCalendar())
      : group.kind === 'status'
        ? h('span', { className: 'ct-wb-group-icon', 'aria-hidden': 'true' }, iconStatus())
        : h('span', { className: 'ct-wb-folder', 'aria-hidden': 'true' }, iconFolder(expanded))
  const isWorkspaceDrag = dragState !== null && dragState.kind === 'workspace'
  const dropHalf = workspaceDrop !== null && workspaceDrop.id === group.workspaceId ? workspaceDrop.half : null
  const groupDragEnter = (event) => {
    if (isWorkspaceDrag) {
      onWorkspaceDragOver(event, group)
      return
    }
    if (isPinned) onPinDragEnter(event)
    else if (isSection) onSectionDragOver(event, group)
    else onGroupDragOver(event, group)
  }
  const groupDragOver = (event) => {
    if (isWorkspaceDrag) {
      onWorkspaceDragOver(event, group)
      return
    }
    if (isPinned) onPinDragOver(event)
    else if (isSection) onSectionDragOver(event, group)
    else onGroupDragOver(event, group)
  }
  const groupDragLeave = (event) => {
    if (isWorkspaceDrag) {
      onWorkspaceDragLeave(event)
      return
    }
    if (isPinned) onPinDragLeave(event)
    else if (isSection) onSectionDragLeave(event)
    else onGroupDragLeave(event)
  }
  const groupDrop = (event) => {
    if (isWorkspaceDrag) {
      onWorkspaceDrop(event, group)
      return
    }
    if (isPinned) onPinDrop(event)
    else if (isSection) onSectionDrop(event, group)
    else onGroupDrop(event, group)
  }
  const canDragWorkspace = workspaceReorder && isWorkspace && group.workspaceId !== undefined
  return h(
    'section',
    {
      className: `ct-wb-group${isPinned ? ' is-pinned' : ''}${isPinned && pinDropActive ? ' is-pin-active' : ''}${isPinned && group.preview ? ' is-drop-preview' : ''}${isSection ? ' is-section' : ''}${isSection && sectionDropId === group.sectionId ? ' is-section-drop' : ''}${!isPinned && !isSection && groupDropKey === group.key ? ' is-group-drop' : ''}${dropHalf === 'before' ? ' is-workspace-drop-before' : ''}${dropHalf === 'after' ? ' is-workspace-drop-after' : ''}`,
      key: group.key,
      'data-ct-wb-group': group.key,
      'data-ct-wb-workspace': isWorkspace ? group.workspaceId : undefined,
      onDragEnter: groupDragEnter,
      onDragOver: groupDragOver,
      onDragLeave: groupDragLeave,
      onDrop: groupDrop,
    },
    h(
      'div',
      {
        className: `ct-wb-project${expanded ? ' is-expanded' : ''}${isPinned ? ' is-pinned' : ''}`,
        role: 'treeitem',
        'aria-expanded': groupExpanded,
        draggable: canDragWorkspace ? true : undefined,
        onDragStart: canDragWorkspace ? (event) => onWorkspaceDragStart(event, group) : undefined,
        onDragEnd: canDragWorkspace ? onWorkspaceDragEnd : undefined,
        onClick: () => onToggleGroup(group.key),
        onContextMenu: isSection ? (event) => onOpenSectionMenu(event, group) : group.workspaceId === undefined ? (event) => onOpenGroupMenu(event, group) : (event) => onOpenWorkspaceMenu(event, group),
      },
      icon,
      h(Tooltip, {
        label: group.path ?? '',
        side: 'top',
        delayMs: 400,
        portal: true,
      }, h('span', { className: 'ct-wb-project-title' }, group.title)),
      h('span', { className: 'ct-wb-project-chevron', 'aria-hidden': 'true' }, iconChevron(groupExpanded)),
      isFlat
        ? null
        : h(
            'span',
            { className: 'ct-wb-project-actions' },
            h(
              Tooltip,
              { label: '分组和排序', side: 'top', align: 'center', delayMs: 200, portal: true },
              h(
                'button',
                {
                  type: 'button',
                  className: 'ct-wb-icon-btn',
                  'aria-label': '分组和排序',
                  'data-ct-wb-view-trigger': '',
                  onClick: (event) => {
                    event.stopPropagation()
                    onOpenViewMenu(event, isSection ? group.sectionId : undefined)
                  },
                },
                iconSort(),
              ),
            ),
            isWorkspace || isSection
              ? h(
                  Tooltip,
                  {
                    label: '新建会话（⌘N）',
                    side: 'top',
                    delayMs: 400,
                    portal: true,
                  },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'ct-wb-icon-btn',
                      'aria-label': '新建会话',
                      'aria-keyshortcuts': 'Meta+N Control+N',
                      onClick: (event) => {
                        event.stopPropagation()
                        onCreate(isSection ? (currentWorkspaceId ?? group.workspaceId) : group.workspaceId, isSection ? group.sectionId : undefined)
                      },
                    },
                    iconPlus(),
                  ),
                )
              : null,
          ),
    ),
    groupExpanded
      ? h(
          'div',
          { className: 'ct-wb-rows', role: 'group' },
          sectionSubgroups !== undefined
            ? sectionSubgroups.length === 0
              ? h('div', { className: 'ct-wb-empty ct-wb-empty-group' }, '暂无会话')
              : sectionSubgroups.map((subgroup) =>
                  h(
                    'div',
                    { className: 'ct-wb-subgroup', key: subgroup.key },
                    h('div', { className: 'ct-wb-subgroup-label' }, subgroup.title),
                    h('div', { className: 'ct-wb-rows' }, renderRows(buildTree(subgroup.members, localSortSpec))),
                  ),
                )
            : rowNodes.length === 0
              ? isPinned
                ? h(
                    'div',
                    { className: 'ct-wb-pin-hint' },
                    h('span', { className: 'ct-wb-pin-hint-icon', 'aria-hidden': 'true' }, iconPin()),
                    h('span', null, pinDropActive ? '松开以置顶' : '拖放到此处'),
                  )
                : h('div', { className: 'ct-wb-empty ct-wb-empty-group' }, '暂无会话')
              : rowNodes,
        )
      : null,
  )
}

function renderCollapsedSummary({ count, rootId, onToggleBranch }) {
  return h(
    Tooltip,
    {
      key: `summary:${rootId}`,
      label: '显示嵌套会话',
      side: 'top',
      delayMs: 400,
      portal: true,
      asChild: true,
    },
    h(
      'button',
      {
        type: 'button',
        className: 'ct-wb-row ct-wb-summary is-child is-last-child',
        role: 'treeitem',
        'aria-expanded': false,
        onClick: (event) => {
          event.stopPropagation()
          onToggleBranch(rootId)
        },
      },
      h('span', { className: 'ct-wb-slot', 'aria-hidden': 'true' }),
      h('span', { className: 'ct-wb-title-wrap' }, h('span', { className: 'ct-wb-title ct-wb-summary-text' }, `${count} 个嵌套会话`)),
    ),
  )
}

function renderSessionRow({
  row,
  isLastChild,
  currentId,
  selectedIds,
  collapsedBranches,
  pinnedIds,
  archivedIds,
  now,
  searchMode,
  useSessionStatus,
  renderSlot,
  onHoverStart,
  onHoverEnd,
  dragState,
  onSessionDragStart,
  onSessionDragEnd,
  onToggleBranch,
  onOpenSession,
  onOpenMenu,
  statusSnapshot,
}) {
  const { summary, depth, children } = row
  const hidden = !searchMode && depth > 0 && collapsedBranches.has(row.rootId)
  const title = sessionTitle(summary)
  const isCurrent = summary.id === currentId
  const isSelected = isCurrent || (selectedIds instanceof Set && selectedIds.has(summary.id))
  const isArchived = archivedIds.has(summary.id)
  const status = statusSnapshot?.get?.(summary.id)
  const pending = status?.pendingInteraction !== undefined && status.pendingInteraction !== null
  const running = !pending && (status?.running ?? summary.running === true)
  return h(
    'div',
    {
      key: summary.id,
      className: `ct-wb-row${depth > 0 ? ' is-child' : ''}${isLastChild ? ' is-last-child' : ''}${isCurrent ? ' is-current' : ''}${isSelected ? ' is-selected' : ''}${isArchived ? ' is-archived' : ''}${hidden ? ' is-hidden' : ''}${dragState?.kind === 'session' && dragState.id === summary.id ? ' is-dragging' : ''}`,
      role: 'treeitem',
      'aria-selected': isSelected,
      'aria-current': isCurrent ? 'true' : undefined,
      'data-ct-wb-session': summary.id,
      draggable: !isArchived,
      onDragStart: (event) => onSessionDragStart(event, summary),
      onDragEnd: onSessionDragEnd,
      onClick: () => onOpenSession(summary),
      onContextMenu: (event) => onOpenMenu(event, summary),
      onMouseEnter: (event) => onHoverStart(summary, row.workspace, event.currentTarget),
      onMouseLeave: onHoverEnd,
    },
    h(
      'span',
      { className: 'ct-wb-slot', 'aria-hidden': 'true' },
      h(SessionLeading, { summary, archived: isArchived, useSessionStatus, renderSlot }),
    ),
    h(
      'span',
      { className: 'ct-wb-title-wrap' },
      h(
        'span',
        { className: 'ct-wb-title' },
        title,
        running ? h('span', { className: 'ct-wb-title-sheen', 'aria-hidden': 'true' }, title) : null,
      ),
      children.length > 0
        ? h(
            Tooltip,
            {
              label: collapsedBranches.has(summary.id) ? '显示嵌套会话' : '隐藏嵌套会话',
              side: 'bottom',
              delayMs: 400,
              portal: true,
            },
            h(
              'button',
              {
                type: 'button',
                className: 'ct-wb-toggle',
                'aria-label': collapsedBranches.has(summary.id) ? '显示嵌套会话' : '隐藏嵌套会话',
                'aria-expanded': !collapsedBranches.has(summary.id),
                onClick: (event) => {
                  event.stopPropagation()
                  onToggleBranch(summary.id)
                },
              },
              iconChevron(!collapsedBranches.has(summary.id)),
            ),
          )
        : null,
    ),
    pinnedIds.has(summary.id) && !isArchived ? h('span', { className: 'ct-wb-pin', 'aria-label': '已置顶' }, '📌') : null,
    h(
      'button',
      {
        type: 'button',
        className: 'ct-wb-more',
        'aria-label': `会话「${title}」的操作`,
        'data-ct-wb-session-trigger': '',
        onClick: (event) => onOpenMenu(event, summary),
      },
      iconMore(),
    ),
  )
}

function useStore(store) {
  return React.useSyncExternalStore(
    React.useCallback((listener) => store.subscribe(listener), [store]),
    React.useCallback(() => store.getSnapshot(), [store]),
  )
}

/**
 * 会话行标题：只认持久化标题，缺失时给中性占位。
 *
 * 不能用 `summary.displayTitle`：DSH 对它的定义是「标题 → 项目目录名 → 会话 id」，
 * 只适合菜单等"总要有个名字"的场景。把它当行标题会在标题尚未加载时把会话
 * 显示成项目名，和 Claude Code（未命名会话）不一致。
 */
function sessionTitle(summary) {
  if (summary === undefined || summary === null) return ''
  const title = typeof summary.title === 'string' ? summary.title.trim() : ''
  if (title !== '') return title
  return summary.blank === true ? '新会话' : '未命名会话'
}

/**
 * 补齐缺失的会话标题。
 *
 * DSH 的列表投影缓存是进程内状态：另一个宿主进程（桌面端 / 另一个 `dsh web`）
 * 新建的会话，本进程的 session.list 可能不带 projections，client 因此拿不到
 * title，`displayTitle` 就退回项目目录名。`refreshProjections` 走的是与会话
 * 打开时相同的 exact projections 读取（直接读会话日志），标题落进 store 后
 * 列表会自行重算，不需要用户点一下。
 */
function useMissingSessionTitles(sessions, summaries) {
  const requested = React.useRef(new Set())
  React.useEffect(() => {
    if (typeof sessions?.refreshProjections !== 'function') return
    const pending = []
    for (const summary of summaries) {
      if (summary === undefined || summary === null) continue
      if (summary.blank === true || summary.origin === 'subagent') continue
      if (typeof summary.title === 'string' && summary.title !== '') continue
      if (requested.current.has(summary.id)) continue
      requested.current.add(summary.id)
      pending.push(summary.id)
    }
    if (pending.length === 0) return
    let cursor = 0
    const worker = async () => {
      while (cursor < pending.length) {
        const id = pending[cursor]
        cursor += 1
        try {
          await sessions.refreshProjections(id)
        } catch {
          // 失败留给下一轮快照重试；成功但确实没有标题的会话不再重复读。
          requested.current.delete(id)
        }
      }
    }
    void Promise.all([worker(), worker(), worker()])
  }, [sessions, summaries])
}

/** 标题/工作区本地匹配 + Host 内容搜索，合并成一个 flat 结果列表。 */
function buildSearchResults({ sessionSnap, workspaceSnap, archivedFilter, archivedIds, query, remote, limit }) {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  const byId = sessionSnap.byId
  const labelById = new Map()
  for (const workspace of workspaceSnap.items ?? []) {
    const label = workspace.title || basename(workspace.path ?? '')
    for (const sessionId of workspace.sessionIds ?? []) labelById.set(sessionId, label)
  }
  for (const sessionId of sessionSnap.ids ?? []) {
    if (!labelById.has(sessionId)) labelById.set(sessionId, basename(byId[sessionId]?.cwd ?? ''))
  }
  const visible = (summary) => {
    if (summary === undefined || summary.blank) return false
    const archived = archivedIds.has(summary.id)
    if (archivedFilter === 'default' && archived) return false
    if (archivedFilter === 'only' && !archived) return false
    return true
  }

  const local = (sessionSnap.ids ?? [])
    .map((sessionId) => byId[sessionId])
    .filter((summary) => visible(summary))
    .filter((summary) => {
      const title = `${summary.title ?? ''}`.toLowerCase()
      const workspace = (labelById.get(summary.id) ?? '').toLowerCase()
      return title.includes(q) || workspace.includes(q)
    })
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))

  const ordered = []
  const seen = new Set()
  const include = (summary, snippet) => {
    if (summary === undefined || !visible(summary) || seen.has(summary.id)) return
    seen.add(summary.id)
    ordered.push({
      id: summary.id,
      title: sessionTitle(summary),
      workspace: labelById.get(summary.id) ?? basename(summary.cwd ?? ''),
      snippet: typeof snippet === 'string' && snippet !== '' ? snippet : undefined,
      archived: archivedIds.has(summary.id),
      running: summary.running === true,
      updatedAt: summary.updatedAt,
    })
  }
  for (const summary of local) include(summary)
  if (remote.query === query && Array.isArray(remote.items)) {
    for (const item of remote.items) {
      if (item === null || typeof item !== 'object' || typeof item.sessionId !== 'string') continue
      include(byId[item.sessionId], item.snippet)
    }
  }
  return ordered.slice(0, Math.max(1, limit))
}

const STATUS_GROUPS = [
  { id: 'pending', label: '等待交互', rank: 0 },
  { id: 'running', label: '运行中', rank: 1 },
  { id: 'unread', label: '未读结果', rank: 2 },
  { id: 'idle', label: '空闲', rank: 3 },
]

function sessionStatusKind(status, summary) {
  if (status?.pendingInteraction !== undefined && status.pendingInteraction !== null) return 'pending'
  if (status?.running === true || summary.running === true) return 'running'
  if (status?.completionUnread === true) return 'unread'
  return 'idle'
}

function dateBucket(timestamp) {
  const date = new Date(timestamp ?? 0)
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000
  if (start === todayStart) return { key: `date:${start}`, label: '今天', at: start }
  if (start === yesterdayStart) return { key: `date:${start}`, label: '昨天', at: start }
  return { key: `date:${start}`, label: `${date.getMonth() + 1}月${date.getDate()}日`, at: start }
}

function buildDateGroups(members, sortSpec) {
  const rows = buildTree(members, sortSpec)
  const buckets = new Map()
  for (let index = 0; index < rows.length;) {
    const rootRow = rows[index]
    const block = [rootRow.summary]
    let cursor = index + 1
    while (cursor < rows.length && rows[cursor].depth > 0) {
      block.push(rows[cursor].summary)
      cursor += 1
    }
    const latest = block.reduce((value, summary) => Math.max(value, summary.updatedAt ?? 0), 0)
    const bucket = dateBucket(latest)
    const group = buckets.get(bucket.key) ?? { key: bucket.key, title: bucket.label, kind: 'date', at: bucket.at, members: [] }
    group.members.push(...block)
    buckets.set(bucket.key, group)
    index = cursor
  }
  return [...buckets.values()].sort((left, right) => (sortSpec.direction === 'asc' ? left.at - right.at : right.at - left.at))
}

function buildStatusGroups(members, statusSnapshot, sortSpec) {
  const byId = new Map(members.map((summary) => [summary.id, summary]))
  const rootKind = new Map()
  for (const summary of members) {
    const root = treeRoot(summary, byId)
    const kind = sessionStatusKind(statusSnapshot?.get?.(summary.id), summary)
    const current = rootKind.get(root.id)
    const rank = STATUS_GROUPS.find((item) => item.id === kind)?.rank ?? 3
    if (current === undefined || rank < current.rank) rootKind.set(root.id, { id: kind, rank })
  }
  const groups = new Map()
  for (const summary of members) {
    const root = treeRoot(summary, byId)
    const kind = rootKind.get(root.id)?.id ?? 'idle'
    const group = groups.get(kind) ?? { key: `status:${kind}`, title: STATUS_GROUPS.find((item) => item.id === kind)?.label ?? '空闲', kind: 'status', status: kind, members: [] }
    group.members.push(summary)
    groups.set(kind, group)
  }
  return [...groups.values()].sort((left, right) => (STATUS_GROUPS.find((item) => item.id === left.status)?.rank ?? 9) - (STATUS_GROUPS.find((item) => item.id === right.status)?.rank ?? 9))
}

/** 归一化工作区/会话的目录写法；只用于跨进程会话补分组，不做 realpath。 */
function normalizeWorkspacePath(value) {
  if (typeof value !== 'string' || value === '') return ''
  const trimmed = value.replace(/[\\/]+$/, '')
  return trimmed === '' ? '/' : trimmed
}

function buildGroups(workspaceSnap, sessionSnap, { currentId, activeId, archivedIds, pinnedIds, archivedFilter, query }) {
  const byId = sessionSnap.byId
  const normalizedQuery = query.trim().toLowerCase()
  const isVisible = (summary) => {
    if (summary === undefined) return false
    if (summary.origin === 'subagent') return false
    if (summary.blank && summary.id !== currentId && summary.id !== activeId) return false
    if (normalizedQuery !== '') {
      const text = `${summary.title ?? ''}`.toLowerCase()
      if (!text.includes(normalizedQuery)) return false
    }
    const archived = archivedIds.has(summary.id)
    if (archivedFilter === 'default') return !archived
    if (archivedFilter === 'only') return archived
    return true
  }

  const workspaces = workspaceSnap.items ?? []
  const workspaceIdByPath = new Map()
  for (const workspace of workspaces) {
    const path = normalizeWorkspacePath(workspace.path)
    if (path !== '') workspaceIdByPath.set(path, workspace.workspaceId)
  }
  const accounted = new Set()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds ?? []) accounted.add(sessionId)
  }
  // 桌面端与 dsh web 是两个宿主进程，各自持有内存里的 workspace.sessionIds。
  // 另一进程 fork/新建的会话可能已经落盘，却没有进入本进程的 workspace 快照；
  // 这里用会话 header 的 cwd 与工作区 path 对齐，把它补回项目分组，
  // 否则它会掉进默认折叠的「未分组」，看起来像会话消失。
  const extraByWorkspace = new Map()
  for (const sessionId of sessionSnap.ids ?? []) {
    const summary = byId[sessionId]
    if (summary === undefined || accounted.has(summary.id)) continue
    const workspaceId = workspaceIdByPath.get(normalizeWorkspacePath(summary.cwd))
    if (workspaceId === undefined) continue
    const extras = extraByWorkspace.get(workspaceId) ?? []
    extras.push(summary)
    extraByWorkspace.set(workspaceId, extras)
    accounted.add(summary.id)
  }

  const groups = []
  for (const workspace of workspaces) {
    const members = [
      ...(workspace.sessionIds ?? []).map((sessionId) => byId[sessionId]),
      ...(extraByWorkspace.get(workspace.workspaceId) ?? []),
    ].filter(isVisible)
    if (archivedFilter === 'only' && members.length === 0) continue
    if (normalizedQuery !== '' && members.length === 0) continue
    groups.push({
      key: workspace.workspaceId,
      workspaceId: workspace.workspaceId,
      title: workspace.title || basename(workspace.path ?? ''),
      path: workspace.path,
      members,
    })
  }

  const stray = (sessionSnap.ids ?? [])
    .map((sessionId) => byId[sessionId])
    .filter((summary) => summary !== undefined && !accounted.has(summary.id) && isVisible(summary))
  if (stray.length > 0) {
    groups.push({ key: '', workspaceId: undefined, title: '未分组', path: undefined, members: stray })
  }
  return groups
}

/**
 * 给缺少 parentId 的会话补上宿主回填的 fork 父关系。
 * 只在原生快照没有 parentId 时使用，header 里的血缘始终优先。
 */
function applyLineageParents(snapshot, parentById) {
  if (snapshot === undefined || snapshot === null) return snapshot
  if (!(parentById instanceof Map) || parentById.size === 0) return snapshot
  let changed = false
  const byId = { ...snapshot.byId }
  for (const [id, parentId] of parentById) {
    const summary = byId[id]
    if (summary === undefined || typeof parentId !== 'string' || summary.parentId !== undefined) continue
    byId[id] = { ...summary, parentId }
    changed = true
  }
  return changed ? { ...snapshot, byId } : snapshot
}

/** 沿 parentId 找到这一支的根；fork 树以根为单位置顶。 */
function treeRoot(summary, byId) {
  let current = summary
  const seen = new Set()
  while (current !== undefined && current.parentId !== undefined && byId[current.parentId] !== undefined && !seen.has(current.id)) {
    seen.add(current.id)
    current = byId[current.parentId]
  }
  return current ?? summary
}

function buildTree(members, sortSpec = DEFAULT_VIEW) {
  const byId = new Map(members.map((summary) => [summary.id, summary]))
  const createdAtOf = (summary) => sortSpec.createdAtById?.get(summary.id) ?? summary.createdAt ?? summary.updatedAt ?? 0
  const direction = sortSpec.direction === 'asc' ? 1 : -1
  const compareValues = (left, right) => {
    if (sortSpec.orderBy === 'name') {
      return direction * String(left).localeCompare(String(right), 'zh', { numeric: true, sensitivity: 'base' })
    }
    return direction * ((left ?? 0) - (right ?? 0))
  }
  const rootOf = new Map()
  for (const summary of members) {
    let root = summary.id
    let cursor = summary.id
    const seen = new Set([cursor])
    for (let guard = 0; guard < 32; guard += 1) {
      const parent = byId.get(cursor)?.parentId
      if (typeof parent !== 'string' || parent === cursor || seen.has(parent)) break
      seen.add(parent)
      if (byId.has(parent)) {
        root = parent
        cursor = parent
      } else {
        break
      }
    }
    rootOf.set(summary.id, root)
  }

  const children = new Map()
  for (const summary of members) {
    const root = rootOf.get(summary.id)
    if (root === summary.id) continue
    const list = children.get(root) ?? []
    list.push(summary)
    children.set(root, list)
  }

  const latestAt = (root) => {
    let latest = root.updatedAt ?? 0
    for (const descendant of children.get(root.id) ?? []) latest = Math.max(latest, descendant.updatedAt ?? 0)
    return latest
  }
  const rootValue = (root) => {
    if (sortSpec.orderBy === 'name') return root.title || ''
    if (sortSpec.orderBy === 'created') return createdAtOf(root)
    return latestAt(root)
  }
  const sessionValue = (summary) => {
    if (sortSpec.orderBy === 'name') return summary.title || ''
    if (sortSpec.orderBy === 'created') return createdAtOf(summary)
    return summary.updatedAt ?? 0
  }
  const roots = members.filter((summary) => rootOf.get(summary.id) === summary.id)
  roots.sort((left, right) => compareValues(rootValue(left), rootValue(right)) || members.indexOf(left) - members.indexOf(right))

  const rows = []
  for (const root of roots) {
    const descendants = [...(children.get(root.id) ?? [])].sort(
      (left, right) => compareValues(sessionValue(left), sessionValue(right)) || members.indexOf(left) - members.indexOf(right),
    )
    rows.push({ summary: root, depth: 0, rootId: root.id, children: descendants, workspace: undefined })
    for (const child of descendants) rows.push({ summary: child, depth: 1, rootId: root.id, children: [], workspace: undefined })
  }
  return rows
}

/** 计算一棵树里最新/最早的活动时间，供日期分组和排序使用。 */
function treeLatest(root, members) {
  let latest = root.updatedAt ?? 0
  for (const member of members) {
    if (member.id === root.id) continue
    if (treeRoot(member, new Map(members.map((item) => [item.id, item]))).id === root.id) latest = Math.max(latest, member.updatedAt ?? 0)
  }
  return latest
}


function basename(path) {
  if (typeof path !== 'string' || path === '') return ''
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function iconSvg(children) {
  return h(
    'svg',
    { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', 'stroke-width': 1 },
    children,
  )
}

function iconChevron(expanded) {
  return iconSvg(
    h('path', {
      d: expanded ? 'M4 6l4 4 4-4' : 'M6 3.5 10.5 8 6 12.5',
      stroke: 'currentColor',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  )
}

function iconFolder(open) {
  return iconSvg(
    h('path', {
      d: open ? 'M2 5.5h4l1.2 1.5H14v6H2z' : 'M2 4.5h4l1.2 1.5H14v6.5H2z',
      stroke: 'currentColor',
      'stroke-linejoin': 'round',
    }),
  )
}

function iconSearch() {
  return iconSvg([
    h('circle', { key: 'c', cx: 7, cy: 7, r: 4.2, stroke: 'currentColor' }),
    h('path', { key: 'p', d: 'M10.2 10.2 13.5 13.5', stroke: 'currentColor', 'stroke-linecap': 'round' }),
  ])
}

function iconSession() {
  return iconSvg([
    h('path', { key: 'l', d: 'M5.5 3.5 2 8l3.5 4.5', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    h('path', { key: 'r', d: 'M10.5 3.5 14 8l-3.5 4.5', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ])
}

function iconPin() {
  return iconSvg([
    h('path', {
      key: 'p',
      d: 'M9.5 2.5 13.5 6.5 11.8 8.2 11.6 10.5 9.3 8.2 6.5 11 5 9.5 7.8 6.7 5.5 4.4 7.8 4.2z',
      stroke: 'currentColor',
      'stroke-linejoin': 'round',
    }),
  ])
}

function iconCalendar() {
  return iconSvg([
    h('rect', { key: 'r', x: 2.5, y: 3.5, width: 11, height: 10, rx: 1.5, stroke: 'currentColor' }),
    h('path', { key: 'a', d: 'M2.5 6.5h11M5.5 2v3M10.5 2v3', stroke: 'currentColor', 'stroke-linecap': 'round' }),
  ])
}

function iconStatus() {
  return iconSvg([
    h('circle', { key: 'c', cx: 8, cy: 8, r: 5.5, stroke: 'currentColor' }),
    h('path', { key: 'p', d: 'M8 5v3.2l2 1.4', stroke: 'currentColor', 'stroke-linecap': 'round' }),
  ])
}

function iconSort() {
  return iconSvg([
    h('path', { key: 'up', d: 'M4.5 13V3.2M4.5 3.2 2 5.7M4.5 3.2 7 5.7', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    h('path', { key: 'down', d: 'M11.5 3v9.8M11.5 12.8 9 10.3M11.5 12.8 14 10.3', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ])
}

function iconPlus() {
  return iconSvg([
    h('path', { key: 'a', d: 'M8 3v10', stroke: 'currentColor', 'stroke-linecap': 'round' }),
    h('path', { key: 'b', d: 'M3 8h10', stroke: 'currentColor', 'stroke-linecap': 'round' }),
  ])
}

function iconMore() {
  return iconSvg([
    h('circle', { key: 'a', cx: 3, cy: 8, r: 1, fill: 'currentColor' }),
    h('circle', { key: 'b', cx: 8, cy: 8, r: 1, fill: 'currentColor' }),
    h('circle', { key: 'c', cx: 13, cy: 8, r: 1, fill: 'currentColor' }),
  ])
}

/* ============================================================================
 * 分屏视图
 *
 * 不接管 main keyed slot：原生 conversation+rightbar 留在左/上屏，其余会话用
 * frame 的 `shell.overlay` 画在右侧/下方。每个 overlay 叶子 = 一个外部 Session
 * reference + 一层 SessionProvider，在 pane scope 下通过 main 入口的 renderSlot
 * 渲染完整原生 `main.conversation` 子 slot（原生根/header/正文/composer/滚动），
 * 不复制聊天实现，也不自己拼会话根。同方向的叶子会摊平成一行/一列，避免 4 屏时
 * 越分越窄。
 *
 * 网格上限：左右最多两列、上下最多两行，共 4 屏。原生屏占左列（row）或
 * 上排（column），overlay 区域是第二列/第二行；两个方向都不允许再拆出第
 * 三列/第三行。网格已满时，任何落点只能替换已有屏幕，不再新增 cell。
 *
 * 交互约定（对齐 Claude Code 的 split view）：
 *   - 从侧栏拖到主内容区：默认向右分屏；靠近底边则上下分屏；最多 4 屏。
 *   - 分屏后只有真正的空位（原生下方、overlay 区域外侧）是分屏落点；
 *     其余落点一律替换该屏。分屏已满时全部落点都是替换。
 *   - 右键「在分屏中打开」是同一动作的非拖拽入口；没有空位时替换聚焦屏。
 *   - 分屏期间点击侧栏会话，替换当前聚焦的这一屏。
 * ========================================================================== */

const EMPTY_SPLIT_STATE = Object.freeze({
  visible: false,
  mode: null,
  extraTree: null,
  bottomCellId: null,
  focusedCellId: null,
})

function splitLeaf(cellId) {
  return { type: 'leaf', cellId }
}

function collectSplitLeaves(node, out = []) {
  if (node === null || node === undefined) return out
  if (node.type === 'leaf') {
    out.push(node)
    return out
  }
  for (const child of node.children ?? []) collectSplitLeaves(child, out)
  return out
}

function splitLeafCount(node) {
  return collectSplitLeaves(node).length
}

/**
 * 分屏网格容量：左右最多两列、上下最多两行。
 *
 * 原生屏（main+rightbar）固定是第一列/第一行；row 模式时左列还能有一屏
 * native bottom，overlay 区域是右列（上下最多两屏）；column 模式时上排只有
 * 原生屏，overlay 区域是下排（左右最多两屏）。总数上限 4。
 */
function readSplitGrid(snapshot) {
  const extraTree = snapshot?.extraTree ?? null
  const overlayLeaves = collectSplitLeaves(extraTree)
  const hasNativeBottom = snapshot?.bottomCellId !== null && snapshot?.bottomCellId !== undefined
  const mode = snapshot?.mode ?? null
  const total = 1 + (hasNativeBottom ? 1 : 0) + overlayLeaves.length
  return {
    mode,
    overlayLeaves,
    hasNativeBottom,
    total,
    atMax: total >= SPLIT_MAX_PANES,
    overlayFull: overlayLeaves.length >= 2,
    /** 左列还能再放一屏（只有左右两列且还没有 native bottom 时）。 */
    canNativeBottom: mode === 'row' && !hasNativeBottom && overlayLeaves.length > 0 && total < SPLIT_MAX_PANES,
  }
}

function splitChildKey(node) {
  return node.type === 'leaf' ? node.cellId : node.id
}

function removeSplitLeaf(node, cellId) {
  if (node === null || node === undefined) return null
  if (node.type === 'leaf') return node.cellId === cellId ? null : node
  const children = (node.children ?? []).map((child) => removeSplitLeaf(child, cellId)).filter((child) => child !== null)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { ...node, children }
}

/**
 * 在指定叶子旁插入一个新分屏。同方向的父节点直接摊平，正交方向则在叶子上
 * 嵌套一层。分屏树只用于右侧/下方的 overlay 区域；原生 main 屏不在树里。
 */
function insertSplitLeaf(node, cellId, direction, nextLeaf, createId) {
  if (node === null || node === undefined) return null
  if (node.type === 'leaf') {
    if (node.cellId !== cellId) return node
    return { type: 'split', id: createId(), direction, children: [node, nextLeaf] }
  }
  if (node.direction === direction) {
    const index = node.children.findIndex((child) => child.type === 'leaf' && child.cellId === cellId)
    if (index >= 0) {
      const children = node.children.slice()
      children.splice(index + 1, 0, nextLeaf)
      return { ...node, children }
    }
  }
  const children = node.children.map((child) => insertSplitLeaf(child, cellId, direction, nextLeaf, createId))
  if (children.every((child, index) => child === node.children[index])) return node
  return { ...node, children }
}

/** 在 overlay 区域矩形内等分计算每个 overlay 叶子的位置。 */
function computeOverlayRects(node, width, height, out = new Map(), rect = { x: 0, y: 0, w: width, h: height }, bottomShare = SPLIT_NATIVE_BOTTOM_SHARE) {
  if (node === null || node === undefined) return out
  if (node.type === 'leaf') {
    out.set(node.cellId, rect)
    return out
  }
  const count = node.children.length
  if (count === 0) return out
  const share = 1 / count
  // 上下分屏与 native bottom 共用同一个高度比例，左右两侧的上下屏保持对齐；
  // 竖排超过两个子屏时，第一屏之后按均分。
  const columnTopShare = count === 2 ? 1 - bottomShare : (1 / count)
  let offset = 0
  for (let index = 0; index < count; index += 1) {
    const child = node.children[index]
    const last = index === count - 1
    if (node.direction === 'row') {
      const childWidth = last ? rect.w - offset : rect.w * share
      computeOverlayRects(child, width, height, out, { x: rect.x + offset, y: rect.y, w: Math.max(0, childWidth), h: rect.h }, bottomShare)
      offset += childWidth
    } else {
      const childHeight = last ? rect.h - offset : rect.h * (index === 0 ? columnTopShare : share)
      computeOverlayRects(child, width, height, out, { x: rect.x, y: rect.y + offset, w: rect.w, h: Math.max(0, childHeight) }, bottomShare)
      offset += childHeight
    }
  }
  return out
}

function serializeSplitTree(node, cells) {
  if (node === null || node === undefined) return null
  if (node.type === 'leaf') {
    const sessionId = cells.get(node.cellId)?.sessionId
    return typeof sessionId === 'string' ? { type: 'leaf', sessionId } : null
  }
  const children = (node.children ?? []).map((child) => serializeSplitTree(child, cells)).filter(Boolean)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { type: 'split', direction: node.direction === 'column' ? 'column' : 'row', children }
}

function readPersistedSplit() {
  try {
    const raw = readStorage(SPLIT_STORAGE_KEY)
    if (raw === null || raw === '') return null
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || parsed.version !== 1) return null
    return parsed
  } catch {
    return null
  }
}

/** 旧版本可能持久化过非法网格（3 个 overlay 叶或三层嵌套）；恢复时展平重排。 */
function collectPersistedSplitLeaves(node, out = []) {
  if (node === null || typeof node !== 'object') return out
  if (node.type === 'leaf') {
    if (typeof node.sessionId === 'string') out.push(node.sessionId)
    return out
  }
  for (const child of node.children ?? []) collectPersistedSplitLeaves(child, out)
  return out
}

/**
 * 分屏控制器：原生 main+rightbar 是第一个屏（不归控制器 retain），
 * 其余屏是 overlay，各自 retain 一个 Session reference。
 * mode 决定原生屏的方位：row = 原生在左、overlay 在右；column = 原生在上、overlay 在下。
 */
function createSplitController({ sessions, workspaces, ui, layout }) {
  let mode = null
  let extraTree = null
  let bottomCellId = null
  let focusedCellId = null
  /** 分屏时左/上原生壳的会话。与窗口级 mainView 解耦：聚焦 overlay 时窗口
   * 选中会话会切到 overlay（快捷键按选中屏），但主壳不能跟着换。 */
  let rootSessionId = null
  let nativeShare = SPLIT_NATIVE_ROW_SHARE
  let columnShare = SPLIT_NATIVE_COLUMN_SHARE
  let bottomShare = SPLIT_NATIVE_BOTTOM_SHARE
  let state = EMPTY_SPLIT_STATE
  let cellSeq = 0
  let splitSeq = 0
  let disposed = false
  let restored = false
  let stopSessions = () => {}
  let releaseTimer = 0
  const listeners = new Set()
  const cells = new Map()
  const pendingReleases = []

  const store = {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  /** 只保留当前 tree/bottom cell 里的 cell；旧 cell 的 retain 引用一并释放。 */
  const syncPanes = () => {
    const active = new Set()
    if (extraTree !== null) {
      for (const leaf of collectSplitLeaves(extraTree)) active.add(leaf.cellId)
    }
    if (bottomCellId !== null) active.add(bottomCellId)
    for (const [cellId, record] of [...cells]) {
      if (active.has(cellId)) continue
      cells.delete(cellId)
      scheduleRelease(record.reference)
    }
  }

  const emit = () => {
    syncPanes()
    // 没有 overlay 时，只剩原生上下两屏；此时方向必须是 column，不能沿用旧的 row。
    if (extraTree === null && bottomCellId !== null) mode = 'column'
    state = {
      visible: extraTree !== null || bottomCellId !== null,
      mode,
      extraTree,
      bottomCellId,
      focusedCellId,
      rootSessionId,
      nativeShare,
      columnShare,
      bottomShare,
    }
    for (const listener of [...listeners]) listener()
    persist()
  }

  const mainSessionId = () => {
    const snapshot = sessions.list.getSnapshot()
    return snapshot.ids.find((sessionId) => (snapshot.byId[sessionId]?.retainedBy?.mainView ?? 0) > 0)
  }
  /** 原生壳当前承载的会话；单屏时就是 mainView。 */
  const nativeShellSessionId = () => (extraTree !== null || bottomCellId !== null)
    ? (rootSessionId ?? mainSessionId())
    : mainSessionId()
  /**
   * 把窗口级选中会话同步到某个屏。关闭/提升分屏后必须调用：单屏的壳按
   * mainView 渲染，不同步就会留在刚被关掉的那一屏会话上（看起来像关错了屏）。
   */
  const syncWindowSession = (targetSessionId) => {
    if (typeof targetSessionId !== 'string' || targetSessionId === '') return
    if (targetSessionId === mainSessionId()) return
    try { ui.openSession(targetSessionId) } catch { /* 同步失败时保持原选中 */ }
  }
  /** 当前聚焦屏承载的会话（root 用固定的主壳会话，不读窗口 mainView）。 */
  const focusedPaneSessionId = () => (focusedCellId === ROOT_CELL_ID || focusedCellId === null)
    ? (rootSessionId ?? mainSessionId())
    : cells.get(focusedCellId)?.sessionId
  const persist = () => {
    if (disposed) return
    try {
      if (extraTree === null && bottomCellId === null) {
        window.localStorage.removeItem(SPLIT_STORAGE_KEY)
        return
      }
      const nativeBottomSessionId = cells.get(bottomCellId)?.sessionId ?? null
      const focusedSessionId = focusedCellId !== null && focusedCellId !== ROOT_CELL_ID
        ? cells.get(focusedCellId)?.sessionId ?? null
        : null
      window.localStorage.setItem(SPLIT_STORAGE_KEY, JSON.stringify({
        version: 1,
        mode,
        nativeSessionId: rootSessionId ?? mainSessionId() ?? null,
        overlayTree: serializeSplitTree(extraTree, cells),
        nativeBottomSessionId,
        focusedSessionId,
        nativeShare,
        columnShare,
        bottomShare,
      }))
    } catch {
      /* localStorage 不可用时仅影响持久化 */
    }
  }

  const restoreFromStorage = () => {
    if (restored) return
    const raw = readPersistedSplit()
    if (raw === null) {
      restored = true
      return
    }
    const apply = () => {
      if (restored) return false
      const snapshot = sessions.list.getSnapshot()
      if (snapshot.phase !== 'ready') return false
      const byId = snapshot.byId ?? {}
      // 先只解析要恢复的会话 id，不 retain：主屏先就位，下一帧再挂 overlay。
      // 两个 overlay 的 retain 与主屏切换叠在同一个同步栈里，会让 DSH 同时加载
      // 三个会话并互相触发渲染，刷新后表现为卡死。
      const persistedLeaves = collectPersistedSplitLeaves(raw.overlayTree)
      const overlaySessionIds = persistedLeaves
        .slice(0, 2)
        .filter((sessionId) => typeof sessionId === 'string' && byId[sessionId] !== undefined)
      const bottomSessionId = typeof raw.nativeBottomSessionId === 'string' && byId[raw.nativeBottomSessionId] !== undefined
        ? raw.nativeBottomSessionId
        : null
      if (overlaySessionIds.length === 0 && bottomSessionId === null) {
        try { window.localStorage.removeItem(SPLIT_STORAGE_KEY) } catch { /* ignore */ }
        restored = true
        return true
      }
      restored = true

      const mountOverlays = () => {
        if (disposed) return
        const paneBySession = new Map()
        const usedSessions = new Set()
        // 主屏会话不能同时出现在 overlay/native bottom 里。
        if (typeof raw.nativeSessionId === 'string') usedSessions.add(raw.nativeSessionId)
        const retainSession = (sessionId) => {
          if (typeof sessionId !== 'string' || byId[sessionId] === undefined) return undefined
          if (usedSessions.has(sessionId)) return undefined
          let cellId
          try {
            cellId = retainCell(sessionId)
          } catch {
            return undefined
          }
          usedSessions.add(sessionId)
          paneBySession.set(sessionId, cellId)
          return cellId
        }
        const extraCellIds = overlaySessionIds.map(retainSession).filter((cellId) => cellId !== undefined)
        const bottomPaneId = retainSession(bottomSessionId) ?? null
        if (extraCellIds.length === 0 && bottomPaneId === null) {
          try { window.localStorage.removeItem(SPLIT_STORAGE_KEY) } catch { /* ignore */ }
          return
        }
        // 只有左右两列时左列才能上下两屏；只有 overlay 独立存在时才是上下两行。
        const finalMode = extraCellIds.length > 0 && bottomPaneId !== null
          ? 'row'
          : extraCellIds.length === 0
            ? 'column'
            : (raw.mode === 'column' ? 'column' : 'row')
        const tree = extraCellIds.length === 0
          ? null
          : extraCellIds.length === 1
            ? splitLeaf(extraCellIds[0])
            : {
                type: 'split',
                id: `split-${++splitSeq}`,
                direction: finalMode === 'column' ? 'row' : 'column',
                children: extraCellIds.map((cellId) => splitLeaf(cellId)),
              }
        mode = finalMode
        rootSessionId = typeof raw.nativeSessionId === 'string' ? raw.nativeSessionId : mainSessionId() ?? null
        extraTree = tree
        bottomCellId = bottomPaneId
        const restoreShare = (value, fallback) => typeof value === 'number' && Number.isFinite(value)
          ? Math.min(SPLIT_MAX_SHARE, Math.max(SPLIT_MIN_SHARE, value))
          : fallback
        nativeShare = restoreShare(raw.nativeShare, SPLIT_NATIVE_ROW_SHARE)
        columnShare = restoreShare(raw.columnShare, SPLIT_NATIVE_COLUMN_SHARE)
        bottomShare = restoreShare(raw.bottomShare, SPLIT_NATIVE_BOTTOM_SHARE)
        const focusedPane = typeof raw.focusedSessionId === 'string' ? paneBySession.get(raw.focusedSessionId) : undefined
        focusedCellId = focusedPane
          ?? (typeof raw.focusedSessionId === 'string' && raw.focusedSessionId === raw.nativeSessionId
            ? ROOT_CELL_ID
            : (bottomPaneId ?? ROOT_CELL_ID))
        // 先等所有 retain 的初始 open 完成，再让 overlay 挂到 frame 里；
        // 否则 refresh 后 overlay 可能拿到仍在 loading 的 session，历史永远停在“载入历史…”。
        const readyPromises = []
        for (const record of cells.values()) {
          const ready = record.reference?.ready
          if (ready !== undefined && typeof ready.then === 'function') readyPromises.push(ready)
        }
        const commit = () => {
          if (disposed) return
          emit()
          // 恢复后把窗口选中会话对齐到聚焦屏，快捷键才不会落回旧主屏。
          const focusSession = focusedCellId === ROOT_CELL_ID
            ? rootSessionId
            : cells.get(focusedCellId)?.sessionId
          if (typeof focusSession === 'string' && focusSession !== mainSessionId()) {
            try { ui.openSession(focusSession) } catch { /* 同步失败时保持原选中 */ }
          }
        }
        if (readyPromises.length === 0) commit()
        else Promise.allSettled(readyPromises).then(commit, commit)
      }

      const switchNative = () => {
        if (disposed) return
        if (typeof raw.nativeSessionId === 'string' && byId[raw.nativeSessionId] !== undefined && mainSessionId() !== raw.nativeSessionId) {
          try { ui.openSession(raw.nativeSessionId) } catch { /* ignore */ }
        }
      }
      // 顺序：主屏会话先切过去并渲染一帧，再把 overlay retain + 挂载。
      switchNative()
      if (typeof window === 'undefined') {
        mountOverlays()
        return true
      }
      window.requestAnimationFrame(() => { window.setTimeout(mountOverlays, 0) })
      return true
    }
    if (apply()) return
    stopSessions = sessions.list.subscribe(() => {
      if (apply()) {
        stopSessions()
        stopSessions = () => {}
      }
    })
  }

  let newSessionHandler
  const setNewSessionHandler = (handler) => {
    newSessionHandler = typeof handler === 'function' ? handler : undefined
  }
  const retainCell = (sessionId) => {
    const cellId = `cell-${++cellSeq}`
    const reference = sessions.retain(sessionId, { source: SPLIT_RETAIN_SOURCE })
    reference.ready.catch(() => {})
    cells.set(cellId, { cellId, sessionId, reference })
    return cellId
  }

  const scheduleRelease = (reference) => {
    if (reference === undefined || reference === null) return
    pendingReleases.push(reference)
    if (releaseTimer !== 0) return
    releaseTimer = window.setTimeout(() => {
      releaseTimer = 0
      for (const pending of pendingReleases.splice(0)) {
        try {
          pending.release()
        } catch {
          /* 引用已经释放时保持幂等 */
        }
      }
    }, 0)
  }

  const releaseNow = (reference) => {
    try {
      reference.release()
    } catch {
      /* 幂等 */
    }
  }

  const takeAllPanes = () => {
    const records = [...cells.values()]
    cells.clear()
    return records
  }

  const focusPane = (cellId) => {
    if (cellId !== ROOT_CELL_ID && !cells.has(cellId)) return
    // 快捷键/右键菜单是窗口级的：把窗口选中会话切到聚焦屏，命令才会落在
    // 用户正在看的那一屏。主壳会话由 rootSessionId 固定，不跟着换。
    const sessionId = cellId === ROOT_CELL_ID ? nativeShellSessionId() : cells.get(cellId)?.sessionId
    if (sessionId !== undefined && sessionId !== mainSessionId()) {
      try { ui.openSession(sessionId) } catch { /* 切换失败时保持原选中 */ }
    }
    if (focusedCellId === cellId) return
    focusedCellId = cellId
    emit()
  }

  const totalPaneCount = () => 1 + (bottomCellId !== null ? 1 : 0) + splitLeafCount(extraTree)

  const firstExtraCellId = () => collectSplitLeaves(extraTree)[0]?.cellId

  const findCellForSession = (sessionId) => {
    if (bottomCellId !== null && cells.get(bottomCellId)?.sessionId === sessionId) return bottomCellId
    for (const leaf of collectSplitLeaves(extraTree)) {
      if (cells.get(leaf.cellId)?.sessionId === sessionId) return leaf.cellId
    }
    return undefined
  }

  const seedSplit = (sessionId, direction, keepNativeBottom = false) => {
    let cellId
    try {
      cellId = retainCell(sessionId)
    } catch (error) {
      return { mode: 'error', error }
    }
    mode = direction
    if (rootSessionId === null) rootSessionId = mainSessionId() ?? null
    extraTree = splitLeaf(cellId)
    if (!keepNativeBottom) bottomCellId = null
    focusedCellId = cellId
    emit()
    return { mode: 'split' }
  }

  /**
   * 在 overlay 区域里再加一屏。方向不允许由调用方决定：overlay 区域已经是
   * 第二列/第二行，只能沿与原生屏正交的方向再分（左右两列时上下、上下两行
   * 时左右）。区域已满（两屏）或总数到 4 时退化成替换。
   */
  const splitExtra = (cellId, sessionId) => {
    if (!cells.has(cellId)) return { mode: 'noop' }
    if (splitLeafCount(extraTree) >= 2 || totalPaneCount() >= SPLIT_MAX_PANES) {
      return replaceExtra(cellId, sessionId, true)
    }
    let newPaneId
    try {
      newPaneId = retainCell(sessionId)
    } catch (error) {
      return { mode: 'error', error }
    }
    const direction = mode === 'column' ? 'row' : 'column'
    const nextTree = insertSplitLeaf(extraTree, cellId, direction, splitLeaf(newPaneId), () => `split-${++splitSeq}`)
    if (nextTree === extraTree) {
      const record = cells.get(newPaneId)
      cells.delete(newPaneId)
      releaseNow(record?.reference)
      return { mode: 'noop' }
    }
    extraTree = nextTree
    focusedCellId = newPaneId
    emit()
    return { mode: 'split' }
  }

  const replaceExtra = (cellId, sessionId, atMax = false) => {
    const record = cells.get(cellId)
    if (record === undefined) return { mode: 'noop' }
    let reference
    try {
      reference = sessions.retain(sessionId, { source: SPLIT_RETAIN_SOURCE })
    } catch (error) {
      return { mode: 'error', error }
    }
    reference.ready.catch(() => {})
    cells.set(cellId, { cellId, sessionId, reference })
    scheduleRelease(record.reference)
    focusedCellId = cellId
    emit()
    return { mode: atMax ? 'max-replace' : 'replace' }
  }

  const replaceNative = (sessionId) => {
    if (nativeShellSessionId() !== sessionId) {
      try {
        ui.openSession(sessionId)
      } catch (error) {
        return { mode: 'error', error }
      }
    }
    rootSessionId = sessionId
    focusedCellId = ROOT_CELL_ID
    emit()
    return { mode: 'native-replace' }
  }

  /** 左列下方只允许左右两列（row）时出现；它占左列第二行。 */
  const addNativeBottom = (sessionId) => {
    if (bottomCellId !== null) return replaceExtra(bottomCellId, sessionId)
    if (extraTree === null || mode !== 'row') return replaceNative(sessionId)
    if (totalPaneCount() >= SPLIT_MAX_PANES) return replaceNative(sessionId)
    let cellId
    try {
      cellId = retainCell(sessionId)
    } catch (error) {
      return { mode: 'error', error }
    }
    bottomCellId = cellId
    focusedCellId = cellId
    emit()
    return { mode: 'native-bottom' }
  }

  /**
   * 菜单「在分屏中打开」：先找网格里的空位（右列/下排的第二个 overlay，
   * 或左列的 native bottom），没有空位时替换聚焦屏/主屏，绝不越出 2×2。
   */
  const addExtraForMenu = (sessionId) => {
    const anchor = firstExtraCellId()
    if (anchor === undefined) {
      if (bottomCellId !== null) return seedSplit(sessionId, 'row', true)
      return replaceNative(sessionId)
    }
    if (totalPaneCount() >= SPLIT_MAX_PANES) {
      const focusedOverlay = focusedCellId !== null && focusedCellId !== ROOT_CELL_ID && cells.has(focusedCellId)
        ? focusedCellId
        : undefined
      if (focusedOverlay !== undefined) return replaceExtra(focusedOverlay, sessionId, true)
      return replaceNative(sessionId)
    }
    if (splitLeafCount(extraTree) >= 2) {
      // 右列/下排已经两屏，只剩左列下方这个空位。
      if (bottomCellId === null && mode === 'row') return addNativeBottom(sessionId)
      return replaceExtra(anchor, sessionId, true)
    }
    return splitExtra(anchor, sessionId)
  }

  const drop = (sessionId, target) => {
    if (disposed || typeof sessionId !== 'string' || sessionId === '') return { mode: 'noop' }
    const current = nativeShellSessionId()
    if (extraTree === null) {
      if (current === undefined) {
        ui.openSession(sessionId)
        return { mode: 'native' }
      }
      if (current === sessionId) return { mode: 'same' }
      if (bottomCellId !== null) {
        const bottomSession = cells.get(bottomCellId)?.sessionId
        if (bottomSession === sessionId) {
          focusPane(bottomCellId)
          return { mode: 'focus' }
        }
        if (target?.zone === 'native-bottom' || target?.zone === 'bottom') return replaceExtra(bottomCellId, sessionId)
        if (target?.zone === 'right') return seedSplit(sessionId, 'row', true)
        return replaceNative(sessionId)
      }
      return seedSplit(sessionId, target?.zone === 'bottom' ? 'column' : 'row')
    }
    if (current === sessionId) {
      focusPane(ROOT_CELL_ID)
      return { mode: 'focus' }
    }
    const existing = findCellForSession(sessionId)
    if (existing !== undefined) {
      focusPane(existing)
      return { mode: 'focus' }
    }
    if (target?.zone === 'native-bottom') {
      if (bottomCellId !== null) return replaceExtra(bottomCellId, sessionId)
      if (extraTree !== null && mode === 'row') return addNativeBottom(sessionId)
      return replaceNative(sessionId)
    }
    const cellId = target?.cellId ?? focusedCellId
    if (cellId === bottomCellId && cellId !== null) return replaceExtra(cellId, sessionId)
    if (cellId === ROOT_CELL_ID) return replaceNative(sessionId)
    if (cellId === null || cellId === undefined || !cells.has(cellId)) return { mode: 'noop' }
    const atMax = totalPaneCount() >= SPLIT_MAX_PANES
    if (target?.zone === 'replace' || atMax) return replaceExtra(cellId, sessionId, atMax)
    return splitExtra(cellId, sessionId)
  }

  const openInSplit = (sessionId) => {
    if (disposed || typeof sessionId !== 'string' || sessionId === '') return { mode: 'noop' }
    const current = nativeShellSessionId()
    if (extraTree === null && bottomCellId === null) {
      if (current === undefined) {
        ui.openSession(sessionId)
        return { mode: 'native' }
      }
      if (current === sessionId) return { mode: 'same' }
      return seedSplit(sessionId, 'row')
    }
    if (current === sessionId) {
      focusPane(ROOT_CELL_ID)
      return { mode: 'focus' }
    }
    const existing = findCellForSession(sessionId)
    if (existing !== undefined) {
      focusPane(existing)
      return { mode: 'focus' }
    }
    if (focusedCellId === bottomCellId && bottomCellId !== null) return replaceExtra(bottomCellId, sessionId)
    if (extraTree === null && bottomCellId !== null) {
      if (focusedCellId === ROOT_CELL_ID) return seedSplit(sessionId, 'row', true)
      return replaceExtra(bottomCellId, sessionId)
    }
    if (focusedCellId === ROOT_CELL_ID || !cells.has(focusedCellId)) return addExtraForMenu(sessionId)
    return splitExtra(focusedCellId, sessionId)
  }

  const openFocused = (sessionId) => {
    if (disposed || typeof sessionId !== 'string' || sessionId === '') return { mode: 'noop' }
    if (extraTree === null && bottomCellId === null) return { mode: 'native' }
    if (nativeShellSessionId() === sessionId) {
      focusPane(ROOT_CELL_ID)
      return { mode: 'focus' }
    }
    const existing = findCellForSession(sessionId)
    if (existing !== undefined) {
      focusPane(existing)
      return { mode: 'focus' }
    }
    if (extraTree === null && bottomCellId !== null) {
      if (focusedCellId === ROOT_CELL_ID) return replaceNative(sessionId)
      return replaceExtra(bottomCellId, sessionId)
    }
    if (focusedCellId === ROOT_CELL_ID) return replaceNative(sessionId)
    if (!cells.has(focusedCellId)) return addExtraForMenu(sessionId)
    return replaceExtra(focusedCellId, sessionId)
  }

  const closeCell = (cellId) => {
    if (cellId === ROOT_CELL_ID) return
    const record = cells.get(cellId)
    if (record === undefined) return
    // 退出分屏时要回到主壳会话；必须在清 rootSessionId 之前捕获。
    const nativeSessionId = rootSessionId ?? mainSessionId()
    cells.delete(cellId)
    scheduleRelease(record.reference)
    if (cellId === bottomCellId) {
      bottomCellId = null
      if (extraTree === null) {
        // 最后一个分屏：先切回主壳会话，再退出；否则单屏会停在刚关掉的屏上。
        mode = null
        focusedCellId = null
        rootSessionId = null
        syncWindowSession(nativeSessionId)
        emit()
        return
      }
      const leaves = collectSplitLeaves(extraTree)
      if (!leaves.some((leaf) => leaf.cellId === focusedCellId)) focusedCellId = leaves[0]?.cellId ?? ROOT_CELL_ID
      syncWindowSession(focusedPaneSessionId())
      emit()
      return
    }
    const nextTree = removeSplitLeaf(extraTree, cellId)
    if (nextTree === null) {
      if (bottomCellId !== null) {
        // 右侧最后一个 overlay 关闭后，保留左侧 native top + native bottom，
        // 切成整宽的上下两屏；不要连 native bottom 一起关掉。
        extraTree = null
        mode = 'column'
        focusedCellId = bottomCellId
        syncWindowSession(focusedPaneSessionId())
        emit()
        return
      }
      // 左右两屏里关掉 overlay：回主壳会话。单屏的壳按窗口 mainView 渲染，
      // 不同步就会显示被关掉的那一屏，用户看到的是「关右屏、左屏消失」。
      mode = null
      extraTree = null
      focusedCellId = null
      rootSessionId = null
      syncWindowSession(nativeSessionId)
      emit()
      return
    }
    extraTree = nextTree
    const leaves = collectSplitLeaves(nextTree)
    if (!leaves.some((leaf) => leaf.cellId === focusedCellId)) focusedCellId = leaves[0]?.cellId ?? ROOT_CELL_ID
    syncWindowSession(focusedPaneSessionId())
    emit()
  }

  const closeSessionToNew = (sessionId) => {
    const workspaceId = workspaces?.list?.getSnapshot()?.items?.find(item => item.sessionIds.includes(sessionId))?.workspaceId
    try {
      // 和左上角「新会话」走完全相同的入口（含草稿保留/迁移逻辑）。
      if (typeof newSessionHandler === 'function') newSessionHandler(workspaceId)
      else ui.startSession(workspaceId)
    } catch (error) {
      return { mode: 'error', error }
    }
    return { mode: 'new-session' }
  }

  const exitSplit = () => {
    if (extraTree === null && bottomCellId === null) {
      try { window.localStorage.removeItem(SPLIT_STORAGE_KEY) } catch { /* ignore */ }
      return
    }
    const records = takeAllPanes()
    mode = null
    extraTree = null
    bottomCellId = null
    focusedCellId = null
    rootSessionId = null
    emit()
    for (const record of records) scheduleRelease(record.reference)
  }

  const removeSession = (sessionId) => {
    if (extraTree === null && bottomCellId === null) return
    if (nativeShellSessionId() === sessionId) {
      exitSplit()
      return
    }
    const cellId = findCellForSession(sessionId)
    if (cellId !== undefined) closeCell(cellId)
  }

  const stopSessionsTracking = sessions.list.subscribe(() => {
    if (extraTree !== null || bottomCellId !== null) persist()
  })

  const stopLayout = typeof layout?.panelInfo?.subscribe === 'function'
    ? layout.panelInfo.subscribe(() => {
      if ((extraTree !== null || bottomCellId !== null) && layout.panelInfo.getSnapshot().activePanelId !== null) exitSplit()
    })
    : () => {}

  const stopArchived = typeof workspaces?.list?.subscribe === 'function'
    ? workspaces.list.subscribe(() => {
      if (extraTree === null && bottomCellId === null) return
      const archived = new Set(workspaces.list.getSnapshot().archivedSessionIds ?? [])
      if (archived.size === 0) return
      if (archived.has(nativeShellSessionId())) {
        exitSplit()
        return
      }
      const targets = []
      for (const leaf of collectSplitLeaves(extraTree)) {
        const sessionId = cells.get(leaf.cellId)?.sessionId
        if (sessionId !== undefined && archived.has(sessionId)) targets.push(sessionId)
      }
      if (bottomCellId !== null) {
        const sessionId = cells.get(bottomCellId)?.sessionId
        if (sessionId !== undefined && archived.has(sessionId)) targets.push(sessionId)
      }
      for (const sessionId of targets) {
        const cellId = findCellForSession(sessionId)
        if (cellId !== undefined) closeCell(cellId)
      }
    })
    : () => {}

  const dispose = () => {
    if (disposed) return
    disposed = true
    stopLayout()
    stopArchived()
    stopSessions()
    stopSessionsTracking()
    if (releaseTimer !== 0) {
      window.clearTimeout(releaseTimer)
      releaseTimer = 0
    }
    for (const record of takeAllPanes()) releaseNow(record.reference)
    for (const reference of pendingReleases.splice(0)) releaseNow(reference)
    mode = null
    extraTree = null
    bottomCellId = null
    focusedCellId = null
    listeners.clear()
  }

  return {
    enabled: true,
    store,
    restoreFromStorage,
    drop,
    openInSplit,
    openFocused,
    closeCell,
    focusPane,
    removeSession,
    exitSplit,
    dispose,
    cell: (cellId) => cells.get(cellId),
    isVisible: () => extraTree !== null || bottomCellId !== null,
    isExtraSession: (sessionId) => {
      // 只认当前 tree / bottom cell 里的 cell：cells 里可能有退出分屏后
      // 未及清理的记录，误判会让该会话的右栏 syncPresentation 永久变成
      // no-op（表现为面板开了看不到、关了还占一列）。
      for (const record of cells.values()) {
        if (record.sessionId !== sessionId) continue
        if (record.cellId === bottomCellId) return true
        if (extraTree !== null && collectSplitLeaves(extraTree).some((leaf) => leaf.cellId === record.cellId)) return true
      }
      return false
    },
    isSessionOpen: (sessionId) => {
      if (typeof sessionId !== 'string' || sessionId === '') return false
      if (sessionId === nativeShellSessionId()) return true
      return findCellForSession(sessionId) !== undefined
    },
    closeSession: (sessionId) => {
      // 只按当前 tree/bottom cell 里的 cell 关；cells 里可能残留旧 cell。
      const activePaneIds = []
      if (extraTree !== null) {
        for (const leaf of collectSplitLeaves(extraTree)) activePaneIds.push(leaf.cellId)
      }
      if (bottomCellId !== null) activePaneIds.push(bottomCellId)
      for (const cellId of activePaneIds) {
        const record = cells.get(cellId)
        if (record?.sessionId === sessionId) {
          closeCell(cellId)
          return { mode: 'cell', cellId, sessionId }
        }
      }
      // 关的是主壳：优先让同一列下方的 cell 顶上来（上下之间的屏幕关掉后
      // 下方扩展），没有 native bottom 时才让右侧 overlay 顶上来；否则最后一个新会话。
      if (activePaneIds.length > 0) {
        const leafIds = extraTree === null ? [] : collectSplitLeaves(extraTree).map((leaf) => leaf.cellId)
        let preferred = bottomCellId
        if (preferred === null) preferred = leafIds.includes(focusedCellId) ? focusedCellId : leafIds[0]
        const record = preferred === undefined || preferred === null ? undefined : cells.get(preferred)
        if (record !== undefined) {
          const promotedSessionId = record.sessionId
          cells.delete(preferred)
          scheduleRelease(record.reference)
          if (preferred === bottomCellId) bottomCellId = null
          else extraTree = removeSplitLeaf(extraTree, preferred)
          if (extraTree === null && bottomCellId === null) {
            mode = null
            focusedCellId = null
          } else {
            const leaves = collectSplitLeaves(extraTree)
            focusedCellId = bottomCellId ?? leaves[0]?.cellId ?? ROOT_CELL_ID
            mode = extraTree !== null ? 'row' : 'column'
          }
          // 被提升的会话成为新的主壳会话；分屏还在时原生壳按 rootSessionId 渲染，
          // 不更新会继续显示刚关掉的主屏会话。
          rootSessionId = promotedSessionId
          syncWindowSession(focusedPaneSessionId())
          emit()
          return { mode: 'promote', promotedSessionId, closedSessionId: sessionId }
        }
      }
      // 最后一个 cell：回到同项目新会话。
      return closeSessionToNew(sessionId)
    },
    setNewSessionHandler,
    closeSessionToNew,
    setShare: (kind, value) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return
      const next = Math.min(SPLIT_MAX_SHARE, Math.max(SPLIT_MIN_SHARE, value))
      if (kind === 'native') nativeShare = next
      else if (kind === 'column') columnShare = next
      else if (kind === 'bottom') bottomShare = next
      else return
      emit()
    },

  }
}

/** 找到 app frame 的四个关键节点；只在这里集中 DSH 的 frame 结构假设。 */
/** 分屏关闭时的占位控制器：所有入口都返回「不可用」，也不接管主视图。
 *
 * Browser 组件仍会拿到它（拖拽落点、行状态、右键菜单都读），但
 * `enabled: false` 让拖拽层与「在分屏中打开」直接短路；壳网格、右栏包装、
 * 关闭按钮都不安装，主区保持原生单屏。
 * @param {{ sessions: any }} services
 */
function createDisabledSplit(services) {
  const disabledState = Object.freeze({
    visible: false,
    mode: null,
    extraTree: null,
    bottomCellId: null,
    focusedCellId: null,
    rootSessionId: null,
  })
  const mainSessionId = () => {
    const snapshot = services.sessions.list.getSnapshot()
    return snapshot.ids.find((sessionId) => (snapshot.byId[sessionId]?.retainedBy?.mainView ?? 0) > 0)
  }
  const noop = () => ({ mode: 'disabled' })
  return {
    enabled: false,
    store: { getSnapshot: () => disabledState, subscribe: () => () => {} },
    restoreFromStorage: () => {},
    drop: noop,
    openInSplit: noop,
    openFocused: noop,
    closeCell: noop,
    focusPane: () => {},
    removeSession: () => {},
    exitSplit: () => {},
    dispose: () => {},
    cell: () => undefined,
    isVisible: () => false,
    isExtraSession: () => false,
    isSessionOpen: (sessionId) => typeof sessionId === 'string' && sessionId !== '' && sessionId === mainSessionId(),
    closeSession: noop,
    setNewSessionHandler: () => {},
  }
}

function findContentAreaRect() {
  const grid = document.querySelector('[data-ct-shell-grid]')
  if (grid === null) return null
  const rect = grid.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
}

/**
 * 所有分屏的矩形：原生屏 = center 列与 rightbar 列的并集（右侧栏算在
 * 左/上屏里）；overlay 屏 = shell.overlay 里绝对定位的面板。
 */
function readSplitCellRects() {
  // 壳网格是唯一的分屏布局：每个壳 cell 就是一屏。
  const cells = []
  for (const element of document.querySelectorAll('[data-ct-shell-cell]')) {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    const cellId = element.getAttribute('data-ct-shell-cell')
    cells.push({
      cellId,
      native: cellId === ROOT_CELL_ID,
      nativeBottom: element.hasAttribute('data-ct-shell-native-bottom'),
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
    })
  }
  return cells
}

/**
 * 落点：只有网格里真实存在的空位才是分屏，其余落点一律替换目标屏。
 *   - 单屏：拖到右/下边缘 = 第一次分屏（左右或上下）。
 *   - 左右两列：左列下方（native bottom）和右列下方（overlay 上下）是空位。
 *   - 上下两行：下排右侧（overlay 左右）是空位，上排不能再拆。
 *   - 网格已满（4 屏，或 overlay 区域已两屏）：全部落点都是替换。
 */
function resolveSplitDropTarget(clientX, clientY, splitSnap) {
  const area = findContentAreaRect()
  if (area === null) return null
  if (clientX < area.left || clientX > area.right || clientY < area.top || clientY > area.bottom) return null
  const cellRects = readSplitCellRects()
  let cell = cellRects.find((item) => clientX >= item.rect.left && clientX <= item.rect.right && clientY >= item.rect.top && clientY <= item.rect.bottom)
  if (cell === undefined && cellRects.length > 0) {
    let best
    let bestDistance = Number.POSITIVE_INFINITY
    for (const item of cellRects) {
      const centerX = item.rect.left + item.rect.width / 2
      const centerY = item.rect.top + item.rect.height / 2
      const distance = (clientX - centerX) ** 2 + (clientY - centerY) ** 2
      if (distance < bestDistance) {
        bestDistance = distance
        best = item
      }
    }
    cell = best
  }
  if (cell === undefined) cell = { cellId: ROOT_CELL_ID, native: true, rect: area }
  const grid = readSplitGrid(splitSnap)
  const bottomCell = cellRects.find((item) => item.nativeBottom === true)
  let rect = cell.rect
  const ratioX = (clientX - rect.left) / Math.max(1, rect.width)
  const ratioY = (clientY - rect.top) / Math.max(1, rect.height)
  let zone
  if (cell.nativeBottom === true) {
    zone = 'replace'
  } else if (cell.native === true) {
    if (grid.total <= 1) {
      zone = ratioY >= SPLIT_EDGE_RATIO ? 'bottom' : 'right'
    } else if (ratioY >= SPLIT_EDGE_RATIO) {
      if (grid.hasNativeBottom && bottomCell !== undefined) {
        cell = bottomCell
        rect = bottomCell.rect
        zone = 'replace'
      } else if (grid.canNativeBottom) {
        zone = 'native-bottom'
      } else {
        zone = 'replace'
      }
    } else if (
      ratioX >= SPLIT_EDGE_RATIO
      && grid.mode === 'column'
      && grid.hasNativeBottom
      && grid.overlayLeaves.length === 0
    ) {
      // 整宽上下两屏时拖原生右缘：右侧补一屏，回到左右两列（左列两屏 + 右列一屏）。
      zone = 'right'
    } else {
      zone = 'replace'
    }
  } else if (grid.atMax || grid.overlayFull) {
    zone = 'replace'
  } else if (grid.mode === 'row' && ratioY >= SPLIT_EDGE_RATIO) {
    // 右列只能上下排；拖右缘不再长出第三列。
    zone = 'bottom'
  } else if (grid.mode === 'column' && ratioX >= SPLIT_EDGE_RATIO) {
    // 下排只能左右排；拖下缘不再长出第三行。
    zone = 'right'
  } else {
    zone = 'replace'
  }
  return {
    cellId: cell.cellId,
    zone,
    rect,
    paneCount: grid.total,
    atMax: grid.atMax,
    overlayFull: grid.overlayFull,
    mode: grid.mode,
    native: cell.native === true,
    nativeBottom: cell.nativeBottom === true,
  }
}

/** 预览矩形：首次原生分屏显示右/下，overlay 分屏显示新叶子的真实位置；无空位时显示替换。 */
function splitDropPreviewRect(target, splitSnap) {
  if (target.zone === 'replace' || target.zone === 'native-bottom' || target.atMax === true) {
    if (target.zone === 'native-bottom') {
      const area = findContentAreaRect()
      if (area !== null) {
        const nativeW = area.width * SPLIT_NATIVE_ROW_SHARE
        const nativeH = area.height * (1 - SPLIT_NATIVE_BOTTOM_SHARE)
        return { left: area.left, top: area.top + nativeH, width: nativeW, height: area.height - nativeH }
      }
    }
    return target.rect
  }
  const area = findContentAreaRect()
  if (area === null) return target.rect
  if (target.native) {
    if (target.zone === 'bottom') {
      return {
        left: area.left,
        top: area.top + area.height * SPLIT_NATIVE_COLUMN_SHARE,
        width: area.width,
        height: area.height * (1 - SPLIT_NATIVE_COLUMN_SHARE),
      }
    }
    return {
      left: area.left + area.width * SPLIT_NATIVE_ROW_SHARE,
      top: area.top,
      width: area.width * (1 - SPLIT_NATIVE_ROW_SHARE),
      height: area.height,
    }
  }
  if (splitSnap.mode === null || splitSnap.extraTree === null) return target.rect
  const nativeW = splitSnap.mode === 'column' ? area.width : area.width * SPLIT_NATIVE_ROW_SHARE
  const nativeH = splitSnap.mode === 'row' ? area.height : area.height * SPLIT_NATIVE_COLUMN_SHARE
  const region = splitSnap.mode === 'row'
    ? { x: nativeW, y: 0, w: area.width - nativeW, h: area.height }
    : { x: 0, y: nativeH, w: area.width, h: area.height - nativeH }
  const direction = target.zone === 'bottom' ? 'column' : 'row'
  const nextTree = insertSplitLeaf(splitSnap.extraTree, target.cellId, direction, splitLeaf('preview'), () => 'preview-split')
  if (nextTree === splitSnap.extraTree) return target.rect
  const rect = computeOverlayRects(nextTree, region.w, region.h).get('preview')
  if (rect === undefined) return target.rect
  return {
    left: area.left + region.x + rect.x,
    top: area.top + region.y + rect.y,
    width: rect.w,
    height: rect.h,
  }
}
