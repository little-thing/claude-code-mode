/** MCP 工具目录：从 ctx.tools.definitions() 里收集模型可见的 MCP 工具。
 *
 * 只保存 name / description / server，不保存 inputSchema —— 延迟加载的意义就是
 * 不把这些 schema 常驻进上下文。
 */

import { createSearchIndex, searchIndex } from './search.js'

/** 单条描述进入索引的上限，避免某个超大 description 撑爆索引。 */
const MAX_INDEX_DESCRIPTION = 4096

/**
 * 清理描述：去控制字符、压空白、截断。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeDescription(value) {
  if (typeof value !== 'string') return ''
  const text = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > MAX_INDEX_DESCRIPTION ? `${text.slice(0, MAX_INDEX_DESCRIPTION - 1)}…` : text
}

/**
 * 从 `mcp__<server>__<tool>` 取 server 名；只用于展示和筛选，调用不依赖它。
 * @param {string} name
 * @returns {string}
 */
export function serverOf(name) {
  if (typeof name !== 'string' || !name.startsWith('mcp__')) return ''
  const rest = name.slice(5)
  const index = rest.indexOf('__')
  return index === -1 ? '' : rest.slice(0, index)
}

/** MCP 工具目录。 */
export class ToolCatalog {
  /**
   * @param {{
   *   definitions: () => Iterable<any>,
   *   config: ReturnType<import('./config.js').resolveConfig>,
   *   logger?: any,
   * }} options
   */
  constructor({ definitions, config, logger }) {
    this.definitions = typeof definitions === 'function' ? definitions : () => []
    this.config = config
    this.logger = logger
    /** @type {Array<{ name: string, description: string, server: string }>} */
    this.entries = []
    /** @type {Map<string, { name: string, description: string, server: string }>} */
    this.byName = new Map()
    this.index = createSearchIndex([])
    this.version = 0
    /** 一旦有过 MCP 工具就粘住，避免 server 临时挂掉导致搜索工具从 header 消失。 */
    this.everHadTools = false
  }

  /** 从工具注册表重建目录。 */
  refresh() {
    const next = []
    let source
    try {
      source = this.definitions()
    } catch (error) {
      this.logger?.warn?.(`[mcp-tool-search] cannot read tool definitions: ${String(error)}`)
      source = []
    }

    for (const definition of source ?? []) {
      if (definition === null || typeof definition !== 'object') continue
      const name = definition.name
      if (typeof name !== 'string' || name === '') continue
      if (name === this.config.toolName) continue
      // 已经是 deferred 的工具由别的机制负责；这里再接管只会让它永远不可见。
      if (definition.deferLoading === true) continue
      if (!this.config.includeRe.test(name)) continue
      if (this.config.excludeRes.some((matcher) => matcher.test(name))) continue

      next.push({
        name,
        description: normalizeDescription(definition.description),
        server: serverOf(name),
      })
    }

    next.sort((left, right) => left.name.localeCompare(right.name))
    const previousSize = this.entries.length
    this.entries = next
    this.byName = new Map(next.map((entry) => [entry.name, entry]))
    this.index = createSearchIndex(next)
    this.version += 1
    if (next.length > 0) this.everHadTools = true

    if (previousSize !== next.length) {
      this.logger?.info?.(`[mcp-tool-search] catalog: ${next.length} MCP tool(s) from ${this.servers().length} server(s)`)
    }
  }

  /** @returns {boolean} */
  hasAny() {
    return this.entries.length > 0
  }

  /** @returns {number} */
  get size() {
    return this.entries.length
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  manages(name) {
    return this.byName.has(name)
  }

  /** 当前目录的 name 快照；每个 step 抓一份，避免中途 refresh 改变过滤结果。 */
  nameSnapshot() {
    return new Set(this.byName.keys())
  }

  /** @returns {string[]} */
  servers() {
    return [...new Set(this.entries.map((entry) => entry.server).filter((server) => server !== ''))]
  }

  /**
   * @param {string} query
   * @param {{ limit?: number, server?: string }} [options]
   * @returns {Array<{ name: string, description: string, server: string }>}
   */
  search(query, options = {}) {
    return searchIndex(this.index, query, options)
  }
}