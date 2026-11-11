import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveConfig } from '../../src/host/features/mcp-tool-search/config.js'
import { VisibilityStore } from '../../src/host/features/mcp-tool-search/visibility.js'

const MCP_TOOLS = ['mcp__fake__echo', 'mcp__fake__add', 'mcp__fake__inspect_macho']

function createCatalog(names = MCP_TOOLS) {
  const byName = new Map(names.map((name) => [name, { name, description: name, server: 'fake' }]))
  return {
    get size() {
      return byName.size
    },
    manages: (name) => byName.has(name),
    nameSnapshot: () => new Set(byName.keys()),
    hasAny: () => byName.size > 0,
    everHadTools: byName.size > 0,
  }
}

function createAgent(id = 'session-1', header) {
  return {
    id,
    session: {
      requestHeader: () => header,
    },
  }
}

function createToolSet(agent, { builtin = [['read', { name: 'read' }]] } = {}) {
  let disposeCalls = 0
  const visible = new Map([
    ...builtin,
    ...MCP_TOOLS.map((name) => [name, { name }]),
  ])
  return {
    get disposeCalls() {
      return disposeCalls
    },
    dispose() {
      disposeCalls += 1
    },
    view(scope) {
      return scope === agent ? visible : visible
    },
  }
}

function storeFor(catalog, rawConfig = {}) {
  return new VisibilityStore({
    catalog,
    config: resolveConfig({ enabled: true, ...rawConfig }),
  })
}

test('new session keeps only built-in tools visible', () => {
  const agent = createAgent()
  const catalog = createCatalog()
  const visibility = storeFor(catalog)
  const wrapped = visibility.wrapToolSet(agent, createToolSet(agent))
  const view = wrapped.view(agent)

  assert.deepEqual([...view.keys()], ['read'])
  assert.equal(view.has('mcp__fake__echo'), false)
})

test('preload is visible before any search', () => {
  const agent = createAgent()
  const visibility = storeFor(createCatalog(), { preload: ['mcp__fake__echo'] })
  const view = visibility.wrapToolSet(agent, createToolSet(agent)).view(agent)

  assert.equal(view.has('mcp__fake__echo'), true)
  assert.equal(view.has('mcp__fake__add'), false)
})

test('resumed session restores MCP tools from the last request header', () => {
  const agent = createAgent('session-resumed', {
    tools: [{ name: 'mcp__fake__inspect_macho' }, { name: 'read' }, { name: 'mcp__other__x' }],
  })
  const visibility = storeFor(createCatalog())
  const view = visibility.wrapToolSet(agent, createToolSet(agent)).view(agent)

  assert.equal(view.has('mcp__fake__inspect_macho'), true)
  assert.equal(view.has('mcp__fake__echo'), false)
  assert.equal(visibility.hiddenCount(agent), 2)
})

test('activation affects the next step and only adds managed names', () => {
  const agent = createAgent()
  const visibility = storeFor(createCatalog())

  assert.deepEqual(visibility.activate(agent, ['mcp__fake__echo', 'mcp__other__x', 'read']), ['mcp__fake__echo'])
  assert.deepEqual(visibility.activate(agent, ['mcp__fake__echo']), [])

  const view = visibility.wrapToolSet(agent, createToolSet(agent)).view(agent)
  assert.equal(view.has('mcp__fake__echo'), true)
  assert.equal(view.has('mcp__fake__add'), false)
  assert.equal(visibility.isActive(agent, 'mcp__fake__echo'), true)
  assert.equal(visibility.activeCount(agent), 1)
})

test('maxActiveTools caps new activations without unloading existing tools', () => {
  const agent = createAgent()
  const visibility = storeFor(createCatalog(), { maxActiveTools: 2 })
  visibility.activate(agent, ['mcp__fake__echo'])

  const added = visibility.activate(agent, ['mcp__fake__add', 'mcp__fake__inspect_macho'])
  assert.deepEqual(added, ['mcp__fake__add'])
  assert.equal(visibility.activeCount(agent), 2)
  assert.equal(visibility.isActive(agent, 'mcp__fake__inspect_macho'), false)
})

test('other scopes are never filtered', () => {
  const agent = createAgent()
  const other = createAgent('session-other')
  const original = createToolSet(agent)
  const view = storeFor(createCatalog()).wrapToolSet(agent, original).view(other)

  assert.equal(view.has('mcp__fake__echo'), true)
})

test('wrapper keeps dispose semantics and returns the original set when no MCP tools exist', () => {
  const agent = createAgent()
  const original = createToolSet(agent)
  const wrapped = storeFor(createCatalog()).wrapToolSet(agent, original)
  wrapped.dispose()
  wrapped.dispose()
  assert.equal(original.disposeCalls, 2)

  const empty = createToolSet(agent)
  assert.equal(storeFor(createCatalog([])).wrapToolSet(agent, empty), empty)
})

test('states are isolated per agent and cleared on delete', () => {
  const first = createAgent('session-a')
  const second = createAgent('session-b')
  const visibility = storeFor(createCatalog())
  visibility.activate(first, ['mcp__fake__echo'])

  assert.equal(visibility.isActive(first, 'mcp__fake__echo'), true)
  assert.equal(visibility.isActive(second, 'mcp__fake__echo'), false)

  visibility.delete('session-a')
  assert.equal(visibility.isActive(first, 'mcp__fake__echo'), false)
})