/** 功能开关偏好：宿主侧持久化 + 同源路由 + 首屏注入。
 *
 * 为什么不存 localStorage：桌面端由 desktop-host 以 `--port 0` 启动，每次进程
 * 重启端口都会变，origin 也跟着变，localStorage 里的开关会「无端重置」；而
 * `dsh web` 与桌面端本来就是两个 origin。写进 `$DSH_HOME/claude-code-mode/
 * preferences.json` 之后，桌面端、Web 端、换端口都读同一份。
 *
 * 形状刻意存「被关掉的集合」而不是全量开关表：以后新增功能天然默认开启，
 * 老用户的旧文件不会把新功能意外关掉。皮肤不是开关，单独存 `skin` 值
 * （默认 `claude`，`native` 表示不挂皮肤）。
 *
 * 兼容：旧版本的 `disabled` 里可能含 `skin`（那时皮肤还是开关）。读到它时
 * 迁移成 `skin: 'native'` 并从 disabled 里移除，尊重用户上次关掉皮肤的选择。
 */

import { readFileSync, utimesSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const PREFERENCES_ROUTE = '/claude-code-mode/preferences'

const DIRECTORY = 'claude-code-mode'
const FILENAME = 'preferences.json'
const VERSION = 1
/** 默认皮肤：与客户端 SKINS 里的 claude 对应。 */
const DEFAULT_SKIN = 'claude'
/** 不挂皮肤的值。 */
const NATIVE_SKIN = 'native'
/** 旧版本把皮肤当功能开关时用过的 id。 */
const LEGACY_SKIN_KEY = 'skin'
/** 旧版本偏好里的 feature id → 开关 id；与客户端 core/catalog.js 的 LEGACY_SWITCH_IDS 保持一致。 */
const LEGACY_SWITCH_IDS = Object.freeze({
  'workspace-browser': 'sidebar',
  'window-chrome': 'sidebar',
  'conversation-header-menu': 'session-header',
  'conversation-title-edit': 'session-header',
})
/** 开关项上限：够覆盖全部功能，也挡住乱写的文件/请求。 */
const MAX_ITEMS = 64
/** 单个开关 id 上限（feature id 都是短横线串）。 */
const MAX_ID_LENGTH = 80
/** 皮肤 id 上限。 */
const MAX_SKIN_LENGTH = 32
/** 一次写入的请求体上限。 */
const MAX_BODY_BYTES = 64 * 1024
/** 首屏注入的全局名，客户端 core/preferences.js 读同一个名字。 */
const GLOBAL_NAME = '__CT_PREFS__'

/**
 * 当前生效的偏好。宿主侧的功能（例如安全护栏）要按开关装卸，
 * 所以这里保留一份模块级引用，并提供同步查询与变更订阅。
 * @type {{ disabled: string[] }}
 */
let activeState = { disabled: [] }
/** @type {Set<() => void>} */
const preferenceListeners = new Set()

/**
 * 某个开关是否处于开启状态（默认开启：只看「被关掉的集合」）。
 * @param {string} id
 * @returns {boolean}
 */
export function isFeatureEnabled(id) {
  return !activeState.disabled.includes(id)
}

/**
 * 订阅偏好变更。保存成功后同步调用，宿主功能据此重新装卸。
 * @param {() => void} listener
 * @returns {() => void} 退订
 */
export function subscribePreferences(listener) {
  preferenceListeners.add(listener)
  return () => { preferenceListeners.delete(listener) }
}

/** 通知所有订阅者。回调抛错不影响其它订阅者与保存流程。 */
function notifyPreferences() {
  for (const listener of preferenceListeners) {
    try {
      listener()
    } catch {
      /* 单个订阅者失败不影响其它订阅者 */
    }
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

/**
 * 安装偏好存储：同步读盘一次（apply 阶段完成，页面请求前就绪），
 * 注册读写路由，并把快照注入首页 HTML。
 * @param {any} ctx host root context
 * @returns {() => void} disposer
 */
export function installPreferences(ctx) {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const path = join(home, DIRECTORY, FILENAME)

  /** @type {{ disabled: string[], skin: string, updatedAt: number }} */
  const state = loadState(path)
  activeState = state
  /** 写盘串行：并发 PUT 不会互相覆盖临时文件。 */
  let writeChain = Promise.resolve()

  const snapshot = () => ({ disabled: [...state.disabled], skin: state.skin, updatedAt: state.updatedAt })

  /**
   * @param {{ disabled?: string[], skin?: string }} next
   * @returns {Promise<void>}
   */
  const save = (next) => {
    const record = {
      version: VERSION,
      disabled: next.disabled ?? [...state.disabled],
      skin: next.skin ?? state.skin,
      updatedAt: Date.now(),
    }
    const body = JSON.stringify(record)
    // 先更新内存：本次进程后续的首屏注入立即反映新状态。
    state.disabled = [...record.disabled]
    state.skin = record.skin
    state.updatedAt = record.updatedAt
    // 宿主功能（安全护栏）按开关装卸：先通知，再落盘。
    notifyPreferences()
    const run = writeChain.then(async () => {
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.${process.pid}.tmp`
      await writeFile(temporary, body, 'utf8')
      await rename(temporary, path)
    })
    writeChain = run.catch(() => {})
    return run
  }

  /**
   * 保存后让页面只重载本插件：client-hmr 按 bundle 的 mtime/ctime/size 计算
   * revision，touch 一下 client bundle 就会广播 rebuilt，页面重新装载插件
   * 而不刷新整个页面。没有 clientModules（headless 等）时静默跳过。
   */
  /** @type {any} */
  let clientModules = null
  ctx.inject(['clientModules'], (scope) => {
    clientModules = scope.get('clientModules')
    return () => { clientModules = null }
  })

  const signalClientReload = () => {
    try {
      const baseline = clientModules?.artifactBaseline?.('claude-code-mode')
      if (typeof baseline?.path !== 'string') return
      const now = new Date()
      utimesSync(baseline.path, now, now)
    } catch (error) {
      ctx.logger?.warn?.(`claude-code-mode: client reload signal failed: ${String(error)}`)
    }
  }

  const disposers = []

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: PREFERENCES_ROUTE,
    async handler(request, response) {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, CORS)
        response.end()
        return
      }
      if (request.method === 'GET') {
        sendJson(response, 200, { ok: true, ...snapshot() })
        return
      }
      if (request.method !== 'PUT' && request.method !== 'POST') {
        sendJson(response, 405, { ok: false, code: 'method', message: 'GET or PUT only' }, CORS)
        return
      }
      let body
      try {
        body = await readJsonBody(request)
      } catch (error) {
        sendJson(response, 400, { ok: false, code: 'bad-json', message: String(error?.message ?? error) }, CORS)
        return
      }
      if (body?.disabled !== undefined && !Array.isArray(body.disabled)) {
        sendJson(response, 400, { ok: false, code: 'bad-request', message: 'disabled must be an array' }, CORS)
        return
      }
      if (body?.skin !== undefined && typeof body.skin !== 'string') {
        sendJson(response, 400, { ok: false, code: 'bad-request', message: 'skin must be a string' }, CORS)
        return
      }
      try {
        const disabledBefore = [...state.disabled].sort().join('\n')
        await save({
          ...(body?.disabled === undefined ? {} : { disabled: migrateSwitchIds(normalizeIds(body.disabled)) }),
          ...(normalizeSkin(body?.skin) === undefined ? {} : { skin: normalizeSkin(body?.skin) }),
        })
        // 只有功能集合变化才需要重载插件；皮肤是纯观感，客户端即时切换。
        if ([...state.disabled].sort().join('\n') !== disabledBefore) signalClientReload()
      } catch (error) {
        ctx.logger?.warn?.(`claude-code-mode: preferences write failed: ${String(error)}`)
        sendJson(response, 500, { ok: false, code: 'write-failed', message: String(error?.message ?? error) }, CORS)
        return
      }
      sendJson(response, 200, { ok: true, ...snapshot() }, CORS)
    },
  }))

  // 首屏注入：客户端 apply 时同步读取，避免「先按旧状态画一帧再纠正」。
  if (typeof ctx.webServer.tapIndex === 'function') {
    disposers.push(ctx.webServer.tapIndex((html) => injectBootSnapshot(html, snapshot())))
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* 已经释放 */
      }
    }
  }
}

/**
 * 读偏好文件并迁移旧形状；任何损坏都退回默认（全开 + Claude 皮肤），
 * 不让设置文件拖垮插件。
 * @param {string} path
 * @returns {{ disabled: string[], skin: string, updatedAt: number }}
 */
function loadState(path) {
  let parsed = null
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[claude-code-mode] preferences unreadable, treating every feature as enabled', error)
    }
  }
  const disabled = Array.isArray(parsed?.disabled) ? normalizeIds(parsed.disabled) : []
  const legacySkinOff = disabled.includes(LEGACY_SKIN_KEY)
  const filtered = disabled.filter((id) => id !== LEGACY_SKIN_KEY)
  const skin = normalizeSkin(parsed?.skin) ?? (legacySkinOff ? NATIVE_SKIN : DEFAULT_SKIN)
  return { disabled: migrateSwitchIds(filtered), skin, updatedAt: 0 }
}

/**
 * 只留合法的开关 id：字符串、非空、长度受限、去重、最多 MAX_ITEMS 个。
 * @param {unknown[]} value
 * @returns {string[]}
 */
function normalizeIds(value) {
  const result = []
  const seen = new Set()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (id === '' || id.length > MAX_ID_LENGTH || seen.has(id)) continue
    seen.add(id)
    result.push(id)
    if (result.length >= MAX_ITEMS) break
  }
  return result
}

/**
 * 把旧版本的 feature id 映射成开关 id 并去重。
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
 * 皮肤 id：非空、长度受限；不认识的交给客户端回退默认皮肤。
 * @param {unknown} value
 * @returns {string | undefined}
 */
function normalizeSkin(value) {
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  if (id === '' || id.length > MAX_SKIN_LENGTH) return undefined
  return id
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<any>}
 */
async function readJsonBody(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  if (body.trim() === '') return {}
  return JSON.parse(body)
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} value
 * @param {Record<string, string>} [headers]
 */
function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  response.end(JSON.stringify(value))
}

/**
 * 把快照写成同步脚本注入首屏。
 * @param {string} html
 * @param {{ disabled: string[], skin: string, updatedAt: number }} snapshot
 * @returns {string}
 */
function injectBootSnapshot(html, snapshot) {
  const payload = JSON.stringify(snapshot).replace(/</g, '\\u003c')
  const script = `<script>window.${GLOBAL_NAME}=${payload};</script>`
  const source = String(html)
  if (source.includes('</head>')) return source.replace('</head>', `${script}</head>`)
  if (source.includes('</body>')) return source.replace('</body>', `${script}</body>`)
  return script + source
}
