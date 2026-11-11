/** image-preview：会话内图片统一弹窗。
 *
 * 目标是把「点击会话里的图片或图片文件链接」收敛成一个行为：
 *  - 只用一个 `openImagePreview()` store，一个 `shell.overlay` 宿主；
 *  - 所有聊天文件链接的 `openFile` 在 `conversation.view` 入口统一拦截，
 *    图片路径改走弹窗，其它文件仍走右侧抽屉；
 *  - `read` / `read_image` 工具行在右侧显示缩略图，图片名与缩略图都可点；
 *  - `turn-process` 折叠摘要行汇总本轮读到的图片，折叠时也能看到缩略图；
 *  - 观感只在 `image-preview.css` 改一次（包括原生灯箱的遮罩深浅）。
 */

import * as React from 'react'
import { ImageLightbox } from '@deepseek-ai/dsh-client-ui-primitives'
import { Tooltip } from '../../shared/ui/tooltip.js'
import {
  closeImagePreview, filePreviewTarget, imagePreviewTarget, openImagePreview,
  registerTurnImage, subscribeTurnImages, toolImageInfo, turnImagesSnapshot, unregisterTurnImage,
  useImagePreviewTarget, useTurnImages,
} from '../../shared/image-preview.js'
import imagePreviewCss from './image-preview.css'

const h = React.createElement

const STYLE_ID = 'ct-image-preview'
const HOST_ID = 'ct-image-preview-host'
const MAX_TURN_THUMBS = 3
const IMAGE_TOOL_KEYS = new Set(['read', 'read_image'])

/** @param {any} ctx client root context */
export function install(ctx) {
  let style = null
  if (document.getElementById(STYLE_ID) === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = imagePreviewCss
    document.head.appendChild(style)
  }

  const dispose = ctx.inject(['slots'], (scope) => {
    const disposers = []
    let disposed = false
    for (const installer of [
      installPreviewHost, installViewOpenFile, installToolRowImages, installTurnImageSummary,
      installTurnImageRegistry, installGroupImageThumbs,
    ]) {
      try {
        const result = installer(scope)
        if (typeof result === 'function') disposers.push(result)
      } catch (error) {
        console.warn(`[claude-code-mode] image-preview ${installer.name} failed`, error)
      }
    }
    return () => {
      if (disposed) return
      disposed = true
      closeImagePreview()
      for (const disposeInstaller of disposers.reverse()) {
        try { disposeInstaller() } catch { /* ignore */ }
      }
      style?.remove()
    }
  })

  return () => {
    if (typeof dispose === 'function') dispose()
    if (document.getElementById(STYLE_ID) !== null && document.getElementById(STYLE_ID) === style) style.remove()
  }
}

/* 唯一宿主 ------------------------------------------------------------------ */

function installPreviewHost(scope) {
  return scope.slots.inject('shell.overlay', () => scope.slots.register(
    { name: 'shell.overlay', id: HOST_ID },
    ImagePreviewHost,
  ))
}

function ImagePreviewHost() {
  const target = useImagePreviewTarget()
  if (target === null) return null
  return h(
    'div',
    { className: 'ct-image-preview-host', 'data-ct-image-preview-host': '' },
    h(ImageLightbox, {
      src: target.src,
      alt: target.name,
      labels: { dialog: '图片预览', close: '关闭图片预览' },
      onClose: closeImagePreview,
    }),
  )
}

/* 聊天入口：所有 openFile 统一拦截 ----------------------------------------- */

function installViewOpenFile(scope) {
  const patched = new WeakSet()
  const records = []
  const patch = () => {
    for (const entry of scope.slots.entries('conversation.view')) {
      if (patched.has(entry)) continue
      patched.add(entry)
      const original = entry.component
      const Wrapper = function ImagePreviewChatView(props) {
        const openFile = props.openFile
        const resolveFilePath = props.resolveFilePath
        const wrappedOpenFile = React.useCallback((path, options) => {
          const target = imagePreviewTarget(path, resolveFilePath)
          if (target !== null) {
            openImagePreview(target)
            return
          }
          if (typeof openFile === 'function') openFile(path, options)
        }, [openFile, resolveFilePath])
        return h(original, { ...props, openFile: wrappedOpenFile })
      }
      entry.component = Wrapper
      records.push({ entry, original, wrapper: Wrapper })
    }
  }

  patch()
  const stop = scope.slots.subscribe('conversation.view', patch)
  return () => {
    stop()
    for (const record of records) {
      if (record.entry.component === record.wrapper) record.entry.component = record.original
    }
  }
}

/* 工具行缩略图 -------------------------------------------------------------- */

