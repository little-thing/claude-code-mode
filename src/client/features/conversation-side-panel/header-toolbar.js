/** 会话 header 右上角的侧栏入口条：内置面板直接排开，其余收进最右的「更多」。
 *
 * 入口清单来自 `sidebarRightTabs.guide()`，所以第三方面板（Git、会话诊断…）
 * 注册后自动出现，不需要在这里列名字。
 *
 * 两种宿主：
 *  - `header`（已有会话的 utilities 槽）：入口条 + 常驻「更多」。菜单固定包含
 *    后台任务 toggle、分隔线和放不下的入口；
 *  - `blank`（新会话 hero 的 header corner 槽）：标题区不存在，入口条独占整行。
 *    新会话没有向会话提交任何内容，后台任务这种必须绑定会话的入口按不支持处理，
 *    不渲染；「更多」也只在有入口溢出时出现，避免弹出一个空菜单。
 *
 * 复制/下载/反馈留在会话名后的下拉里，这里不重复。
 */

import * as React from 'react'
import ReactDOM from 'react-dom'
import { Tooltip } from '../../shared/ui/tooltip.js'
import { JOBS_KIND } from './jobs-panel.js'

const h = React.createElement

/** 一个入口按钮的占位宽度（30px 按钮 + 3px 间距）。 */
const ENTRY_WIDTH = 33
/** 标题区至少要留下的宽度：面包屑 + 标题动作，低于它就先收起入口。 */
const TITLE_RESERVE = 260
/** corner 与入口条之间的间距。 */
const CORNER_GAP = 8

/** 观察会话 header 行，得到一个入口条最多能放几个按钮。
 *
 * `variant === 'blank'` 时没有标题/动作要预留，入口条自己就在 corner 里，
 * 因此按整行宽度算，不能再把 corner 自身（也就是自己）的宽度扣掉。
 */
function useEntryBudget(ref, enabled, variant) {
  const [budget, setBudget] = React.useState(0)
  React.useLayoutEffect(() => {
    if (!enabled) return undefined
    // 从入口条向上找同时包含 header corner、且有实际宽度的那一行；
    // 中间的 slot 容器是 display: contents（宽度 0），类名又是哈希，所以按结构与宽度找。
    const rowOf = () => {
      let node = ref.current?.parentElement ?? null
      while (node !== null) {
        if (node.querySelector('[data-conversation-header-corner]') !== null && node.getBoundingClientRect().width > 0) return node
        node = node.parentElement
      }
      return null
    }
    const update = () => {
      const row = rowOf()
      if (row === null) return
      const rowWidth = row.getBoundingClientRect().width
      if (variant === 'blank') {
        setBudget(Math.max(0, Math.floor((rowWidth - CORNER_GAP) / ENTRY_WIDTH)))
        return
      }
      // corner 的实际占用（分屏关闭按钮 / 右栏开关）走测量：单屏时通常为 0，
      // 不再固定预留，避免白白少放一个入口。
      const corner = row.querySelector('[data-conversation-header-corner]')
      const reserved = corner === null ? 0 : corner.getBoundingClientRect().width
      const available = rowWidth - TITLE_RESERVE - reserved - CORNER_GAP
      setBudget(Math.max(0, Math.floor(available / ENTRY_WIDTH)))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const row = rowOf()
    if (row === null) return undefined
    const observer = new ResizeObserver(update)
    observer.observe(row)
    return () => { observer.disconnect() }
  }, [ref, enabled, variant])
  return budget
}

/** 后台任务菜单项：打开时显示可勾选状态与数量。 */
function JobsMenuRow({ jobs, sessionId, open, onToggle, onClose, t }) {
  const snapshot = React.useSyncExternalStore(
    React.useCallback((listener) => jobs.state.subscribe(listener), [jobs]),
    React.useCallback(() => jobs.state.getSnapshot(), [jobs]),
  )
  const rows = snapshot.rows[sessionId] ?? []
  const live = rows.filter((job) => job.status === 'running' || job.status === 'stopping').length
  const count = live > 0 ? live : rows.length

  return h('button', {
    type: 'button',
    role: 'menuitemcheckbox',
    'aria-checked': open,
    className: 'ct-sp-menu-item',
    'data-ct-sp-menu-jobs': true,
    onClick: () => {
      onClose()
      onToggle()
    },
  },
  h('span', { className: 'ct-sp-menu-icon' }, h(JobsGlyph, { size: 18 })),
  h('span', { className: 'ct-sp-menu-label' }, t('jobs')),
  count > 0 ? h('span', { className: 'ct-sp-menu-count' }, String(count)) : null,
  h('span', { className: 'ct-sp-menu-check', 'aria-hidden': true }, open ? h(CheckGlyph, null) : null))
}

/** 固定在触发按钮下方的入口菜单。 */
function EntryMenu({ entries, anchor, sessionId, jobs, jobsOpen, onToggleJobs, onToggleKind, t, onClose }) {
  const menuRef = React.useRef(null)
  const rect = anchor?.getBoundingClientRect()
  const style = rect === undefined
    ? { visibility: 'hidden' }
    : { top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) }

  React.useEffect(() => {
    const onPointerDown = (event) => {
      if (menuRef.current?.contains(event.target)) return
      if (anchor?.contains(event.target)) return
      onClose()
    }
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [anchor, onClose])

  const jobItem = jobs === undefined
    ? null
    : h(JobsMenuRow, {
      jobs,
      sessionId,
      open: jobsOpen,
      onToggle: onToggleJobs,
      onClose,
      t,
    })

  const toolItems = entries.map((entry) => h('button', {
    key: `${entry.providerId}:${entry.id}`,
    type: 'button',
    role: 'menuitem',
    className: 'ct-sp-menu-item',
    onClick: () => {
      onClose()
      onToggleKind(entry.kind)
    },
  }, h('span', { className: 'ct-sp-menu-icon' }, entry.icon !== undefined ? h(entry.icon, { width: 18, height: 18 }) : h(FallbackGlyph, null)),
    h('span', { className: 'ct-sp-menu-label' }, entry.title())))

  return ReactDOM.createPortal(
    h('div', {
      ref: menuRef,
      className: 'ct-sp-menu',
      role: 'menu',
      'data-ct-sp-menu': true,
      style,
    },
    jobItem,
    jobItem !== null && toolItems.length > 0 ? h('div', { className: 'ct-sp-menu-sep', role: 'separator' }) : null,
    toolItems.length > 0 ? toolItems : null),
    document.body)
}

/** 「更多」图标的兜底字形。 */
function FallbackGlyph() {
  return h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    h('rect', { x: 2.5, y: 2.5, width: 11, height: 11, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.4 }))
}

