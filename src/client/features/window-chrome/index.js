/** window-chrome：把侧栏开关、导航后退/前进固定到窗口左上角。
 *
 * 参考 Claude 桌面窗口：
 *  - 开关和导航按钮不放在侧栏内部，收起/展开时位置不变；
 *  - 左侧抽屉（窄窗口的覆盖侧栏）开合不影响这组按钮；
 *  - 侧栏收起后，指针停在开关上时把原生侧栏作为浮层弹出，离开收回。
 *
 * 实现要点：
 *  - chrome 是 `shell.overlay` 里的宿主，portal 到 body：不受 frame 的列网格、
 *    overflow 和 inert 影响，因此能盖在抽屉之上；
 *  - 原生开关只隐藏不删除，只保留焦点锚点；
 *  - peek 不复制 SidebarRoot：包装 sidebar 入口，peek 打开时覆盖 props 为展开态，
 *    由 CSS 把原生侧栏列临时变成 absolute 浮层；列宽不变、主内容不位移。
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import {
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconPanelLeftOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Tooltip } from '../../shared/ui/tooltip.js'
import chromeCss from './window-chrome.css'
import { createNavigationHistory } from './history.js'
import { createSidebarPeek } from './peek.js'
import { createCollapsedRail } from './rail.js'

const h = React.createElement
const STYLE_ID = 'ct-window-chrome'
const HOST_ID = 'ct-window-chrome'

/** 当前布局 frame（AppFrame 的根 div）。 */
function frameElement() {
  return document.querySelector('[data-shell-overlay]')?.parentElement ?? null
}

/** 订阅侧栏是否收起：标签和 aria 需要跟随开合状态。 */
function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = React.useState(() => frameElement()?.hasAttribute('data-sidebar-collapsed') ?? false)
  React.useEffect(() => {
    const element = frameElement()
    if (element === null) return undefined
    const sync = () => setCollapsed(element.hasAttribute('data-sidebar-collapsed'))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(element, { attributes: true, attributeFilter: ['data-sidebar-collapsed', 'data-sidebar-drawer'] })
    return () => observer.disconnect()
  }, [])
  return collapsed
}

/** 一个 28px 的图标按钮；提示统一走共享 Tooltip。 */
function ChromeButton({ label, disabled, pressed, attribute, opener, onClick, onPointerEnter, onPointerLeave, children }) {
  const button = h('button', {
    type: 'button',
    className: 'ct-window-chrome__button',
    [attribute]: '',
    'data-sidebar-opener': opener ? '' : undefined,
    'aria-label': label,
    'aria-disabled': disabled ? 'true' : undefined,
    'aria-pressed': pressed === undefined ? undefined : pressed ? 'true' : 'false',
    disabled: disabled || undefined,
    onClick,
    onPointerEnter,
    onPointerLeave,
  }, children)
  return h(Tooltip, { label, side: 'bottom', delayMs: 500 }, button)
}

/** chrome 的按钮组；portal 到 body，位置由 CSS 固定。 */
function ChromeHost({ layout, peek, history }) {
  const collapsed = useSidebarCollapsed()
  const historySnapshot = React.useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot)
  const toggleLabel = collapsed ? '展开侧边栏' : '收起侧边栏'

  return createPortal(
    h('div', { className: 'ct-window-chrome', 'data-ct-window-chrome': '' },
      h(ChromeButton, {
        label: toggleLabel,
        attribute: 'data-ct-window-chrome-toggle',
        opener: true,
        pressed: !collapsed,
        onClick: () => {
          peek.close()
          layout.toggleSidebar()
        },
        onPointerEnter: () => { peek.scheduleOpen() },
        onPointerLeave: () => { peek.scheduleClose() },
      }, h(IconPanelLeftOutlineRegular, { size: 16 })),
      h(ChromeButton, {
        label: '后退',
        attribute: 'data-ct-window-chrome-back',
        disabled: !historySnapshot.canBack,
        onClick: () => {
          peek.close()
          history.goBack()
        },
      }, h(IconChevronLeftOutlineRegular, { size: 16 })),
      h(ChromeButton, {
        label: '前进',
        attribute: 'data-ct-window-chrome-forward',
        disabled: !historySnapshot.canForward,
        onClick: () => {
          peek.close()
          history.goForward()
        },
      }, h(IconChevronRightOutlineRegular, { size: 16 })),
    ),
    document.body,
  )
}

/** 包装 sidebar 入口：peek 打开时把原生 SidebarRoot 覆盖成展开态。
 *
 * slots 服务先于 ui-sidebar 的入口注册就绪，因此不能只查一次：订阅 sidebar
 * 槽，入口出现后再包，避免 peek 时仍渲染 rail。
 */
function installSidebarPeek(scope, peek) {
  let entry = null
  let original = null
  let wrapper = null

  const sync = () => {
    const next = scope.slots.entries('sidebar')[0]
    if (next === undefined) return
    if (next === entry && next.component === wrapper) return
    if (entry !== null && entry.component === wrapper) entry.component = original
    entry = next
    original = next.component
    wrapper = function WindowChromeSidebar(props) {
      const open = React.useSyncExternalStore(peek.subscribe, peek.getSnapshot, peek.getSnapshot)
      return h(original, open
        ? { ...props, collapsed: false, drawer: false, width: peek.width }
        : props)
    }
    next.component = wrapper
  }

  sync()
  const off = scope.slots.subscribe('sidebar', sync)
  return () => {
    off()
    if (entry !== null && entry.component === wrapper) entry.component = original
  }
}

/** @param {any} ctx 客户端 root context */
export function install(ctx) {
  // HMR 会保留旧的 style 元素；每次都覆盖内容，避免热更新后仍是旧布局。
  let style = document.getElementById(STYLE_ID)
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = chromeCss

  const dispose = ctx.inject(['slots', 'sessions', 'uiWorkspace', 'layout'], (scope) => {
    const peek = createSidebarPeek()
    const collapsedRail = createCollapsedRail()
    const history = createNavigationHistory({
      sessions: scope.get('sessions'),
      ui: scope.get('uiWorkspace'),
    })
    const restoreSidebar = installSidebarPeek(scope, peek)
    const disposeChrome = scope.slots.inject('shell.overlay', () => scope.slots.register(
      { name: 'shell.overlay', id: HOST_ID },
      props => h(ChromeHost, { ...props, layout: scope.get('layout'), peek, history }),
    ))

    return () => {
      disposeChrome()
      restoreSidebar()
      history.dispose()
      collapsedRail.dispose()
      peek.dispose()
    }
  })

  return () => {
    if (typeof dispose === 'function') dispose()
    document.getElementById(STYLE_ID)?.remove()
  }
}
