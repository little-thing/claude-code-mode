/** 会话壳：一个 session 一份完整原生会话 + 右栏。
 *
 * 壳只接收 `{ sessionId, reference }`，不接收 rect、不知道自己在第几屏。
 * 分屏（workspace-browser）只负责决定壳的宽高与位置；壳内逻辑（header、
 * 正文、composer、右栏、tab）全部走该会话自己的原生 store 与 slot。
 *
 * 右栏宽度是壳内布局：`data-sidebar-right-open` 由 `conversation-side-panel`
 * 的 SidePanel 渲染时写入，`.ct-shell-rightbar` 用 `:has()` 跟随展开/收起；
 * 不经过窗口级 `ctx.layout.openRightbar`。
 */

import * as React from 'react'

const h = React.createElement

/** 右栏宽度按会话存：拖动过就记住，没拖过用 CSS 默认 40%。 */
const WIDTH_KEY_PREFIX = 'ct.shell.rightbarWidth.v1'

function readStoredWidth(sessionId) {
  try {
    const raw = globalThis.localStorage?.getItem(`${WIDTH_KEY_PREFIX}.${sessionId}`)
    const value = raw === null || raw === undefined ? Number.NaN : Number(raw)
    return Number.isFinite(value) && value >= 180 ? value : null
  } catch {
    return null
  }
}

function writeStoredWidth(sessionId, width) {
  try { globalThis.localStorage?.setItem(`${WIDTH_KEY_PREFIX}.${sessionId}`, String(Math.round(width))) } catch { /* 存不了只影响下次恢复 */ }
}

/** 右栏稳定引用：每次渲染生成新函数会让原生 seat 反复执行 retain，拖拽时叠成重渲染。 */
function retainTab() {
  return () => {}
}

/**
 * 一个会话壳。
 * @param {{ sessionId: string, reference: any, SessionProvider: any, mainSurface: any, rightbarSurface: any }} props
 * @returns 壳元素
 */
export function SessionShell({ sessionId, reference, SessionProvider, mainSurface, rightbarSurface }) {
  const rootRef = React.useRef(null)
  const rightbarRef = React.useRef(null)
  // 右栏宽度是壳内状态：拖动把手改变它，按会话持久化；null 表示用 CSS 默认值。
  const [width, setWidth] = React.useState(() => readStoredWidth(sessionId))
  const widthRef = React.useRef(width)
  widthRef.current = width
  // 实际渲染宽度（会被 min/max 夹住）：把手必须贴在真实左边缘，不能按存储值算。
  const [renderedWidth, setRenderedWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const element = rightbarRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return undefined
    const update = () => setRenderedWidth(element.getBoundingClientRect().width)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const startResize = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const root = rootRef.current
    if (root === null) return
    const rect = root.getBoundingClientRect()
    // 上限与 CSS 的 max-width: 50% 对齐，避免保存一个渲染不出来的宽度。
    const max = Math.max(180, Math.min(Math.round(rect.width - 260), Math.floor(rect.width * 0.5)))
    // 以最后一次 move 的意图宽度落盘（等 React 渲染完再读 DOM 会慢一帧）。
    let lastWidth = widthRef.current
    // 函数声明让 move / finish 互相引用，避免事件回调里的 TDZ。
    function finish() {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', finish)
      window.removeEventListener('blur', finish)
      if (lastWidth !== null) writeStoredWidth(sessionId, lastWidth)
    }
    function move(moveEvent) {
      // mouseup 可能丢在窗口外/别的应用：之后普通鼠标移动也必须结束拖拽，
      // 否则右栏宽度跟着指针漂移，内部终端被反复 resize（光标持续闪）。
      if (moveEvent.buttons === 0) {
        finish()
        return
      }
      const next = Math.round(Math.min(max, Math.max(180, rect.right - moveEvent.clientX)))
      lastWidth = next
      setWidth(next)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', finish)
    window.addEventListener('blur', finish)
  }

  const main = mainSurface !== null && typeof mainSurface?.renderSlot === 'function'
    ? mainSurface.renderSlot('main.conversation', {})
    : h('div', { className: 'ct-shell-fallback', role: 'alert' }, '会话主视图不可用')
  // 右栏实际宽度跟随壳内布局，而不是固定 240：内部原生面板会读这个值。
  const rightbarWidth = renderedWidth > 0 ? Math.round(renderedWidth) : 240
  const rightbar = React.useMemo(() => (
    rightbarSurface !== null && typeof rightbarSurface?.renderSlot === 'function'
      ? rightbarSurface.renderSlot('rightbar.session', {
        width: rightbarWidth,
        viewportWidth: typeof window === 'undefined' ? 0 : window.innerWidth,
        canShow: true,
        active: true,
        retainTab,
      })
      : null
  ), [rightbarSurface, sessionId, rightbarWidth])

  return h('div', {
    ref: rootRef,
    className: 'ct-shell',
    'data-ct-shell': sessionId,
    style: width === null ? undefined : { '--ct-shell-rightbar-w': `${width}px` },
  },
    h('div', { className: 'ct-shell-main' },
      typeof SessionProvider === 'function'
        ? h(SessionProvider, { key: `main:${sessionId}`, session: reference }, main)
        : main),
    rightbar === null
      ? null
      : h(React.Fragment, null,
        h('div', {
          className: 'ct-shell-rightbar-handle',
          'data-ct-shell-rightbar-handle': '',
          role: 'separator',
          'aria-orientation': 'vertical',
          'aria-label': '调整右侧面板宽度',
          style: renderedWidth > 0 ? { right: `${renderedWidth - 3}px` } : undefined,
          onMouseDown: startResize,
        }),
        h('div', { ref: rightbarRef, className: 'ct-shell-rightbar', 'data-ct-shell-rightbar': '' },
          typeof SessionProvider === 'function'
            ? h(SessionProvider, { key: `rightbar:${sessionId}`, session: reference }, rightbar)
            : rightbar)))
}
