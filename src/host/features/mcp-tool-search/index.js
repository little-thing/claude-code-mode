/** MCP 工具按需加载：不复制 MCP client，只在每个 step 的 toolSet 上过滤。
 *
 * 设计要点：
 *  - 连接/重连/调用仍由 DSH 内置的 `dsh-mcp-client` 负责；
 *  - 这里只维护 `mcp__*` 的目录和每个 session 的 active 集合；
 *  - 包装 `ctx.tools.resolve()`，让未激活的 MCP 工具不进 request/header；
 *  - `mcp_tool_search` 命中后把工具加入 active，下一步自然出现在 tools 里。
 *
 * 这样首轮不会带上 170 个 REA 工具的 schema，也不会依赖 `defer_loading`
 * （DSH 有该字段，但没有组件在搜索后生成 tool-addition）。
 */

import { originalOf } from '../../shared/cordis.js'
import { resolveConfig } from './config.js'
import { ToolCatalog } from './catalog.js'
import { VisibilityStore } from './visibility.js'
import { createSearchTool } from './tool.js'
import { createPromptSection } from './prompt.js'

/**
 * 安装功能；返回 teardown。
 * @param {any} ctx Cordis context，必须已有 tools 与 systemPrompt
 * @param {unknown} [rawConfig]
 * @returns {() => void}
 */
export function installMcpToolSearch(ctx, rawConfig = {}) {
  let config
  try {
    config = resolveConfig(rawConfig)
  } catch (error) {
    ctx.logger?.error?.(`[mcp-tool-search] invalid config: ${String(error)}`)
    return () => {}
  }
  if (!config.enabled) return () => {}

  if (typeof ctx.tools?.definitions !== 'function' || typeof ctx.tools?.register !== 'function'
    || typeof ctx.tools?.resolve !== 'function') {
    ctx.logger?.warn?.('[mcp-tool-search] tools service is missing definitions/register/resolve; feature disabled')
    return () => {}
  }

  /** @type {Array<() => void>} */
  const disposers = []
  const remember = (dispose) => {
    if (typeof dispose === 'function') disposers.push(dispose)
  }
  const cleanup = () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch (error) {
        ctx.logger?.warn?.(`[mcp-tool-search] teardown failed: ${String(error)}`)
      }
    }
  }

  const catalog = new ToolCatalog({
    definitions: () => ctx.tools.definitions(),
    config,
    logger: ctx.logger,
  })
  catalog.refresh()

  const visibility = new VisibilityStore({ catalog, config, logger: ctx.logger })

  if (typeof ctx.on === 'function') {
    remember(ctx.on('tools/change', () => {
      try {
        catalog.refresh()
      } catch (error) {
        ctx.logger?.warn?.(`[mcp-tool-search] catalog refresh failed: ${String(error)}`)
      }
    }))
    remember(ctx.on('agent/disposed', (payload) => {
      const agent = payload?.agent ?? payload
      if (typeof agent?.id === 'string') visibility.delete(agent.id)
    }))
  }

  if (config.hint && typeof ctx.systemPrompt?.section === 'function') {
    const baseOrder = typeof ctx.systemPrompt.getSectionOrder === 'function'
      ? ctx.systemPrompt.getSectionOrder('MCP_SERVERS')
      : undefined
    const order = Number.isFinite(baseOrder) ? baseOrder - 10 : 3090
    try {
      remember(ctx.systemPrompt.section(createPromptSection({ catalog, visibility, config, order })))
    } catch (error) {
      ctx.logger?.warn?.(`[mcp-tool-search] cannot register prompt hint: ${String(error)}`)
    }
  }

  try {
    remember(ctx.tools.register(createSearchTool({ catalog, visibility, config }), {
      // 没有 MCP 工具的 profile 完全不出现这个工具；一旦出现过就粘住，避免 server
      // 临时掉线时从 header 里移除工具触发 provider 的 tool-removal。
      when: () => catalog.hasAny() || catalog.everHadTools,
    }))
  } catch (error) {
    ctx.logger?.error?.(`[mcp-tool-search] cannot register "${config.toolName}": ${String(error)}`)
    cleanup()
    return () => {}
  }

  const service = originalOf(ctx.tools)
  const originalResolve = service?.resolve
  if (typeof originalResolve !== 'function') {
    ctx.logger?.warn?.('[mcp-tool-search] tools.resolve() is not available; feature disabled')
    cleanup()
    return () => {}
  }

  const hadOwnResolve = Object.hasOwn(service, 'resolve')
  const previousResolve = service.resolve
  const wrappedResolve = async function resolve(context) {
    const toolSet = await Reflect.apply(originalResolve, this, arguments)
    const agent = context?.agent
    if (agent === undefined || agent === null || toolSet === undefined) return toolSet
    return visibility.wrapToolSet(agent, toolSet)
  }

  service.resolve = wrappedResolve
  if (service.resolve !== wrappedResolve) {
    ctx.logger?.warn?.('[mcp-tool-search] cannot wrap tools.resolve(); feature disabled')
    cleanup()
    return () => {}
  }

  remember(() => {
    if (service.resolve !== wrappedResolve) return
    if (hadOwnResolve) service.resolve = previousResolve
    else delete service.resolve
  })

  ctx.logger?.info?.(
    `[mcp-tool-search] enabled: ${catalog.size} MCP tool(s) deferred; search tool "${config.toolName}"`,
  )

  return () => {
    cleanup()
    visibility.clear()
  }
}