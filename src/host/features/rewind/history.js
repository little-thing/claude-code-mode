/** 回退的模型历史裁剪：按「节点代表的原始事件」判断范围，并保证工具调用配对完整。
 *
 * 背景：DSH 的会话日志是 append-only，回退不改日志，只在模型侧把回退范围内的消息
 * 从下一次请求里剔除。这里有两个必须守住的约束：
 *
 * 1. **范围按逻辑身份算，不按节点 seq 算。** 上下文压缩（tool-result-pruner）会把
 *    早期的 tool/result 原地替换成一条新事件，新事件的 seq 在日志末尾。如果按节点
 *    自己的 seq 判断，一条第 1 轮的检索结果会被当成「第 21 轮末尾的消息」删掉，而它
 *    对应的 assistant tool_call 还留着——DeepSeek 适配器会直接拒绝整轮请求
 *    （`tool calls need immediate results`）。替换副本的身份是 `surfaceOp.startSeq`
 *    到 `surfaceOp.endSeq`（单节点替换时两者相等），以及更权威的
 *    `sourceEventSeqs`：DSH 要求 replace 事件列全被遮蔽的 surface 节点，可能跨越
 *    多次压缩，所以这里要递归展开到最初的 append 事件。
 *
 * 2. **裁剪后必须闭合工具调用。** 用户可能正好回退到一轮工具调用中间，或结果晚于
 *    锚点落盘。裁剪会留下没有结果的 assistant tool_call，同样会让请求失败。这里把
 *    这些 tool-call block 从 assistant 消息里剔掉（不伪造工具结果）；剔空则丢弃整条。
 *    反向的孤立 tool_result（调用被回退掉、结果还在）也一并丢弃，否则适配器会报
 *    `tool result has no matching call`。
 */

/** 替换副本的 surfaceOp 形状（与 DSH `@deepseek-ai/dsh-session` 的 SurfaceOp 一致）。 */
function replacementOp(event) {
  const op = event?.surfaceOp
  if (op === undefined || op === null || op === 'append') return null
  return typeof op === 'object' ? op : null
}

/**
 * 一个事件代表的原始事件 seq（用于回退范围判断）。普通 append 事件代表自身；
 * 替换副本代表被它遮蔽的 surface 节点，递归展开到最初的 append 事件。
 * @param {any} event
 * @param {number} seq
 * @param {(seq: number) => any} [eventOf] 取任意 seq 的事件；缺省时只按副本声明的区间展开一层
 * @returns {Set<number>}
 */
export function logicalSources(event, seq, eventOf) {
  const sources = new Set()
  collectSources(event, seq, typeof eventOf === 'function' ? eventOf : null, sources, new Set())
  return sources
}

/**
 * @param {any} event
 * @param {number} seq
 * @param {((seq: number) => any) | null} eventOf
 * @param {Set<number>} out
 * @param {Set<number>} seen
 */
function collectSources(event, seq, eventOf, out, seen) {
  if (seen.has(seq)) return
  seen.add(seq)
  const op = replacementOp(event)
  const shadowed = op === null ? null : shadowedSeqs(op)
  if (shadowed === null) {
    out.add(seq)
    return
  }
  for (const source of shadowed) {
    if (source === seq) continue
    collectSources(eventOf === null ? undefined : eventOf(source), source, eventOf, out, seen)
  }
}

/**
 * 替换副本遮蔽的 surface 节点 seq。优先用 `sourceEventSeqs`（DSH 保证包含全部被遮蔽
 * 节点）；旧日志没有该字段时退回 `startSeq..endSeq` 区间。
 * @param {{ startSeq?: unknown, endSeq?: unknown, op?: unknown }} op
 * @returns {number[] | null}
 */
function shadowedSeqs(op) {
  const declared = op.sourceEventSeqs
  if (Array.isArray(declared)) {
    const seqs = declared.filter((value) => Number.isSafeInteger(value) && value >= 0)
    if (seqs.length > 0) return seqs
  }
  const start = Number(op.startSeq)
  const end = Number(op.endSeq)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  const seqs = []
  for (let value = lo; value <= hi; value += 1) seqs.push(value)
  return seqs.length === 0 ? null : seqs
}

/**
 * 节点是否落在任一仍生效的回退范围内（含边界）。
 * @param {Set<number>} sources
 * @param {{ anchorSeq: number, endSeq: number, undone?: boolean }} record
 * @returns {boolean}
 */
export function overlapsRewind(sources, record) {
  if (record === undefined || record === null || record.undone === true) return false
  const anchor = Number(record.anchorSeq)
  const end = Number(record.endSeq)
  if (!Number.isSafeInteger(anchor) || !Number.isSafeInteger(end)) return false
  for (const seq of sources) {
    if (seq >= anchor && seq <= end) return true
  }
  return false
}

