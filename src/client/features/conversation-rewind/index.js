/** conversation-rewind：会话里「退回到此处」+ 会话内图片灯箱。
 *
 * 行为对齐 Claude Code 桌面端：
 *  - 悬停用户消息，动作行里多一个「退回到此处」；点击后这条消息及其后的
 *    内容从对话里回退，原消息放回输入框。
 *  - 回退段里改过项目文件时，先询问是否一起还原文件；当前文件已经不是
 *    会话最后写出的版本时，不询问，只回退消息。
 *  - 新消息提交前可以「撤销回退」；提交后撤销入口消失。
 *  - 会话里交付的图片文件点击后用 image-preview 的统一弹窗展开，不再打开右侧抽屉。
 *
 * 宿主侧只负责持久化回退点、裁剪模型历史和还原文件；本文件只做界面与
 * 交互。回退范围通过插件自己的同源路由读取，不写 Session 日志。
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import {
  IconBranchOutlineRegular, IconCheckOutlineRegular, IconCopyOutlineRegular, useClipboardCopy,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Tooltip } from '../../shared/ui/tooltip.js'
import { formatRelativeTime, useRelativeNow } from '../../shared/time.js'
import rewindCss from './conversation-rewind.css'

const h = React.createElement

const STYLE_ID = 'ct-conversation-rewind'
const TOAST_ID = 'ct-rewind-toast'
const DELIVERABLES_ID = '@deepseek-ai/dsh-client-ui-deliverables'

const REWIND_STATE_ROUTE = '/claude-code-mode/rewind/state'
const REWIND_PREVIEW_ROUTE = '/claude-code-mode/rewind/preview'
const REWIND_APPLY_ROUTE = '/claude-code-mode/rewind'
const REWIND_UNDO_ROUTE = '/claude-code-mode/rewind/undo'

const REWIND_LABEL = '退回到此处'

/** @param {any} ctx client root context */
export function install(ctx) {
  let style = null
  if (document.getElementById(STYLE_ID) === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = rewindCss
    document.head.appendChild(style)
  }

  const dispose = ctx.inject(['slots', 'conversation'], (scope) => {
    const disposers = []
    let disposed = false
    for (const installer of [installUserRow, installNodeHiding, installActionHover, installDock, installDeliverablesImages, installToast]) {
      try {
        const result = installer(scope)
        if (typeof result === 'function') disposers.push(result)
      } catch (error) {
        console.warn(`[claude-code-mode] conversation-rewind ${installer.name} failed`, error)
      }
    }
    return () => {
      if (disposed) return
      disposed = true
      for (const disposeInstaller of disposers.reverse()) {
        try { disposeInstaller() } catch { /* ignore */ }
      }
      style?.remove()
    }
  })

  return () => {
    if (typeof dispose === 'function') dispose()
    if (document.getElementById(STYLE_ID) !== null && document.getElementById(STYLE_ID) === style) style.remove()
  }
}

/* 回退状态 ------------------------------------------------------------------
 * 每个会话一个内存 store，从宿主读取持久化的回退范围。组件只读 store，
 * 动作完成后再把宿主返回的完整状态写回来。
 */

const stateStores = new Map()
const EMPTY_STATE = { loaded: false, busy: false, rewinds: [], error: null }
const noopSubscribe = () => () => {}
const emptySnapshot = () => EMPTY_STATE

