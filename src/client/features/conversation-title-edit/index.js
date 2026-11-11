/** conversation-title-edit：会话 header 顶部的会话名点击进入内联编辑。
 *
 * DSH 把当前会话标题渲染成 header 面包屑里的最后一个 crumb：一个纯文本
 * `span`（不可编辑），重命名入口只在侧栏行菜单里。这里在原生标题上接
 * 「点击 → 就地编辑」：
 *  - 点击标题，在同一位置盖一个与标题同字体、同尺寸的输入框；
 *  - Enter / 失焦保存，Esc 取消，空标题与原标题相同都不提交；
 *  - 保存走原生 `session.rename`（与侧栏菜单同一条链路），标题由原生
 *    store 刷新，侧栏、分屏、下一次打开都自动同步。
 *
 * 适配锚点：`conversation.session.header.actions` 里渲染一个隐藏标记，用
 * `[data-slot="conversation.session.header"]` 下的 lineage slot 与其前一个
 * 兄弟定位原生标题。标题不是普通文本 span 时（例如 subagent 的自绘标题）
 * 不接管。DSH 改 header 结构或面包屑时只需改本文件顶部的常量。
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import css from './conversation-title-edit.css'

const h = React.createElement

/** 标题旁的动作槽；隐藏标记和菜单按钮共用这个槽。 */
const ACTIONS_SLOT = 'conversation.session.header.actions'
/** 原生 header 的根 slot。 */
const HEADER_SLOT = '[data-slot="conversation.session.header"]'
/** 当前会话面包屑的 lineage 容器；标题是它的前一个兄弟。 */
const LINEAGE_SLOT = '[data-slot="conversation.session.header.lineage"]'

const STYLE_ID = 'ct-conversation-title-edit'
const LOCALE_NS = 'ctTitleEdit'
const EDITOR_MIN_WIDTH = 160
const EDITOR_MAX_WIDTH = 320
const MAX_TITLE_LENGTH = 120

const DICTIONARIES = {
  zh: { rename: '重命名会话', placeholder: '会话名称', renameFailed: '重命名失败，请重试' },
  en: { rename: 'Rename session', placeholder: 'Session name', renameFailed: 'Could not rename the session' },
}

function injectStyles() {
  let style = document.getElementById(STYLE_ID)
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== css) style.textContent = css
  return style
}

/**
 * 找当前 header 的原生标题 span。
 * 最后一个 lineage 容器前面的兄弟就是当前会话 crumb：普通会话是标题
 * span，subagent 是自绘 switcher（容器内非空），祖先 crumb 不是最后一个
 * lineage。只有文本 span 才接管。
 * @param {HTMLElement | null} marker 注册在 actions 槽里的隐藏标记
 * @returns {HTMLSpanElement | null}
 */
function titleOf(marker) {
  const header = marker?.closest(HEADER_SLOT)
  if (header === null || header === undefined) return null
  const lineages = header.querySelectorAll(LINEAGE_SLOT)
  const lineage = lineages[lineages.length - 1]
  if (lineage === undefined) return null
  const title = lineage.previousElementSibling
  if (!(title instanceof HTMLSpanElement)) return null
  const text = title.textContent?.trim() ?? ''
  // 祖先 crumb 之间的「/」分隔符也是 span，但不能当标题。
  if (text === '' || text === '/') return null
  return title
}

/**
 * 按标题实测位置/字体算出编辑框的几何。宽度比标题略宽，方便输入长名称，
 * 但不超出视口。
 * @param {HTMLElement} title
 * @returns {{ rect: { top: number, left: number, width: number, height: number }, font: Record<string, string> }}
 */
function measureTitle(title) {
  const rect = title.getBoundingClientRect()
  const style = window.getComputedStyle(title)
  // 只比标题多出一点内边距，避免编辑框盖住标题后面的下拉按钮。
  const width = Math.max(EDITOR_MIN_WIDTH, Math.min(EDITOR_MAX_WIDTH, rect.width + 8))
  return {
    rect: {
      top: rect.top,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      width,
      height: Math.max(rect.height, 24),
    },
    font: {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      color: style.color,
    },
  }
}

/**
 * 进入编辑态：隐藏原标题（避免长标题从编辑框右侧露出），并给该 header
 * 打上编辑标记，让标题旁的下拉按钮暂时让位。
 * @param {{ title: HTMLElement, header: Element | null }} editor
 */
function startEditingFrame(editor) {
  if (editor.title.isConnected) editor.title.style.visibility = 'hidden'
  if (editor.header instanceof HTMLElement) editor.header.dataset.ctTitleEditing = ''
}

/**
 * 退出编辑态：恢复标题可见，并撤掉 header 的编辑标记（下拉按钮回来）。
 * @param {{ title: HTMLElement, header: Element | null }} editor
 */
function endEditingFrame(editor) {
  if (editor.title.isConnected) editor.title.style.visibility = ''
  if (editor.header instanceof HTMLElement && editor.header.isConnected) {
    delete editor.header.dataset.ctTitleEditing
  }
}

/**
 * 一个 header 实例的可编辑标题：隐藏标记负责定位标题与拿到 sessionId，
 * 编辑框 portal 到 body，避开 header 的 overflow clip 与窗口拖拽区。
 * @param {{ sessionId: string, sessions: any, menus: any, t: any }} props
 */
