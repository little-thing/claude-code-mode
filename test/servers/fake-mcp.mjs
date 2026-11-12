#!/usr/bin/env node
/** 测试用 MCP server：纯 JSON-RPC over stdio，不引任何依赖。
 *
 * 用途：在隔离 profile 里验证 `dsh-mcp-client` + `mcp-tool-search` 的
 * “首轮不加载、搜索后下一步可调用”契约，不依赖真实 REA server。
 */

import { createInterface } from 'node:readline'

const SERVER_INFO = { name: 'fake-mcp', version: '0.0.1' }

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo the given text back. Useful for connectivity checks and deterministic tests.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo back.' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'add',
    description: 'Add two numbers and return the sum.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
      additionalProperties: false,
    },
  },
  {
    name: 'inspect_macho',
    description: 'Inspect a Mach-O binary: headers, load commands, segments, symbols, and code signatures.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path to a Mach-O file.' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'decompile',
    description: 'Decompile a function or an entire binary into readable pseudo-code using the native decompiler.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        functionName: { type: 'string', description: 'Optional function to decompile.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'take_screenshot',
    description: 'Open a URL in a browser and capture a full-page screenshot.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories under a path.',
    inputSchema: {
      type: 'object',
      properties: { dir: { type: 'string' } },
      required: ['dir'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_file',
    description: 'Read a text file from disk.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_files',
    description: 'Search file contents for a regular expression.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, root: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'localize_strings',
    description: '提取并本地化应用内的字符串资源（中文界面文案）。',
    inputSchema: {
      type: 'object',
      properties: { locale: { type: 'string' } },
      required: ['locale'],
      additionalProperties: false,
    },
  },
  {
    name: 'extract_apk',
    description: 'Extract an Android APK and list its manifest components.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'network_capture',
    description: 'Capture HTTP traffic while loading a URL.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'hash_file',
    description: 'Compute SHA-256 for a file.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
]

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]))

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function textResult(text) {
  return {
    content: [{ type: 'text', text }],
    isError: false,
  }
}

function callTool(name, args) {
  const tool = TOOL_BY_NAME.get(name)
  if (tool === undefined) throw new Error(`unknown tool: ${name}`)

  switch (name) {
    case 'echo':
      return textResult(`echo:${String(args?.text ?? '')}`)
    case 'add':
      return textResult(String(Number(args?.a ?? 0) + Number(args?.b ?? 0)))
    case 'localize_strings':
      return textResult(`localized:${String(args?.locale ?? '')}`)
    default:
      return textResult(`${name}:${JSON.stringify(args ?? {})}`)
  }
}

function handle(message) {
  if (message === null || typeof message !== 'object') return
  const { id, method, params } = message

  // 通知没有 id，不需要响应。
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return
  if (typeof method !== 'string') return

  try {
    switch (method) {
      case 'initialize':
        send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: 'Fake MCP server for DSH tests. Prefer echo for verification.',
          },
        })
        return
      case 'ping':
        send({ jsonrpc: '2.0', id, result: {} })
        return
      case 'tools/list':
        send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
        return
      case 'tools/call': {
        const name = typeof params?.name === 'string' ? params.name : ''
        send({ jsonrpc: '2.0', id, result: callTool(name, params?.arguments) })
        return
      }
      default:
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } })
    }
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: String(error?.message ?? error) },
    })
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', (line) => {
  const text = line.trim()
  if (text === '') return
  try {
    handle(JSON.parse(text))
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: `parse error: ${String(error?.message ?? error)}` },
    })
  }
})