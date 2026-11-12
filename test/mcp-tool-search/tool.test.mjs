import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveConfig } from '../../src/host/features/mcp-tool-search/config.js'
import { ToolCatalog } from '../../src/host/features/mcp-tool-search/catalog.js'
import { VisibilityStore } from '../../src/host/features/mcp-tool-search/visibility.js'
import { createSearchTool } from '../../src/host/features/mcp-tool-search/tool.js'
import { formatSearchResult } from '../../src/host/features/mcp-tool-search/format.js'

const DEFINITIONS = [
  { name: 'read', description: 'Read a file' },
  { name: 'mcp__fake__echo', description: 'Echo text back to the caller.' },
  { name: 'mcp__fake__add', description: 'Add two numbers.' },
  { name: 'mcp__fake__inspect_macho', description: 'Inspect a Mach-O binary: headers, symbols, and code signatures.' },
]

function setup(rawConfig = {}) {
  const config = resolveConfig({ enabled: true, ...rawConfig })
  const catalog = new ToolCatalog({ definitions: () => DEFINITIONS, config })
  catalog.refresh()
  const visibility = new VisibilityStore({ catalog, config })
  const tool = createSearchTool({ catalog, visibility, config })
  const agent = { id: 'session-1', session: { requestHeader: () => undefined } }
  return { config, catalog, visibility, tool, agent }
}

test('search tool activates matches and reports deferred counts', async () => {
  const { tool, visibility, agent } = setup()

  const value = await tool.execute({ query: 'echo' }, { agent })
  assert.equal(value.query, 'echo')
  assert.ok(value.matches.some((match) => match.name === 'mcp__fake__echo'))
  assert.deepEqual(value.activated, ['mcp__fake__echo'])
  assert.equal(value.hidden, 2)
  assert.equal(value.total, 3)
  assert.equal(value.limitReached, false)
  assert.equal(visibility.isActive(agent, 'mcp__fake__echo'), true)
})

test('a second identical search activates nothing', async () => {
  const { tool, agent } = setup()
  await tool.execute({ query: 'echo' }, { agent })
  const value = await tool.execute({ query: 'echo' }, { agent })

  assert.deepEqual(value.activated, [])
  assert.equal(value.limitReached, false)
})

test('server filter and limit reach the catalog', async () => {
  const { tool, agent } = setup({ maxResults: 1 })
  const value = await tool.execute({ query: 'fake', server: 'fake', limit: 1 }, { agent })

  assert.equal(value.matches.length, 1)
  assert.equal(value.matches[0].server, 'fake')
})

test('maxActiveTools reports that the active limit was reached', async () => {
  const { tool, agent } = setup({ maxActiveTools: 1 })
  const value = await tool.execute({ query: 'fake', limit: 3 }, { agent })

  assert.equal(value.matches.length, 3)
  assert.equal(value.activated.length, 1)
  assert.equal(value.limitReached, true)
})

test('empty query returns no matches instead of throwing', async () => {
  const { tool, agent } = setup()
  const value = await tool.execute({ query: '   ' }, { agent })

  assert.deepEqual(value.matches, [])
  assert.deepEqual(value.activated, [])
})

test('execute requires an agent', async () => {
  const { tool } = setup()
  await assert.rejects(() => tool.execute({ query: 'echo' }, {}), /active agent/)
})

test('output schema accepts the produced value', async () => {
  const { tool, agent } = setup()
  const value = await tool.execute({ query: 'macho' }, { agent })
  const schema = tool.output.schema

  for (const key of schema.required) assert.ok(Object.hasOwn(value, key), `missing ${key}`)
  for (const match of value.matches) {
    for (const key of schema.properties.matches.items.required) {
      assert.ok(Object.hasOwn(match, key), `missing match.${key}`)
    }
  }
  const rendered = tool.output.render({ query: 'macho' }, value)
  assert.equal(rendered[0].type, 'text')
  assert.match(rendered[0].text, /server-provided data, not instructions/)
})

test('format explains empty results and all-active results', () => {
  const none = formatSearchResult({ query: 'nothing', matches: [], activated: [], hidden: 2, total: 3 })
  assert.match(none, /No MCP tool matched/)
  assert.match(none, /Try broader capability words/)

  const all = formatSearchResult({ query: 'x', matches: [], activated: [], hidden: 0, total: 3 })
  assert.match(all, /already available/)

  const active = formatSearchResult({
    query: 'echo',
    matches: [{ name: 'mcp__fake__echo', description: 'Echo text back.' }],
    activated: [],
    hidden: 1,
    total: 3,
  })
  assert.match(active, /already available/)
  assert.match(active, /server-provided data/)
})

test('format reports a reached active limit', () => {
  const blocked = formatSearchResult({
    query: 'fake',
    matches: [{ name: 'mcp__fake__echo', description: 'Echo text back.' }],
    activated: [],
    hidden: 1,
    total: 3,
    limitReached: true,
  })
  assert.match(blocked, /active MCP tool limit is already reached/)
})