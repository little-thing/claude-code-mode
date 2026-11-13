/* 回退历史裁剪测试：锁住「压缩替换副本不能按自身 seq 判定」与「工具调用必须闭合」。
 *
 * 这些用例来自一次真实故障：回退到 turn 20 时，endSeq 覆盖了上下文压缩刚写下的
 * 17 条 tool/result 替换副本；旧实现按副本自己的 seq 判断范围，把第 1 轮的结果删掉，
 * 而它对应的 assistant tool_call 还留着，DeepSeek 适配器在序列化阶段直接拒绝整轮
 * 请求（`DeepSeek Messages tool calls need immediate results`）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  alignRewindEnd,
  dropDanglingToolCalls,
  logicalSources,
  overlapsRewind,
  rewindMessages,
} from '../../src/host/features/rewind/history.js'

// -- 事件与消息构造 ---------------------------------------------------------

const user = (seq, text) => ({ seq, type: 'user/message', surfaceOp: 'append', data: { id: `u-${seq}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } })

const assistant = (seq, content) => ({ seq, type: 'assistant/message', surfaceOp: 'append', data: { message: { id: `a-${seq}`, role: 'assistant', source: { kind: 'model' }, content } } })

const toolCall = (id) => ({ type: 'tool-call', id, name: 'read', arguments: '{}' })

const toolResult = (seq, callId, replace) => ({
  seq,
  type: 'tool/result',
  surfaceOp: replace === undefined ? 'append' : { op: 'replace', startSeq: replace[0], endSeq: replace[1] },
  ...(replace === undefined ? {} : { sourceEventSeqs: replace[0] === replace[1] ? [replace[0]] : undefined }),
  data: { message: { id: `t-${seq}`, role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text: `result ${callId}` }], isError: false } },
})

const text = (value) => ({ type: 'text', text: value })

/** 建一个「索引 == seq」的事件数组，与 Session.eventAt / snapshotEvents 的约定一致。 */
function eventsAt(entries) {
  const events = []
  for (const [seq, event] of entries) events[seq] = event
  return events
}

/** 按 surface 语义折叠事件：replace 副本替换被遮蔽节点，append 追加到末尾。 */
function fold(events) {
  const nodes = []
  for (const event of events) {
    if (event === undefined) continue
    if (event.surfaceOp === 'append') {
      nodes.push(event.seq)
      continue
    }
    const start = nodes.indexOf(event.surfaceOp.startSeq)
    const end = nodes.indexOf(event.surfaceOp.endSeq)
    if (start === -1 || end === -1) continue
    nodes.splice(start, end - start + 1, event.seq)
  }
  return nodes
}

/**
 * 按 DeepSeek 适配器的规则校验配对：assistant 的每个 tool-call 必须被紧随其后的
 * tool 结果覆盖，且不允许出现孤立结果。
 * @param {any[]} messages
 */
function assertPaired(messages) {
  const pending = new Set()
  for (const message of messages) {
    if (message.role === 'assistant') {
      assert.equal(pending.size, 0, `assistant 前的调用未闭合: ${[...pending].join(',')}`)
      for (const block of message.content ?? []) {
        if (block.type === 'tool-call') pending.add(block.id)
      }
    } else if (message.role === 'tool') {
      assert.ok(pending.delete(message.toolCallId), `孤立 tool 结果: ${message.toolCallId}`)
    } else {
      assert.equal(pending.size, 0, `普通消息前的调用未闭合: ${[...pending].join(',')}`)
    }
  }
  assert.equal(pending.size, 0, `历史末尾有未闭合调用: ${[...pending].join(',')}`)
}

/** 跑一次裁剪并返回消息数组。 */
function derive(events, nodes, records) {
  const messages = rewindMessages({
    nodes,
    eventOf: (seq) => events[seq],
    messageOf: (event) => event?.data?.message ?? event?.data ?? null,
    records,
  })
  assert.ok(Array.isArray(messages), '有生效回退记录时不应返回 null')
  return messages
}

