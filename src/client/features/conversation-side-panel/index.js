/** conversation-side-panel：Claude 式会话右侧面板 + header 入口条。
 *
 * 原生右侧栏的 DockLayout 只画 1–2 个水平 pane（第 3 个会 throw），所以这里
 * 接管 `rightbar.session` 的渲染：布局自绘，tab 内容仍走原生
 * `sidebar.right.pane.tab` slot。入口清单来自 `sidebarRightTabs.guide()`，
 * 在会话 header 右上角排开，放不下的收进「更多」。
 *
 * 后台任务是本功能自己贡献的 rightbar tab：它**不注册 guide**，因此不会
 * 出现在 header 入口条里，只从「更多」菜单进入；原生 header 的 jobs 触发器
 * 按 slot 注册项 id 屏蔽（见 patchJobsTrigger）。
 *
 * 依赖的是原生 seat 的 props（renderSlot / store / occurrence / 注入面），
 * 与 workspace-browser 的 rightbar 包装同级别：DSH 改 RightbarSeat 的注入
 * 形状时，只需改本文件的 patch 与 side-panel.js 的 props 解构。
 */

import * as React from 'react'
import css from './side-panel.css'
import jobsCss from './jobs-panel.css'
import { createSidePanel } from './side-panel.js'
import { createHeaderToolbar } from './header-toolbar.js'
import { createJobsPanel, JOBS_KIND, JOBS_TAB_ID } from './jobs-panel.js'

export const id = 'conversation-side-panel'

/** 右栏 seat 的 slot key（原生注册在这里）。 */
const RIGHTBAR_SEAT = 'rightbar.session'
/** 会话 header 右侧的列表槽。 */
const HEADER_UTILITIES = 'conversation.session.header.utilities'
/** 会话 header 右上角 corner 槽：已有会话放右栏开关/分屏关闭，新会话 hero 也保留这一格。 */
const HEADER_CORNER = 'conversation.session.header.corner'
/** 会话名旁的原生动作槽：原生 jobs 触发器注册在这里（id `job-list`）。 */
const HEADER_ACTIONS = 'conversation.session.header.actions'
/** 右栏 pane body 的 keyed slot。 */
const PANE_TAB_SLOT = 'sidebar.right.pane.tab'
/** 原生 jobs 触发器在本槽里的注册 id。 */
const NATIVE_JOBS_ACTION = 'job-list'

const LOCALE_NS = 'ctSidePanel'
const DICTIONARIES = {
  zh: {
    more: '更多',
    close: '关闭面板',
    collapse: '收起右侧边栏',
    fullscreen: '全屏',
    exitFullscreen: '退出全屏',
    emptyPane: '没有打开的面板',
    unavailable: '这个面板类型当前不可用',
    blankTitle: '右侧面板',
    blankHint: '从会话右上角的图标打开文件、终端或 Git',
    newTab: '新建一个',
    maximize: '最大化面板',
    restore: '还原面板',
    jobs: '后台任务',
    'section.live': '进行中',
    'section.settled': '已完成',
    clear: '清空',
    'kill.stop': '停止任务',
    'kill.confirm': '确认停止',
    'kill.failed': '停止失败',
    'row.expand': '展开「{label}」的输出',
    'row.collapse': '收起「{label}」的输出',
    'empty.title': '没有后台任务',
    'empty.hint': '在这个会话里启动的后台命令会显示在这里',
    'status.running': '运行中',
    'status.stopping': '正在停止',
    'status.completed': '已完成',
    'status.killed': '已停止',
    'status.failed': '失败',
    'duration.hours': '{hours} 小时 {minutes} 分',
    'duration.minutes': '{minutes} 分 {seconds} 秒',
    'duration.seconds': '{seconds} 秒',
    'output.gap': '较早的输出已被丢弃',
    'output.error': '输出中断：{error}',
    'output.empty': '（暂无输出）',
    'output.copy': '复制',
    'output.copied': '已复制',
    'output.label': '「{label}」的输出',
  },
  en: {
    more: 'More',
    close: 'Close panel',
    collapse: 'Collapse sidebar',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen',
    emptyPane: 'No panel open',
    unavailable: 'This panel type is unavailable',
    blankTitle: 'Side panel',
    blankHint: 'Open files, terminal or Git from the icons at the top right of the conversation',
    newTab: 'New',
    maximize: 'Maximize panel',
    restore: 'Restore panel',
    jobs: 'Background tasks',
    'section.live': 'Running',
    'section.settled': 'Completed',
    clear: 'Clear',
    'kill.stop': 'Stop task',
    'kill.confirm': 'Confirm',
    'kill.failed': 'Stop failed',
    'row.expand': 'Show output of "{label}"',
    'row.collapse': 'Hide output of "{label}"',
    'empty.title': 'No background tasks',
    'empty.hint': 'Background commands started in this session appear here',
    'status.running': 'Running',
    'status.stopping': 'Stopping',
    'status.completed': 'Completed',
    'status.killed': 'Stopped',
    'status.failed': 'Failed',
    'duration.hours': '{hours}h {minutes}m',
    'duration.minutes': '{minutes}m {seconds}s',
    'duration.seconds': '{seconds}s',
    'output.gap': 'Earlier output was dropped',
    'output.error': 'Output interrupted: {error}',
    'output.empty': '(no output yet)',
    'output.copy': 'Copy',
    'output.copied': 'Copied',
    'output.label': 'Output of "{label}"',
  },
}