function stateStoreFor(sessionId) {
  let store = stateStores.get(sessionId)
  if (store !== undefined) return store

  let snapshot = EMPTY_STATE
  const listeners = new Set()
  let inflight = null

  const emit = (next) => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const refresh = (force = false) => {
    if (sessionId === undefined || sessionId === null || sessionId === '') return Promise.resolve()
    if (inflight !== null && !force) return inflight
    const request = fetch(`${REWIND_STATE_ROUTE}?${new URLSearchParams({ sessionId })}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`rewind state ${response.status}`)
        const value = await response.json()
        if (value?.ok === false) throw new Error(value.message ?? 'rewind state failed')
        emit({
          loaded: true,
          busy: value.busy === true,
          rewinds: Array.isArray(value.rewinds) ? value.rewinds : [],
          error: null,
        })
        return value
      })
      .catch((error) => {
        emit({ ...snapshot, loaded: true, error: String(error?.message ?? error) })
        throw error
      })
      .finally(() => { if (inflight === request) inflight = null })

    inflight = request
    return request
  }

  const apply = (value) => {
    if (value === undefined || value === null) return
    emit({
      loaded: true,
      busy: value.busy === true,
      rewinds: Array.isArray(value.rewinds) ? value.rewinds : snapshot.rewinds,
      error: null,
    })
  }

  store = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh,
    apply,
  }
  stateStores.set(sessionId, store)
  return store
}

function useRewindState(sessionId) {
  const store = React.useMemo(() => sessionId ? stateStoreFor(sessionId) : null, [sessionId])
  React.useEffect(() => {
    if (store !== null) void store.refresh().catch(() => {})
  }, [store])
  const snapshot = React.useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getSnapshot ?? emptySnapshot,
  )
  return [snapshot, store]
}

function hiddenByRewinds(seq, turn, rewinds) {
  if (!Array.isArray(rewinds)) return false
  for (const record of rewinds ?? []) {
    if (Number.isFinite(seq) && seq >= record.anchorSeq && seq <= record.endSeq) return true
    // turn-process（处理失败/已停止）和分组头的 anchorSeq 落在 turn/start 上，
    // 比用户消息早；只按 seq 判断会把它们留在回退范围外面。按轮次兜底。
    if (Number.isFinite(turn) && Number.isFinite(record.anchorTurn) && Number.isFinite(record.endTurn)
      && turn >= record.anchorTurn && turn <= record.endTurn) return true
  }
  return false
}

/** 节点所属轮次；turn-process / turn-tail / assistant-step 都在 turn/step location 下。 */
function nodeTurn(node) {
  const location = node?.location
  return location?.kind === 'turn' || location?.kind === 'step' ? location.turn.turn : undefined
}

/* 用户消息行 ----------------------------------------------------------------
 * 原生 user 行由 ui-chat 自己渲染，没有给外部留动作插槽。这里替换 keyed
 * node 入口的 'user' 渲染器：内容仍走原生 user content factory（引用、附件、
 * 图片、文本选择都不变），只在下面补一行原生风格的动作：时间、复制、回退。
 */

function installUserRow(scope) {
  const patched = new Set()
  const records = []

  const patch = () => {
    const entry = scope.slots.entries('conversation.chat.node').find((candidate) => candidate.options?.key === 'user')
    if (entry === undefined || patched.has(entry)) return
    patched.add(entry)
    const original = entry.component
    entry.component = UserRowWithRewind
    records.push({ entry, original, wrapper: UserRowWithRewind })
  }

  patch()
  const stop = scope.slots.subscribe('conversation.chat.node', patch)
  return () => {
    stop()
    for (const record of records) {
      if (record.entry.component === record.wrapper) record.entry.component = record.original
    }
  }
}

function UserRowWithRewind(props) {
  const {
    node, loadImage, renderFactorySlot, renderSlotChain, sessionId,
    useSession, useInput, useAccess, inputActions,
  } = props
  const data = node?.data ?? {}
  const parts = React.useMemo(() => contentParts(Array.isArray(data.content) ? data.content : []), [data.content])
  const prepared = React.useMemo(() => ({
    text: parts.text,
    attachments: parts.attachments,
    extraBlocks: parts.rest,
    ...(data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }),
  }), [parts, data.referenceLabels])
  const facts = React.useMemo(() => ({
    ...(data.referenceLabels === undefined ? {} : { sessionLabels: data.referenceLabels }),
    ...(data.skillNames === undefined ? {} : { skillNames: data.skillNames }),
  }), [data.referenceLabels, data.skillNames])

  const [rewindState, store] = useRewindState(sessionId)
  const now = useRelativeNow()
  const running = useSession((snapshot) => snapshot?.running === true)
  const phase = useInput((input) => input?.phase ?? 'plain')
  const allowed = useAccess('session/prompt') !== false
  const forkAllowed = useAccess('session/fork') !== false
  const [dialog, setDialog] = React.useState(null)
  const [pending, setPending] = React.useState(false)
  const [notice, setNotice] = React.useState(null)
  const [dialogError, setDialogError] = React.useState(null)
  const rowRef = React.useRef(null)

  if (node === undefined) return null
  if (hiddenByRewinds(node.anchorSeq, nodeTurn(node), rewindState.rewinds)) return hiddenSentinel()

  const busy = pending || running || !allowed || (phase !== 'plain' && phase !== 'claimed')
  const hasAttachment = prepared.attachments.length > 0

  const execute = async (rollbackFiles, preview) => {
    setPending(true)
    setNotice(null)
    try {
      const value = await callRewind(REWIND_APPLY_ROUTE, {
        sessionId,
        anchorSeq: node.anchorSeq ?? node.data?.seq,
        rollbackFiles: rollbackFiles === true,
      })
      if (value.ok === false) {
        const detail = Array.isArray(value.files) && value.files.length > 0
          ? `${value.message ?? '回退失败'}：${value.files[0].path} (${value.files[0].message})`
          : value.message ?? '回退失败'
        setNotice(detail)
        setDialogError(detail)
        return
      }
      setDialog(null)
      // 先关弹窗、再写回状态：回退成功后这条用户消息本身会被隐藏，
      // 渲染它的组件随之卸载。
      store?.apply(value.state)
      if (typeof inputActions?.setDraft === 'function' && prepared.text !== '') {
        inputActions.setDraft(prepared.text)
        inputActions.focus?.()
      }
      if (hasAttachment) showToast('消息里的图片/附件没有放回输入框，请重新添加')
      if (value.filesRolledBack > 0) showToast(`已回退，并还原了 ${value.filesRolledBack} 个文件`)
      else if (preview?.fileRollback?.reason === 'dirty' || preview?.fileRollback?.reason === 'untracked' || preview?.fileRollback?.reason === 'unsupported') {
        if ((preview.fileRollback.count ?? 0) > 0) showToast('这些文件已被其它操作改过，本次只回退了消息')
      }
      scrollConversationToBottom(rowRef.current)
    } catch (error) {
      setNotice(String(error?.message ?? error))
    } finally {
      setPending(false)
    }
  }

  const begin = async () => {
    if (busy) return
    setPending(true)
    setNotice(null)
    setDialogError(null)
    try {
      const preview = await callRewind(REWIND_PREVIEW_ROUTE, { sessionId, anchorSeq: node.anchorSeq ?? node.data?.seq })
      if (preview.ok === false) {
        setNotice(preview.code === 'compaction'
          ? '这段对话已经被压缩，不能再退回到这条消息'
          : preview.code === 'busy' ? '会话正在运行，结束或停止后才能回退' : (preview.message ?? '回退失败'))
        return
      }
      if (preview.fileRollback?.available === true && Array.isArray(preview.fileRollback.files) && preview.fileRollback.files.length > 0) {
        setDialog({ preview })
      } else {
        await execute(false, preview)
      }
    } catch (error) {
      setNotice(String(error?.message ?? error))
    } finally {
      setPending(false)
    }
  }

  return h(
    'div',
    { ref: rowRef, className: 'ct-rw-user-row', 'data-ct-rewind-row': '' },
    renderSlotChain('conversation.chat.user.before', { source: data.source, kind: node.kind }, { fallback: null }),
    renderFactorySlot('conversation.chat.user.content', {
      content: prepared,
      loadImage,
      facts,
      interactive: true,
    }),
    h(
      'div',
      { className: 'ct-rw-user-actions', 'data-actions-reveal': '' },
      h('span', { className: 'ct-rw-time' }, formatRelativeTime(data.time, now)),
      h(CopyAction, { text: prepared.text }),
      h(RewindAction, { busy, pending, onActivate: begin }),
      h(BranchAction, {
        enabled: !running && forkAllowed && typeof props.forkAt === 'function',
        onActivate: () => {
          try { props.forkAt(node.data?.seq ?? node.anchorSeq) } catch (error) { showToast(String(error?.message ?? error)) }
        },
      }),
    ),
    notice === null ? null : h('div', { className: 'ct-rw-notice', role: 'status' }, notice),
    dialog === null ? null : h(RewindDialog, {
      preview: dialog.preview,
      text: prepared.text,
      attachmentCount: prepared.attachments.length,
      error: dialogError,
      pending,
      onCancel: () => { setDialog(null); setDialogError(null) },
      onMessagesOnly: () => { void execute(false, dialog.preview) },
      onRestoreFiles: () => { void execute(true, dialog.preview) },
    }),
  )
}

function CopyAction({ text }) {
  const { copied, onCopy } = useClipboardCopy(text)
  return h(
    Tooltip,
    { label: copied ? '已复制' : '复制', side: 'bottom' },
    h(
      'button',
      {
        type: 'button',
        className: 'ct-rw-action',
        'aria-label': copied ? '已复制' : '复制',
        'data-ct-rewind-copy': '',
        onClick: onCopy,
      },
      copied ? h(IconCheckOutlineRegular) : h(IconCopyOutlineRegular),
    ),
  )
}

function RewindAction({ busy, pending, onActivate }) {
  return h(
    Tooltip,
    { label: REWIND_LABEL, side: 'bottom' },
    h(
      'button',
      {
        type: 'button',
        className: 'ct-rw-action ct-rw-rewind-action',
        'aria-label': REWIND_LABEL,
        'data-ct-rewind-action': '',
        disabled: busy,
        onClick: () => { if (!busy) void onActivate() },
      },
      pending ? h('span', { className: 'ct-rw-spinner', 'aria-hidden': true }) : h(RewindIcon),
    ),
  )
}

function BranchAction({ enabled, onActivate }) {
  return h(
    Tooltip,
    { label: '在新对话中分支', side: 'bottom' },
    h(
      'button',
      {
        type: 'button',
        className: 'ct-rw-action',
        'aria-label': '在新对话中分支',
        'data-ct-rewind-branch': '',
        disabled: !enabled,
        onClick: onActivate,
      },
      h(IconBranchOutlineRegular),
    ),
  )
}

function RewindIcon({ size = 15 }) {
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
    h('path', {
      d: 'M3.2 8a4.8 4.8 0 1 0 1.4-3.4',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
    }),
    h('path', {
      d: 'M3.2 4.2v2.6h2.6',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

function contentParts(content) {
  const texts = []
  const attachments = []
  const rest = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') texts.push(block.text)
    else if (block?.type === 'image' && block.attachment !== undefined) {
      attachments.push({ type: 'image', image: { attachment: block.attachment } })
    } else if (block?.type === 'file' && block.attachment !== undefined) {
      attachments.push({ type: 'file', file: block.attachment })
    } else rest.push(block)
  }
  return { text: texts.join(''), attachments, rest }
}

/* 回退确认弹窗 ------------------------------------------------------------- */

function RewindDialog({ preview, text, attachmentCount, error, pending, onCancel, onMessagesOnly, onRestoreFiles }) {
  const titleId = React.useId()
  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !pending) { event.stopPropagation(); onCancel() }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [pending, onCancel])

  const files = Array.isArray(preview?.fileRollback?.files) ? preview.fileRollback.files : []
  return createPortal(
    h(
      'div',
      {
        className: 'ct-rw-backdrop',
        'data-ct-rewind-dialog': '',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget && !pending) onCancel()
        },
      },
      h(
        'div',
        { className: 'ct-rw-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        h('h2', { className: 'ct-rw-dialog-title', id: titleId }, REWIND_LABEL),
        h('p', { className: 'ct-rw-dialog-text' }, '将从对话中移除这条消息及其后的所有内容。这条消息会放回输入框。'),
        files.length === 0 ? null : h(
          'div',
          { className: 'ct-rw-dialog-files' },
          h('span', { className: 'ct-rw-dialog-label' }, `这段对话修改了 ${files.length} 个项目文件：`),
          h(
            'ul',
            { className: 'ct-rw-file-list' },
            files.slice(0, 20).map((file) => h(Tooltip, {
              key: file.path,
              label: file.path,
              side: 'top',
              delayMs: 400,
              portal: true,
              asChild: true,
            }, h('li', null, file.display ?? file.path))),
          ),
          files.length > 20 ? h('span', { className: 'ct-rw-dialog-more' }, `还有 ${files.length - 20} 个文件`) : null,
          h('span', { className: 'ct-rw-dialog-note' }, '选择还原文件时，会把这些文件恢复到这段对话开始修改之前的内容。'),
        ),
        attachmentCount > 0 ? h('p', { className: 'ct-rw-dialog-note' }, '这条消息里的图片/附件不会放回输入框，需要重新添加。') : null,
        text.trim() === '' ? null : h('p', { className: 'ct-rw-dialog-quote' }, text),
        error === null || error === undefined ? null : h('p', { className: 'ct-rw-dialog-error', role: 'status' }, error),
        h(
          'div',
          { className: 'ct-rw-dialog-actions' },
          h('button', { type: 'button', className: 'ct-rw-dialog-button', disabled: pending, onClick: onCancel }, '取消'),
          h('button', { type: 'button', className: 'ct-rw-dialog-button', disabled: pending, onClick: onMessagesOnly }, '只回退消息'),
          h('button', { type: 'button', className: 'ct-rw-dialog-button is-primary', disabled: pending, onClick: onRestoreFiles },
            pending ? '正在回退…' : '回退消息并还原文件'),
        ),
      ),
    ),
    document.body,
  )
}

/* 已回退到此处 / 撤销回退（会话滚动内容末尾） -------------------------------
 * 原生聊天列没有尾部插槽，输入框的 dock 又会把提示钉在输入框上方、脱离滚动
 * 内容。这里替换 single flow 渲染器：原 flow 照常返回它的消息行数组，提示条
 * 紧接在它后面渲染。两者都是聊天列的直接子节点，所以提示条位于会话滚动内容
 * 的末尾，向上翻历史时会一起滚走。
 */
function installDock(scope) {
  const conversation = scope.get('conversation')
  const patched = new Set()
  const records = []

  const patch = () => {
    const entry = scope.slots.entries('conversation.chat.flow')[0]
    if (entry === undefined || patched.has(entry)) return
    patched.add(entry)
    const original = entry.component
    const Wrapper = function RewindFlow(props) {
      return h(
        React.Fragment,
        null,
        h(original, props),
        h(RewindDock, { sessionId: props?.sessionId, useSession: props?.useSession, conversation }),
      )
    }
    entry.component = Wrapper
    records.push({ entry, original, wrapper: Wrapper })
  }

  patch()
  const stop = scope.slots.subscribe('conversation.chat.flow', patch)
  return () => {
    stop()
    for (const record of records) {
      if (record.entry.component === record.wrapper) record.entry.component = record.original
    }
  }
}

const EMPTY_INPUT = Object.freeze({ phase: 'plain', draft: '' })
const emptyInputSnapshot = () => EMPTY_INPUT

function RewindDock({ sessionId, useSession, conversation }) {
  const [rewindState, store] = useRewindState(sessionId)
  const running = useSession((snapshot) => snapshot?.running === true)

  // 提示条虽然画在会话内容里，仍要和输入框联动：提交新消息后收起、撤销后清掉
  // 回填的草稿。conversation 服务取不到时退化成只读回退状态。
  const shell = React.useMemo(() => {
    if (conversation === undefined || conversation === null || sessionId === undefined || sessionId === null) return null
    try {
      return conversation.input?.shell?.(sessionId) ?? null
    } catch {
      return null
    }
  }, [conversation, sessionId])
  const input = React.useSyncExternalStore(
    shell?.state?.subscribe ?? noopSubscribe,
    shell?.state?.getSnapshot ?? emptyInputSnapshot,
  )
  const phase = input?.phase ?? 'plain'
  const draft = input?.draft ?? ''
  const inputActions = shell?.actions ?? null
  const [pending, setPending] = React.useState(false)
  const [suppress, setSuppress] = React.useState(false)
  const dockRef = React.useRef(null)
  const submitted = React.useRef(false)

  React.useEffect(() => {
    if (phase === 'sending' || phase === 'submitting' || phase === 'adjudicating') {
      submitted.current = true
      setSuppress(true)
      return
    }
    if (!submitted.current) return
    let cancelled = false
    const tick = (attempt) => {
      void store?.refresh(true).then(() => {
        if (cancelled) return
        const stillUndoable = (store?.getSnapshot().rewinds ?? []).some((record) => record.canUndo === true)
        if (stillUndoable && attempt < 5) setTimeout(() => tick(attempt + 1), 400)
        else if (!stillUndoable) {
          submitted.current = false
          setSuppress(false)
        }
      }).catch(() => {})
    }
    tick(0)
    return () => { cancelled = true }
  }, [phase, store])

  if (running || suppress || rewindState.loaded === false) return null
  const active = rewindState.rewinds.filter((record) => record.canUndo === true)
  const latest = active.length === 0 ? undefined : active.reduce((left, right) => (right.createdAt ?? 0) >= (left.createdAt ?? 0) ? right : left)
  if (latest === undefined) return null

  const onUndo = async () => {
    if (pending) return
    setPending(true)
    try {
      const value = await callRewind(REWIND_UNDO_ROUTE, { sessionId, id: latest.id })
      if (value.ok === false) {
        showToast(value.message ?? '撤销回退失败')
        return
      }
      store?.apply(value.state)
      if (typeof inputActions?.setDraft === 'function' && latest.text !== '' && draft === latest.text) {
        inputActions.setDraft('')
      }
      scrollConversationToBottom(dockRef.current)
    } catch (error) {
      showToast(String(error?.message ?? error))
    } finally {
      setPending(false)
    }
  }

  return h(
    'div',
    { ref: dockRef, className: 'ct-rw-dock', 'data-ct-rewind-dock': '' },
    h('span', { className: 'ct-rw-dock-label' }, '已回退到此处'),
    h(
      'span',
      { className: 'ct-rw-dock-undo-wrap' },
      h(
        Tooltip,
        { label: '撤销回退', side: 'bottom', portal: true },
        h(
          'button',
          {
            type: 'button',
            className: 'ct-rw-dock-undo',
            'data-ct-rewind-undo': '',
            disabled: pending,
            onClick: () => { void onUndo() },
          },
          pending ? '正在撤销…' : '撤销回退',
        ),
      ),
    ),
    latest.filesRolledBack > 0 ? h('span', { className: 'ct-rw-dock-detail' }, `同时还原了 ${latest.filesRolledBack} 个文件`) : null,
    h('span', { className: 'ct-rw-dock-detail' }, '发送新消息后将无法撤销'),
  )
}

/* 悬停消息时显示动作 --------------------------------------------------------
 * Claude 的动作行只在悬停消息时出现。用户行用 :hover；助手动作行在 turn-tail
 * 里，和正文不在同一个 flow item，因此这里给同一 turn 的所有 flow item 打
 * 一个临时属性，CSS 据此显示该轮 turn-tail 的按钮。时间保留，按钮默认隐藏。
 */
function installActionHover() {
  let active = null
  const clear = () => {
    if (active === null) return
    for (const item of active.scroller.querySelectorAll('[data-ct-hover-assistant]')) {
      item.removeAttribute('data-ct-hover-assistant')
    }
    active = null
  }
  const set = (row) => {
    if (row === null) { clear(); return }
    const scroller = row.closest('[data-conversation-scroll]')
    const turn = row.getAttribute('data-chat-turn')
    if (scroller === null || turn === null) { clear(); return }
    if (active?.row === row) return
    clear()
    active = { scroller, row }
    // 用户行只显示自己的按钮；助手动作行是同一轮 turn-tail，只在该轮的
    // 非用户行（正文/工具/turn-tail）悬停时出现。
    if (row.getAttribute('data-chat-flow-kind') === 'user') return
    for (const item of scroller.querySelectorAll('[data-chat-flow-kind="turn-tail"]')) {
      if (item.getAttribute('data-chat-turn') === turn) item.setAttribute('data-ct-hover-assistant', '')
    }
  }
  const onPointerOver = (event) => {
    const target = event.target
    set(target instanceof Element ? target.closest('[data-chat-flow-key]') : null)
  }
  const onPointerOut = (event) => {
    if (event.relatedTarget === null) clear()
  }
  document.addEventListener('pointerover', onPointerOver, true)
  document.addEventListener('pointerout', onPointerOut, true)
  return () => {
    document.removeEventListener('pointerover', onPointerOver, true)
    document.removeEventListener('pointerout', onPointerOut, true)
    clear()
  }
}

/* 隐藏回退范围里的消息 ------------------------------------------------------
 * 原生 keyed node 入口逐个包一层：节点 anchorSeq 落在回退范围内就渲染一个
 * 隐藏哨兵，由 CSS 把整行折掉。用户行自己处理（上面），这里跳过 'user'。
 */

function installNodeHiding(scope) {
  const patched = new Set()
  const records = []

  const patch = () => {
    for (const entry of scope.slots.entries('conversation.chat.node')) {
      if (entry.options?.key === 'user' || patched.has(entry)) continue
      patched.add(entry)
      const original = entry.component
      const Wrapper = function RewindHiddenNode(props) {
        const [state] = useRewindState(props?.sessionId)
        if (hiddenByRewinds(props?.node?.anchorSeq, nodeTurn(props?.node), state.rewinds)) return hiddenSentinel()
        return h(original, props)
      }
      entry.component = Wrapper
      records.push({ entry, original, wrapper: Wrapper })
    }
  }

  patch()
  const stop = scope.slots.subscribe('conversation.chat.node', patch)
  return () => {
    stop()
    for (const record of records) {
      if (record.entry.component === record.wrapper) record.entry.component = record.original
    }
  }
}

function hiddenSentinel() {
  return h('span', { className: 'ct-rw-hidden', 'data-ct-rewind-hidden': '', 'aria-hidden': 'true' })
}

/* 交付图片：只改提示文案，点击统一交给 image-preview ----------------------- */

function installDeliverablesImages(scope) {
  const patched = new Set()
  const records = []

  const patch = () => {
    for (const entry of scope.slots.entries('conversation.chat.turnTail')) {
      if (entry.options?.id !== DELIVERABLES_ID || patched.has(entry)) continue
      patched.add(entry)
      const original = entry.component
      const Wrapper = function DeliverablesImageGate(props) {
        const patchedT = React.useCallback((key, params) => {
          // 图片卡点击后开的是统一弹窗，不再进右侧抽屉；两条提示改成对两种行为都成立的文案。
          if (key === 'presented.preview') return '点击预览'
          if (key === 'presented.previewCard') return `预览 ${params?.name ?? ''}`
          return props.t(key, params)
        }, [props.t])
        return h(original, { ...props, t: patchedT })
      }
      entry.component = Wrapper
      records.push({ entry, original, wrapper: Wrapper })
    }
  }

  patch()
  const stop = scope.slots.subscribe('conversation.chat.turnTail', patch)
  return () => {
    stop()
    for (const record of records) {
      if (record.entry.component === record.wrapper) record.entry.component = record.original
    }
  }
}

/* Toast -------------------------------------------------------------------- */

const toastListeners = new Set()
let toastSnapshot = null
let toastTimer = null
let toastSeq = 0

function showToast(text) {
  toastSeq += 1
  toastSnapshot = { id: toastSeq, text: String(text) }
  for (const listener of toastListeners) listener()
  if (toastTimer !== null) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastSnapshot = null
    toastTimer = null
    for (const listener of toastListeners) listener()
  }, 4200)
}

function installToast(scope) {
  return scope.slots.inject('shell.overlay', () => scope.slots.register(
    { name: 'shell.overlay', id: TOAST_ID },
    RewindToastHost,
  ))
}

function RewindToastHost() {
  const value = React.useSyncExternalStore(
    (listener) => { toastListeners.add(listener); return () => toastListeners.delete(listener) },
    () => toastSnapshot,
  )
  if (value === null) return null
  return h(
    'div',
    { className: 'ct-rw-toast', role: 'status', 'data-ct-rewind-toast': '' },
    value.text,
  )
}

/* 工具 --------------------------------------------------------------------- */

async function callRewind(route, payload) {
  const response = await fetch(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })
  const value = await response.json().catch(() => null)
  if (value === null) throw new Error(`rewind ${response.status}`)
  return value
}

function scrollConversationToBottom(from) {
  // 分屏时 document 里可能有多个滚动根；提示条现在就在自己的滚动容器内，
  // 优先用它最近的 [data-conversation-scroll]，单屏再退回 main / document。
  const scroller = from?.closest?.('[data-conversation-scroll]')
    ?? (from?.closest?.('[data-ct-shell-cell]') ?? from?.closest?.('[data-slot="main"]') ?? document)?.querySelector?.('[data-conversation-scroll]')
    ?? document.querySelector('[data-conversation-scroll]')
  if (scroller === null || scroller === undefined) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight
    })
  })
}