function installToolRowImages(scope) {
  const patched = new WeakSet()
  const records = []
  const patch = () => {
    for (const entry of scope.slots.entries('tool.call.toolview')) {
      const key = entry.options?.key
      if (!IMAGE_TOOL_KEYS.has(key) || patched.has(entry)) continue
      patched.add(entry)
      const original = entry.component
      const Wrapper = function ImageToolRow(props) {
        const info = toolImageInfo(props.block, key, props.resolveFilePath)
        const openFile = props.openFile
        const resolveFilePath = props.resolveFilePath
        const wrappedOpenFile = React.useCallback((path, options) => {
          const target = key === 'read_image'
            ? filePreviewTarget(path, resolveFilePath)
            : imagePreviewTarget(path, resolveFilePath)
          if (target !== null) {
            openImagePreview(target)
            return
          }
          if (typeof openFile === 'function') openFile(path, options)
        }, [key, openFile, resolveFilePath])
        return h(
          React.Fragment,
          null,
          h(original, { ...props, openFile: wrappedOpenFile }),
          info === null ? null : h(ToolRowThumb, { info, className: 'ct-tool-image-thumb' }),
        )
      }
      entry.component = Wrapper
      records.push({ entry, original, wrapper: Wrapper })
    }
  }

  patch()
  const stop = scope.slots.subscribe('tool.call.toolview', patch)
  return () => {
    stop()
    for (const record of records) {
      if (record.entry.component === record.wrapper) record.entry.component = record.original
    }
  }
}

/* 折叠摘要行汇总本轮图片 ---------------------------------------------------- */

function installTurnImageSummary(scope) {
  const patched = new WeakSet()
  const records = []
  const patch = () => {
    for (const entry of scope.slots.entries('conversation.chat.node')) {
      if (entry.options?.key !== 'turn-process' || patched.has(entry)) continue
      patched.add(entry)
      const original = entry.component
      const Wrapper = function TurnProcessImages(props) {
        const sessionId = props.sessionId
        const location = props.node?.location
        const turn = location?.kind === 'turn' || location?.kind === 'step' ? location.turn.turn : undefined
        const images = useTurnImages(sessionId, turn)
        // 与原生 TurnProcessNodeView 的口径一致：不可折叠时永远算展开。
        // 展开后由「已读取图片」分组行显示缩略图；摘要行只在收起时显示，
        // 避免同一轮图片在两层同时出现。
        const process = props.turnProcess
        const processOpen = process === undefined ? false : process.foldable === false || process.open === true
        const showSummary = !processOpen && images.length > 0
        return h(
          React.Fragment,
          null,
          h(original, props),
          showSummary ? h(TurnImageThumbs, { images }) : null,
        )
      }
      entry.component = Wrapper
      records.push({ entry, original, wrapper: Wrapper })
    }
  }

  patch()
  const stop = scope.slots.subscribe('conversation.chat.node', patch)
  return () => {
    stop()
    for (const record of records) {
      if (record.entry.component === record.wrapper) record.entry.component = record.original
    }
  }
}

/* 工具节点登记本 turn 的图片 ------------------------------------------------ */

function installTurnImageRegistry(scope) {
  const patched = new WeakSet()
  const records = []
  const patch = () => {
    for (const entry of scope.slots.entries('conversation.chat.node')) {
      if (entry.options?.key !== 'tool-call' || patched.has(entry)) continue
      patched.add(entry)
      const original = entry.component
      const Wrapper = function ToolImageRegistry(props) {
        const sessionId = props.sessionId
        const location = props.node?.location
        const turn = location?.kind === 'turn' || location?.kind === 'step' ? location.turn.turn : undefined
        const callId = String(props.node?.anchorSeq ?? '')
        const seq = typeof props.node?.anchorSeq === 'number' ? props.node.anchorSeq : 0
        const info = toolImageInfo(props.node?.data?.root, undefined, props.resolveFilePath)
        React.useEffect(() => {
          if (info === null || typeof sessionId !== 'string' || sessionId === '' || typeof turn !== 'number') return undefined
          registerTurnImage(sessionId, turn, callId, seq, info)
          return () => { unregisterTurnImage(sessionId, turn, callId) }
        }, [sessionId, turn, callId, seq, info?.path, info?.src, info?.name])
        return h(original, props)
      }
      entry.component = Wrapper
      records.push({ entry, original, wrapper: Wrapper })
    }
  }

  patch()
  const stop = scope.slots.subscribe('conversation.chat.node', patch)
  return () => {
    stop()
    for (const record of records) {
      if (record.entry.component === record.wrapper) record.entry.component = record.original
    }
  }
}

/* 分组行缩略图 --------------------------------------------------------------
 * DSH 把同一类工具调用收进 `[data-step-process]` 分组行（「已读取图片」）。
 * 这个行不是 slot，无法用 React 包装；在 group root 上追加一个与分组头同高的
 * 操作条：文件名 + 缩略图，点击开统一弹窗。数据仍来自同一份 turn 图片 store。
 */

const GROUP_ACTIVITIES = new Set(['readImage', 'read'])

