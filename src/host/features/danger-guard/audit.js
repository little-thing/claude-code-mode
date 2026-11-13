/** danger-guard 的审计：拒绝记录写 JSONL，并在内存里保留「最近拦截」。
 *
 * 只记录判定结论与脱敏后的命令原文，不记录模型对话、不记录推理过程。
 * 写入失败绝不影响拦截本身：审计是旁路能力。
 */

import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { safeLog } from './log.js'

/** 内存里保留的最近记录条数。 */
const MAX_RECENT = 50

/** 审计文件超过这个大小就轮转一次。 */
const MAX_FILE_BYTES = 512 * 1024
/** 轮转后保留的最近条数。 */
const KEEP_ROWS = 500
/** 每写这么多条检查一次文件大小（避免每条都 stat）。 */
const TRIM_CHECK_EVERY = 50

/** 距上次检查文件大小又写了几条。 */
let writesSinceTrim = 0

/**
 * 审计文件轮转：超过 {@link MAX_FILE_BYTES} 时只保留最后 {@link KEEP_ROWS} 条。
 * 失败只记日志，不影响审计本身。
 * @param {string} file
 * @returns {Promise<void>}
 */
async function trimAuditFile(file) {
  const info = await stat(file)
  if (info.size <= MAX_FILE_BYTES) return
  const text = await readFile(file, 'utf8')
  const lines = text.split('\n').filter((line) => line !== '')
  if (lines.length <= KEEP_ROWS) return
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${lines.slice(-KEEP_ROWS).join('\n')}\n`, 'utf8')
  await rename(temporary, file)
}

/** 连续拦截多少次后提示（只提示，不放行）。 */
const CONSECUTIVE_ALERT = 5

/** 单条记录最长的命令原文。 */
const MAX_COMMAND = 400

/** 审计只读路由：设置页「最近拦截」读它。 */
export const DANGER_AUDIT_ROUTE = '/claude-code-mode/danger-guard/audit'

/**
 * 安装审计。`record()` 永远不抛错。
 * @param {any} ctx
 * @returns {{ record: (entry: object) => void, recent: () => object[], dispose: () => void }}
 */
export function installAudit(ctx) {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const file = join(home, 'claude-code-mode', 'danger-guard.jsonl')
  const recent = []
  let disposed = false
  let queue = Promise.resolve()

  const record = (entry) => {
    if (disposed) return
    const row = {
      at: new Date().toISOString(),
      kind: entry.kind,
      layer: entry.layer ?? null,
      rule: entry.rule ?? null,
      tool: entry.tool ?? null,
      detail: sanitize(entry.detail),
      command: entry.command === undefined ? undefined : sanitize(entry.command),
      path: entry.path === undefined ? undefined : sanitize(entry.path),
      session: entry.session ?? null,
      error: entry.error === undefined ? undefined : sanitize(entry.error),
    }
    // `refused` 是「判定命中、但用户没批准」，同样属于一次拦截；
    // 只有真正放行的记录才重置连续计数。
    if (entry.kind === 'deny' || entry.kind === 'refused') {
      status.consecutiveDenials += 1
      status.totalDenials += 1
      if (status.consecutiveDenials >= CONSECUTIVE_ALERT && status.alert === null) {
        status.alert = {
          at: row.at,
          consecutive: status.consecutiveDenials,
          message: `连续拦截 ${status.consecutiveDenials} 次：可能是规则过严，也可能任务卡在同一处`,
        }
        safeLog(ctx, 'warn', `claude-code-mode: danger-guard ${status.alert.message}`)
      }
    } else {
      // 出现任何非拒绝事件（放行后的错误等）就重置连续计数。
      status.consecutiveDenials = 0
      status.alert = null
    }
    recent.push(row)
    if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT)
    queue = queue
      .then(async () => {
        await mkdir(join(home, 'claude-code-mode'), { recursive: true })
        await appendFile(file, `${JSON.stringify(row)}\n`, 'utf8')
      })
      .then(async () => {
        // 文件无限追加会越用越大，隔一段检查一次，超限就只留最近的若干条。
        writesSinceTrim += 1
        if (writesSinceTrim < TRIM_CHECK_EVERY) return
        writesSinceTrim = 0
        await trimAuditFile(file)
      })
      .catch((error) => {
        safeLog(ctx, 'warn', `claude-code-mode: danger-guard audit write failed: ${String(error)}`)
      })
  }

  /** 安装状态：供审计路由自证守卫是否真的挂上了。 */
  const status = {
    installed: false,
    guards: 0,
    listeners: [],
    front: null,
    chain: -1,
    error: null,
    /** 连续拦截次数：用来提示「规则可能过严 / 任务卡住了」。 */
    consecutiveDenials: 0,
    totalDenials: 0,
    /** 连续拒绝超过阈值时置位，只用于提示，不改变任何拦截行为。 */
    alert: null,
  }

  // 审计路由：只读，返回当前进程内存里的最近记录（不含历史文件）。
  let disposeRoute = () => {}
  const webServer = ctx.get('webServer')
  if (typeof webServer?.register === 'function') {
    try {
      disposeRoute = webServer.register({
        kind: 'exact',
        path: DANGER_AUDIT_ROUTE,
        handler(request, response) {
          if (request.method === 'OPTIONS') {
            response.writeHead(204, CORS)
            response.end()
            return
          }
          if (request.method !== 'GET') {
            response.writeHead(405, { ...CORS, 'content-type': 'application/json; charset=utf-8' })
            response.end(JSON.stringify({ ok: false, message: 'GET only' }))
            return
          }
          response.writeHead(200, { ...NO_STORE, ...CORS })
          response.end(JSON.stringify({ ok: true, status, recent }))
        },
      })
    } catch (error) {
      safeLog(ctx, 'warn', `claude-code-mode: danger-guard audit route failed: ${String(error)}`)
    }
  }
  safeLog(ctx, 'debug', 'claude-code-mode: danger-guard audit ready')

  return {
    record,
    status,
    recent: () => recent.map((row) => ({ ...row })),
    dispose() {
      disposed = true
      try {
        disposeRoute()
      } catch {
        /* ignore */
      }
    },
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

const NO_STORE = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

/** 截断并抹掉明显的凭据。 */
function sanitize(value) {
  const text = String(value ?? '')
  const masked = text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/giu, '$1***')
    .replace(/((?:token|api[_-]?key|secret|password)=)[^&\s"']{4,}/giu, '$1***')
  return masked.length > MAX_COMMAND ? `${masked.slice(0, MAX_COMMAND)}…` : masked
}