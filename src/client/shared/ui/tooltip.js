/** 共享 Tooltip：无样式行为层，定位交给 Floating UI。
 *
 * 默认把触发元素包在 display: contents 的 span 里，不改变调用方布局；
 * `asChild` 则直接克隆子元素，不插入 wrapper——给 role=treeitem / tab
 * 这类对 DOM 结构敏感的场景用。浮层默认 portal 到 body，避免被滚动容器
 * 裁剪。颜色、圆角等观感全部来自 DSH 别名令牌与皮肤令牌，功能层不写色值。
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import css from './tooltip.css'

const h = React.createElement
const STYLE_ID = 'ct-shared-ui'

let styleElement = null
function ensureStyle() {
  if (typeof document === 'undefined') return
  if (styleElement === null || !styleElement.isConnected) {
    styleElement = document.getElementById(STYLE_ID)
    if (styleElement === null) {
      styleElement = document.createElement('style')
      styleElement.id = STYLE_ID
      document.head.appendChild(styleElement)
    }
  }
  if (styleElement.textContent !== css) styleElement.textContent = css
}

/** `side` + 可选 `align` → Floating UI placement。 */
export function placementOf(side, align) {
  return align === undefined || align === 'center' ? side : `${side}-${align}`
}

function composeHandlers(their, ours) {
  if (typeof their !== 'function') return ours
  if (typeof ours !== 'function') return their
  return (event) => {
    their(event)
    ours(event)
  }
}

function mergeRefs(...refs) {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node)
      else if (ref !== null && ref !== undefined) ref.current = node
    }
  }
}

/**
 * @param {{
 *   label: React.ReactNode,
 *   side?: 'top' | 'bottom' | 'left' | 'right',
 *   align?: 'start' | 'center' | 'end',
 *   delayMs?: number,
 *   disabled?: boolean,
 *   maxWidth?: number,
 *   portal?: boolean,
 *   openOnClick?: boolean,
 *   asChild?: boolean,
 *   children: React.ReactNode,
 * }} props
 */
export function Tooltip(props) {
  const {
    label,
    side = 'top',
    align,
    delayMs = 400,
    disabled = false,
    maxWidth,
    portal = true,
    openOnClick = false,
    asChild = false,
    children,
  } = props
  ensureStyle()

  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef(null)
  const floatingRef = React.useRef(null)
  const timerRef = React.useRef(0)
  const reactId = React.useId()
  const tooltipId = `ct-tooltip-${reactId.replace(/:/g, '')}`
  const visible = open && !disabled && label !== undefined && label !== null && label !== ''
  const childElement = React.isValidElement(children) ? children : null

  const clearTimer = () => {
    if (timerRef.current !== 0) {
      window.clearTimeout(timerRef.current)
      timerRef.current = 0
    }
  }

  const show = React.useCallback((immediate) => {
    if (disabled || label === undefined || label === null || label === '') return
    clearTimer()
    if (immediate || delayMs <= 0) {
      setOpen(true)
      return
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0
      setOpen(true)
    }, delayMs)
  }, [delayMs, disabled, label])

  const hide = React.useCallback(() => {
    clearTimer()
    setOpen(false)
  }, [])

  React.useEffect(() => () => clearTimer(), [])

  const triggerOf = React.useCallback(() => {
    if (asChild && childElement !== null) return triggerRef.current
    return triggerRef.current?.firstElementChild ?? triggerRef.current
  }, [asChild, childElement])

  // 定位：显示时算一次，滚动/缩放时跟着走。
  React.useLayoutEffect(() => {
    if (!visible) return undefined
    if (triggerOf() === null || floatingRef.current === null) return undefined

    let frame = 0
    const update = () => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const trigger = triggerOf()
        const floating = floatingRef.current
        if (trigger === null || floating === null) return
        computePosition(trigger, floating, {
          placement: placementOf(side, align),
          strategy: 'fixed',
          middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
        }).then(({ x, y }) => {
          if (floatingRef.current !== floating) return
          floating.style.left = `${x}px`
          floating.style.top = `${y}px`
        })
      })
    }

    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [visible, side, align, label, triggerOf])

  // 打开时按 Escape 关闭。
  React.useEffect(() => {
    if (!visible) return undefined
    const onKeyDown = (event) => { if (event.key === 'Escape') hide() }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [visible, hide])

  // openOnClick：点外面关闭。
  React.useEffect(() => {
    if (!openOnClick || !visible) return undefined
    const onPointerDown = (event) => {
      if (triggerRef.current?.contains(event.target)) return
      if (floatingRef.current?.contains(event.target)) return
      hide()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [openOnClick, visible, hide])

  const describedBy = childElement === null
    ? undefined
    : [childElement.props['aria-describedby'], visible ? tooltipId : undefined]
      .filter(Boolean).join(' ') || undefined

  const interactions = {
    onPointerEnter: (event) => { if (event.pointerType !== 'touch') show(false) },
    onPointerLeave: hide,
    onFocus: () => show(true),
    onBlur: hide,
  }

  const toggle = () => { if (open) hide(); else show(true) }

  const trigger = childElement !== null && asChild
    ? React.cloneElement(childElement, {
        ...interactions,
        ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
        ref: mergeRefs(childElement.ref, triggerRef),
        onPointerEnter: composeHandlers(childElement.props.onPointerEnter, interactions.onPointerEnter),
        onPointerLeave: composeHandlers(childElement.props.onPointerLeave, interactions.onPointerLeave),
        onFocus: composeHandlers(childElement.props.onFocus, interactions.onFocus),
        onBlur: composeHandlers(childElement.props.onBlur, interactions.onBlur),
        ...(openOnClick
          ? { onClick: composeHandlers(childElement.props.onClick, toggle) }
          : { onPointerDown: composeHandlers(childElement.props.onPointerDown, hide) }),
      })
    : h('span', {
        ref: triggerRef,
        className: 'ct-tooltip-trigger',
        ...interactions,
        ...(openOnClick ? { onClick: toggle } : { onPointerDown: hide }),
      }, childElement === null
        ? children
        : React.cloneElement(childElement, describedBy === undefined ? {} : { 'aria-describedby': describedBy }))

  const floating = visible
    ? h('div', {
        ref: floatingRef,
        id: tooltipId,
        role: 'tooltip',
        className: 'ct-tooltip',
        'data-side': side,
        style: maxWidth === undefined ? undefined : { maxWidth: `${maxWidth}px` },
      }, label)
    : null

  return h(
    React.Fragment,
    null,
    trigger,
    floating === null ? null : portal ? createPortal(floating, document.body) : floating,
  )
}
