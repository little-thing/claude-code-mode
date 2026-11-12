/** 每个 session 的 MCP 工具可见性。
 *
 * active 集合决定哪些 `mcp__*` 能进入当前 step 的 ResolvedToolSet。新会话只放行
 * preload；恢复会话从最后一次 request/header 恢复已经加载过的工具；搜索命中后
 * 只增不减，避免 deepseek 的 addition-only 路线遇到中途 tool-removal。
 */

/** 每个 agent 一份可见性状态。 */
export class VisibilityStore {
  /**
   * @param {{
   *   catalog: any,
   *   config: ReturnType<import('./config.js').resolveConfig>,
   *   logger?: any,
   * }} options
   */
  constructor({ catalog, config, logger }) {
    this.catalog = catalog
    this.config = config
    this.logger = logger
    /** @type {Map<string, { agent: any, active: Set<string> }>} */
    this.states = new Map()
  }

  /**
   * 取/建一个 agent 的可见性状态。
   * @param {any} agent
   * @returns {{ agent: any, active: Set<string> } | null}
   */
  ensure(agent) {
    if (agent === null || typeof agent !== 'object') return null
    const id = agent.id
    if (typeof id !== 'string' || id === '') return null

    const existing = this.states.get(id)
    if (existing !== undefined) return existing

    const active = new Set(this.config.preload)
    let header
    try {
      header = agent.session?.requestHeader?.()
    } catch (error) {
      this.logger?.warn?.(`[mcp-tool-search] cannot read request header for ${id}: ${String(error)}`)
    }
    for (const tool of header?.tools ?? []) {
      if (typeof tool?.name === 'string' && this.catalog.manages(tool.name)) active.add(tool.name)
    }

    const state = { agent, active }
    this.states.set(id, state)
    return state
  }

  /**
   * 搜索命中后激活工具；只增不减。
   * `maxActiveTools > 0` 时只限制新激活数量，不卸载已有工具。
   * @param {any} agent
   * @param {string[]} names
   * @returns {string[]} 本次新激活的名字
   */
  activate(agent, names) {
    const state = this.ensure(agent)
    if (state === null) return []
    const limit = this.config.maxActiveTools
    const added = []
    for (const name of names) {
      if (typeof name !== 'string' || !this.catalog.manages(name)) continue
      if (state.active.has(name)) continue
      if (limit > 0 && state.active.size >= limit) continue
      state.active.add(name)
      added.push(name)
    }
    if (added.length > 0) {
      this.logger?.debug?.(`[mcp-tool-search] session ${agent.id}: activated ${added.join(', ')}`)
    }
    return added
  }

  /**
   * 当前会话已经加载的 MCP 工具数量（含 preload）。
   * @param {any} agent
   * @returns {number}
   */
  activeCount(agent) {
    const state = this.ensure(agent)
    return state === null ? 0 : state.active.size
  }

  /**
   * 某个 MCP 工具是否已经对当前会话可见。
   * @param {any} agent
   * @param {string} name
   * @returns {boolean}
   */
  isActive(agent, name) {
    const state = this.ensure(agent)
    return state === null ? false : state.active.has(name)
  }

  /**
   * 当前会话还有多少已注册 MCP 工具未加载。
   * @param {any} [agent]
   * @returns {number}
   */
  hiddenCount(agent) {
    if (agent === undefined || agent === null) {
      let count = 0
      for (const name of this.catalog.nameSnapshot()) {
        if (!this.config.preloadSet.has(name)) count += 1
      }
      return count
    }
    const state = this.ensure(agent)
    if (state === null) return 0
    let count = 0
    for (const name of this.catalog.nameSnapshot()) {
      if (!state.active.has(name)) count += 1
    }
    return count
  }

  /**
   * 包装一个 step 的 ResolvedToolSet：`view()` 里只留下未管理的工具和已激活的 MCP 工具。
   * 其它作用域、空视图、无 MCP 目录时原样返回，保证没有 MCP 的 profile 行为不变。
   * @param {any} agent
   * @param {any} toolSet
   * @returns {any}
   */
  wrapToolSet(agent, toolSet) {
    if (toolSet === null || typeof toolSet !== 'object' || typeof toolSet.view !== 'function') return toolSet
    if (this.catalog.size === 0) return toolSet
    const state = this.ensure(agent)
    if (state === null) return toolSet

    // 快照：同一个 step 内 catalog refresh 不能让隐藏工具“漏”进来。
    const managed = this.catalog.nameSnapshot()

    return Object.freeze({
      dispose: () => toolSet.dispose(),
      view(scope) {
        const visible = toolSet.view(scope)
        if (scope !== agent || visible.size === 0) return visible

        let changed = false
        const kept = []
        for (const [name, definition] of visible) {
          if (managed.has(name) && !state.active.has(name)) {
            changed = true
            continue
          }
          kept.push([name, definition])
        }
        return changed ? new Map(kept) : visible
      },
    })
  }

  /**
   * @param {string} agentId
   */
  delete(agentId) {
    if (typeof agentId === 'string') this.states.delete(agentId)
  }

  /** 清空所有会话状态。 */
  clear() {
    this.states.clear()
  }
}