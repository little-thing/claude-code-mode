/** danger-guard 安装层：把确定性判定挂到工具管线与文件系统瀑布上。
 *
 * 三处拦截，全部是「单调」的：没有 allow 返回值，任何审批、任何自动审查都翻不了案。
 *
 * 1. `ctx.tools.guard()`：工具执行前最后一次检查。`dsh-tools` 的管线顺序是
 *    pre-execute → 审批 → checkGuards → 工具 body，而 `bash` 的
 *    `sandbox_permissions` 升权审批发生在**工具 body 内部**。因此这里的 guard
 *    落在「用户已经点了批准」之后：批准升权也绕不过危险删除。
 * 2. `tools/pre-execute`：先于 auto-review 运行，负责解析会话 cwd 与符号链接。
 * 3. `fs/write-intent` / `fs/edit-intent` / `fs/delete-intent`：文件系统原语层的同步守卫，
 *    兜住不是经 bash 的写入（`write`/`edit`/`apply_patch`/MCP 写类工具）。
 *
 * 失败关闭：判定自身抛错时返回拒绝理由，而不是放行。
 */

import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { installAudit } from './audit.js'
import { safeLog } from './log.js'
import {
  criticalKind,
  deleteTargets,
  HOME_PROTECTED_FILES,
  inspectPowerShell,
  inspectShell,
  normalize,
  PROJECT_PROTECTED,
  protectedFileKind,
  resolvePath,
} from './rules.js'

/** 判定自身失败时的保守理由。 */
const INTERNAL_FAILURE = 'danger-guard: 判定过程失败，按失败关闭处理'

/** 走写路径检查的工具。 */
const WRITE_TOOLS = new Set(['write', 'edit', 'apply_patch'])

/** 走命令检查的工具。 */
const SHELL_TOOLS = new Set(['bash', 'pwsh', 'terminal_send', 'terminal_open'])

/**
 * 安装安全护栏。
 * @param {any} ctx
 * @param {{ enabled?: boolean, protectedPaths?: string[] } | undefined} config
 * @returns {() => void} disposer
 */
