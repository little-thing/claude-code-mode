/** 会话内图片预览的唯一入口。
 *
 * 所有「点击图片或图片文件链接 → 原图弹窗」的入口都走这里：
 *  - `openImagePreview()` 更新一份全局 store；
 *  - `features/image-preview` 在 `shell.overlay` 里挂唯一一个宿主，用原生
 *    `ImageLightbox` 渲染当前图片；
 *  - 观感（遮罩深浅、缩略图尺寸）集中在 `image-preview.css`，改一次全部生效。
 *
 * 这里只放与 React 无关的解析与 store；组件与 slot 接管在 feature 里。
 */

import * as React from 'react'

/** 图片扩展名；查询串和 hash 不参与判断。 */
const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|bmp|svg|ico|avif|heic)$/i

const EMPTY_TARGETS = Object.freeze([])

/**
 * 路径是否指向图片文件。
 * @param {unknown} path 文件路径或链接
 * @returns {boolean}
 */
export function isImagePath(path) {
  if (typeof path !== 'string' || path === '') return false
  const clean = path.split(/[?#]/, 1)[0] ?? path
  return IMAGE_EXTENSIONS.test(clean)
}

/**
 * 是否是宿主绝对路径（POSIX、盘符或 UNC）。
 * @param {unknown} path
 * @returns {boolean}
 */
export function isAbsolutePath(path) {
  if (typeof path !== 'string' || path === '') return false
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

/**
 * 取路径最后一段，用于缩略图/灯箱的无障碍名。
 * @param {string} path
 * @returns {string}
 */
export function baseName(path) {
  const normalized = String(path).replaceAll('\\', '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

/**
 * 把绝对文件路径变成鉴权后的文件接口 URL。
 * @param {unknown} path
 * @returns {string | undefined}
 */
export function filePreviewUrl(path) {
  if (!isAbsolutePath(path)) return undefined
  try {
    return new URL(`api/file?path=${encodeURIComponent(path)}`, document.baseURI).href
  } catch {
    return undefined
  }
}

/**
 * 解析一个文件路径（相对路径用 `resolve` 按会话 cwd 还原）。
 * @param {unknown} path
 * @param {((path: string) => string) | undefined} resolve
 * @returns {string | undefined}
 */
function resolveAbsolutePath(path, resolve) {
  if (typeof path !== 'string' || path === '') return undefined
  let absolute = path
  if (typeof resolve === 'function') {
    try {
      const next = resolve(path)
      if (typeof next === 'string' && next !== '') absolute = next
    } catch {
      // 解析失败就沿用原路径；非绝对路径会在下面被拒绝。
    }
  }
  return isAbsolutePath(absolute) ? absolute : undefined
}

/**
 * 任意文件路径 → 灯箱 target；不做图片扩展名判断。
 * @param {unknown} path
 * @param {((path: string) => string) | undefined} resolve
 * @returns {{ path: string, src: string, name: string } | null}
 */
export function filePreviewTarget(path, resolve) {
  const absolute = resolveAbsolutePath(path, resolve)
  if (absolute === undefined) return null
  const src = filePreviewUrl(absolute)
  if (src === undefined) return null
  return { path: absolute, src, name: baseName(absolute) }
}

/**
 * 图片文件路径 → 灯箱 target；非图片返回 null。
 * @param {unknown} path
 * @param {((path: string) => string) | undefined} resolve
 * @returns {{ path: string, src: string, name: string } | null}
 */
export function imagePreviewTarget(path, resolve) {
  if (!isImagePath(path)) return null
  return filePreviewTarget(path, resolve)
}

/* 全局「当前预览」store ------------------------------------------------------ */

/** @type {Set<() => void>} */
const listeners = new Set()
/** @type {{ id: number, src: string, name: string, path?: string } | null} */
let current = null
let openSeq = 0

/**
 * 打开原图弹窗；重复调用会把当前弹窗换成新图。
 * @param {{ src?: unknown, path?: unknown, name?: unknown } | null | undefined} input
 * @returns {void}
 */
export function openImagePreview(input) {
  if (input === null || typeof input !== 'object') return
  const path = typeof input.path === 'string' && input.path !== '' ? input.path : undefined
  const rawSrc = typeof input.src === 'string' && input.src !== '' ? input.src : undefined
  const src = rawSrc ?? (path === undefined ? undefined : filePreviewUrl(path))
  if (src === undefined) return
  const name = typeof input.name === 'string' && input.name !== ''
    ? input.name
    : path === undefined ? '图片' : baseName(path)
  openSeq += 1
  current = { id: openSeq, src, name, ...(path === undefined ? {} : { path }) }
  for (const listener of listeners) listener()
}

/** 关闭原图弹窗。 */
export function closeImagePreview() {
  if (current === null) return
  current = null
  for (const listener of listeners) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 当前弹窗目标；没有打开时是 null。 */
export function useImagePreviewTarget() {
  return React.useSyncExternalStore(subscribe, () => current)
}

/* 每轮会话读到的图片 --------------------------------------------------------
 * process 折叠时单条 tool row 不显示，缩略图要挂到可见的 `turn-process`
 * 摘要行上。工具行渲染时把图片登记到「会话 + turn」的 store，摘要行订阅它。
 * 同一会话可能在主屏和分屏里同时渲染，所以按挂载次数计数。
 */

/** @type {Map<string, { items: Map<string, { seq: number, info: object, count: number }>, snapshot: readonly object[], listeners: Set<() => void> }>} */
const turnStores = new Map()

function turnKey(sessionId, turn) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  if (typeof turn !== 'number' || !Number.isInteger(turn)) return undefined
  return `${sessionId}\u0000${turn}`
}

function storeFor(key) {
  let store = turnStores.get(key)
  if (store === undefined) {
    store = { items: new Map(), snapshot: EMPTY_TARGETS, listeners: new Set() }
    turnStores.set(key, store)
  }
  return store
}

function publish(store) {
  const next = [...store.items.values()]
    .sort((left, right) => left.seq - right.seq)
    .map(item => item.info)
  store.snapshot = next.length === 0 ? EMPTY_TARGETS : next
  for (const listener of store.listeners) listener()
}

/**
 * 登记一张本轮读到的图片，同一 callId 重复挂载只记一次引用。
 * @param {string} sessionId
 * @param {number} turn
 * @param {string} callId
 * @param {number} seq
 * @param {{ path: string, src: string, name: string }} info
 */
export function registerTurnImage(sessionId, turn, callId, seq, info) {
  const key = turnKey(sessionId, turn)
  if (key === undefined || typeof callId !== 'string' || info === null) return
  const store = storeFor(key)
  const previous = store.items.get(callId)
  if (previous !== undefined) {
    previous.count += 1
    if (previous.seq === seq && previous.info.path === info.path && previous.info.src === info.src) return
    previous.seq = seq
    previous.info = info
    publish(store)
    return
  }
  store.items.set(callId, { seq, info, count: 1 })
  publish(store)
}

/**
 * 注销一次登记。
 * @param {string} sessionId
 * @param {number} turn
 * @param {string} callId
 */
export function unregisterTurnImage(sessionId, turn, callId) {
  const key = turnKey(sessionId, turn)
  if (key === undefined) return
  const store = turnStores.get(key)
  if (store === undefined) return
  const item = store.items.get(callId)
  if (item === undefined) return
  item.count -= 1
  if (item.count > 0) return
  store.items.delete(callId)
  publish(store)
  if (store.items.size === 0 && store.listeners.size === 0) turnStores.delete(key)
}

/**
 * 同步读取一轮已登记的图片；给 DOM 注入等非 React 消费者用。
 * @param {string | undefined} sessionId
 * @param {number | undefined} turn
 * @returns {readonly { path: string, src: string, name: string }[]}
 */
export function turnImagesSnapshot(sessionId, turn) {
  const key = turnKey(sessionId, turn)
  if (key === undefined) return EMPTY_TARGETS
  return turnStores.get(key)?.snapshot ?? EMPTY_TARGETS
}

/**
 * 订阅一轮图片变化。
 * @param {string | undefined} sessionId
 * @param {number | undefined} turn
 * @param {() => void} listener
 * @returns {() => void}
 */
export function subscribeTurnImages(sessionId, turn, listener) {
  const key = turnKey(sessionId, turn)
  if (key === undefined) return () => {}
  const store = storeFor(key)
  store.listeners.add(listener)
  return () => {
    store.listeners.delete(listener)
    if (store.items.size === 0 && store.listeners.size === 0) turnStores.delete(key)
  }
}

/**
 * 一轮会话读到的图片，按调用顺序。
 * @param {string | undefined} sessionId
 * @param {number | undefined} turn
 * @returns {readonly { path: string, src: string, name: string }[]}
 */
export function useTurnImages(sessionId, turn) {
  const key = turnKey(sessionId, turn)
  return React.useSyncExternalStore(
    React.useCallback((listener) => {
      if (key === undefined) return () => {}
      const store = storeFor(key)
      store.listeners.add(listener)
      return () => {
        store.listeners.delete(listener)
        if (store.items.size === 0 && store.listeners.size === 0) turnStores.delete(key)
      }
    }, [key]),
    () => (key === undefined ? EMPTY_TARGETS : (turnStores.get(key)?.snapshot ?? EMPTY_TARGETS)),
  )
}

/**
 * 从 tool-call 数据里取本行读到的图片。
 * @param {any} block ToolCallBlock（preparing / start / result）
 * @param {string | undefined} toolName 已知工具名
 * @param {((path: string) => string) | undefined} resolve 相对路径解析
 * @returns {{ path: string, src: string, name: string } | null}
 */
export function toolImageInfo(block, toolName, resolve) {
  if (block === null || block === undefined || typeof block !== 'object') return null
  if (block.phase === 'preparing') return null
  const name = typeof toolName === 'string' && toolName !== ''
    ? toolName
    : block?.call?.name ?? block?.name
  if (name !== 'read' && name !== 'read_image') return null
  const raw = toolReadPath(block, name)
  if (raw === null) return null
  if (name === 'read' && !isImagePath(raw)) return null
  return filePreviewTarget(raw, resolve)
}

function toolReadPath(block, toolName) {
  if (toolName === 'read_image') {
    const metaPath = block?.meta?.path
    if (typeof metaPath === 'string' && metaPath !== '') return metaPath
  }
  const call = block?.call ?? block
  const raw = call?.argsRaw
  if (typeof raw !== 'string') return null
  try {
    const args = JSON.parse(raw)
    if (typeof args?.file_path === 'string' && args.file_path !== '') return args.file_path
    if (typeof args?.path === 'string' && args.path !== '') return args.path
  } catch {
    return null
  }
  return null
}