const ids = (messages) => messages.map((message) => message.id)

// -- 用例 -------------------------------------------------------------------

test('压缩替换副本按原始 seq 判断，不会误删早期结果', () => {
  // 早期一轮工具调用：assistant(1) -> tool(2)；压缩把 seq 2 原地替换成 seq 20 的副本。
  const events = eventsAt([
    [0, user(0, '看看仓库')],
    [1, assistant(1, [toolCall('call-1')])],
    [2, toolResult(2, 'call-1')],
    [3, user(3, '继续')],
    [4, assistant(4, [text('好的')])],
    [10, user(10, 'turn 20 的问题')],
    [11, assistant(11, [text('回答')])],
    [12, user(12, 'turn 21 的问题')],
    [13, assistant(13, [text('回答')])],
    [20, toolResult(20, 'call-1', [2, 2])],
  ])
  const nodes = fold(events)
  // 替换副本在原位（seq 20 的节点出现在早期位置），节点 seq 不再单调。
  assert.deepEqual(nodes, [0, 1, 20, 3, 4, 10, 11, 12, 13])

  // 回退到 seq 10（turn 20 的用户消息），区间覆盖压缩副本自己的 seq 20。
  const messages = derive(events, nodes, [{ anchorSeq: 10, endSeq: 20, undone: false }])

  // 早期的调用与结果都要保留，且顺序配对；turn 20 之后的消息整体消失。
  assert.deepEqual(ids(messages), ['u-0', 'a-1', 't-20', 'u-3', 'a-4'])
  assertPaired(messages)
})

test('链式替换会递归解析到最初的 append 事件', () => {
  // 副本 30 遮蔽原始结果 seq 2，副本 40 又遮蔽副本 30。
  const events = eventsAt([
    [0, user(0, '问题')],
    [1, assistant(1, [toolCall('call-1')])],
    [2, toolResult(2, 'call-1')],
    [30, toolResult(30, 'call-1', [2, 2])],
    [40, toolResult(40, 'call-1', [30, 30])],
  ])
  assert.deepEqual(fold(events), [0, 1, 40])

  const sources = logicalSources(events[40], 40, (seq) => events[seq])
  assert.deepEqual([...sources], [2])
  assert.equal(overlapsRewind(sources, { anchorSeq: 10, endSeq: 40, undone: false }), false)

  const messages = derive(events, [0, 1, 40], [{ anchorSeq: 10, endSeq: 40 }])
  assert.deepEqual(ids(messages), ['u-0', 'a-1', 't-40'])
  assertPaired(messages)
})

test('回退跨越工具调用：调用在锚点之前、结果在范围内被删时剔除悬空调用', () => {
  // assistant(1) 的调用结果被搬到了回退范围内（seq 11 也是结果节点）。
  const events = eventsAt([
    [0, user(0, '问题')],
    [1, assistant(1, [toolCall('call-1')])],
    [10, user(10, 'turn 2')],
    [11, toolResult(11, 'call-1')],
    [12, assistant(12, [text('回答')])],
  ])
  const messages = derive(events, [0, 1, 10, 11, 12], [{ anchorSeq: 10, endSeq: 12 }])
  // 调用还在但结果被裁掉 → 调用块剔除后内容为空，整条 assistant 消息丢弃。
  assert.deepEqual(ids(messages), ['u-0'])
  assertPaired(messages)
})

test('回退保留调用、删掉结果时，assistant 的文本块仍然保留', () => {
  const events = eventsAt([
    [0, user(0, '问题')],
    [1, assistant(1, [text('我先查一下'), toolCall('call-1')])],
    [2, toolResult(2, 'call-1')],
    [10, user(10, 'turn 2')],
    [11, toolResult(11, 'call-1')],
  ])
  const messages = derive(events, [0, 1, 10, 11], [{ anchorSeq: 10, endSeq: 11 }])
  assert.deepEqual(ids(messages), ['u-0', 'a-1'])
  assert.deepEqual(messages[1].content, [text('我先查一下')])
  assertPaired(messages)
})

