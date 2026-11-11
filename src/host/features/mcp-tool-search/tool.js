/** 模型可见的 MCP 工具搜索入口：mcp_tool_search。
 *
 * 工具本身只返回 name + 截断描述，并把命中项加入当前 session 的 active 集合；
 * 完整的 inputSchema 会在下一步通过 ResolvedToolSet 过滤后才进入请求。
 */

import { formatSearchResult } from './format.js'

/** 搜索结果里单条匹配的 canonical 形状。 */
const MATCH_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    server: { type: 'string' },
  },
  required: ['name', 'description'],
  additionalProperties: false,
}

/** 工具返回值的 canonical schema。 */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    matches: { type: 'array', items: MATCH_SCHEMA },
    activated: { type: 'array', items: { type: 'string' } },
    hidden: { type: 'integer' },
    total: { type: 'integer' },
    limitReached: { type: 'boolean' },
  },
  required: ['query', 'matches', 'activated', 'hidden', 'total', 'limitReached'],
  additionalProperties: false,
}

/**
 * @param {{
 *   catalog: any,
 *   visibility: any,
 *   config: ReturnType<import('./config.js').resolveConfig>,
 * }} options
 * @returns {any}
 */
export function createSearchTool({ catalog, visibility, config }) {
  return {
    name: config.toolName,
    description:
      'Search and load deferred MCP tools. MCP tools are not listed in your toolset until you search for them. '
      + 'Call this before using any tool whose name starts with "mcp__". Matching tools become callable on the '
      + 'next step. Query with capability keywords, not exact names only.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          description: 'Capability keywords, for example "decompile macho", "browser screenshot", or "extract apk".',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Maximum number of matching tools to load. Defaults to 8.',
        },
        server: {
          type: 'string',
          description: 'Optional MCP server name filter, for example "rea".',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render(_args, value) {
        return [{ type: 'text', text: formatSearchResult(value) }]
      },
    },
    presentCall(args) {
      const query = args !== null && typeof args === 'object' && typeof args.query === 'string' ? args.query : ''
      return {
        card: 'generic',
        title: `Search MCP tools: ${query}`,
        kind: 'search',
        rawInput: { query },
      }
    },
    /**
     * @param {unknown} args
     * @param {{ agent?: any }} exec
     * @returns {Promise<any>}
     */
    async execute(args, exec) {
      const agent = exec?.agent
      if (agent === undefined || agent === null) throw new Error(`${config.toolName} requires an active agent session`)

      const query = args !== null && typeof args === 'object' && typeof args.query === 'string'
        ? args.query.trim()
        : ''
      const requestedLimit = args !== null && typeof args === 'object' && Number.isInteger(args.limit)
        ? args.limit
        : config.maxResults
      const limit = Math.min(20, Math.max(1, requestedLimit))
      const server = args !== null && typeof args === 'object' && typeof args.server === 'string' && args.server.trim() !== ''
        ? args.server.trim()
        : undefined

      const matches = query === '' ? [] : catalog.search(query, { limit, server })
      const alreadyActive = matches.filter((match) => visibility.isActive(agent, match.name)).length
      const activated = visibility.activate(agent, matches.map((match) => match.name))
      // maxActiveTools 只限制新激活数量：还有未激活的命中项时才算触顶。
      const limitReached = config.maxActiveTools > 0
        && activated.length < matches.length - alreadyActive

      return {
        query,
        matches: matches.map((match) => ({
          name: match.name,
          description: match.description,
          ...(match.server === '' ? {} : { server: match.server }),
        })),
        activated,
        hidden: visibility.hiddenCount(agent),
        total: catalog.size,
        limitReached,
      }
    },
  }
}