function installGroupImageThumbs() {
  if (typeof MutationObserver !== 'function') return () => {}
  /** @type {Map<Element, { sessionId: string, turn: number, unsubscribe: () => void, lastKey: string }>} */
  const records = new Map()
  let frame = 0
  let stopped = false

  const schedule = () => {
    if (stopped || frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!stopped) sync()
    })
  }

  const sync = () => {
    const seen = new Set()
    for (const root of document.querySelectorAll('[data-step-process]')) {
      seen.add(root)
      const header = root.querySelector('button[data-process-activity]')
      const activity = header?.getAttribute('data-process-activity')
      if (header === null || header === undefined || !GROUP_ACTIVITIES.has(activity)) {
        removeRecord(root)
        continue
      }
      const sessionId = root.closest('[data-conversation-session]')?.getAttribute('data-conversation-session')
      const turn = Number(root.getAttribute('data-chat-turn'))
      if (typeof sessionId !== 'string' || sessionId === '' || !Number.isInteger(turn)) {
        removeRecord(root)
        continue
      }
      let record = records.get(root)
      if (record === undefined || record.sessionId !== sessionId || record.turn !== turn) {
        removeRecord(root)
        record = { sessionId, turn, unsubscribe: () => {}, lastKey: '' }
        record.unsubscribe = subscribeTurnImages(sessionId, turn, () => renderRecord(root, record))
        records.set(root, record)
      }
      renderRecord(root, record)
    }
    for (const root of [...records.keys()]) {
      if (!seen.has(root) || !root.isConnected) removeRecord(root)
    }
  }

  const removeRecord = (root) => {
    const record = records.get(root)
    if (record === undefined) return
    record.unsubscribe()
    records.delete(root)
    root.querySelector(':scope > [data-ct-group-image-thumbs]')?.remove()
  }

  const renderRecord = (root, record) => {
    const images = turnImagesSnapshot(record.sessionId, record.turn)
    const existing = root.querySelector(':scope > [data-ct-group-image-thumbs]')
    if (images.length === 0) {
      existing?.remove()
      record.lastKey = ''
      return
    }
    const key = images.map(image => `${image.path}:${image.src}`).join('|')
    if (key === record.lastKey && existing !== null) return
    record.lastKey = key
    const bar = existing ?? document.createElement('div')
    bar.className = 'ct-group-image-thumbs'
    bar.setAttribute('data-ct-group-image-thumbs', '')
    bar.replaceChildren()
    const first = images[0]
    const name = document.createElement('button')
    name.type = 'button'
    name.className = 'ct-group-image-name'
    name.textContent = first.name
    name.title = `预览 ${first.name}`
    name.setAttribute('aria-label', `预览 ${first.name}`)
    name.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      openImagePreview(first)
    })
    bar.append(name)
    const shown = images.slice(0, MAX_TURN_THUMBS)
    for (const image of shown) {
      const thumb = document.createElement('button')
      thumb.type = 'button'
      thumb.className = 'ct-group-image-thumb'
      thumb.title = `预览 ${image.name}`
      thumb.setAttribute('aria-label', `预览 ${image.name}`)
      thumb.setAttribute('data-ct-group-image-thumb', '')
      const img = document.createElement('img')
      img.src = image.src
      img.alt = image.name
      img.loading = 'lazy'
      img.draggable = false
      img.addEventListener('error', () => { thumb.remove() })
      thumb.append(img)
      thumb.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        openImagePreview(image)
      })
      bar.append(thumb)
    }
    if (images.length > shown.length) {
      const more = document.createElement('span')
      more.className = 'ct-group-image-more'
      more.textContent = `+${images.length - shown.length}`
      bar.append(more)
    }
    if (existing === null) root.append(bar)
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-chat-turn', 'data-process-activity'] })
  schedule()
  return () => {
    stopped = true
    observer.disconnect()
    if (frame !== 0) cancelAnimationFrame(frame)
    for (const root of [...records.keys()]) removeRecord(root)
  }
}

/* 组件 ---------------------------------------------------------------------- */

function ToolRowThumb({ info, className }) {
  const [failed, setFailed] = React.useState(false)
  if (failed) return null
  return h(
    Tooltip,
    {
      label: `预览 ${info.name}`,
      side: 'top',
      delayMs: 400,
      portal: true,
    },
    h(
      'button',
      {
        type: 'button',
        className,
        'aria-label': `预览 ${info.name}`,
        'data-ct-image-thumb': '',
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          openImagePreview(info)
        },
      },
      h('img', {
        src: info.src,
        alt: info.name,
        loading: 'lazy',
        draggable: false,
        onError: () => { setFailed(true) },
      }),
    ),
  )
}

function TurnImageThumbs({ images }) {
  const shown = images.slice(0, MAX_TURN_THUMBS)
  const remaining = images.length - shown.length
  return h(
    'div',
    { className: 'ct-turn-image-thumbs', 'data-ct-turn-image-thumbs': '' },
    shown.map((info) => h(ToolRowThumb, { key: `${info.path}:${info.name}`, info, className: 'ct-turn-image-thumb' })),
    remaining > 0 ? h('span', { className: 'ct-turn-image-more' }, `+${remaining}`) : null,
  )
}