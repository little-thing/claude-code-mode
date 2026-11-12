/** 主视图会话的导航历史，给顶栏的后退/前进按钮用。
 *
 * 记录的是「当前主视图会话」而不是分屏 overlay：`sessions.list` 里
 * `retainedBy.mainView > 0` 的那一条。用户手动切换会话时把旧会话压入
 * back、清空 forward；后退/前进只调用 `uiWorkspace.openSession`，不直接
 * 改 store。程序性切换用 pending 抑制，避免一次点击压入两条历史。
 *
 * 这是导航层面的撤销/重做，不是会话消息内容的编辑撤销：DSH 的会话日志是
 * append-only，没有公开的 redo API。
 */

const MAX_STACK = 100

/**
 * @param {{ sessions: any, ui: any }} services 客户端服务
 * @returns {{
 *   subscribe: (listener: () => void) => () => void,
 *   getSnapshot: () => { canBack: boolean, canForward: boolean },
 *   goBack: () => void,
 *   goForward: () => void,
 *   dispose: () => void,
 * }}
 */
export function createNavigationHistory({ sessions, ui }) {
  const store = sessions.list
  let back = []
  let forward = []
  let current = null
  let pending = null
  let snapshot = { canBack: false, canForward: false }
  const listeners = new Set()

  const read = () => store.getSnapshot()
  const currentId = () => {
    const snap = read()
    const ids = snap?.ids ?? []
    for (const id of ids) {
      if ((snap.byId?.[id]?.retainedBy?.mainView ?? 0) > 0) return id
    }
    return null
  }
  const exists = id => read()?.byId?.[id] !== undefined
  const prune = () => {
    // 原地删除：step() 拿的是数组引用，重新赋值会让它继续操作旧数组，
    // 后退/前进就只打开会话、不改栈。
    for (let index = back.length - 1; index >= 0; index -= 1) {
      if (!exists(back[index])) back.splice(index, 1)
    }
    for (let index = forward.length - 1; index >= 0; index -= 1) {
      if (!exists(forward[index])) forward.splice(index, 1)
    }
  }
  const push = (stack, id) => {
    if (id === null) return
    stack.push(id)
    if (stack.length > MAX_STACK) stack.shift()
  }
  const clearPending = () => {
    pending = null
  }
  const emit = () => {
    const next = { canBack: back.length > 0, canForward: forward.length > 0 }
    if (next.canBack === snapshot.canBack && next.canForward === snapshot.canForward) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  const consume = () => {
    const next = currentId()
    if (next === current) return
    // retain/release 的中间态会短暂没有 mainView；等下一次真正的切换。
    if (next === null) return
    if (pending !== null && next === pending) {
      clearPending()
      current = next
      emit()
      return
    }
    clearPending()
    if (current !== null) {
      push(back, current)
      forward = []
    }
    current = next
    emit()
  }

  const step = (from, to) => {
    prune()
    while (from.length > 0) {
      const target = from.pop()
      if (!exists(target)) continue
      const moved = current
      if (moved !== null) push(to, moved)
      pending = target
      try {
        ui.openSession(target)
      } catch (error) {
        clearPending()
        if (moved !== null && to[to.length - 1] === moved) to.pop()
        console.warn('[claude-code-mode] window-chrome: openSession failed', error)
      }
      break
    }
    emit()
  }

  current = currentId()
  const unsubscribe = store.subscribe(consume)
  emit()

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => snapshot,
    goBack: () => { step(back, forward) },
    goForward: () => { step(forward, back) },
    dispose() {
      unsubscribe()
      clearPending()
      listeners.clear()
    },
  }
}
