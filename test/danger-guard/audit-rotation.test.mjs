/* 审计文件轮转：这个文件曾经只追加、从不清理，越用越大。 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, stat, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installAudit } from '../../src/host/features/danger-guard/audit.js'

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

/** 造一个最小可用的 ctx：installAudit 只用到 logger 与路由注册。 */
function fakeContext(home) {
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const server = { get() {}, post() {} }
  const ctx = {
    logger: { info() {}, warn() {} },
    get(name) { return name === 'webServer' ? server : undefined },
  }
  return {
    ctx,
    restore() {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    },
  }
}

test('审计文件超过上限后只保留最近若干条', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-audit-'))
  const file = join(home, 'claude-code-mode', 'danger-guard.jsonl')
  await writeFile(`${file}.seed`, '').catch(() => {})

  // 预置一个超大文件：直接写到远超 512KB。
  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(home, 'claude-code-mode'), { recursive: true })
  const rows = Array.from({ length: 12000 }, (_, index) => JSON.stringify({ at: new Date().toISOString(), kind: 'deny', n: index }))
  await writeFile(file, `${rows.join('\n')}\n`, 'utf8')
  const before = await stat(file)
  assert.ok(before.size > 512 * 1024, '预置文件应超过上限')

  const { ctx, restore } = fakeContext(home)
  try {
    const audit = installAudit(ctx)
    // 攒够 50 次写入才会触发一次检查，这里直接驱动 record。
    for (let index = 0; index < 60; index += 1) {
      audit.record({ kind: 'deny', layer: 'test', rule: 'r', detail: 'd' })
    }
    // 等写链跑完
    for (let index = 0; index < 40; index += 1) await settle()

    const after = await stat(file)
    assert.ok(after.size < before.size, '轮转后文件应变小')

    const lines = (await readFile(file, 'utf8')).trimEnd().split('\n')
    // 轮转保留 500 条，之后再写的（不足一个检查周期，最多 50 条）会继续追加。
    assert.ok(lines.length <= 560, `轮转后应只保留最近 500 条出头，实际 ${lines.length}`)
    // 最后一条是刚写进去的
    assert.match(lines[lines.length - 1], /"rule":"r"/u)
    audit.dispose()
  } finally {
    restore()
  }
})
