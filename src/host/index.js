/** claude-code-mode 宿主半边：只做浏览器够不到的两件事。
 *
 * 1. 读会话列表的父子关系（工作区树）。
 * 2. 会话「退回到此处」：持久化回退点、按回退点裁剪模型历史、以及在回退时
 *    还原本次会话改过的项目文件。
 *
 * 说明：DSH 的 Session 日志是 append-only 的，没有公开的「截断」能力。
 * 这里不改日志，而是把回退点记在插件自己的状态文件里：
 *  - 模型侧：包装 live Session 的 `deriveMessages()`，把回退范围内的消息从
 *    下一次请求的历史里剔除。`deriveMessages()` 是 Session 的公开方法，
 *    包装只发生在这个进程的内存对象上，不修改 DSH 包本身。
 *  - 界面侧：客户端从本插件的路由读取回退范围，把对应的行隐藏掉。
 * 这样会话 id 不变、撤销回退可用，也不会动用户已有的事件日志。
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { originalOf } from './shared/cordis.js'
import { installDangerGuard } from './features/danger-guard/index.js'
import { installMcpToolSearch } from './features/mcp-tool-search/index.js'
import { installPreferences, isFeatureEnabled, subscribePreferences } from './features/preferences/index.js'

export const name = 'claude-code-mode'
export const inject = ['sessionController', 'sessionQuery', 'webServer', 'sessions', 'agents', 'fs']

const ROUTE = '/claude-code-mode/lineage.json'
const REFRESH_MS = 10000

/** DSH 0.2.2 起普通 fork 不再写 header.parentSession（0.2.1 会写）；这里恢复写入。 */
const FORK_TITLE_SUFFIX = /[ 　]*[（(]\d+[）)]\s*$/u
/** 历史分叉回填：每个分叉最多验证的候选父会话数。 */
const MAX_FORK_CANDIDATES = 6
/** 历史分叉回填：每轮后台扫描最多处理的分叉数。 */
const MAX_BACKFILL_PER_RUN = 3
/** 历史分叉回填：未找到父会话后，10 分钟内不重复扫描。 */
const BACKFILL_RETRY_MS = 10 * 60 * 1000

const REWIND_STATE_ROUTE = '/claude-code-mode/rewind/state'
const REWIND_PREVIEW_ROUTE = '/claude-code-mode/rewind/preview'
const REWIND_APPLY_ROUTE = '/claude-code-mode/rewind'
const REWIND_UNDO_ROUTE = '/claude-code-mode/rewind/undo'

/** 一个文件最多捕获 5MB；超过的文件不参与文件回滚，避免把会话数据撑爆。 */
const MAX_FILE_BYTES = 5 * 1024 * 1024
/** 每轮最多记录 200 个被改文件。 */
const MAX_FILES_PER_TURN = 200
/** 每个会话保留最近 100 轮的捕获；更早的回退只能回退消息。 */
const MAX_TURNS_PER_SESSION = 100
/** 预览等待 turn/end 后置捕获的上限。 */
const FINALIZE_TIMEOUT_MS = 1500

/**
 * @param {any} ctx
 * @param {{ skin?: string, mcpToolSearch?: unknown }} [config]
 */
