/** 侧栏收起后的 hover 浮层（peek）。
 *
 * 不复制第二份 SidebarRoot：包装 sidebar 入口，在 peek 打开时把 props 覆盖为
 * 展开态；CSS 把原生侧栏列变成 absolute 浮层，列宽本来就是 0，所以不占位。
 * 抽屉模式不启用。
 *
 * 开关时序（hover 面板的常规做法）：
 *  - 打开延迟 120ms，过滤“指针路过开关”；
 *  - 关闭只在「离开开关/浮层」这一下启动一次 120ms 倒计时（grace period），
 *    指针在外部继续移动不会重置它；回到浮层立即取消；
 *  - 指针离开窗口时立即关闭。
 * 不要在 pointermove 里反复重置倒计时：那会让离开后越移动关得越晚。
 */

const PEEK_ATTRIBUTE = 'data-ct-sidebar-peek'
const DEFAULT_WIDTH = 280
const OPEN_DELAY_MS = 120
const CLOSE_DELAY_MS = 120

/** 当前 frame（持有 data-sidebar-collapsed 的布局根）。 */
function frameElement() {
  return document.querySelector('[data-shell-overlay]')?.parentElement ?? null
}

/** 指针是否在某个元素的矩形内；元素缺失时按“不在”处理。 */
function inside(element, event) {
  if (element === null || element === undefined) return false
  const rect = element.getBoundingClientRect()
  return event.clientX >= rect.left && event.clientX < rect.right
    && event.clientY >= rect.top && event.clientY < rect.bottom
}

/**
 * @param {{ width?: number }} [options] 浮层宽度（默认 280，与 SidebarRoot 的默认宽度一致）
 */
export function createSidebarPeek(options = {}) {
  const width = Number.isFinite(options.width) ? options.width : DEFAULT_WIDTH
  let open = false
  let openTimer = 0
  let closeTimer = 0
  let observer = null
  let bound = false
  let pointerDown = false
  /** 指针是否在「开关 + 浮层」这块可交互区域里；只在跨边界时改状态。 */
  let pointerInside = true
  const listeners = new Set()

  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  const frame = () => frameElement()
  const eligible = () => {
    const element = frame()
    return element !== null
      && element.hasAttribute('data-sidebar-collapsed')
      && !element.hasAttribute('data-sidebar-drawer')
      && !element.hasAttribute('data-animating')
  }
  const peekColumn = () => document.querySelector('[data-slot="sidebar"]')?.parentElement ?? null
  const toggleElement = () => document.querySelector('[data-ct-window-chrome-toggle]')

  const clearOpenTimer = () => {
    if (openTimer !== 0) {
      window.clearTimeout(openTimer)
      openTimer = 0
    }
  }
  const clearCloseTimer = () => {
    if (closeTimer !== 0) {
      window.clearTimeout(closeTimer)
      closeTimer = 0
    }
  }

  const unbind = () => {
    if (!bound) return
    bound = false
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('pointercancel', onPointerCancel, true)
    document.removeEventListener('dragend', onDragEnd, true)
    document.removeEventListener('drop', onDragEnd, true)
    document.removeEventListener('keydown', onKeyDown, true)
    document.documentElement.removeEventListener('pointerleave', onDocumentLeave)
    observer?.disconnect()
    observer = null
  }

  const setOpen = value => {
    if (open === value) return
    open = value
    // peek 只由 hover 开关触发：打开瞬间指针一定在开关上。
    if (value) pointerInside = true
    const element = frame()
    if (value) element?.setAttribute(PEEK_ATTRIBUTE, '')
    else element?.removeAttribute(PEEK_ATTRIBUTE)
    emit()
    if (!value) unbind()
  }

  function close() {
    clearOpenTimer()
    clearCloseTimer()
    setOpen(false)
  }

  function scheduleOpen() {
    clearCloseTimer()
    if (open || !eligible()) return
    clearOpenTimer()
    openTimer = window.setTimeout(() => {
      openTimer = 0
      if (open || !eligible()) return
      setOpen(true)
      bind()
    }, OPEN_DELAY_MS)
  }

  function scheduleClose() {
    clearOpenTimer()
    if (!open || pointerDown) return
    // 已经在倒计时就让它跑完：外部移动不延长关闭时间。
    if (closeTimer !== 0) return
    closeTimer = window.setTimeout(() => {
      closeTimer = 0
      setOpen(false)
    }, CLOSE_DELAY_MS)
  }

  function cancelClose() {
    clearCloseTimer()
  }

  /** 指针是否落在开关或浮层的矩形内。 */
  const pointerInPeek = event => inside(toggleElement(), event) || inside(peekColumn(), event)

  /** 按指针位置推进：进入内部取消关闭，离开内部才启动一次关闭倒计时。 */
  const trackPointer = event => {
    if (!open) return
    // 按住指针可能是从侧栏拖会话去分屏；拖拽过程中不要因为离开浮层就收回。
    if (pointerDown) {
      cancelClose()
      return
    }
    const nowInside = pointerInPeek(event)
    if (nowInside === pointerInside) {
      if (nowInside) cancelClose()
      return
    }
    pointerInside = nowInside
    if (nowInside) cancelClose()
    else scheduleClose()
  }

  const onPointerMove = event => {
    trackPointer(event)
  }

  const onPointerDown = event => {
    if (!open) return
    const target = event.target instanceof Element ? event.target : null
    if (target !== null && (target.closest('[data-ct-window-chrome]') !== null || target.closest('[data-slot="sidebar"]') !== null)) {
      pointerDown = true
      cancelClose()
      return
    }
    pointerDown = false
    close()
  }

  const onPointerUp = event => {
    if (!open || !pointerDown) return
    pointerDown = false
    pointerInside = pointerInPeek(event)
    if (pointerInside) cancelClose()
    else scheduleClose()
  }

  // 原生 drag 开始后浏览器会发 pointercancel；这不是“抬起”，不能据此收回浮层。
  // 真正的结束看 dragend / drop。
  const onPointerCancel = () => {
    if (!open) return
    pointerDown = true
    cancelClose()
  }

  const onDragEnd = event => {
    if (!open) return
    pointerDown = false
    pointerInside = pointerInPeek(event)
    if (pointerInside) cancelClose()
    else scheduleClose()
  }

  const onKeyDown = event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close()
    }
  }

  const onDocumentLeave = () => {
    // 指针离开整个窗口：没有“稍后回来”的可能，直接收起，不再等 grace period。
    if (open && !pointerDown) close()
  }

  const bind = () => {
    if (bound) return
    bound = true
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', onPointerCancel, true)
    document.addEventListener('dragend', onDragEnd, true)
    document.addEventListener('drop', onDragEnd, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.documentElement.addEventListener('pointerleave', onDocumentLeave)
    observer = new MutationObserver(() => {
      if (!open || pointerDown) return
      if (!eligible()) close()
    })
    const element = frame()
    if (element !== null) {
      observer.observe(element, {
        attributes: true,
        attributeFilter: ['data-sidebar-collapsed', 'data-sidebar-drawer', 'data-animating'],
      })
    }
  }

  return {
    width,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => open,
    scheduleOpen,
    scheduleClose,
    cancelClose,
    close,
    dispose() {
      close()
      listeners.clear()
    },
  }
}
