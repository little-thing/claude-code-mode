/** conversation-header-menu：把会话 header 的「更多」菜单与「打开方式」搬到会话名后面。
 *
 * DSH 里这两块都是原生插件能力，但都没有「会话名后下拉」这个形态：
 *  - 「更多」由 `@deepseek-ai/dsh-session-log-export` 注册在
 *    `conversation.session.header.utilities`，自己渲染一个 ⋯ 按钮和菜单
 *    （复制会话为 Markdown / 下载 Session 日志 / 反馈）；
 *  - 「打开方式」由 `@deepseek-ai/dsh-client-ui-open-in-app` 注册在同一槽里，
 *    是主按钮 + chevron 的分裂按钮。
 *
 * 这里按 Claude 的形态把两者收进 `conversation.session.header.actions`
 * （会话名旁边）的一个下拉按钮：
 *  - 菜单项行为复用原生能力：Markdown 导出走 `/api/session.markdown`，
 *    下载走 `sessionLogDownload` 服务，反馈走 `feedbackUi` 服务；
 *  - 打开方式的应用清单来自宿主 `/open-in-app/apps`，打开动作调用
 *    `/open-in-app/open`，与原生按钮同一份数据；
 *  - 菜单是自绘弹出层，但文案优先复用原生 `session-log-download` 字典；
 *  - 原生 utilities 里的 ⋯ 与打开方式按钮由 CSS 隐藏，避免两个入口。
 *
 * 与皮肤无关：按钮/菜单只引用 DSH 令牌；打开方式子菜单的图标来自宿主。
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from '../../shared/ui/tooltip.js'
import headerMenuCss from './conversation-header-menu.css'

const h = React.createElement

/** 标题旁的原生动作槽：正好在会话名（面包屑）后面。 */
const ACTIONS_SLOT = 'conversation.session.header.actions'

/** 宿主接口（与原生 open-in-app 客户端同一组路由）。 */
const APPS_ROUTE = 'open-in-app/apps'
const OPEN_ROUTE = 'open-in-app/open'
const ICON_ROUTE = 'open-in-app/icon/'
/** 原生 session-log-export 的 Markdown 导出路由（页面相对）。 */
const MARKDOWN_ROUTE = 'api/session.markdown'

const LOCALE_NS = 'ctHeaderMenu'
const DICTIONARIES = {
  zh: { open: '更多选项', openWith: '打开方式', opened: '已在{app}中打开', copied: 'Session 已复制为 Markdown', copyFailed: '无法读取 Session 进行复制，请重试', clipboardFailed: '无法写入剪贴板，请检查剪贴板权限后重试', openFailed: '打开失败' },
  en: { open: 'More options', openWith: 'Open with', opened: 'Opened in {app}', copied: 'Session copied as Markdown', copyFailed: 'Could not read the Session for copying', clipboardFailed: 'Could not write to the clipboard', openFailed: 'Could not open' },
}

/** 应用 id → 原生 open-in-app 字典键；顺序与宿主菜单一致（宿主返回顺序优先）。 */
const APP_KEYS = {
  finder: 'app.finder', explorer: 'app.explorer', filemanager: 'app.filemanager',
  cursor: 'app.cursor', vscode: 'app.vscode', vscodeinsiders: 'app.vscodeinsiders',
  windsurf: 'app.windsurf', zed: 'app.zed', sublimetext: 'app.sublimetext',
  xcode: 'app.xcode', androidstudio: 'app.androidstudio', intellij: 'app.intellij',
  pycharm: 'app.pycharm', webstorm: 'app.webstorm', phpstorm: 'app.phpstorm',
  goland: 'app.goland', rider: 'app.rider', rustrover: 'app.rustrover',
  fork: 'app.fork', sourcetree: 'app.sourcetree', github: 'app.github',
  tower: 'app.tower', gitkraken: 'app.gitkraken', smartgit: 'app.smartgit',
  sublimemerge: 'app.sublimemerge', ghostty: 'app.ghostty', warp: 'app.warp',
  iterm: 'app.iterm', kitty: 'app.kitty', terminal: 'app.terminal',
  windowsterminal: 'app.windowsterminal', gitbash: 'app.gitbash',
  gnometerminal: 'app.gnometerminal', konsole: 'app.konsole',
}