export function apply(ctx, config = {}) {
  const cache = { at: 0, items: [] }
  let inflight = null
  /** 老数据回填出来的 fork 父会话：childId -> parentId。 */
  const derivedParents = new Map()
  const deriveAttemptedAt = new Map()
  let deriveInflight = null

  ctx.effect(() => installForkLineage(ctx), 'claude-code-mode fork lineage')

  // 功能开关偏好：宿主持久化 + 首屏注入；客户端 apply 时读快照决定装哪些功能。
  ctx.effect(() => installPreferences(ctx), 'claude-code-mode preferences')

  // 安全护栏：确定性拦截，不依赖任何模型判断，任何审批都翻不了案。
  // 只影响「会被判成危险」的命令/写入，正常读写不受影响；安装失败不拖垮宿主插件。
  // 守卫可以整体关掉：配置里 `dangerGuard.enabled: false`，或设置页的开关。
  // 两者是「与」关系——配置是部署方的硬开关，设置页是使用者自己的选择。
  ctx.inject(['tools'], (inner) => {
    inner.effect(() => {
      let dispose = installIfEnabled()
      const unsubscribe = subscribePreferences(() => {
        const on = isFeatureEnabled('danger-guard')
        inner.logger?.info?.(`claude-code-mode: danger-guard 开关变化，enabled=${on}`)
        dispose()
        dispose = installIfEnabled()
      })
      return () => {
        unsubscribe()
        dispose()
      }

      function installIfEnabled() {
        if (config.dangerGuard?.enabled === false) return () => {}
        if (!isFeatureEnabled('danger-guard')) return () => {}
        try {
          return installDangerGuard(inner, config.dangerGuard)
        } catch (error) {
          inner.logger?.warn?.(`claude-code-mode: danger-guard install failed: ${String(error)}`)
          return () => {}
        }
      }
    }, 'claude-code-mode danger-guard')
  })

  // MCP 按需加载：宿主能力，和皮肤/客户端无关；tools/systemPrompt 不在就静默跳过。
  ctx.inject(['tools', 'systemPrompt'], (inner) => {
    inner.effect(
      () => {
        try {
          return installMcpToolSearch(inner, config.mcpToolSearch)
        } catch (error) {
          // 可选能力：安装失败只影响 MCP 按需加载，不能让整个宿主插件起不来。
          inner.logger?.warn?.(`claude-code-mode: mcp-tool-search install failed: ${String(error)}`)
          return () => {}
        }
      },
      'claude-code-mode mcp-tool-search',
    )
  })

  async function refresh() {
    if (inflight !== null) return inflight
    inflight = (async () => {
      try {
        const signal = new AbortController().signal
        const value = await ctx.sessionController.list({}, signal)
        const items = Array.isArray(value?.items) ? value.items : []
        const records = await ctx.sessionQuery.listSessions(signal)
        const createdAtById = new Map((Array.isArray(records) ? records : []).map((record) => [record.header?.id, record.header?.createdAt]))
        cache.items = items
          .filter((item) => item.origin !== 'subagent')
          .map((item) => ({
            id: item.sessionId,
            parent: item.parentSessionId ?? derivedParents.get(item.sessionId) ?? null,
            updatedAt: item.updatedAt ?? 0,
            createdAt: createdAtById.get(item.sessionId) ?? item.createdAt ?? null,
            title: item.title ?? headerTitle(item) ?? null,
          }))
        cache.at = Date.now()
        scheduleForkBackfill(records, items)
      } catch {
        /* 一次失败不掏空快照：保留上一份，等下一轮 */
      } finally {
        inflight = null
      }
      return cache
    })()
    return inflight
  }

  /**
   * DSH 0.2.2 的普通 fork 只复制事件前缀，不再落 header.parentSession；
   * 对升级前/未拦截时产生的历史分叉，用「父标题 + 继承前缀末事件完全一致」回填，
   * 只在唯一匹配时采用，避免猜测。结果缓存在本次进程内。
   */
  function scheduleForkBackfill(records, items) {
    if (deriveInflight !== null) return
    const headers = new Map((Array.isArray(records) ? records : []).map((record) => [record.header?.id, record.header]))
    const itemById = new Map(items.map((item) => [item.sessionId, item]))
    const now = Date.now()
    const orphans = []
    for (const [id, header] of headers) {
      if (header?.isSeeded !== true || header.origin === 'subagent' || header.parentSession !== undefined) continue
      if (!itemById.has(id) || derivedParents.has(id)) continue
      if (now - (deriveAttemptedAt.get(id) ?? 0) < BACKFILL_RETRY_MS) continue
      orphans.push({ id, header, title: headerTitle(itemById.get(id)) })
    }
    if (orphans.length === 0) return
    deriveInflight = (async () => {
      try {
        let processed = 0
        for (const orphan of orphans) {
          if (processed >= MAX_BACKFILL_PER_RUN) break
          const base = forkBaseTitle(orphan.title)
          if (base === '') {
            deriveAttemptedAt.set(orphan.id, Date.now())
            continue
          }
          // 子标题是 DSH 按「源标题 (N)」自动递增出来的；先按反推的源标题精确找，
          // 避免同一支的多个 fork 继承前缀相同、宽松候选出现多个匹配而放弃。
          const sourceTitle = forkSourceTitle(orphan.title)
          const exact = []
          const loose = []
          for (const [id, header] of headers) {
            if (id === orphan.id || header?.origin === 'subagent') continue
            if ((header.createdAt ?? 0) > (orphan.header.createdAt ?? 0)) continue
            const title = headerTitle(itemById.get(id))
            if (sourceTitle !== '' && title === sourceTitle && exact.length < MAX_FORK_CANDIDATES) exact.push({ id, createdAt: header.createdAt ?? 0 })
            if (forkBaseTitle(title) === base && loose.length < MAX_FORK_CANDIDATES) loose.push({ id, createdAt: header.createdAt ?? 0 })
          }
          const candidates = exact.length > 0 ? exact : loose
          processed += 1
          deriveAttemptedAt.set(orphan.id, Date.now())
          if (candidates.length === 0) continue
          candidates.sort((left, right) => right.createdAt - left.createdAt)
          const parent = await matchForkParent(orphan.id, candidates)
          if (parent !== null) derivedParents.set(orphan.id, parent)
        }
      } catch (error) {
        ctx.logger?.warn?.(`claude-code-mode: fork lineage backfill failed: ${String(error)}`)
      } finally {
        deriveInflight = null
      }
    })()
  }

  /** 只有继承前缀的切点事件与候选父会话同序号事件逐字段一致，才算同一个 fork。 */
  async function matchForkParent(childId, candidates) {
    let child
    try {
      child = await ctx.sessionQuery.readSession(childId)
    } catch {
      return null
    }
    const cut = (child?.inheritedEventCount ?? 0) - 1
    const childEvent = cut < 0 ? undefined : child?.events?.[cut]
    if (childEvent === undefined) return null
    let matched = null
    for (const candidate of candidates) {
      let observation
      try {
        observation = await ctx.sessionQuery.readSession(candidate.id)
      } catch {
        continue
      }
      if (!sameForkEvent(childEvent, observation?.events?.[cut])) continue
      if (matched !== null) return null
      matched = candidate.id
    }
    return matched
  }

  refresh()

  ctx.effect(() => {
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, 'claude-code-mode lineage refresh')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    async handler(request, response) {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, CORS)
        response.end()
        return
      }
      const snapshot = await refresh()
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS })
      response.end(JSON.stringify(snapshot))
    },
  }), 'claude-code-mode lineage route')

  const rewind = createRewindManager(ctx)
  rewind.start()

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({
        kind: 'exact',
        path: REWIND_STATE_ROUTE,
        async handler(request, response) {
          if (request.method === 'OPTIONS') return sendJson(response, 204, null, CORS)
          if (request.method !== 'GET') return sendJson(response, 405, { ok: false, code: 'method', message: 'GET only' })
          try {
            const url = new URL(request.url ?? REWIND_STATE_ROUTE, 'http://localhost')
            const sessionId = url.searchParams.get('sessionId')
            if (typeof sessionId !== 'string' || sessionId === '') {
              return sendJson(response, 400, { ok: false, code: 'bad-request', message: 'sessionId required' })
            }
            const value = await rewind.state(sessionId)
            return sendJson(response, 200, value, CORS)
          } catch (error) {
            return sendJson(response, 500, failure(error), CORS)
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: REWIND_PREVIEW_ROUTE,
        async handler(request, response) {
          if (request.method === 'OPTIONS') return sendJson(response, 204, null)
          if (request.method !== 'POST') return sendJson(response, 405, { ok: false, code: 'method', message: 'POST only' })
          try {
            const body = await readJsonBody(request)
            const value = await rewind.preview(body?.sessionId, body?.anchorSeq)
            return sendJson(response, value.ok === false ? statusOf(value) : 200, value)
          } catch (error) {
            return sendJson(response, 500, failure(error))
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: REWIND_APPLY_ROUTE,
        async handler(request, response) {
          if (request.method === 'OPTIONS') return sendJson(response, 204, null)
          if (request.method !== 'POST') return sendJson(response, 405, { ok: false, code: 'method', message: 'POST only' })
          try {
            const body = await readJsonBody(request)
            const value = await rewind.apply(body?.sessionId, body?.anchorSeq, body?.rollbackFiles === true)
            return sendJson(response, value.ok === false ? statusOf(value) : 200, value)
          } catch (error) {
            return sendJson(response, 500, failure(error))
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: REWIND_UNDO_ROUTE,
        async handler(request, response) {
          if (request.method === 'OPTIONS') return sendJson(response, 204, null)
          if (request.method !== 'POST') return sendJson(response, 405, { ok: false, code: 'method', message: 'POST only' })
          try {
            const body = await readJsonBody(request)
            const value = await rewind.undo(body?.sessionId, body?.id)
            return sendJson(response, value.ok === false ? statusOf(value) : 200, value)
          } catch (error) {
            return sendJson(response, 500, failure(error))
          }
        },
      }),
    ]
    return () => {
      for (const dispose of disposers) {
        try { dispose() } catch { /* ignore */ }
      }
      rewind.dispose()
    }
  }, 'claude-code-mode rewind routes')

  // 首屏快照：页面在客户端第一次 fetch 之前就能画出树
  if (typeof ctx.webServer.tapIndex === 'function') {
    ctx.effect(() => ctx.webServer.tapIndex((html) => {
      const boot = JSON.stringify({ at: cache.at, items: cache.items }).replace(/</g, '\\u003c')
      const script = `<script>window.__CT_LINEAGE__=${boot};</script>`
      const source = String(html)
      if (source.includes('</head>')) return source.replace('</head>', `${script}</head>`)
      if (source.includes('</body>')) return source.replace('</body>', `${script}</body>`)
      return script + source
    }), 'claude-code-mode boot snapshot')
  }
}

/**
 * 回退状态与文件检查点。所有状态都在宿主进程里；回退点写进 DSH_HOME 下的
 * JSON 文件，文件内容检查点只在内存里（宿主重启后只能回退消息，不能还原文件）。
 * @param {any} ctx host root context
 */
function createRewindManager(ctx) {
  const stateRoot = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const statePath = join(stateRoot, 'claude-code-mode', 'rewind-state.json')
  /** 更名前的状态文件：第一次用新名字启动时仍能读到旧回退点。 */
  const legacyStatePath = join(stateRoot, 'claude-theme', 'rewind-state.json')

  /** @type {{ version: 1, sessions: Record<string, any[]> }} */
  const store = loadState(statePath, legacyStatePath)

  let writeChain = Promise.resolve()
  function persist() {
    const snapshot = JSON.stringify(store)
    const run = writeChain.then(async () => {
      await mkdir(dirname(statePath), { recursive: true })
      const temporary = `${statePath}.${process.pid}.tmp`
      await writeFile(temporary, snapshot, 'utf8')
      await rename(temporary, statePath)
    })
    writeChain = run.catch(() => {})
    return run
  }

  /** sessionId -> Map<turn, checkpoint>; checkpoint 只在内存。 */
  const checkpoints = new Map()
  /** sessionId -> 当前 turn（fs 事件发生在 tool 执行期间）。 */
  const currentTurn = new Map()
  /** tool exec 对象 -> Session；由 tools/pre-execute 建立。 */
  const actors = new WeakMap()
  /** 当前会话的有效工作目录；workingDirectory 服务缺失时回退到 header.cwd。 */
  const workingDirectory = ctx.get('workingDirectory')

  function effectiveCwd(session) {
    try {
      const value = workingDirectory?.get?.(session)
      if (typeof value === 'string' && value !== '') return value
    } catch { /* fall through */ }
    return session.header.cwd
  }
  /** Session -> 原始 deriveMessages；用于卸载时还原。 */
  const patched = new Map()

  const disposers = []

  function start() {
    for (const session of ctx.sessions.list()) install(session)

    disposers.push(
      ctx.on('session/created', (session) => {
        install(session)
        copyForkState(session)
      }),
      ctx.on('session/disposed', (session) => {
        checkpoints.delete(session.id)
      }),
      ctx.on('session/event', (session, event) => {
        if (event.type === 'turn/start') {
          currentTurn.set(session.id, event.data.turn)
          checkpointFor(session, event.data.turn)
        } else if (event.type === 'turn/end') {
          currentTurn.delete(session.id)
          void finalizeTurn(session, event.data.turn)
        }
      }),
      ctx.on('tools/pre-execute', async (exec, next) => {
        const session = exec?.agent?.session
        if (session !== undefined) {
          actors.set(exec, session)
          const turn = currentTurn.get(session.id)
          if (turn !== undefined) {
            const cwd = effectiveCwd(session)
            for (const path of toolPaths(exec.name, exec.arguments, cwd)) {
              await capturePathBefore(session, turn, path, cwd)
            }
          }
        }
        return next()
      }, { prepend: true }),
      ctx.on('fs/write-intent', (target, actor, next) => rememberTarget(target, actor, next), { prepend: true }),
      ctx.on('fs/edit-intent', (target, actor, next) => rememberTarget(target, actor, next), { prepend: true }),
      ctx.on('fs/delete-intent', (target, actor, next) => rememberTarget(target, actor, next), { prepend: true }),
    )
  }

  function dispose() {
    for (const dispose of disposers.splice(0)) {
      try { dispose() } catch { /* ignore */ }
    }
    for (const [session, original] of [...patched.entries()]) {
      try { session.deriveMessages = original } catch { /* ignore */ }
      patched.delete(session)
    }
    checkpoints.clear()
  }

  /** 包装一个 live Session 的 deriveMessages；回退范围从状态文件读。 */
  function install(session) {
    if (session === undefined || session === null || patched.has(session)) return
    const original = session.deriveMessages
    if (typeof original !== 'function') return
    patched.set(session, original)
    session.deriveMessages = function deriveMessagesWithRewinds() {
      const records = activeRecords(session.id)
      if (records.length === 0) return original.call(session)
      const out = []
      for (const seq of session.surface.nodes) {
        if (records.some((record) => seq >= record.anchorSeq && seq <= record.endSeq)) continue
        const event = session.eventAt(seq)
        if (event === undefined) continue
        const message = session.deriveEventMessage(event)
        if (message !== null) out.push(message)
      }
      return out
    }
  }

  function activeRecords(sessionId) {
    return (store.sessions[sessionId] ?? []).filter((record) => record.undone !== true)
  }

  /** fork 子会话继承父会话仍然生效的回退范围（继承前缀的 seq 不变）。 */
  function copyForkState(child) {
    const parentId = child?.header?.parentSession
    if (typeof parentId !== 'string' || parentId === '') return
    if (child.header.origin === 'subagent') return
    const parent = store.sessions[parentId]
    if (!Array.isArray(parent) || parent.length === 0) return
    const events = child.snapshotEvents()
    const cut = events.length - 1
    if (cut < 0) return
    const copied = []
    for (const record of parent) {
      if (record.undone === true || record.anchorSeq > cut) continue
      const endSeq = Math.min(record.endSeq, cut)
      const endTurn = lastTurnAtOrBefore(events, endSeq) ?? record.anchorTurn
      copied.push({
        ...record,
        id: randomUUID(),
        endSeq,
        endTurn,
        createdAt: Date.now(),
        filesRolledBack: 0,
      })
    }
    if (copied.length === 0) return
    store.sessions[child.id] = [...(store.sessions[child.id] ?? []), ...copied]
    void persist().catch((error) => ctx.logger?.warn?.(`claude-code-mode: rewind fork persist failed: ${String(error)}`))
  }

  // -- 文件检查点 -----------------------------------------------------------

  function checkpointFor(session, turn) {
    if (typeof session.header?.cwd !== 'string' || session.header.cwd === '') return undefined
    if ((session.header.delegationDepth ?? 0) > 0 || session.header.origin === 'subagent') return undefined
    let turns = checkpoints.get(session.id)
    if (turns === undefined) {
      turns = new Map()
      checkpoints.set(session.id, turns)
    }
    let checkpoint = turns.get(turn)
    if (checkpoint === undefined) {
      checkpoint = { turn, files: new Map(), ready: Promise.resolve(), markReady: null }
      checkpoint.ready = new Promise((resolveReady) => { checkpoint.markReady = resolveReady })
      turns.set(turn, checkpoint)
      for (const key of [...turns.keys()].sort((a, b) => a - b).slice(0, Math.max(0, turns.size - MAX_TURNS_PER_SESSION))) {
        turns.delete(key)
      }
    }
    return checkpoint
  }

  async function rememberTarget(target, actor, next) {
    try {
      const session = actors.get(actor)
      if (session !== undefined) {
        const turn = currentTurn.get(session.id)
        if (turn !== undefined) {
          const requested = ctx.fs.processPath(target)
          if (typeof requested === 'string' && isAbsolute(requested)) {
            await capturePathBefore(session, turn, requested, effectiveCwd(session))
          }
        }
      }
    } catch (error) {
      /* 捕获失败只影响文件回滚，不影响工具执行 */
      ctx.logger?.warn?.(`claude-code-mode: file capture failed: ${String(error?.message ?? error)}`)
    }
    return next()
  }

  async function capturePathBefore(session, turn, path, cwd = effectiveCwd(session)) {
    const checkpoint = checkpointFor(session, turn)
    if (checkpoint === undefined || checkpoint.files.size >= MAX_FILES_PER_TURN) return
    const absolute = await canonicalPath(path)
    const root = await canonicalPath(cwd)
    if (!inside(root, absolute)) return
    if (checkpoint.files.has(absolute)) return
    const before = await captureFile(absolute)
    checkpoint.files.set(absolute, {
      absolute,
      display: displayPath(root, absolute),
      before,
      after: undefined,
    })
  }

  async function finalizeTurn(session, turn) {
    const checkpoint = checkpoints.get(session.id)?.get(turn)
    if (checkpoint === undefined || checkpoint.finalized === true) return
    checkpoint.finalized = true
    try {
      for (const file of checkpoint.files.values()) {
        let after = await captureFile(file.absolute)
        // 工具落盘与 turn/end 的时序偶尔会让第一次 stat 落到写入过程中的状态；
        // 短暂重试一次，仍失败才降级为不可回滚。
        if (after.kind === 'unsupported') {
          await delay(120)
          after = await captureFile(file.absolute)
        }
        file.after = after
      }
    } catch {
      for (const file of checkpoint.files.values()) {
        if (file.after === undefined) file.after = { kind: 'unsupported' }
      }
    } finally {
      checkpoint.markReady?.()
    }
  }

  async function waitCheckpoint(checkpoint) {
    await Promise.race([checkpoint.ready, delay(FINALIZE_TIMEOUT_MS)])
  }

  // -- 路由用的操作 ---------------------------------------------------------

  async function state(sessionId) {
    const session = await liveSession(sessionId)
    const busy = await busySession(session)
    const records = activeRecords(sessionId)
    return {
      ok: true,
      busy,
      rewinds: records.map((record) => ({
        id: record.id,
        anchorSeq: record.anchorSeq,
        endSeq: record.endSeq,
        anchorTurn: record.anchorTurn,
        endTurn: record.endTurn,
        messageId: record.messageId ?? null,
        text: typeof record.text === 'string' ? record.text : '',
        attachmentCount: record.attachmentCount ?? 0,
        filesRolledBack: record.filesRolledBack ?? 0,
        createdAt: record.createdAt,
        canUndo: !busy && canUndo(session, record),
      })),
    }
  }

  async function preview(sessionId, anchorSeq) {
    if (typeof sessionId !== 'string' || sessionId === '' || !Number.isSafeInteger(anchorSeq) || anchorSeq < 0) {
      return { ok: false, code: 'bad-request', message: 'sessionId and anchorSeq required' }
    }
    const session = await liveSession(sessionId)
    const events = session.snapshotEvents()
    const anchor = events[anchorSeq]
    if (anchor === undefined || anchor.type !== 'user/message' || anchor.data?.source?.kind !== 'user') {
      return { ok: false, code: 'invalid-anchor', message: 'anchor is not a user message' }
    }
    const busy = await busySession(session)
    if (busy) return { ok: false, code: 'busy', message: 'session is running' }
    const endSeq = events.at(-1)?.seq ?? anchorSeq
    if (!onSurface(session, anchorSeq)) {
      return { ok: false, code: 'compaction', message: 'conversation context was compacted after this message' }
    }
    const anchorTurn = lastTurnAtOrBefore(events, anchorSeq)
    const endTurn = lastTurnAtOrBefore(events, endSeq)
    if (anchorTurn === undefined) return { ok: false, code: 'invalid-anchor', message: 'anchor has no turn' }
    const plan = await planFiles(session, anchorTurn, endTurn, anchorSeq, endSeq)
    return {
      ok: true,
      busy: false,
      anchorSeq,
      endSeq,
      anchorTurn,
      endTurn: endTurn ?? anchorTurn,
      messageId: String(anchor.data.id ?? ''),
      text: textOf(anchor.data.content),
      attachmentCount: attachmentCount(anchor.data.content),
      // 文件内容留在宿主：预览只回传路径和展示名。
      fileRollback: {
        available: plan.available,
        reason: plan.reason,
        count: plan.count,
        files: (plan.files ?? []).map((file) => ({ path: file.path, display: file.display })),
      },
    }
  }

  async function apply(sessionId, anchorSeq, rollbackFiles) {
    if (typeof sessionId !== 'string' || sessionId === '' || !Number.isSafeInteger(anchorSeq) || anchorSeq < 0) {
      return { ok: false, code: 'bad-request', message: 'sessionId and anchorSeq required' }
    }
    const session = await liveSession(sessionId)
    if (await busySession(session)) return { ok: false, code: 'busy', message: 'session is running' }
    const events = session.snapshotEvents()
    const anchor = events[anchorSeq]
    if (anchor === undefined || anchor.type !== 'user/message' || anchor.data?.source?.kind !== 'user') {
      return { ok: false, code: 'invalid-anchor', message: 'anchor is not a user message' }
    }
    const endSeq = events.at(-1)?.seq ?? anchorSeq
    if (!onSurface(session, anchorSeq)) {
      return { ok: false, code: 'compaction', message: 'conversation context was compacted after this message' }
    }
    const anchorTurn = lastTurnAtOrBefore(events, anchorSeq)
    const endTurn = lastTurnAtOrBefore(events, endSeq) ?? anchorTurn
    if (anchorTurn === undefined) return { ok: false, code: 'invalid-anchor', message: 'anchor has no turn' }

    let filesRolledBack = 0
    let fileReason = null
    if (rollbackFiles) {
      const plan = await planFiles(session, anchorTurn, endTurn, anchorSeq, endSeq)
      if (plan.available === true) {
        const restored = await restoreFiles(plan)
        if (restored.failures.length > 0) {
          return {
            ok: false,
            code: 'file-restore-failed',
            message: `failed to restore ${restored.failures.length} file(s)`,
            files: restored.failures,
            restored: restored.restored,
          }
        }
        filesRolledBack = restored.restored
      } else {
        fileReason = plan.reason
      }
    }

    const record = {
      id: randomUUID(),
      anchorSeq,
      endSeq,
      anchorTurn,
      endTurn,
      messageId: String(anchor.data.id ?? ''),
      text: textOf(anchor.data.content).slice(0, 200000),
      attachmentCount: attachmentCount(anchor.data.content),
      createdAt: Date.now(),
      undone: false,
      filesRolledBack,
    }
    const previous = store.sessions[sessionId] ?? []
    store.sessions[sessionId] = [...previous, record]
    try {
      await persist()
    } catch (error) {
      store.sessions[sessionId] = previous
      throw error
    }
    return { ok: true, rewind: record, fileRollback: { available: filesRolledBack > 0, reason: fileReason, rolledBack: filesRolledBack }, state: await state(sessionId) }
  }

  async function undo(sessionId, id) {
    if (typeof sessionId !== 'string' || typeof id !== 'string') {
      return { ok: false, code: 'bad-request', message: 'sessionId and id required' }
    }
    const session = await liveSession(sessionId)
    const records = store.sessions[sessionId] ?? []
    const record = records.find((candidate) => candidate.id === id)
    if (record === undefined || record.undone === true) {
      return { ok: false, code: 'undo-unavailable', message: 'rewind is no longer available' }
    }
    if (!canUndo(session, record) || await busySession(session)) {
      return { ok: false, code: 'undo-unavailable', message: 'a new message was already sent' }
    }
    record.undone = true
    record.undoneAt = Date.now()
    await persist()
    return { ok: true, state: await state(sessionId) }
  }

  // -- 文件回滚计划 ---------------------------------------------------------

  async function planFiles(session, anchorTurn, endTurn, anchorSeq, endSeq) {
    const turns = checkpoints.get(session.id)
    /** @type {Map<string, any>} */
    const files = new Map()
    if (turns !== undefined) {
      const range = [...turns.entries()].filter(([turn]) => turn >= anchorTurn && turn <= endTurn).sort((a, b) => a[0] - b[0])
      await Promise.all(range.map(([, checkpoint]) => waitCheckpoint(checkpoint)))
      for (const [, checkpoint] of range) {
        for (const file of checkpoint.files.values()) {
          const existing = files.get(file.absolute)
          if (existing === undefined) {
            files.set(file.absolute, {
              absolute: file.absolute,
              display: file.display,
              before: file.before,
              after: file.after,
            })
          } else {
            existing.after = file.after
          }
        }
      }
    }

    const untracked = await untrackedChanges(session, anchorSeq, endSeq, files)
    if (untracked === true) return { available: false, reason: 'untracked', files: [], count: files.size }
    if (files.size === 0) return { available: false, reason: 'none', files: [], count: 0 }

    const list = []
    for (const file of files.values()) {
      if (file.before === undefined || file.after === undefined) {
        return { available: false, reason: 'unsupported', files: [], count: files.size }
      }
      if (file.before.kind === 'unsupported' || file.after.kind === 'unsupported') {
        return { available: false, reason: 'unsupported', files: [], count: files.size }
      }
      const current = await captureFile(file.absolute)
      if (!sameCapture(current, file.after)) {
        return { available: false, reason: 'dirty', files: [], count: files.size }
      }
      list.push({ path: file.absolute, display: file.display, before: file.before })
    }
    return { available: true, reason: null, files: list, count: list.length }
  }

  async function untrackedChanges(session, anchorSeq, endSeq, files) {
    const service = ctx.get('workspaceChanges')
    if (service === undefined) return false
    const events = session.snapshotEvents()
    for (let seq = anchorSeq; seq <= endSeq; seq += 1) {
      const event = events[seq]
      if (event?.type !== 'workspace/changes') continue
      const summary = service.summary(session.id, seq)
      if (summary === undefined) continue
      if ((summary.total ?? summary.files.length) > summary.files.length) return true
      for (const changed of summary.files) {
        const absolute = await canonicalPath(isAbsolute(changed.path) ? changed.path : resolve(summary.cwd ?? session.header.cwd, changed.path))
        if (!files.has(absolute)) return true
      }
    }
    return false
  }

  async function restoreFiles(plan) {
    let restored = 0
    const failures = []
    for (const file of plan.files) {
      try {
        if (file.before === undefined) throw new Error('missing before capture')
        if (file.before.kind === 'absent') {
          await rm(file.path, { force: true })
        } else if (file.before.kind === 'file') {
          await mkdir(dirname(file.path), { recursive: true })
          await writeFile(file.path, file.before.bytes)
        } else {
          throw new Error('unsupported before capture')
        }
        restored += 1
      } catch (error) {
        failures.push({ path: file.display, message: String(error?.message ?? error) })
      }
    }
    return { restored, failures }
  }

  async function liveSession(sessionId) {
    let session = ctx.sessions.get(sessionId)
    if (session === undefined) {
      const result = await ctx.sessionController.resolveAgent(sessionId)
      if (result === undefined || result.error !== undefined) {
        throw new Error(`session ${sessionId} is not available: ${String(result?.error?.code ?? 'unknown')}`)
      }
      session = ctx.sessions.get(sessionId) ?? result.agent?.session
    }
    if (session === undefined) throw new Error(`session ${sessionId} is not live`)
    install(session)
    return session
  }

  async function busySession(session) {
    try {
      const state = await ctx.sessionController.state({ sessionId: session.id }, AbortSignal.timeout(5000))
      if (state?.running === true) return true
      if (Array.isArray(state?.queue) && state.queue.length > 0) return true
    } catch {
      /* 状态服务不可用时退回事件判断 */
    }
    const events = session.snapshotEvents()
    let open = false
    for (const event of events) {
      if (event.type === 'turn/start') open = true
      else if (event.type === 'turn/end') open = false
    }
    return open
  }

  function canUndo(session, record) {
    if (record.undone === true) return false
    const events = session.snapshotEvents()
    for (let seq = record.endSeq + 1; seq < events.length; seq += 1) {
      const event = events[seq]
      if (event?.type === 'user/message' && event.data?.source?.kind === 'user') return false
    }
    return true
  }

  return { start, dispose, state, preview, apply, undo }
}

// -- 纯函数 -----------------------------------------------------------------

/**
 * 读回退状态。新文件不存在时回退到更名前的路径；读到后仍写新路径。
 * @param {string} path
 * @param {string} [legacyPath]
 */
function loadState(path, legacyPath) {
  const parsed = readStateFile(path) ?? readStateFile(legacyPath)
  if (parsed === null) return { version: 1, sessions: {} }
  try {
    if (parsed?.version !== 1 || typeof parsed.sessions !== 'object' || parsed.sessions === null) return { version: 1, sessions: {} }
    const sessions = {}
    for (const [sessionId, records] of Object.entries(parsed.sessions)) {
      if (typeof sessionId !== 'string' || !Array.isArray(records)) continue
      sessions[sessionId] = records.filter(isRecord).map((record) => ({
        id: typeof record.id === 'string' ? record.id : randomUUID(),
        anchorSeq: Number(record.anchorSeq) || 0,
        endSeq: Number(record.endSeq) || 0,
        anchorTurn: Number(record.anchorTurn) || 0,
        endTurn: Number(record.endTurn) || 0,
        messageId: typeof record.messageId === 'string' ? record.messageId : null,
        text: typeof record.text === 'string' ? record.text : '',
        attachmentCount: Number(record.attachmentCount) || 0,
        filesRolledBack: Number(record.filesRolledBack) || 0,
        createdAt: Number(record.createdAt) || Date.now(),
        undone: record.undone === true,
        undoneAt: Number(record.undoneAt) || undefined,
      }))
    }
    return { version: 1, sessions }
  } catch {
    return { version: 1, sessions: {} }
  }
}

/** @param {string | undefined} path */
function readStateFile(path) {
  if (typeof path !== 'string') return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function lastTurnAtOrBefore(events, seq) {
  for (let index = Math.min(seq, events.length - 1); index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/start' && Number.isSafeInteger(event.data?.turn)) return event.data.turn
  }
  return undefined
}

function onSurface(session, seq) {
  return session.surface.nodes.includes(seq)
}

function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content.flatMap((block) => block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('')
}

function attachmentCount(content) {
  if (!Array.isArray(content)) return 0
  return content.filter((block) => block?.type === 'image' || block?.type === 'file').length
}

function inside(root, path) {
  if (typeof root !== 'string' || root === '') return false
  const relativePath = relative(resolve(root), resolve(path))
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

async function canonicalPath(path) {
  try {
    return await realpath(path)
  } catch {
    try {
      return join(await realpath(dirname(path)), basename(path))
    } catch {
      return resolve(path)
    }
  }
}

function displayPath(cwd, absolute) {
  const relativePath = relative(resolve(cwd), absolute)
  return relativePath === '' || relativePath.startsWith('..') ? absolute : relativePath.split('\\').join('/')
}

async function captureFile(path) {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_FILE_BYTES) {
      return { kind: 'unsupported', reason: info.isFile() ? 'too-large' : 'not-file' }
    }
    const bytes = await readFile(path)
    if (bytes.length > MAX_FILE_BYTES) return { kind: 'unsupported', reason: 'too-large' }
    return { kind: 'file', bytes, hash: hashOf(bytes) }
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { kind: 'absent' }
    return { kind: 'unsupported', reason: String(error?.code ?? error?.message ?? error) }
  }
}

function sameCapture(left, right) {
  if (left.kind === 'absent' || right.kind === 'absent') return left.kind === right.kind
  return left.kind === 'file' && right.kind === 'file' && left.hash === right.hash
}

function hashOf(bytes) {
  // Node 的 crypto 在 host 进程里可用；只用于比较内容，不持久化。
  return bytes.length === 0 ? 'empty' : createHash('sha1').update(bytes).digest('hex')
}

function toolPaths(name, args, cwd) {
  if (typeof cwd !== 'string' || cwd === '') return []
  if (typeof args !== 'object' || args === null) return []
  const resolveInput = (value) => {
    if (typeof value !== 'string' || value.trim() === '') return undefined
    const trimmed = value.trim()
    return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed)
  }
  if (name === 'write' || name === 'edit' || name === 'str_replace_editor') {
    return [resolveInput(args.file_path ?? args.path)].filter(Boolean)
  }
  if (name === 'apply_patch') {
    const patch = typeof args.patch === 'string' ? args.patch : ''
    const paths = []
    for (const line of patch.split('\n')) {
      for (const prefix of ['*** Update File: ', '*** Add File: ', '*** Delete File: ', '*** Move to: ']) {
        if (!line.startsWith(prefix)) continue
        const value = resolveInput(line.slice(prefix.length).trim())
        if (value !== undefined) paths.push(value)
      }
    }
    return paths
  }
  return []
}

async function readJsonBody(request) {
  let body = ''
  for await (const chunk of request) body += chunk
  if (body.trim() === '') return {}
  return JSON.parse(body)
}

function sendJson(response, status, value, headers = {}) {
  if (status === 204) {
    response.writeHead(204, headers)
    response.end()
    return
  }
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  response.end(JSON.stringify(value))
}

function statusOf(value) {
  if (value?.code === 'busy' || value?.code === 'undo-unavailable') return 409
  if (value?.code === 'invalid-anchor') return 422
  if (value?.code === 'bad-request' || value?.code === 'method') return 400
  return 500
}

function failure(error) {
  return { ok: false, code: 'internal', message: String(error?.message ?? error) }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

/** 兼容不同版本的摘要形状：有的版本把标题放在 projections.values.title。 */
function headerTitle(item) {
  return item?.projections?.values?.title ?? item?.title ?? null
}

/** 恢复 DSH 0.2.1 的 fork 语义：fork 出的子会话 header 里带上源会话 id。
 *
 * 0.2.2 把普通 fork 改成「没有持久化来源关系」，`session.fork` 不再传
 * `meta.parentSession`，于是 `sessions.list.parentId` 永远为空，侧栏 fork 树塌成平铺。
 * 宿主侧只在 fork 的异步链里给 `agents.create` 的 seeded meta 补一个 parentSession，
 * 不改 DSH 包、不重写 fork 逻辑；新建会话/子代理创建不受影响。
 */
function installForkLineage(ctx) {
  const controller = originalOf(ctx.sessionController)
  const registry = originalOf(ctx.agents)
  const originalFork = controller?.fork
  const originalCreate = registry?.create
  if (typeof originalFork !== 'function' || typeof originalCreate !== 'function') return () => {}
  const hadFork = Object.hasOwn(controller, 'fork')
  const hadCreate = Object.hasOwn(registry, 'create')
  const previousFork = controller.fork
  const previousCreate = registry.create
  const scope = new AsyncLocalStorage()

  const forkWithLineage = function (request, ...rest) {
    const parentSessionId = request?.sessionId
    if (typeof parentSessionId !== 'string' || parentSessionId === '') return Reflect.apply(originalFork, this, arguments)
    return scope.run({ parentSessionId }, () => Reflect.apply(originalFork, this, arguments))
  }
  const createWithForkLineage = function (options, ...rest) {
    const fork = scope.getStore()
    if (fork !== undefined && options !== null && typeof options === 'object') {
      const meta = options.meta
      if (meta !== null && typeof meta === 'object' && meta.isSeeded === true && meta.parentSession === undefined) {
        return Reflect.apply(originalCreate, this, [{ ...options, meta: { ...meta, parentSession: fork.parentSessionId } }, ...rest])
      }
    }
    return Reflect.apply(originalCreate, this, arguments)
  }

  controller.fork = forkWithLineage
  registry.create = createWithForkLineage
  return () => {
    if (controller.fork === forkWithLineage) {
      if (hadFork) controller.fork = previousFork
      else delete controller.fork
    }
    if (registry.create === createWithForkLineage) {
      if (hadCreate) registry.create = previousCreate
      else delete registry.create
    }
  }
}

/** 去掉 fork 自动追加的 `(1)` / `（1）` 尾数；只用于找候选父会话，最终仍要事件校验。 */
function forkBaseTitle(title) {
  return typeof title === 'string' ? title.replace(FORK_TITLE_SUFFIX, '').trim() : ''
}

/**
 * 按 DSH 的 `increasedForkTitle` 反推源会话标题：
 * `X` → `X (1)`，`X (1)` → `X (2)`，`X（1）` → `X（2）`。
 * 返回空串表示标题不是自动递增出来的（可能被用户改过），退回宽松候选。
 */
function forkSourceTitle(title) {
  if (typeof title !== 'string') return ''
  const ascii = /^(.*?)\((\d+)\)$/u.exec(title)
  if (ascii !== null) {
    const count = Number(ascii[2])
    if (!Number.isSafeInteger(count)) return ''
    return count > 1 ? `${ascii[1]}(${count - 1})`.trimEnd() : ascii[1].trimEnd()
  }
  const fullWidth = /^(.*?)（(\d+)）$/u.exec(title)
  if (fullWidth !== null) {
    const count = Number(fullWidth[2])
    if (!Number.isSafeInteger(count)) return ''
    return count > 1 ? `${fullWidth[1]}（${count - 1}）`.trimEnd() : fullWidth[1].trimEnd()
  }
  return ''
}

/** 比较 fork 切点事件：seq/time/type/data 全等才算同一段继承前缀。 */
function sameForkEvent(left, right) {
  if (left === undefined || right === undefined) return false
  if (left.seq !== right.seq || left.time !== right.time || left.type !== right.type) return false
  try {
    return JSON.stringify(left.data) === JSON.stringify(right.data)
  } catch {
    return false
  }
}
