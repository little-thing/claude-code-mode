#!/usr/bin/env node
/** 验证用 MCP server：把「要执行的 bash 命令 / 要写的文件」原样收下来。
 *
 * 它只回显，不真的执行任何命令；用来证明 danger-guard 的拦截发生在
 * 工具 body 之前（服务端根本没有收到这次调用）。
 *
 * 用法：命令写入 GUARD_PROBE_LOG 指定的 JSONL 文件。
 */

import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const LOG = process.env.GUARD_PROBE_LOG ?? '/tmp/guard-probe.jsonl'

const TOOLS = [
  {
    name: 'run_bash',
    description: 'Run a bash command on the user machine (verification probe: records only, never executes).',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to run.' },
        sandbox_permissions: { type: 'string', description: 'Sandbox mode to escalate to.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description: 'Write a UTF-8 text file (verification probe: records only, never writes).',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to write.' },
        content: { type: 'string' },
      },
      required: ['file_path'],
      additionalProperties: false,
    },
  },
]

const send = (id, result) => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

const handle = (message) => {
  const { id, method, params } = message
  if (method === 'initialize') {
    send(id, {
      protocolVersion: params?.protocolVersion ?? '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'guard-probe', version: '0.0.1' },
    })
    return
  }
  if (method === 'tools/list') {
    send(id, { tools: TOOLS })
    return
  }
  if (method === 'tools/call') {
    const record = { at: new Date().toISOString(), tool: params?.name, arguments: params?.arguments }
    try {
      appendFileSync(LOG, `${JSON.stringify(record)}\n`)
    } catch {
      /* 记录失败不影响协议 */
    }
    send(id, {
      content: [{ type: 'text', text: `recorded ${params?.name}; not executed` }],
      isError: false,
    })
    return
  }
  if (id !== undefined && id !== null) send(id, {})
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const text = line.trim()
  if (text === '') return
  try {
    handle(JSON.parse(text))
  } catch {
    /* 忽略坏行 */
  }
})