/** 原生字典不可用时的兜底名称（与 DSH 英文文案一致）。 */
const APP_NAMES = {
  finder: 'Finder', explorer: 'File Explorer', filemanager: 'Files',
  cursor: 'Cursor', vscode: 'VS Code', vscodeinsiders: 'VS Code Insiders',
  windsurf: 'Windsurf', zed: 'Zed', sublimetext: 'Sublime Text',
  xcode: 'Xcode', androidstudio: 'Android Studio', intellij: 'IntelliJ IDEA',
  pycharm: 'PyCharm', webstorm: 'WebStorm', phpstorm: 'PhpStorm',
  goland: 'GoLand', rider: 'Rider', rustrover: 'RustRover',
  fork: 'Fork', sourcetree: 'Sourcetree', github: 'GitHub Desktop',
  tower: 'Tower', gitkraken: 'GitKraken', smartgit: 'SmartGit',
  sublimemerge: 'Sublime Merge', ghostty: 'Ghostty', warp: 'Warp',
  iterm: 'iTerm2', kitty: 'kitty', terminal: 'Terminal',
  windowsterminal: 'Windows Terminal', gitbash: 'Git Bash',
  gnometerminal: 'GNOME Terminal', konsole: 'Konsole',
}

const STYLE_ID = 'ct-conversation-header-menu'
const MENU_WIDTH = 232
const SUBMENU_WIDTH = 200

function injectStyles() {
  let style = document.getElementById(STYLE_ID)
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== headerMenuCss) style.textContent = headerMenuCss
  return style
}

/** 极简快照 store：应用清单只在页面生命周期里读一次。 */
function createStore(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    set: (next) => { value = next; for (const listener of listeners) listener() },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

let appsRequest

function loadApps() {
  if (appsRequest === undefined) {
    appsRequest = fetch(APPS_ROUTE, { headers: { accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) throw new Error(`apps: HTTP ${String(response.status)}`)
        return response.json()
      })
      .then((payload) => (Array.isArray(payload?.apps) ? payload.apps : []))
      .then((ids) => ids.filter((id) => typeof id === 'string' && APP_KEYS[id] !== undefined))
      .catch(() => {
        appsRequest = undefined
        return []
      })
  }
  return appsRequest
}

/** 弹层位置：优先按钮下方，越界时收进视口。 */
function menuPoint(rect) {
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8))
  const top = rect.bottom + 6
  return { x: left, y: Math.min(top, Math.max(8, window.innerHeight - 240)) }
}

function Separator() {
  return h('div', { className: 'ct-hm-sep', role: 'separator' })
}

/**
 * @param {{ label: string, icon?: React.ReactNode, shortcut?: string, disabled?: boolean, danger?: boolean, onClick: () => void, onHover?: () => void, hasSubmenu?: boolean }} props
 */
