import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_CONFIG, resolveConfig } from '../../src/host/features/mcp-tool-search/config.js'

test('defaults are disabled with the documented tool name', () => {
  const config = resolveConfig(undefined)
  assert.equal(config.enabled, false)
  assert.equal(config.toolName, DEFAULT_CONFIG.toolName)
  assert.equal(config.maxResults, 8)
  assert.deepEqual(config.preload, [])
})

test('boolean shorthand enables the feature', () => {
  assert.equal(resolveConfig(true).enabled, true)
  assert.equal(resolveConfig(false).enabled, false)
})

test('preload is de-duplicated and trimmed', () => {
  const config = resolveConfig({ enabled: true, preload: [' mcp__a__x ', 'mcp__a__x', ''] })
  assert.deepEqual(config.preload, ['mcp__a__x'])
  assert.equal(config.preloadSet.has('mcp__a__x'), true)
})

test('exclude accepts strings and RegExp', () => {
  const config = resolveConfig({ enabled: true, exclude: ['foo', /bar/g] })
  assert.equal(config.excludeRes.length, 2)
  assert.equal(config.excludeRes[0].test('foo'), true)
  assert.equal(config.excludeRes[1].test('bar'), true)
  assert.equal(config.excludeRes[1].test('bar'), true)
})

test('invalid values throw', () => {
  assert.throws(() => resolveConfig({ include: '(' }), /regular expression/)
  assert.throws(() => resolveConfig({ maxResults: 0 }), /maxResults/)
  assert.throws(() => resolveConfig({ maxResults: 21 }), /maxResults/)
  assert.throws(() => resolveConfig({ toolName: 'run_code' }), /reserved/)
  assert.throws(() => resolveConfig({ preload: 'mcp__a__x' }), /array/)
})

test('tool name stays within the function-name contract', () => {
  const config = resolveConfig({ enabled: true, toolName: 'mcp_tool_search' })
  assert.equal(config.toolName, 'mcp_tool_search')
  assert.throws(() => resolveConfig({ toolName: 'a'.repeat(65) }), /toolName/)
})