test('孤立 tool 结果被丢弃', () => {
  const events = eventsAt([
    [0, user(0, '问题')],
    [10, assistant(10, [toolCall('call-1')])],
    [11, toolResult(11, 'call-1')],
    [12, user(12, 'turn 3')],
  ])
  // 只删掉发出调用的那条 assistant 消息，结果保留在 surface 上。
  const messages = derive(events, [0, 10, 11, 12], [{ anchorSeq: 10, endSeq: 10 }])
  assert.deepEqual(ids(messages), ['u-0', 'u-12'])
  assertPaired(messages)
})

test('回退范围内的消息整体不进入历史', () => {
  const events = eventsAt([
    [0, user(0, '问题')],
    [1, assistant(1, [text('回答')])],
    [10, user(10, 'turn 2')],
    [11, assistant(11, [text('回答')])],
    [12, user(12, 'turn 3')],
    [13, assistant(13, [text('回答')])],
  ])
  const messages = derive(events, [0, 1, 10, 11, 12, 13], [{ anchorSeq: 10, endSeq: 13 }])
  assert.deepEqual(ids(messages), ['u-0', 'a-1'])
})

test('undo 过的记录不参与裁剪', () => {
  const events = eventsAt([
    [0, user(0, '问题')],
    [1, assistant(1, [text('回答')])],
    [2, user(2, 'turn 2')],
  ])
  // 唯一一条记录已撤销 → 等同于没有记录，交给原生 deriveMessages。
  const messages = rewindMessages({
    nodes: [0, 1, 2],
    eventOf: (seq) => events[seq],
    messageOf: (event) => event?.data?.message ?? event?.data ?? null,
    records: [{ anchorSeq: 2, endSeq: 2, undone: true }],
  })
  assert.equal(messages, null)
})

test('没有生效记录时返回 null，交给原生 deriveMessages', () => {
  const events = eventsAt([[0, user(0, '问题')], [1, assistant(1, [text('回答')])]])
  const messages = rewindMessages({
    nodes: [0, 1],
    eventOf: (seq) => events[seq],
    messageOf: (event) => event?.data?.message ?? event?.data ?? null,
    records: [],
  })
  assert.equal(messages, null)
})

test('dropDanglingToolCalls 保留完整消息对象身份', () => {
  const message = { id: 'a-1', role: 'assistant', source: { kind: 'model' }, content: [toolCall('call-1')] }
  const result = { id: 't-2', role: 'tool', source: { kind: 'tool', callId: 'call-1' }, toolCallId: 'call-1', content: [text('ok')] }
  const out = dropDanglingToolCalls([message, result])
  assert.equal(out[0], message)
  assert.equal(out[1], result)
})

test('alignRewindEnd 把未闭合调用之前的末尾收缩掉', () => {
  const events = eventsAt([
    [0, user(0, '问题')],
    [1, assistant(1, [toolCall('call-1')])],
    [2, toolResult(2, 'call-1')],
    [10, user(10, 'turn 2')],
    [11, assistant(11, [toolCall('call-2')])],
  ])
  // 结果还没落盘：末尾收缩到 assistant(11) 之前。
  assert.equal(alignRewindEnd(events, 10, 11), 10)

  // 结果落盘后不收缩。
  events[11] = toolResult(11, 'call-2')
  assert.equal(alignRewindEnd(events, 10, 11), 11)

  // 调用在锚点之前时不收缩，交给裁剪后的配对闭合兜底。
  events[12] = user(12, 'turn 3')
  assert.equal(alignRewindEnd(events, 12, 12), 12)
})

test('alignRewindEnd 不会把区间收缩到锚点之前', () => {
  const events = eventsAt([
    [10, user(10, 'turn 2')],
    [11, assistant(11, [toolCall('call-1')])],
  ])
  assert.equal(alignRewindEnd(events, 10, 11), 10)
})