function MenuRow({ label, icon, shortcut, disabled, danger, onClick, onHover, onLeave, hasSubmenu }) {
  return h('button', {
    type: 'button',
    role: 'menuitem',
    className: 'ct-hm-item',
    'data-danger': danger ? true : undefined,
    'data-has-sub': hasSubmenu ? true : undefined,
    disabled: disabled === true || undefined,
    onClick: (event) => { event.stopPropagation(); onClick() },
    onMouseEnter: onHover,
    onMouseLeave: onLeave,
  },
  icon === undefined ? null : h('span', { className: 'ct-hm-icon', 'aria-hidden': true }, icon),
  h('span', { className: 'ct-hm-label' }, label),
  shortcut === undefined ? null : h('span', { className: 'ct-hm-shortcut' }, shortcut),
  hasSubmenu ? h('svg', { width: 10, height: 10, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, className: 'ct-hm-chevron' },
    h('path', { d: 'M6.2 3.8 10.4 8l-4.2 4.2', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' })) : null)
}

/** 打开方式子菜单：应用清单来自宿主；每项调用宿主打开接口。 */
function OpenWithMenu({ apps, point, appName, onPick, onClose, onPointerEnter, onPointerLeave }) {
  const [failed, setFailed] = React.useState('')
  const style = { top: point.y, left: point.x }
  return h('div', {
    className: 'ct-hm-menu ct-hm-submenu',
    role: 'menu',
    'data-ct-header-submenu': true,
    style,
    onPointerEnter,
    onMouseEnter: onPointerEnter,
    onPointerLeave,
    onMouseLeave: onPointerLeave,
  },
  apps.length === 0
    ? h('div', { className: 'ct-hm-empty' }, failed === '' ? '—' : failed)
    : apps.map((id) => h(MenuRow, {
      key: id,
      label: appName(id),
      icon: h('img', {
        src: ICON_ROUTE + id,
        width: 14,
        height: 14,
        alt: '',
        draggable: false,
        onError: (event) => { event.currentTarget.style.visibility = 'hidden' },
      }),
      onClick: () => { onPick(id); onClose() },
    })))
}

/**
 * @param {{ sessionId: string, appsStore: any, services: any, t: any, openInAppT: any, onClose: () => void, point: { x: number, y: number } }} props
 */
function HeaderMenu({ sessionId, appsStore, services, t, appName, onClose, point, triggerRef }) {
  const apps = React.useSyncExternalStore(appsStore.subscribe, appsStore.getSnapshot)
  const menuRef = React.useRef(null)
  const [submenuPoint, setSubmenuPoint] = React.useState(null)

  React.useEffect(() => {
    const onPointerDown = (event) => {
      // 点击触发按钮交给它自己的 onClick 切换；否则捕获阶段会先关再被打开。
      if (event.target instanceof Node && triggerRef?.current?.contains(event.target)) return
      const inMenu = menuRef.current?.contains(event.target)
      const inSubmenu = event.target instanceof Element && event.target.closest('[data-ct-header-submenu]') !== null
      if (!inMenu && !inSubmenu) onClose()
    }
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [onClose])

  // 二级菜单遵循通用菜单的悬停逻辑：离开父项后由子菜单接住指针时保持，
  // 指针既不在父项也不在子菜单上时延迟收回，避免斜穿 4px 间隙时闪断。
  const closeTimer = React.useRef(null)
  React.useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
  }, [])
  const cancelClose = () => {
    if (closeTimer.current === null) return
    clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setSubmenuPoint(null)
    }, 200)
  }
  const openSubmenu = () => {
    cancelClose()
    const anchor = menuRef.current?.querySelector('[data-has-sub]')
    const rect = anchor?.getBoundingClientRect()
    const top = rect === undefined ? point.y : Math.max(8, Math.min(rect.top - 4, window.innerHeight - 260))
    const left = rect === undefined ? point.x + MENU_WIDTH : rect.right + 4
    setSubmenuPoint({
      x: Math.min(left, window.innerWidth - SUBMENU_WIDTH - 8),
      y: top,
    })
  }

  const copyMarkdown = async () => {
    onClose()
    try {
      const response = await fetch(`${MARKDOWN_ROUTE}?${new URLSearchParams({ sessionId }).toString()}`)
      if (!response.ok) throw new Error(`markdown: HTTP ${String(response.status)}`)
      const markdown = await response.text()
      try {
        await navigator.clipboard.writeText(markdown)
        services.notify(t('copied'), true)
      } catch (_error) {
        services.notify(t('clipboardFailed'))
      }
    } catch (_error) {
      services.notify(t('copyFailed'))
    }
  }

  const download = () => {
    onClose()
    try {
      services.download(sessionId)
    } catch (_error) {
      services.notify(t('openFailed'))
    }
  }

  const feedback = () => {
    onClose()
    services.feedback(sessionId)
  }

  return createPortal(
    h(React.Fragment, null,
      h('div', {
        ref: menuRef,
        className: 'ct-hm-menu',
        role: 'menu',
        'data-ct-header-menu-panel': true,
        style: { top: point.y, left: point.x },
      },
      h(MenuRow, {
        label: t('openWith'),
        icon: h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('path', { d: 'M6 3.2H3.6a.4.4 0 0 0-.4.4v9a.4.4 0 0 0 .4.4h9a.4.4 0 0 0 .4-.4V10M9.2 2.8h4v4M12.9 3.1 7.3 8.7', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' })),
        hasSubmenu: true,
        disabled: apps.length === 0,
        onClick: () => {
          cancelClose()
          if (submenuPoint === null) openSubmenu()
          else setSubmenuPoint(null)
        },
        onHover: openSubmenu,
        onLeave: scheduleClose,
      }),
      h(Separator),
      h(MenuRow, { label: services.copyLabel, onClick: copyMarkdown, onHover: scheduleClose }),
      h(MenuRow, { label: services.downloadLabel, onClick: download, onHover: scheduleClose }),
      h(Separator),
      h(MenuRow, { label: services.feedbackLabel, onClick: feedback, onHover: scheduleClose })),
      submenuPoint === null ? null : h(OpenWithMenu, {
        apps,
        point: submenuPoint,
        appName,
        onClose: onClose,
        onPointerEnter: cancelClose,
        onPointerLeave: scheduleClose,
        onPick: (id) => {
          const directory = services.directory
          if (directory === undefined) return
          fetch(OPEN_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ app: id, path: directory }),
          }).then((response) => {
            if (!response.ok) throw new Error('open failed')
            services.notify(t('opened', { app: appName(id) }), true)
          }).catch(() => { services.notify(t('openFailed')) })
        },
      })),
    document.body,
  )
}

