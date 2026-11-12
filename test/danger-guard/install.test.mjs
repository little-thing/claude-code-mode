/* 安装层测试：用 fake ctx 验证三处拦截点真的会拒绝。
 *
 * 这里锁的是「接线对不对」，而不是规则本身：
 *  - guard 在审批之后仍然拒绝（模拟用户已批准 `sandbox_permissions` 升权）；
 *  - pre-execute 返回 deny 且带结构化错误码，先于 auto-review；
 *  - fs 删除瀑布对关键路径抛错，守卫自身出错时关闭（抛错而不是放行）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { mkdtemp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as prefs from '../../src/host/features/preferences/index.js'
import { installDangerGuard } from '../../src/host/features/danger-guard/index.js'

/** 重排走 queueMicrotask，等它落定。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

/** 最小 fake ctx：记录消费者，支持 tools.guard / on / effect / logger。 */
function fakeContext(cwd) {
  const guards = []
  const listeners = new Map()
  const approvals = []
  const services = {
    tools: { guard: (guard) => { guards.push(guard); return () => guards.splice(guards.indexOf(guard), 1) } },
    workingDirectory: { ensure: async () => cwd },
    // 默认没有审批服务（等价 never 策略）：命中规则一律拒绝。
    approval: undefined,
  }
  const ctx = {
    logged: [],
    tools: services.tools,
    get: (key) => services[key],
    on: (event, listener) => {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    logger: { info: (message) => ctx.logged.push(message), warn: (message) => ctx.logged.push(message), debug: () => {} },
  }
  return { ctx, guards, listeners, approvals, services }
}

test('guard 在审批之后仍然拒绝危险删除', async () => {
  const { ctx, guards } = fakeContext('/tmp')
  const dispose = installDangerGuard(ctx, {})
  assert.equal(guards.length, 1)
  const session = { header: { cwd: '/tmp' }, id: 's1' }
  const reason = guards[0]({ name: 'bash', arguments: { command: `rm -rf ${homedir()}` }, agent: { session } })
  assert.match(String(reason), /^danger-guard: /u)
  dispose()
  assert.equal(guards.length, 0)
})

test('guard 对普通命令返回 undefined', async () => {
  const { ctx, guards } = fakeContext('/tmp')
  installDangerGuard(ctx, {})
  const session = { header: { cwd: '/tmp' }, id: 's1' }
  assert.equal(guards[0]({ name: 'bash', arguments: { command: 'git status' }, agent: { session } }), undefined)
})

test('后注册的监听器不会把前置守卫挤下去', async () => {
  const { ctx, listeners } = fakeContext('/tmp')
  // fake ctx 需要 root 与 events._hooks 才能跑链序自检；没有就跳过这条断言。
  installDangerGuard(ctx, {})
  await settle()
  const listener = listeners.get('tools/pre-execute')
  assert.equal(typeof listener, 'function', '前置守卫必须注册上')
})

test('pre-execute 返回 deny 且带结构化错误码', async () => {
  const { ctx, listeners } = fakeContext('/tmp/work')
  installDangerGuard(ctx, {})
  await settle()
  const listener = listeners.get('tools/pre-execute')
  assert.equal(typeof listener, 'function')
  let nextCalled = false
  const decision = await listener(
    { name: 'bash', arguments: { command: 'rm -rf ..', sandbox_permissions: 'danger-full-access' }, agent: { session: { header: { cwd: '/tmp/work' }, id: 's2' } }, signal: new AbortController().signal },
    async () => { nextCalled = true; return { kind: 'allow' } },
  )
  assert.equal(decision.kind, 'deny')
  assert.equal(decision.info.code, 'DANGER_GUARD_DENIED')
  assert.equal(nextCalled, false, '拒绝时不应继续往 auto-review 走')
})

test('pre-execute 对普通命令放行', async () => {
  const { ctx, listeners } = fakeContext('/tmp/work')
  installDangerGuard(ctx, {})
  await settle()
  const listener = listeners.get('tools/pre-execute')
  let nextCalled = false
  const decision = await listener(
    { name: 'bash', arguments: { command: 'pnpm test' }, agent: { session: { header: { cwd: '/tmp/work' }, id: 's3' } }, signal: new AbortController().signal },
    async () => { nextCalled = true; return { kind: 'allow' } },
  )
  assert.equal(decision.kind, 'allow')
  assert.equal(nextCalled, true)
})

test('fs 删除瀑布对家目录抛错', async () => {
  const { ctx, listeners } = fakeContext('/tmp')
  installDangerGuard(ctx, {})
  const listener = listeners.get('fs/delete-intent')
  await assert.rejects(
    () => listener({ displayPath: homedir(), targetKey: 'k' }, { agent: { session: { header: { cwd: '/tmp' }, id: 's4' } } }, async () => undefined),
    (error) => error.code === 'DANGER_GUARD_DENIED',
  )
})

test('fs 写入瀑布拦 .git 与 .zshrc', async () => {
  const { ctx, listeners } = fakeContext('/tmp/work')
  installDangerGuard(ctx, {})
  const listener = listeners.get('fs/write-intent')
  const actor = { agent: { session: { header: { cwd: '/tmp/work' }, id: 's5' } } }
  await assert.rejects(() => listener({ displayPath: '/tmp/work/.git/config' }, actor, async () => undefined), (error) => error.code === 'DANGER_GUARD_DENIED')
  await assert.rejects(() => listener({ displayPath: `${homedir()}/.zshrc` }, actor, async () => undefined), (error) => error.code === 'DANGER_GUARD_DENIED')
  assert.doesNotReject(() => listener({ displayPath: '/tmp/work/src/index.js' }, actor, async () => undefined))
})

test('删除目标穿透符号链接：rm -rf 指向家目录的链接会被拒', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'danger-link-'))
  const link = join(dir, 'home-link')
  await symlink(homedir(), link)
  const { ctx, listeners } = fakeContext(dir)
  installDangerGuard(ctx, {})
  await settle()
  const listener = listeners.get('tools/pre-execute')
  let nextCalled = false
  const decision = await listener(
    { name: 'bash', arguments: { command: 'rm -rf home-link' }, agent: { session: { header: { cwd: dir }, id: 's7' } }, signal: new AbortController().signal },
    async () => { nextCalled = true; return { kind: 'allow' } },
  )
  assert.equal(decision.kind, 'deny', '指向家目录的链接不应被当作普通路径放行')
  assert.equal(decision.info.code, 'DANGER_GUARD_DENIED')
  assert.equal(nextCalled, false)
})