function EditableSessionTitle({ sessionId, sessions, menus, t }) {
  const markerRef = React.useRef(null)
  const editorRef = React.useRef(null)
  const [editor, setEditor] = React.useState(null)

  const commit = React.useCallback((cancelled) => {
    const current = editorRef.current
    if (current === null) return
    editorRef.current = null
    setEditor(null)
    endEditingFrame(current)
    if (cancelled) return
    const value = current.value.trim()
    // 空标题与未改动的标题都不发请求；原生命令会拒绝空标题。
    if (value === '' || value === current.original) return
    void (async () => {
      try {
        const result = await sessions.using(sessionId, { source: 'conversationTitleEdit' }, (reference) =>
          reference.binding.session.rename(value))
        if (result?.ok !== true) throw new Error(result?.error?.message ?? 'rename failed')
      } catch (_error) {
        try {
          menus.notify(t('renameFailed'))
        } catch (_notifyError) {
          // 通知面未就绪时保持静默：标题本身没有变化。
        }
      }
    })()
  }, [menus, sessionId, sessions, t])

  const openEditor = React.useCallback((title) => {
    if (editorRef.current !== null) return
    const { rect, font } = measureTitle(title)
    const next = {
      title,
      header: title.closest(HEADER_SLOT),
      original: title.textContent?.trim() ?? '',
      // 输入框显示原始文本；提交时再 trim。
      value: title.textContent ?? '',
      rect,
      font,
    }
    startEditingFrame(next)
    editorRef.current = next
    setEditor(next)
  }, [])

  // 给当前 header 的原生标题挂点击。sessionId 变化时重新定位。
  React.useLayoutEffect(() => {
    const title = titleOf(markerRef.current)
    if (title === null) return undefined
    title.dataset.ctSessionTitle = ''
    const onClick = (event) => {
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      event.preventDefault()
      event.stopPropagation()
      openEditor(title)
    }
    title.addEventListener('click', onClick)
    return () => {
      title.removeEventListener('click', onClick)
      delete title.dataset.ctSessionTitle
      if (editorRef.current?.title === title) {
        const current = editorRef.current
        editorRef.current = null
        setEditor(null)
        endEditingFrame(current)
      }
    }
  }, [sessionId, openEditor])

  // 窗口尺寸变化时重新贴合标题；编辑中不跟随滚动（header 固定在顶部）。
  const editingTitle = editor?.title ?? null
  React.useLayoutEffect(() => {
    if (editingTitle === null) return undefined
    const onResize = () => {
      const current = editorRef.current
      if (current === null) return
      const { rect } = measureTitle(current.title)
      setEditor((previous) => previous === null ? previous : { ...previous, rect })
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [editingTitle])

  const attachInput = React.useCallback((node) => {
    if (node === null) return
    node.focus({ preventScroll: true })
    node.select()
  }, [])

  const onChange = (event) => {
    const current = editorRef.current
    if (current === null) return
    current.value = event.target.value
    setEditor({ ...current })
  }

  const onKeyDown = (event) => {
    // 输入框吃掉按键，避免触发全局快捷键；输入法组合期间放行。
    event.stopPropagation()
    if (event.nativeEvent?.isComposing || event.nativeEvent?.keyCode === 229) return
    if (event.key === 'Escape') {
      event.preventDefault()
      commit(true)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      commit(false)
    }
  }

  return h(React.Fragment, null,
    h('span', { ref: markerRef, hidden: true, 'data-ct-title-session': sessionId }),
    editor === null ? null : createPortal(
      h('input', {
        ref: attachInput,
        type: 'text',
        className: 'ct-title-editor',
        value: editor.value,
        placeholder: t('placeholder'),
        'aria-label': t('rename'),
        maxLength: MAX_TITLE_LENGTH,
        spellCheck: false,
        autoComplete: 'off',
        style: {
          top: `${String(editor.rect.top)}px`,
          left: `${String(editor.rect.left)}px`,
          width: `${String(editor.rect.width)}px`,
          height: `${String(editor.rect.height)}px`,
          ...editor.font,
        },
        onChange,
        onKeyDown,
        onBlur: () => { if (editorRef.current !== null) commit(false) },
        onPointerDown: (event) => { event.stopPropagation() },
        onClick: (event) => { event.stopPropagation() },
        onDoubleClick: (event) => { event.stopPropagation() },
      }),
      document.body,
    ))
}

/**
 * 安装功能：每个会话 header 的标题点击编辑。
 * @param {any} ctx 客户端 root context
 * @returns {() => void}
 */
export function install(ctx) {
  let style = null
  try {
    style = injectStyles()
  } catch (error) {
    console.warn('[conversation-title-edit] style injection failed', error)
  }

  let dispose = () => {}
  dispose = ctx.inject(['slots', 'locale', 'contextMenus', 'sessions'], (scope) => {
    const locale = scope.get('locale')
    const sessions = scope.get('sessions')
    const menus = scope.get('contextMenus')
    scope.effect(() => locale.register(LOCALE_NS, DICTIONARIES), 'conversation-title-edit: copy')
    const t = locale.bind(LOCALE_NS)
    const Title = (props) => h(EditableSessionTitle, { sessionId: props.sessionId, sessions, menus, t })
    const stop = scope.slots.inject(ACTIONS_SLOT, () => scope.slots.register({
      name: ACTIONS_SLOT,
      id: 'ct-title-edit',
      order: 10,
    }, Title))
    return () => stop()
  })

  return () => {
    dispose()
    if (document.getElementById(STYLE_ID) === style) style?.remove()
  }
}
