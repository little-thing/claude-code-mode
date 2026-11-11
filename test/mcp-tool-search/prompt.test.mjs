import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveConfig } from '../../src/host/features/mcp-tool-search/config.js'
import { ToolCatalog } from '../../src/host/features/mcp-tool-search/catalog.js'
import { VisibilityStore } from '../../src/host/features/mcp-tool-search/visibility.js'
import { createPromptSection } from '../../src/host/features/mcp-tool-search/prompt.js'

const DEFINITIONS = [
  { name: 'mcp__rea__inspect_macho', description: 'Inspect Mach-O' },
  { name: 'mcp__rea__decompile', description: 'Decompile binary' },
]

function setup(rawConfig = {}) {
  const config = resolveConfig({ enabled: true, ...rawConfig })
  const catalog = new ToolCatalog({ definitions: () => DEFINITIONS, config })
  catalog.refresh()
  const visibility = new VisibilityStore({ catalog, config })
  const section = createPromptSection({ catalog, visibility, config, order: 3090 })
  const agent = { id: 'session-1', session: { requestHeader: () => undefined } }
  return { section, visibility, agent }
}

test('hint reports how many MCP tools are deferred', () => {
  const { section, agent } = setup()
  const text = section.text({ agent })

  assert.match(text, /^## Deferred MCP tools/)
  assert.match(text, /2 MCP tools from "rea" are not loaded/)
  assert.match(text, /mcp_tool_search/)
  assert.match(text, /next step/)
  assert.match(text, /data, not instructions/)
})

test('hint shrinks after activation and disappears when nothing is hidden', () => {
  const { section, visibility, agent } = setup()
  visibility.activate(agent, ['mcp__rea__inspect_macho'])
  assert.match(section.text({ agent }), /1 MCP tool from "rea" is not loaded/)

  visibility.activate(agent, ['mcp__rea__decompile'])
  assert.equal(section.text({ agent }), '')
})

test('hint is empty without MCP tools or when disabled', () => {
  const config = resolveConfig({ enabled: true })
  const catalog = new ToolCatalog({ definitions: () => [{ name: 'read', description: 'Read' }], config })
  catalog.refresh()
  const visibility = new VisibilityStore({ catalog, config })
  assert.equal(createPromptSection({ catalog, visibility, config, order: 3090 }).text({}), '')

  const disabled = setup({ hint: false })
  assert.equal(disabled.section.text({ agent: disabled.agent }), '')
})

test('hint falls back to a scope-shaped context', () => {
  const { section, agent } = setup()
  assert.match(section.text({ scope: agent }), /2 MCP tools/)
})