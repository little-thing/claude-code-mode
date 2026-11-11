/** 功能开关偏好（客户端半边）。
 *
 * 偏好的真源在宿主：`$DSH_HOME/claude-code-mode/preferences.json`，由
 * `src/host/features/preferences/` 读写，并注入首屏快照 `window.__CT_PREFS__`。
 * 这里只做四件事：
 *  - `hydratePreferences()`：在装功能之前同步读到快照（没有就退回本地缓存）；
 *  - `isFeatureEnabled()`：功能注册表用它决定装不装；
 *  - `getSkin()` / `setSkin()`：皮肤是下拉选择，切换即时生效、不刷新页面；
 *  - `setFeatureEnabled()` / `resetPreferences()`：设置页写回宿主。
 *
 * 本地缓存只用于「宿主没注入快照」的兜底；真源永远以宿主返回为准。
 * 皮肤不放在 disabled 集合里：它不是一个可关的功能，而是一个取值。
 */

import { LEGACY_SWITCH_IDS } from './catalog.js'

const ROUTE = '/claude-code-mode/preferences'
const CACHE_KEY = 'ct.features.v1'
/** 宿主注入的全局名，与 src/host/features/preferences/index.js 保持一致。 */
const GLOBAL_NAME = '__CT_PREFS__'
const MAX_ID_LENGTH = 80
const DEFAULT_SKIN = 'claude'
const NATIVE_SKIN = 'native'
/** 旧版本把皮肤当功能开关时用过的 id。 */
const LEGACY_SKIN_KEY = 'skin'

/** @type {Set<string>} */
let disabled = new Set()
/** @type {string} */
let skin = DEFAULT_SKIN
/** @type {{ disabled: ReadonlySet<string>, skin: string, revision: number, error: null | 'save' }} */
let snapshot = { disabled: new Set(), skin: DEFAULT_SKIN, revision: 0, error: null }
const listeners = new Set()
/** 写盘串行：连续切换按点击顺序落盘。 */
let writeChain = Promise.resolve()
/** 宿主最后一次确认的 updatedAt；写进本地缓存，热重载时用它判断哪份更新。 */
let lastUpdatedAt = 0

/**
 * 同步读取首屏快照。必须在 mountFeatures 之前调用一次。
 */
export function hydratePreferences() {
  const boot = readBootSnapshot()
  const cached = readCache()
  // 插件热重载（HMR rebuilt）只重新执行插件，不会重新生成页面 HTML：
  // window.__CT_PREFS__ 仍是首屏快照，而刚保存的偏好只在本页缓存里。
  // 取 updatedAt 较新的一份；页面整刷时 boot 总是最新，热重载时 cache 更新。
  const source = cached !== null && (cached.updatedAt ?? 0) > (boot?.updatedAt ?? 0)
    ? cached
    : (boot ?? cached)
  const ids = source?.disabled ?? []
  lastUpdatedAt = source?.updatedAt ?? lastUpdatedAt
  // 旧数据：皮肤还在 disabled 集合里 → 迁移成 native；旧 feature id → 新开关 id。
  const legacySkinOff = ids.includes(LEGACY_SKIN_KEY)
  disabled = new Set(
    migrateSwitchIds(ids.filter((id) => id !== LEGACY_SKIN_KEY)),
  )
  skin = normalizeSkin(source?.skin) ?? (legacySkinOff ? NATIVE_SKIN : DEFAULT_SKIN)
  publish()
}

/**
 * @returns {{ disabled: ReadonlySet<string>, skin: string, revision: number, error: null | 'save' }}
 */
export function getPreferencesSnapshot() {
  return snapshot
}

/**
 * @returns {string} 当前皮肤 id（`native` 表示不挂皮肤）
 */
export function getSkin() {
  return snapshot.skin
}

/**
 * @param {() => void} listener
 * @returns {() => void}
 */
