import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveConfig } from '../../src/host/features/mcp-tool-search/config.js'
import { normalizeDescription, serverOf, ToolCatalog } from '../../src/host/features/mcp-tool-search/catalog.js'

function catalogFor(definitions, rawConfig = {}) {
  return new ToolCatalog({
    definitions: () => definitions,
    config: resolveConfig({ enabled: true, ...rawConfig }),
  })
}

test('catalog keeps only matching MCP tools', () => {
  const catalog = catalogFor([
    { name: 'read', description: 'Read a file' },
    { name: 'mcp__rea__inspect_macho', description: 'Inspect Mach-O' },
    { name: 'mcp__rea__decompile', description: 'Decompile binary' },
    { name: 'mcp__rea__skipped', description: 'Skip me', deferLoading: true },
  ])
  catalog.refresh()
  assert.equal(catalog.size, 2)
  assert.equal(catalog.manages('mcp__rea__inspect_macho'), true)
  assert.equal(catalog.manages('mcp__rea__skipped'), false)
  assert.equal(catalog.manages('read'), false)
})

test('catalog honors exclude and the search tool name', () => {
  const catalog = catalogFor([
    { name: 'mcp__rea__inspect_macho', description: 'Inspect Mach-O' },
    { name: 'mcp__rea__decompile', description: 'Decompile binary' },
    { name: 'mcp_tool_search', description: 'Search' },
  ], { exclude: ['decompile$'] })
  catalog.refresh()
  assert.equal(catalog.size, 1)
  assert.equal(catalog.manages('mcp__rea__inspect_macho'), true)
})

test('catalog normalizes descriptions and parses servers', () => {
  const catalog = catalogFor([
    { name: 'mcp__rea__inspect_macho', description: ' line one\n\nline two \u0000 ' },
  ])
  catalog.refresh()
  assert.equal(catalog.entries[0].description, 'line one line two')
  assert.equal(catalog.entries[0].server, 'rea')
  assert.equal(serverOf('mcp__chrome__take_screenshot'), 'chrome')
  assert.equal(serverOf('read'), '')
})

test('catalog truncates huge descriptions', () => {
  const catalog = catalogFor([{ name: 'mcp__x__long', description: 'a'.repeat(9000) }])
  catalog.refresh()
  assert.ok(catalog.entries[0].description.length <= 4096)
  assert.ok(catalog.entries[0].description.endsWith('…'))
})

test('catalog refresh tracks additions and everHadTools', () => {
  let definitions = [{ name: 'read', description: 'Read a file' }]
  const catalog = new ToolCatalog({
    definitions: () => definitions,
    config: resolveConfig({ enabled: true }),
  })
  catalog.refresh()
  assert.equal(catalog.size, 0)
  assert.equal(catalog.everHadTools, false)

  definitions = [...definitions, { name: 'mcp__rea__inspect_macho', description: 'Inspect Mach-O' }]
  catalog.refresh()
  assert.equal(catalog.size, 1)
  assert.equal(catalog.everHadTools, true)
  assert.deepEqual(catalog.servers(), ['rea'])
})

test('normalizeDescription strips control characters', () => {
  assert.equal(normalizeDescription(' a \u0001 b \t c '), 'a b c')
  assert.equal(normalizeDescription(undefined), '')
})