/** 后台任务的层叠字形。 */
function JobsGlyph({ size = 16 }) {
  return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    h('path', { d: 'm8 2.4 5.4 2.9L8 8.2 2.6 5.3 8 2.4Z', stroke: 'currentColor', strokeWidth: 1.25, strokeLinejoin: 'round' }),
    h('path', { d: 'm2.6 8.2 5.4 2.9 5.4-2.9', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    h('path', { d: 'm2.6 11 5.4 2.9L13.4 11', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

function CheckGlyph() {
  return h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    h('path', { d: 'm3.5 8.4 3 3 6-6.4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

/** header 入口条组件工厂。
 *
 * @param seats 右栏座位表
 * @param registry 右栏 tab 注册表（`guide()` 给出入口清单）
 * @param jobs 后台任务服务；空白会话模式下不参与渲染
 * @param t 文案
 * @param openFallback 座位还没挂载时的兜底打开（按会话走原生 openTabIn）
 */
export function createHeaderToolbar({ seats, registry, jobs, t, openFallback }) {
  function HeaderToolbarInner(props) {
    try {
    const { sessionId } = props
    const blank = props.variant === 'blank'
    const entries = React.useSyncExternalStore(
      React.useCallback((listener) => registry.subscribe(listener), [registry]),
      React.useCallback(() => registry.guide(), [registry]),
    )
    // 座位表（session -> actions/布局读取）在右栏 seat 挂载后就绪；订阅它再订阅该会话布局。
    const seat = React.useSyncExternalStore(
      React.useCallback((listener) => seats.subscribe(listener), [seats]),
      React.useCallback(() => seats.get(sessionId), [seats, sessionId]),
    )
    const layout = React.useSyncExternalStore(
      React.useCallback((listener) => (typeof seat?.subscribe === 'function' ? seat.subscribe(listener) : () => {}), [seat]),
      React.useCallback(() => (typeof seat?.layout === 'function' ? seat.layout() : undefined), [seat]),
    )
    const openKinds = React.useMemo(() => {
      const kinds = new Set()
      if (layout?.expanded !== true) return kinds
      for (const node of Object.values(layout.nodes)) {
        if (node.kind !== 'pane' || node.host !== 'dock') continue
        for (const id of node.tabs) {
          const tab = layout.tabs[id]
          if (tab !== undefined && tab.kind !== 'guide') kinds.add(tab.kind)
        }
      }
      return kinds
    }, [layout])
    // 后台任务必须绑定会话：新会话 hero 里不出现这个入口，也不订阅该会话的花名册。
    const hasJobs = !blank && jobs !== undefined
    React.useEffect(() => {
      if (!hasJobs) return undefined
      return jobs.watchRows(sessionId)
    }, [hasJobs, jobs, sessionId])

    const rootRef = React.useRef(null)
    const moreRef = React.useRef(null)
    const [menuOpen, setMenuOpen] = React.useState(false)
    // 刚打开页面就点新会话入口时，右栏 seat 可能还没挂载（会话引用 ready 是异步的）：
    // 先记下要开的 kind，seat 一出现就补开；迟迟不出现才退回原生 openTabIn。
    const [pendingKind, setPendingKind] = React.useState(undefined)
    const budget = useEntryBudget(rootRef, entries.length > 0 || hasJobs, blank ? 'blank' : 'header')
    // 已有会话：「更多」常驻（里面固定有后台任务），先扣掉它自己一个位置。
    // 新会话：没有后台任务，「更多」只在入口放不下时出现。
    let visibleCount = Math.max(0, budget - (hasJobs ? 1 : 0))
    let showMore = hasJobs
    if (entries.length > visibleCount) {
      showMore = true
      visibleCount = Math.max(0, Math.min(visibleCount, budget - 1))
    } else {
      visibleCount = entries.length
    }
    const visible = entries.slice(0, visibleCount)
    const hidden = entries.slice(visibleCount)
    const jobsOpen = hasJobs && openKinds.has(JOBS_KIND)

    if (entries.length === 0 && !hasJobs) return null

    /** 入口的开/关：座位尚未挂载时先排队，等 seat 挂上再开。 */
    const toggleKind = (kind) => {
      const target = seats.get(sessionId)
      if (target === undefined) {
        setPendingKind(kind)
        return
      }
      if (openKinds.has(kind)) target.closeKind?.(kind)
      else target.openPanel?.(kind)
    }

    // 排队的入口：seat 出现（订阅 seats 触发重绘）就补开；2s 还没出现才用原生兜底。
    React.useEffect(() => {
      if (pendingKind === undefined) return undefined
      const target = seats.get(sessionId)
      if (target !== undefined) {
        setPendingKind(undefined)
        target.openPanel?.(pendingKind)
        return undefined
      }
      const timer = setTimeout(() => {
        setPendingKind(undefined)
        openFallback?.(sessionId, pendingKind)
      }, 2000)
      return () => clearTimeout(timer)
    }, [pendingKind, seat, sessionId, openFallback])

    const toggleJobs = () => {
      const target = seats.get(sessionId)
      if (jobsOpen) target?.closeKind?.(JOBS_KIND)
      else target?.openPanel?.(JOBS_KIND)
    }

    return h('span', {
      ref: rootRef,
      className: 'ct-sp-entries',
      'data-ct-sp-entries': true,
      'data-ct-sp-variant': blank ? 'blank' : undefined,
      'data-ct-sp-budget': budget,
    },
      visible.map((entry) => h(Tooltip, {
        key: `${entry.providerId}:${entry.id}`,
        label: entry.title(),
        side: 'bottom',
        delayMs: 400,
        portal: true,
      }, h('button', {
        type: 'button',
        className: 'ct-sp-entry',
        'data-ct-sp-entry': entry.kind,
        'data-active': openKinds.has(entry.kind) || undefined,
        'aria-label': entry.title(),
        'aria-pressed': openKinds.has(entry.kind) || undefined,
        onClick: () => toggleKind(entry.kind),
      }, entry.icon !== undefined ? h(entry.icon, { width: 18, height: 18 }) : h(FallbackGlyph, null)))),
      showMore
        ? h(Tooltip, {
          label: t('more'),
          side: 'bottom',
          delayMs: 400,
          // 菜单打开时禁用气泡：鼠标仍停在触发按钮上，气泡会盖住菜单第一项。
          disabled: menuOpen,
          portal: true,
        }, h('button', {
          ref: moreRef,
          type: 'button',
          className: 'ct-sp-entry',
          'data-ct-sp-more': true,
          'data-open': menuOpen || undefined,
          'aria-label': t('more'),
          'aria-haspopup': 'menu',
          'aria-expanded': menuOpen,
          onClick: () => setMenuOpen((open) => !open),
        }, h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('circle', { cx: 3.5, cy: 8, r: 1.1, fill: 'currentColor' }),
          h('circle', { cx: 8, cy: 8, r: 1.1, fill: 'currentColor' }),
          h('circle', { cx: 12.5, cy: 8, r: 1.1, fill: 'currentColor' }))))
        : null,
      menuOpen && showMore
        ? h(EntryMenu, {
          entries: hidden,
          anchor: moreRef.current,
          sessionId,
          jobs: hasJobs ? jobs : undefined,
          jobsOpen,
          onToggleJobs: toggleJobs,
          onToggleKind: toggleKind,
          t,
          onClose: () => setMenuOpen(false),
        })
        : null)
    } catch (error) {
      return h('span', { 'data-ct-sp-error': String(error && error.stack || error), style: { display: 'none' } })
    }
  }

  return function HeaderToolbar(props) {
    try {
      return h(HeaderToolbarInner, props)
    } catch (error) {
      // 入口条是可选的 UI：渲染崩溃时退化成不可见，不能把整个 header 拖垮。
      return h('span', { 'data-ct-sp-error': String(error && error.stack || error), hidden: true })
    }
  }
}