export function subscribePreferences(listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isFeatureEnabled(id) {
  return !disabled.has(id)
}

/**
 * 切换皮肤：先让界面即时换肤，再落盘；失败回滚。
 * @param {string} next
 * @returns {Promise<void>}
 */
export async function setSkin(next) {
  const value = normalizeSkin(next) ?? DEFAULT_SKIN
  const previous = skin
  if (value === skin) return
  skin = value
  publish()
  writeCache()
  try {
    await persist()
  } catch (error) {
    skin = previous
    publish('save')
    writeCache()
    throw error
  }
}

/**
 * @param {string} id
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export async function setFeatureEnabled(id, enabled) {
  if (enabled) disabled.delete(id)
  else disabled.add(id)
  publish()
  writeCache()
  try {
    await persist()
  } catch (error) {
    // 保存失败要回到宿主上一次确认的状态，而不是让界面显示一个没落盘的开关。
    if (enabled) disabled.add(id)
    else disabled.delete(id)
    publish('save')
    writeCache()
    throw error
  }
}

/**
 * 恢复默认：清空「被关掉的集合」并回到默认皮肤，等于全部开启。
 * @returns {Promise<void>}
 */
export async function resetPreferences() {
  const previousDisabled = new Set(disabled)
  const previousSkin = skin
  disabled = new Set()
  skin = DEFAULT_SKIN
  publish()
  writeCache()
  try {
    await persist()
  } catch (error) {
    disabled = previousDisabled
    skin = previousSkin
    publish('save')
    writeCache()
    throw error
  }
}

/**
 * @param {null | 'save'} [error]
 */
function publish(error = null) {
  snapshot = { disabled: new Set(disabled), skin, revision: snapshot.revision + 1, error }
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (failure) {
      console.warn('[claude-code-mode] preference listener failed', failure)
    }
  }
}

/**
 * @returns {{ disabled: string[], skin?: string } | null}
 */
function readBootSnapshot() {
  if (typeof window === 'undefined') return null
  const boot = window[GLOBAL_NAME]
  if (boot === null || typeof boot !== 'object') return null
  if (!Array.isArray(boot.disabled) && typeof boot.skin !== 'string') return null
  return {
    disabled: Array.isArray(boot.disabled) ? sanitize(boot.disabled) : [],
    ...(typeof boot.skin === 'string' ? { skin: boot.skin } : {}),
    ...(typeof boot.updatedAt === 'number' ? { updatedAt: boot.updatedAt } : {}),
  }
}

/**
 * @returns {{ disabled: string[], skin?: string } | null}
 */
function readCache() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    // 旧缓存是纯数组（只有 disabled）。
    if (Array.isArray(parsed)) return { disabled: sanitize(parsed), updatedAt: 0 }
    if (parsed === null || typeof parsed !== 'object') return null
    return {
      disabled: Array.isArray(parsed.disabled) ? sanitize(parsed.disabled) : [],
      ...(typeof parsed.skin === 'string' ? { skin: parsed.skin } : {}),
      ...(typeof parsed.updatedAt === 'number' ? { updatedAt: parsed.updatedAt } : {}),
    }
  } catch {
    return null
  }
}

function writeCache() {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ disabled: [...disabled], skin, updatedAt: lastUpdatedAt }))
  } catch {
    /* 隐私模式/配额满：缓存只是兜底，失败不影响宿主真源 */
  }
}

/**
 * @param {unknown[]} value
 * @returns {string[]}
 */
function sanitize(value) {
  const result = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (id === '' || id.length > MAX_ID_LENGTH) continue
    result.push(id)
  }
  return result
}

/**
 * 旧版本偏好里的 feature id → 开关 id，并去重。
 * @param {string[]} ids
 * @returns {string[]}
 */
function migrateSwitchIds(ids) {
  const result = []
  const seen = new Set()
  for (const id of ids) {
    const next = LEGACY_SWITCH_IDS[id] ?? id
    if (seen.has(next)) continue
    seen.add(next)
    result.push(next)
  }
  return result
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function normalizeSkin(value) {
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  if (id === '') return undefined
  return id
}

/**
 * 把当前状态写回宿主；失败向上抛，由设置页显示错误。
 * @returns {Promise<void>}
 */
function persist() {
  const payload = JSON.stringify({ disabled: [...disabled], skin })
  const run = writeChain.then(async () => {
    const response = await fetch(ROUTE, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: payload,
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`preferences save failed (HTTP ${String(response.status)})`)
    const value = await response.json().catch(() => null)
    if (typeof value?.updatedAt === 'number') {
      lastUpdatedAt = value.updatedAt
      writeCache()
    }
  })
  writeChain = run.catch(() => {})
  return run
}