/**
 * 按回退范围裁剪模型历史。没有仍生效的回退记录时返回 null，调用方应走原生
 * `deriveMessages()`（保留它自己的增量缓存）。
 * @param {{ nodes: Iterable<number>, eventOf: (seq: number) => any, messageOf: (event: any) => any, records: any[] }} input
 * @returns {any[] | null}
 */
export function rewindMessages({ nodes, eventOf, messageOf, records }) {
  const active = (records ?? []).filter((record) => record !== undefined && record !== null && record.undone !== true)
  if (active.length === 0) return null
  const kept = []
  for (const seq of nodes) {
    const event = eventOf(seq)
    if (event === undefined || event === null) continue
    const sources = logicalSources(event, seq, eventOf)
    if (active.some((record) => overlapsRewind(sources, record))) continue
    const message = messageOf(event)
    if (message !== null && message !== undefined) kept.push(message)
  }
  return dropDanglingToolCalls(kept)
}

/**
 * 保证 assistant 的 tool-call 与 tool 结果成对：
 * - 没有结果的 tool-call block 从 assistant 消息里剔除，剔除后内容为空则丢弃该消息；
 * - 没有对应调用的 tool 结果整条丢弃（适配器对「孤立结果」同样是硬错误）。
 * 没有需要修复的消息时原样返回输入里的消息对象，不破坏 DSH 的消息身份缓存。
 * @param {any[]} messages
 * @returns {any[]}
 */
export function dropDanglingToolCalls(messages) {
  const out = []
  /** @type {{ message: any, missing: Set<string>, results: any[] } | null} */
  let pending = null

  const flush = () => {
    if (pending === null) return
    const { message, missing, results } = pending
    pending = null
    if (missing.size === 0) {
      out.push(message)
    } else {
      const content = (message.content ?? []).filter(
        (block) => !(block?.type === 'tool-call' && typeof block.id === 'string' && missing.has(block.id)),
      )
      // 剔空的 assistant 消息不再进入请求：它只剩被回退掉的工具调用。
      if (content.length > 0) out.push({ ...message, content })
    }
    // 结果必须排在它回答的 assistant 消息之后；只有匹配到保留调用的结果才会进 results。
    out.push(...results)
  }

  for (const message of messages) {
    if (message?.role === 'assistant') {
      flush()
      const ids = new Set()
      for (const block of message.content ?? []) {
        if (block?.type === 'tool-call' && typeof block.id === 'string') ids.add(block.id)
      }
      if (ids.size === 0) {
        out.push(message)
        continue
      }
      pending = { message, missing: ids, results: [] }
    } else if (message?.role === 'tool') {
      const id = toolCallIdOf(message)
      // 没有等待中的 assistant，或 id 不匹配：这条结果在裁剪后没有调用可回答，丢弃。
      if (pending !== null && id !== undefined && pending.missing.delete(id)) pending.results.push(message)
    } else {
      flush()
      out.push(message)
    }
  }
  flush()
  return out
}

/**
 * 回退末尾的安全对齐：如果回退范围内有 assistant 发出了工具调用、但结果没有一起落盘，
 * 就把末尾收缩到那次调用之前，避免主动切出一对残缺的调用/结果（例如用户在一轮工具
 * 执行中途点回退、并行工具结果晚于锚点）。
 * @param {readonly any[]} events 按 seq 连续的事件数组
 * @param {number} anchorSeq
 * @param {number} endSeq
 * @returns {number}
 */
export function alignRewindEnd(events, anchorSeq, endSeq) {
  if (!Array.isArray(events) || events.length === 0) return endSeq
  const last = Math.min(endSeq, events.length - 1)
  /** @type {Map<string, number>} callId -> assistant seq */
  const pending = new Map()
  for (let seq = 0; seq <= last; seq += 1) {
    const event = events[seq]
    if (event === undefined || event === null) continue
    if (event.type === 'assistant/message') {
      for (const block of event.data?.message?.content ?? []) {
        if (block?.type === 'tool-call' && typeof block.id === 'string') pending.set(block.id, event.seq ?? seq)
      }
    } else if (event.type === 'tool/result') {
      pending.delete(toolCallIdOf(event.data?.message))
    }
  }
  // 只收缩「调用本身也在回退范围内」的情况；调用在锚点之前时，交给裁剪后的配对闭合兜底。
  let limit = endSeq
  for (const assistantSeq of pending.values()) {
    if (!Number.isSafeInteger(assistantSeq)) continue
    if (assistantSeq < anchorSeq) continue
    limit = Math.min(limit, assistantSeq - 1)
  }
  return Math.max(limit, anchorSeq)
}

function toolCallIdOf(message) {
  if (message === undefined || message === null) return undefined
  if (typeof message.toolCallId === 'string') return message.toolCallId
  const callId = message.source?.callId
  return typeof callId === 'string' ? callId : undefined
}