const STYLE_ID = 'ct-conversation-side-panel'

function injectStyles() {
  // 内容变化时同步替换：热更新重载插件后旧样式不能留在页面上。
  const text = `${css}\n${jobsCss}`
  let style = document.getElementById(STYLE_ID)
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== text) style.textContent = text
  return style
}

/**
 * 订阅会话列表，判断这个会话是否仍是「新会话」（还没提交第一轮）。
 * hero 状态下原生 header 只渲染 corner，入口条挂在那里。
 */
function useBlankSession(sessions, sessionId) {
  const store = sessions?.list
  const subscribe = React.useCallback(
    (listener) => (store === undefined ? () => {} : store.subscribe(listener)),
    [store],
  )
  const getSnapshot = React.useCallback(
    () => (store === undefined ? false : store.getSnapshot()?.byId?.[sessionId]?.blank === true),
    [store, sessionId],
  )
  return React.useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * 安装功能：接管右栏渲染 + 注册 header 入口条 + 后台任务 pane。
 * @param {any} ctx 客户端 root context
 * @returns {() => void}
 */
export function install(ctx) {
  let style = null
  try {
    style = injectStyles()
  } catch (error) {
    console.warn('[conversation-side-panel] style injection failed', error)
  }

  let dispose = () => {}
  // jobs 必须在依赖里声明：它是 DSH base 的客户端服务，晚于本插件注册；
  // 只 get() 会在插件加载那一刻拿到 undefined，菜单也就没有后台任务项。
  dispose = ctx.inject(['slots', 'sidebarRight', 'sidebarRightTabs', 'locale', 'jobs', 'sessions'], (scope) => {
    const sbr = scope.get('sidebarRight')
    const registry = scope.get('sidebarRightTabs')
    const locale = scope.get('locale')
    const jobs = scope.get('jobs')
    const sessions = scope.get('sessions')
    /** sessionId -> { actions, openPanel, closeKind, layout, subscribe, isOpen }。
     * 可订阅：header 入口条在右栏 seat 挂载后才拿得到布局，用订阅在挂载/变化时重绘。 */
    const map = new Map()
    const listeners = new Set()
    const seats = {
      get: (sessionId) => map.get(sessionId),
      set: (sessionId, value) => { map.set(sessionId, value); for (const listener of listeners) listener() },
      delete: (sessionId) => { map.delete(sessionId); for (const listener of listeners) listener() },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      clear: () => { map.clear(); for (const listener of listeners) listener() },
    }

    scope.effect(() => locale.register(LOCALE_NS, DICTIONARIES), 'conversation-side-panel: copy')
    const t = locale.bind(LOCALE_NS)

    const SidePanel = createSidePanel({ sbr, registry, seats, t })
    /** 座位尚未挂载时按会话走原生 openTabIn：seat 一挂上就由自绘面板接管渲染。 */
    const openFallback = (sessionId, kind) => {
      try {
        sbr.openTabIn(sessionId, kind)
      } catch (error) {
        console.warn('[conversation-side-panel] open without seat failed', error)
      }
    }
    const Toolbar = createHeaderToolbar({ seats, registry, jobs, t, openFallback })

    /** 新会话 hero：会话已经存在但还没提交第一轮，原生 header 只有 corner。
     * 把同一套入口条挂进 corner，让文件/终端/Git 这类不依赖对话内容的面板
     * 在 hero 就能打开；后台任务等必须绑定会话内容的入口由 toolbar 的 blank
     * 模式排除。 */
    const BlankHeaderToolbar = function CtBlankHeaderToolbar({ sessionId }) {
      const blank = useBlankSession(sessions, sessionId)
      if (!blank) return null
      return React.createElement(Toolbar, { sessionId, variant: 'blank' })
    }

    // 后台任务 pane：只注册 tab 类型与 body，不声明 guide → 不占 header 入口条。
    if (jobs !== undefined) {
      const JobsPanel = createJobsPanel({ jobs, t })
      scope.effect(() => registry.register({
        id: JOBS_TAB_ID,
        kind: JOBS_KIND,
        priority: 'extension',
        title: () => t('jobs'),
      }), 'conversation-side-panel: jobs tab type')
      scope.effect(() => scope.slots.inject(PANE_TAB_SLOT, () => scope.slots.register({
        name: PANE_TAB_SLOT,
        key: JOBS_TAB_ID,
      }, JobsPanel)), 'conversation-side-panel: jobs tab body')
    }

    // 接管右栏 seat：原生注册的组件保留为「未 materialize / 收起」时的回退。
    const patched = new WeakSet()
    const patches = []
    const patchSeats = () => {
      for (const entry of scope.slots.entries(RIGHTBAR_SEAT)) {
        if (patched.has(entry)) continue
        patched.add(entry)
        const Native = entry.component
        const Wrapper = function ClaudeThemeSidePanel(props) {
          return React.createElement(SidePanel, { ...props, Native })
        }
        entry.component = Wrapper
        patches.push({ entry, component: Native, wrapper: Wrapper })
      }
    }
    patchSeats()
    const stopSeat = scope.slots.subscribe(RIGHTBAR_SEAT, patchSeats)

    // 新会话 hero 的 header 只渲染 corner（标题/utilities 都被 hideChrome 关掉），
    // 所以把入口条包进 corner 注册项；正常会话里 BlankHeaderToolbar 渲染 null。
    const patchedCorners = new WeakSet()
    const cornerPatches = []
    /** 热重载时旧实例的包装可能留在链里（新实例包在外面，旧 dispose 撤不掉）。
     * `live` 关掉后旧包装只转发原生 corner，不再重复渲染一份入口条。 */
    const cornerState = { live: true }
    const patchCorner = () => {
      const entry = scope.slots.entries(HEADER_CORNER)[0]
      if (entry === undefined || patchedCorners.has(entry)) return
      patchedCorners.add(entry)
      const Native = entry.component
      const Wrapper = function ClaudeThemeBlankHeader(props) {
        // 入口条放在原生 corner 内容之前：workspace-browser 的分屏关闭按钮
        // 无论先包还是后包，都保持在 corner 最右侧。
        return React.createElement(React.Fragment, null,
          cornerState.live
            ? React.createElement(BlankHeaderToolbar, { sessionId: props.sessionId })
            : null,
          React.createElement(Native, props))
      }
      entry.component = Wrapper
      cornerPatches.push({ entry, component: Native, wrapper: Wrapper })
    }
    patchCorner()
    const stopCorner = scope.slots.subscribe(HEADER_CORNER, patchCorner)

    // 原生后台任务触发器：后台任务只从 header 最右的「更多」进入。
    // 按注册项 id 屏蔽，而不是 CSS/DOM——原生类名是 CSS Modules 哈希，且
    // 不同版本的 trigger 结构不同（有的带 data-job-count，有的没有）。
    const CtHiddenNativeJobs = function CtHiddenNativeJobs() { return null }
    const patchedActions = new WeakSet()
    const actionPatches = []
    const patchJobsTrigger = () => {
      for (const entry of scope.slots.entries(HEADER_ACTIONS)) {
        if (entry.options?.id !== NATIVE_JOBS_ACTION) continue
        if (patchedActions.has(entry)) continue
        patchedActions.add(entry)
        const Native = entry.component
        entry.component = CtHiddenNativeJobs
        actionPatches.push({ entry, component: Native })
      }
    }
    patchJobsTrigger()
    const stopJobsTrigger = scope.slots.subscribe(HEADER_ACTIONS, patchJobsTrigger)

    const disposeToolbar = scope.slots.inject(HEADER_UTILITIES, () => scope.slots.register({
      name: HEADER_UTILITIES,
      id: 'ct-side-panel',
    }, Toolbar))

    return () => {
      cornerState.live = false
      stopSeat()
      stopCorner()
      stopJobsTrigger()
      disposeToolbar()
      for (const saved of patches) {
        // 热重载时新实例可能已重新包过这个 seat；只撤自己的包装，避免覆盖新实例。
        if (saved.entry.component === saved.wrapper) saved.entry.component = saved.component
      }
      for (const saved of cornerPatches) {
        if (saved.entry.component === saved.wrapper) saved.entry.component = saved.component
      }
      for (const saved of actionPatches) {
        if (saved.entry.component === CtHiddenNativeJobs) saved.entry.component = saved.component
      }
      seats.clear()
    }
  })

  return () => {
    dispose()
    // 卸载后原生右栏/展开按钮必须回来：隐藏它们的是本功能的样式。
    if (document.getElementById(STYLE_ID) === style) style?.remove()
  }
}
