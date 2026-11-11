import { readFile } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'

import { createSearchIndex, searchIndex, tokenize, compact } from '../../src/host/features/mcp-tool-search/search.js'

const tools = JSON.parse(await readFile(new URL('../fixtures/mcp-tools.json', import.meta.url), 'utf8'))
const entries = tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  server: tool.name.startsWith('mcp__') ? tool.name.slice(5).split('__')[0] : '',
}))
const index = createSearchIndex(entries)

test('tokenize splits snake_case, camelCase and CJK', () => {
  assert.deepEqual(tokenize('inspect_macho'), ['inspect', 'macho'])
  assert.deepEqual(tokenize('takeScreenshot'), ['take', 'screenshot'])
  assert.ok(tokenize('参数量化').includes('参数'))
  assert.ok(tokenize('参数量化').includes('量化'))
  assert.equal(compact('Mach-O / inspect_macho'), 'machoinspectmacho')
})

test('exact tool name ranks first', () => {
  const hits = searchIndex(index, 'mcp__rea__inspect_macho')
  assert.equal(hits[0].name, 'mcp__rea__inspect_macho')
})

test('capability query finds decompile and macho tools', () => {
  const names = searchIndex(index, 'decompile macho').map((hit) => hit.name)
  assert.ok(names.includes('mcp__rea__decompile'))
  assert.ok(names.includes('mcp__rea__inspect_macho'))
})

test('macho query still finds inspect_macho without the exact name', () => {
  const names = searchIndex(index, 'macho').map((hit) => hit.name)
  assert.equal(names[0], 'mcp__rea__inspect_macho')
})

test('server filter restricts results', () => {
  const hits = searchIndex(index, 'browser screenshot', { server: 'chrome' })
  assert.ok(hits.length > 0)
  assert.ok(hits.every((hit) => hit.server === 'chrome'))
})

test('limit is clamped', () => {
  const hits = searchIndex(index, 'binary', { limit: 2 })
  assert.ok(hits.length <= 2)
})

test('empty and blank queries return nothing', () => {
  assert.deepEqual(searchIndex(index, ''), [])
  assert.deepEqual(searchIndex(index, '   '), [])
})

test('CJK description is searchable', () => {
  const names = searchIndex(index, '本地化').map((hit) => hit.name)
  assert.ok(names.includes('mcp__rea__localize_strings'))
})

test('description is clipped for the model', () => {
  const longIndex = createSearchIndex([{ name: 'mcp__x__long', description: 'a'.repeat(400), server: 'x' }])
  const [hit] = searchIndex(longIndex, 'long')
  assert.ok(hit.description.length <= 240)
  assert.ok(hit.description.endsWith('…'))
})

test('ranking is deterministic', () => {
  const first = searchIndex(index, 'inspect').map((hit) => hit.name)
  const second = searchIndex(index, 'inspect').map((hit) => hit.name)
  assert.deepEqual(first, second)
})