test('只读命令带符号链接路径不能被误判为删除', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'danger-read-'))
  const link = join(dir, 'home-link')
  await symlink(homedir(), link)
  const { ctx, listeners } = fakeContext(dir)
  installDangerGuard(ctx, {})
  await settle()
  const listener = listeners.get('tools/pre-execute')
  for (const command of ['ls -ld home-link', 'readlink home-link', 'pwd; ls -la; readlink home-link']) {
    let nextCalled = false
    const decision = await listener(
      { name: 'bash', arguments: { command }, agent: { session: { header: { cwd: dir }, id: 's8' } }, signal: new AbortController().signal },
      async () => { nextCalled = true; return { kind: 'allow' } },
    )
    assert.equal(decision.kind, 'allow', `只读命令不应被拦：${command}`)
    assert.equal(nextCalled, true)
  }
})

test('符号链接绕不过保护路径', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'danger-guard-'))
  const link = join(dir, 'home-link')
  await symlink(homedir(), link)
  const { ctx, listeners } = fakeContext(dir)
  installDangerGuard(ctx, {})
  await settle()
  const listener = listeners.get('tools/pre-execute')
  const decision = await listener(
    { name: 'write', arguments: { file_path: join(link, '.zshrc'), content: 'x' }, agent: { session: { header: { cwd: dir }, id: 's6' } }, signal: new AbortController().signal },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(decision.kind, 'deny')
})

test('enabled: false 时不安装任何监听', () => {
  const { ctx, guards, listeners } = fakeContext('/tmp')
  installDangerGuard(ctx, { enabled: false })
  assert.equal(guards.length, 0)
  assert.equal(listeners.size, 0)
})

test('用户批准后放行本次调用，且只对这一次生效', async () => {
  const { ctx, listeners, services } = fakeContext('/tmp')
  const seen = []
  services.approval = {
    request: async (req) => { seen.push(req); return 'allowed-once' },
  }
  installDangerGuard(ctx, {})
  await settle()
  const listener = listeners.get('tools/pre-execute')
  const session = { header: { cwd: '/tmp' }, id: 's9' }
  let nextCalled = false
  const decision = await listener(
    { name: 'bash', arguments: { command: 'rm -rf ..' }, agent: { session }, signal: new AbortController().signal },
    async () => { nextCalled = true; return { kind: 'allow' } },
  )
  assert.equal(decision.kind, 'allow')
  assert.equal(nextCalled, true, '批准后应继续执行')
  assert.equal(seen.length, 1, '应发起一次审批')
  assert.match(String(seen[0].reason), /danger-guard/u)
})

test('用户拒绝时保持拒绝，理由只说规则本身', async () => {
  const { ctx, listeners, services } = fakeContext('/tmp')
  let calls = 0
  services.approval = { request: async () => { calls += 1; return 'rejected' } }
  installDangerGuard(ctx, {})
  await settle()
  const listener = listeners.get('tools/pre-execute')
  let nextCalled = false
  const decision = await listener(
    { name: 'bash', arguments: { command: 'rm -rf ..' }, agent: { session: { header: { cwd: '/tmp' }, id: 's10' } }, signal: new AbortController().signal },
    async () => { nextCalled = true; return { kind: 'allow' } },
  )
  assert.equal(decision.kind, 'deny')
  assert.equal(nextCalled, false)
  assert.equal(calls, 1)
  // 无论是用户点的拒绝还是策略拒绝，都要给出下一步怎么走。
  assert.match(decision.reason, /不要在同一会话里反复尝试/u)
})

test('无人值守时拒绝理由要说明原因和出路', async () => {
  const { ctx, listeners } = fakeContext('/tmp')
  installDangerGuard(ctx, {})
  await settle()
  const listener = listeners.get('tools/pre-execute')
  const decision = await listener(
    { name: 'bash', arguments: { command: 'rm -rf ..' }, agent: { session: { header: { cwd: '/tmp' }, id: 's13' } }, signal: new AbortController().signal },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(decision.kind, 'deny')
  // 模型不该把它当成普通失败去反复重试。
  assert.match(decision.reason, /手动执行/u)
  assert.match(decision.reason, /不要在同一会话里反复尝试/u)
})