export function installDangerGuard(ctx, config) {
  const options = config ?? {}
  if (options.enabled === false) return () => {}
  const audit = installAudit(ctx)
  const disposers = []

  /** 会话 → 已知 cwd（由 pre-execute / fs 瀑布填充）。 */
  const knownCwd = new WeakMap()

  /**
   * 用户当次批准过的调用。命中硬规则时先向用户要一次授权：
   * `allowed-once` 才放行，并且只对这一个 exec 对象生效（不持久、不跨调用）。
   * 审批策略是 `never` 时 approval 服务直接拒绝，等于保持原来的硬拒行为。
   */
  const approved = new WeakSet()

  const env = (cwd) => ({
    home: homedir(),
    cwd: cwd ?? process.cwd(),
    protectedPaths: Array.isArray(options.protectedPaths) ? options.protectedPaths : [],
  })

  /** 解析会话当前工作目录；失败时退回会话头部或进程目录。 */
  async function sessionCwd(agent, signal) {
    try {
      const value = await ctx.get('workingDirectory')?.ensure?.(agent, signal)
      if (typeof value === 'string' && value !== '') return value
    } catch {
      /* 退回下一层 */
    }
    return agent?.session?.header?.cwd ?? process.cwd()
  }

  /**
   * 解析真实绝对路径（穿透符号链接）；目标不存在时解析最近的已存在上级。
   * @param {string} path
   * @returns {Promise<string>}
   */
  async function realTarget(path) {
    let current = resolve(path)
    const rest = []
    for (let depth = 0; depth < 40; depth += 1) {
      try {
        const real = await realpath(current)
        return normalize(join(real, ...rest.reverse()))
      } catch {
        const parent = dirname(current)
        if (parent === current) break
        rest.push(current.slice(parent.length).replace(/^\//u, ''))
        current = parent
      }
    }
    return normalize(path)
  }

  /**
   * 无 IO 的同步判定：只看字面路径与命令文本。
   * @param {{ name: string, arguments?: any }} exec
   * @param {string} cwd
   * @returns {{ rule: string, detail: string, command?: string } | null}
   */
  function judgeSync(exec, cwd) {
    const args = exec.arguments ?? {}
    const base = env(cwd)
    if (SHELL_TOOLS.has(exec.name)) {
      const command = commandOf(exec.name, args)
      if (command === '') return null
      // PowerShell 的删除命令与路径形态和 POSIX 不同，单独判。
      return exec.name === 'pwsh' ? inspectPowerShell(command) : inspectShell(command, base)
    }
    if (WRITE_TOOLS.has(exec.name)) {
      for (const target of writeTargets(exec.name, args, base)) {
        const hit = protectedPath(normalize(resolve(cwd, target)), base, false)
        if (hit !== null) return hit
      }
    }
    return null
  }

  /**
   * 带 IO 的异步判定：额外穿透符号链接，避免用链接绕过保护路径。
   * @param {{ name: string, arguments?: any }} exec
   * @param {string} cwd
   * @returns {Promise<{ rule: string, detail: string, command?: string } | null>}
   */
  async function judgeAsync(exec, cwd) {
    const hit = judgeSync(exec, cwd)
    if (hit !== null) return hit
    const base = env(cwd)
    // 删除目标要穿透符号链接再判一次：`rm -rf link/` 删的是链接指向的内容，
    // 只看字面路径挡不住这种绕行。
    if (SHELL_TOOLS.has(exec.name)) {
      const command = commandOf(exec.name, exec.arguments ?? {})
      for (const target of command === '' ? [] : deleteTargets(command, base)) {
        const real = await realTarget(target.path)
        const kind = criticalKind(real, base)
        if (kind !== null) return { rule: 'critical-path-delete', detail: `danger-guard: 删除 ${kind}：${real}`, command }
        const guarded = protectedFileKind(real, base)
        if (guarded !== null) return { rule: 'protected-path-delete', detail: `danger-guard: 删除${guarded}：${real}`, command }
      }
      return null
    }
    if (!WRITE_TOOLS.has(exec.name)) return null
    const realCwd = await realTarget(cwd)
    const baseForWrite = env(realCwd)
    for (const target of writeTargets(exec.name, exec.arguments ?? {}, baseForWrite)) {
      const path = await realTarget(normalize(resolve(cwd, target)))
      const guarded = protectedPath(path, baseForWrite, false)
      if (guarded !== null) return guarded
    }
    return null
  }

  /** 判定并记录；guard 与 pre-execute 共用。 */
  async function judgeAndRecord(exec, cwd, layer) {
    const hit = await judgeAsync(exec, cwd)
    if (hit === null) return null
    audit.record({
      kind: 'deny',
      layer,
      rule: hit.rule,
      detail: hit.detail,
      command: hit.command,
      tool: exec.name,
      session: exec.agent?.session?.id,
    })
    return hit
  }

  /**
   * 拒绝时回给模型的理由。
   *
   * 用户主动点「拒绝」时不需要多说，他自己知道上下文；
   * 但无人值守（`never` 策略 / 没有应答者）时必须讲明白「为什么没得弹」和
   * 「接下来怎么办」——否则模型会以为只是普通失败，换个写法反复重试。
   * @param {string} detail
   * @param {string} outcome
   * @returns {string}
   */
  function deniedReason(detail) {
    // 没法从 outcome 区分「用户点了拒绝」和「策略是 never」——两种都返回 rejected。
    // 所以措辞要对两种情况都成立，重点是别让模型把它当普通失败反复重试。
    return `${detail}｜如果确实需要执行：由用户手动执行，或在会询问审批的会话里重试；`
      + '不要在同一会话里反复尝试同一条命令，也不要改写规避。'
  }

  /** 从工具调用里取命令原文，只用于审计展示。 */
  function commandOfJudge(exec) {
    const args = exec?.arguments
    return typeof args?.command === 'string' ? args.command : undefined
  }

  /**
   * 向用户要一次授权。只有 `allowed-once` 才放行。
   * approval 服务缺失、策略为 never、用户拒绝、取消、或请求本身失败，全部按拒绝处理。
   * @param {any} exec
   * @param {{ rule: string, detail: string }} hit
   * @returns {Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>}
   */
  async function requestApproval(exec, hit) {
    let approval
    try {
      approval = ctx.get('approval')
    } catch {
      approval = undefined
    }
    audit.status.approvalAvailable = typeof approval?.request === 'function'
    if (approval === undefined || exec.agent === undefined) {
      audit.status.approvalSkip = approval === undefined ? 'no-service' : 'no-agent'
      return 'unavailable'
    }
    try {
      audit.status.lastApprovalRequestedAt = new Date().toISOString()
      const outcome = await approval.request({
        agent: exec.agent,
        toolName: exec.name,
        callId: exec.callId,
        reason: hit.detail,
        // 弹窗里给人看的文案：指出具体风险，而不是只报规则名。
        displayReason: {
          en: hit.detail,
          zh: hit.detail,
        },
        signal: exec.signal,
      })
      audit.status.lastApprovalOutcome = outcome
      if (outcome !== 'allowed-once') {
        audit.record({
          kind: 'refused',
          layer: 'pre-execute',
          rule: hit.rule,
          detail: `${hit.detail}（未批准：${outcome}）`,
          command: commandOfJudge(exec),
          tool: exec.name,
          session: exec.agent?.session?.id,
        })
        return outcome
      }
      approved.add(exec)
      audit.record({
        kind: 'approved',
        layer: 'pre-execute',
        rule: hit.rule,
        detail: `${hit.detail}（用户已批准本次）`,
        command: commandOfJudge(exec),
        tool: exec.name,
        session: exec.agent?.session?.id,
      })
      return 'allowed-once'
    } catch (error) {
      // 没有打开的 turn、审计写入失败等：按拒绝处理（fail closed）。
      audit.status.lastApprovalError = String(error?.message ?? error)
      safeLog(ctx, 'warn', `claude-code-mode: danger-guard approval failed: ${String(error)}`)
      return 'unavailable'
    }
  }

  // 1. 同步 guard：审批之后的最后一道闸，只做无 IO 判定。
  const tools = ctx.get('tools')
  if (typeof tools?.guard === 'function') {
    audit.status.guards += 1
    audit.status.listeners.push('tools.guard')
    disposers.push(tools.guard((exec) => {
      // 用户在 pre-execute 阶段已经为这一次调用授权过。
      if (approved.has(exec)) return undefined
      try {
        const session = exec.agent?.session
        const cwd = knownCwd.get(session) ?? session?.header?.cwd ?? process.cwd()
        const hit = judgeSync({ name: exec.name, arguments: exec.arguments }, cwd)
        if (hit !== null) {
          audit.record({
            kind: 'deny',
            layer: 'guard',
            rule: hit.rule,
            detail: hit.detail,
            command: hit.command,
            tool: exec.name,
            session: session?.id,
          })
          return hit.detail
        }
        return undefined
      } catch (error) {
        audit.record({ kind: 'error', detail: INTERNAL_FAILURE, error: String(error), tool: exec.name })
        return INTERNAL_FAILURE
      }
    }))
  }

  // 2. 前置判定（异步，补符号链接与会话 cwd）。
  //
  // 顺序怎么保证：cordis 的 `prepend` 是 unshift，**后注册者排在前面**，而事件表
  // 只有数组顺序、没有优先级字段。auto-review 在本插件之后加载，它的 prepend 会把
  // 我们挤到后面，于是「我们拒绝」之前会先花掉一次模型调用。
  //
  // 这里不靠"等一拍"这种时序运气，而是用 cordis 自己的 `internal/listener` 扩展点：
  // 每次有插件往 `tools/pre-execute` 注册监听器都会触发它。收到通知后我们重新
  // dispose + prepend 一次，把自己顶回链首。两个细节决定它成立：
  //   - `internal/listener` 在 register 的 unshift **之前**触发，所以重排要放到
  //     `queueMicrotask` 里，等对方的 unshift 落定（这是确定的执行语义，不是调度运气）；
  //   - 已经在链首就不再重排，否则会自激成死循环。
  //
  // 命中硬规则时直接返回 deny，waterfall 短路整条链（cordis 原文：
  // "a listener that does not call next() vetoes the rest of the chain"），
  // auto-review 根本不会被调用 —— 这才是 Claude 里「硬规则拒绝后分类器不参与」。
  const preExecute = async function dangerGuardPreExecute(exec, next) {
    try {
      const session = exec?.agent?.session
      if (session !== undefined) {
        const cwd = await sessionCwd(exec.agent, exec.signal)
        knownCwd.set(session, cwd)
        const hit = await judgeAndRecord({ name: exec.name, arguments: exec.arguments, agent: exec.agent }, cwd, 'pre-execute')
        if (hit !== null) {
          // 命中硬规则：先给用户一次明确的裁决机会。
          // 批准只对这次调用有效；无人值守（never 策略）时服务会直接拒绝。
          audit.status.approvalPhase = 'before'
          const outcome = await requestApproval(exec, hit)
          audit.status.approvalPhase = outcome === 'allowed-once' ? 'allowed' : 'refused'
          if (outcome === 'allowed-once') return next()
          return {
            kind: 'deny',
            reason: deniedReason(hit.detail),
            info: { name: 'DangerGuardDeniedError', code: 'DANGER_GUARD_DENIED' },
          }
        }
      }
    } catch (error) {
      audit.status.lastPreExecuteError = String(error?.message ?? error)
      /* 异步判定失败时留给同步 guard 兜底 */
    }
    // 判定通过才把控制权交给后面的监听器（auto-review）。
    return next()
  }

  /** ctx.on 会用 reflect.bind 包一层，身份比较不可靠，改比函数名。 */
  const FRONT_NAMES = new Set(['dangerGuardPreExecute', 'bound dangerGuardPreExecute'])
  const chainOf = () => {
    try {
      const hooks = ctx.root?.events?._hooks?.['tools/pre-execute']
      return Array.isArray(hooks) ? hooks : []
    } catch {
      return []
    }
  }
  /**
   * 能不能读到事件链。读不到（框架内部结构变了）时不重排：
   * 否则 atFront 永远为 false，每次通知都重排，重排又触发通知，会死循环。
   */
  const canInspect = () => {
    try {
      return Array.isArray(ctx.root?.events?._hooks?.['tools/pre-execute'])
    } catch {
      return false
    }
  }
  const atFront = () => {
    const hooks = chainOf()
    return hooks.length > 0 && FRONT_NAMES.has(String(hooks[0]?.callback?.name ?? ''))
  }

  let frontDispose = null
  let reordering = false
  /**
   * 已卸载标志。`stabilize` 是排队执行的（queueMicrotask），如果卸载正好发生在
   * 「别人注册 → 排队重排 → 我们卸载」之间，排队的重排还会把监听器重新装回去。
   * 关掉开关后仍然被拦就是这个原因，所以这里必须显式拦一道。
   */
  let disposed = false
  const swapFront = () => {
    try {
      frontDispose?.()
    } catch {
      /* 旧注册已释放 */
    }
    frontDispose = ctx.on('tools/pre-execute', preExecute, { prepend: true })
    if (!audit.status.listeners.includes('tools/pre-execute')) audit.status.listeners.push('tools/pre-execute')
    audit.status.front = atFront()
    audit.status.chain = chainOf().length
    audit.status.chainInfo = describeChain(ctx.root ?? ctx, 'tools/pre-execute', preExecute)
  }
  const stabilize = () => {
    if (disposed) return
    // 读不到链就只保留首次注册，不做相对顺序的重排。
    if (!canInspect()) return
    if (reordering || atFront()) return
    reordering = true
    try {
      swapFront()
    } catch (error) {
      safeLog(ctx, 'warn', `claude-code-mode: danger-guard cannot register pre-execute: ${String(error)}`)
    } finally {
      reordering = false
    }
  }

  // 立即注册，不漏判任何调用；后续有人插队时再顶回链首。
  try {
    swapFront()
  } catch (error) {
    safeLog(ctx, 'warn', `claude-code-mode: danger-guard initial registration failed: ${String(error)}`)
  }
  disposers.push(() => {
    try {
      frontDispose?.()
    } catch {
      /* ignore */
    }
  })

  // 根上下文才能观察到全部注册（子上下文会漏）。
  const rootCtx = ctx.root ?? ctx
  let offInternal = null
  try {
    offInternal = rootCtx.on('internal/listener', (name) => {
      if (name === 'tools/pre-execute') queueMicrotask(stabilize)
    })
  } catch (error) {
    safeLog(ctx, 'warn', `claude-code-mode: danger-guard cannot watch listener order: ${String(error)}`)
  }
  if (offInternal !== null) disposers.push(offInternal)

  // 3. fs 原语：同步抛出即拒绝，与 fs-observation-policy 同一形态。
  const fsGuard = (verb) => async (target, actor, next) => {
    try {
      const display = normalize(String(target?.displayPath ?? ''))
      if (display === '' || !display.startsWith('/')) return next()
      const session = actor?.agent?.session
      const cwd = knownCwd.get(session) ?? session?.header?.cwd ?? process.cwd()
      const base = env(await realTarget(cwd))
      const real = await realTarget(display)
      const hit = verb === 'delete'
        ? inspectShell(`rm -rf ${shellQuote(real)}`, base)
        : protectedPath(real, base, false)
      const reason = hit === null ? null : hit.detail
      if (reason !== null) {
        audit.record({ kind: 'deny', layer: `fs-${verb}`, rule: hit?.rule ?? `fs-${verb}`, detail: reason, path: display, session: session?.id })
        throw Object.assign(new Error(reason), { code: 'DANGER_GUARD_DENIED' })
      }
    } catch (error) {
      if (error?.code === 'DANGER_GUARD_DENIED') throw error
      audit.record({ kind: 'error', detail: INTERNAL_FAILURE, error: String(error) })
      throw Object.assign(new Error(INTERNAL_FAILURE), { code: 'DANGER_GUARD_DENIED' })
    }
    return next()
  }
  for (const [event, verb] of [['fs/write-intent', 'write'], ['fs/edit-intent', 'edit'], ['fs/delete-intent', 'delete']]) {
    try {
      disposers.push(ctx.on(event, fsGuard(verb)))
      audit.status.listeners.push(event)
    } catch (error) {
      safeLog(ctx, 'warn', `claude-code-mode: danger-guard cannot listen ${event}: ${String(error)}`)
    }
  }

  audit.status.installed = true
  safeLog(ctx, 'info', `claude-code-mode: danger-guard enabled (guards=${audit.status.guards}, listeners=${audit.status.listeners.join(',')})`)

  return () => {
    disposed = true
    audit.dispose()
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 逐个列出事件链上的监听器及其来源（诊断用，帮助确认我们与 auto-review 的相对位置）。
 * @param {any} ctx
 * @param {string} event
 * @param {Function} self 我们自己的监听器，用于标记
 * @returns {{ index: number, source: string, self: boolean }[]}
 */
function describeChain(ctx, event, self) {
  try {
    const hooks = ctx.events?._hooks?.[event]
    if (!Array.isArray(hooks)) return []
    return hooks.map((hook, index) => {
      let source = 'unknown'
      try {
        const fiber = hook?.ctx?.fiber
        source = fiber?.name ?? fiber?.runtime?.name ?? hook?.ctx?.name ?? hook?.name ?? 'unknown'
      } catch {
        /* 来源读不到不影响诊断 */
      }
      // ctx.on 会用 reflect.bind 包一层，原函数身份比较不可靠，改比函数名。
      const name = String(hook?.callback?.name ?? '')
      const isSelf = name === self?.name || name === `bound ${self?.name}`
      return { index, source: String(source), self: isSelf }
    })
  } catch {
    return []
  }
}

/**
 * 事件链上当前注册了多少监听器（诊断用）。
 * @param {any} ctx
 * @param {string} event
 * @returns {number}
 */
function chainLength(ctx, event) {
  try {
    const hooks = ctx.events?._hooks?.[event]
    return Array.isArray(hooks) ? hooks.length : -1
  } catch {
    return -1
  }
}

/**
 * 我们的监听器是否排在事件链第一个（诊断用）。
 * @param {any} ctx
 * @param {string} event
 * @param {Function} callback
 * @returns {boolean}
 */
function isFirstListener(ctx, event, callback) {
  try {
    const hooks = ctx.events?._hooks?.[event]
    if (!Array.isArray(hooks)) return false
    const name = String(hooks[0]?.callback?.name ?? '')
    return name === callback?.name || name === `bound ${callback?.name}`
  } catch {
    return false
  }
}

/**
 * 取一次写类工具会写到哪些路径。
 * @param {string} name
 * @param {any} args
 * @param {{ home: string, cwd: string }} env
 * @returns {string[]}
 */
function writeTargets(name, args, env) {
  if (name === 'apply_patch') {
    const input = typeof args?.input === 'string' ? args.input : ''
    const found = []
    for (const match of input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gmu)) found.push(match[1].trim())
    for (const match of input.matchAll(/^\*\*\* Move to: (.+)$/gmu)) found.push(match[1].trim())
    return found
  }
  const filePath = typeof args?.file_path === 'string' ? args.file_path : undefined
  if (filePath === undefined) return []
  const resolved = resolvePath(filePath, env)
  return resolved === null ? [filePath] : [resolved]
}

/**
 * 写路径是否落在保护范围。返回理由或 null。
 * @param {string} path 绝对路径
 * @param {{ home: string, cwd: string, protectedPaths?: string[] }} env
 * @param {boolean} deleting
 * @returns {{ rule: string, detail: string } | null}
 */
function protectedPath(path, env, deleting) {
  for (const name of HOME_PROTECTED_FILES) {
    const absolute = `${env.home}/${name}`
    if (path === absolute || path.startsWith(`${absolute}/`)) {
      return { rule: 'protected-path-write', detail: `danger-guard: ${deleting ? '删除' : '写入'}受保护配置 ~/${name}：${path}` }
    }
  }
  if (path.startsWith(`${env.cwd}/`)) {
    const head = path.slice(env.cwd.length + 1).split('/')[0]
    if (PROJECT_PROTECTED.includes(head)) {
      return { rule: 'protected-path-write', detail: `danger-guard: ${deleting ? '删除' : '写入'}项目内受保护路径 ${head}：${path}` }
    }
  }
  for (const root of env.protectedPaths ?? []) {
    if (path === root || path.startsWith(`${root}/`)) return { rule: 'protected-path', detail: `danger-guard: 受保护路径 ${root}` }
  }
  return null
}

/**
 * 取一条命令文本：bash 用 `command`，终端类工具用 `input`。
 * @param {string} name
 * @param {any} args
 * @returns {string}
 */
function commandOf(name, args) {
  if (typeof args?.command === 'string') return args.command
  if (name === 'terminal_send' && typeof args?.input === 'string') return args.input
  return ''
}

/** 把路径包成单引号，供内部再解析一次。 */
function shellQuote(value) {
  return `'${String(value).replace(/'/gu, `'\\''`)}'`
}