/**
 * @param {{ sessionId: string, appsStore: any, services: any, t: any, appName: any }} props
 * @returns 会话名后的下拉按钮；菜单由插件自绘，行为复用原生能力。
 */
export function SessionMenuButton({ sessionId, appsStore, services, t, appName }) {
  const [point, setPoint] = React.useState(null)
  const triggerRef = React.useRef(null)

  React.useEffect(() => () => { setPoint(null) }, [])

  const onClick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (point !== null) {
      setPoint(null)
      return
    }
    setPoint(menuPoint(event.currentTarget.getBoundingClientRect()))
  }

  return h(React.Fragment, null,
    h(Tooltip, {
      label: t('open'),
      side: 'bottom',
      delayMs: 400,
      portal: true,
    }, h('button', {
      type: 'button',
      className: 'ct-hm-trigger',
      'data-ct-header-menu': true,
      'aria-label': t('open'),
      'aria-haspopup': 'menu',
      'aria-expanded': point === null ? undefined : 'true',
      onClick,
      onPointerDown: (event) => { event.stopPropagation() },
      ref: triggerRef,
    }, h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
      h('path', {
        d: 'M3.8 6.2 8 10.4l4.2-4.2',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      })))),
    point === null ? null : h(HeaderMenu, {
      sessionId,
      appsStore,
      services: services(sessionId),
      t,
      appName,
      point,
      triggerRef,
      onClose: () => { setPoint(null) },
    }))
}

/**
 * 安装功能：标题旁下拉按钮 + 打开方式子菜单。
 * @param {any} ctx 客户端 root context
 * @returns {() => void}
 */
export function install(ctx) {
  let style = null
  try {
    style = injectStyles()
  } catch (error) {
    console.warn('[conversation-header-menu] style injection failed', error)
  }

  let dispose = () => {}
  dispose = ctx.inject(['slots', 'locale', 'contextMenus', 'sessions'], (scope) => {
    const locale = scope.get('locale')
    const sessions = scope.get('sessions')
    const menus = scope.get('contextMenus')
    scope.effect(() => locale.register(LOCALE_NS, DICTIONARIES), 'conversation-header-menu: copy')
    const t = locale.bind(LOCALE_NS)
    // 原生字典：文案与原生菜单一致；未注册时 bind 会把 key 原样返回。
    const logT = locale.bind('session-log-download')
    const openInApp = locale.bind('open-in-app')
    const appName = (id) => {
      const key = APP_KEYS[id]
      const translated = key === undefined ? key : openInApp(key)
      return translated !== undefined && translated !== key ? translated : APP_NAMES[id] ?? id
    }
    const logLabel = (key, fallback) => {
      const value = logT(key)
      return value === key ? fallback : value
    }
    const appsStore = createStore([])
    let appsAttempted = false
    const refreshApps = () => {
      if (appsAttempted) return
      appsAttempted = true
      void loadApps().then((apps) => { appsStore.set(apps) })
    }
    refreshApps()

    const servicesFor = (sessionId) => {
      const directory = sessions.list.getSnapshot().byId[sessionId]?.cwd
      return {
        directory,
        copyLabel: logLabel('menu.copyMarkdown', 'Copy Session as Markdown'),
        downloadLabel: logLabel('menu.download', 'Download Session log'),
        feedbackLabel: logLabel('menu.feedback', 'Feedback'),
        notify: (text, success) => { try { menus.notify(text, success) } catch (_error) { /* menu closed */ } },
        download: (id) => { try { scope.get('sessionLogDownload')?.download(id) } catch (_error) { /* unavailable */ } },
        feedback: (id) => { try { scope.get('feedbackUi')?.openSession(id) } catch (_error) { /* unavailable */ } },
      }
    }

    const Button = (props) => h(SessionMenuButton, { ...props, appsStore, services: servicesFor, t, appName })
    const stop = scope.slots.inject(ACTIONS_SLOT, () => scope.slots.register({
      name: ACTIONS_SLOT,
      id: 'ct-header-menu',
      order: -100,
    }, Button))
    return () => stop()
  })

  return () => {
    dispose()
    // 卸载后原生 utilities 按钮必须回来：隐藏它们的是本功能的样式。
    if (document.getElementById(STYLE_ID) === style) style?.remove()
  }
}
