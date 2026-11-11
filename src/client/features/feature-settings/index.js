/** feature-settings：设置面板里的「Claude Code」分组。
 *
 * 插件把一整块 DSH 界面替换掉，不同用户想留的功能不一样。这个页把每个功能
 * 做成一个开关（默认全开），皮肤做成下拉选择（默认 Claude）。状态存在宿主
 * （`$DSH_HOME/claude-code-mode/preferences.json`），所以桌面端、Web 端、
 * 换端口、重启都一致。
 *
 * 挂点：`settings.section` 的独立分组（不是 General 里的一行）。导航 id
 * `claude-code-mode`，图标走同 id 的 `settings.section.icon`。
 *
 * 生效方式：都不刷新页面。
 *  - 皮肤：纯观感，切换时只换样式与 body 标记，立即生效；
 *  - 功能开关：保存后宿主 touch 本插件的 client bundle，client-hmr 广播
 *    rebuilt，页面只重新装载本插件（等价开发热更新），会话状态保留；
 *    等不到热重载时才回退到整页刷新。
 */

import * as React from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { FEATURE_CATALOG } from '../../core/catalog.js'
import { PLUGIN_VERSION } from '../../core/version.js'
import {
  getPreferencesSnapshot, resetPreferences, setFeatureEnabled, setSkin, subscribePreferences,
} from '../../core/preferences.js'
import settingsCss from './feature-settings.css'

const h = React.createElement

const STYLE_ID = 'ct-feature-settings'
const LOCALE_NS = 'ctFeatureSettings'
const SECTION_SLOT = 'settings.section'
const ICON_SLOT = 'settings.section.icon'
/** 排在 Agent 预设（20）之后、社区插件（45）之前。 */
const SECTION_ORDER = 25
const SECTION_ID = 'claude-code-mode'
/** 等宿主触发的插件热重载的上限；等不到才回退整页刷新。 */
const CLIENT_RELOAD_TIMEOUT_MS = 3000

const DICTIONARIES = {
  zh: {
    nav: 'CodeMode',
    groupFeatures: '功能',
    groupAppearance: '外观',
    featureSidebar: '左侧边栏',
    featureSidebarHint: '会话树与工作区分组，加上窗口左上角的侧栏开关和前进/后退（收起后悬停浮出侧栏，Web 与桌面一样不保留图标列）。',
    featureSplitView: '会话分屏',
    featureSplitViewHint: '把会话从侧栏拖进主内容区分屏，最多 2×2；关闭后只保留单屏。依赖左侧边栏。',
    featureSessionHeader: '会话标题栏',
    featureSessionHeaderHint: '点击标题就地重命名，会话名旁的下拉放「更多」与「打开方式」。',
    featureSidePanel: '右侧面板',
    featureSidePanelHint: '会话右侧的自绘面板与标题栏工具入口；关闭后回到原生右栏。',
    featureRewind: '消息回退',
    featureRewindHint: '从任意用户消息退回到此处，并可选择一并还原这一段改过的文件。',
    featureImagePreview: '图片预览',
    featureImagePreviewHint: '会话里的图片统一用同一个原图弹窗打开；关闭后仍打开右侧抽屉。',
    skinLabel: '皮肤',
    skinHint: '选择配色与字体观感；原生不挂任何皮肤，功能仍然可用。切换立即生效。',
    skinOptionClaude: 'Claude',
    skinOptionNative: '原生（DSH）',
    reset: '恢复默认',
    resetHint: '功能开关保存后自动生效，不会刷新页面。',
    saveFailed: '保存失败，请重试。',
  },
  en: {
    nav: 'CodeMode',
    groupFeatures: 'Features',
    groupAppearance: 'Appearance',
    featureSidebar: 'Left sidebar',
    featureSidebarHint: 'Session tree and workspaces, plus the sidebar toggle and back/forward controls in the top-left corner (hover the toggle to float the collapsed sidebar; the web keeps no icon rail).',
    featureSplitView: 'Split view',
    featureSplitViewHint: 'Drag sessions from the sidebar into the content area to split, up to 2×2; off keeps a single pane. Requires the left sidebar.',
    featureSessionHeader: 'Session header',
    featureSessionHeaderHint: 'Click the title to rename in place; the dropdown beside the name holds "More" and "Open in".',
    featureSidePanel: 'Right rail',
    featureSidePanelHint: 'The Claude-style session rail and header tool entries; off restores the native rail.',
    featureRewind: 'Message rewind',
    featureRewindHint: 'Rewind to any user message, optionally restoring the files that changed in that range.',
    featureImagePreview: 'Image preview',
    featureImagePreviewHint: 'One lightbox for every image in a session; off opens images in the right rail again.',
    skinLabel: 'Skin',
    skinHint: 'Pick the palette and type; native mounts no skin and every feature keeps working. Takes effect immediately.',
    skinOptionClaude: 'Claude',
    skinOptionNative: 'Native (DSH)',
    reset: 'Restore defaults',
    resetHint: 'Feature switches apply automatically; the page is not reloaded.',
    saveFailed: 'Could not save. Please try again.',
  },
}

/**
 * 设置页主体：按 catalog 的分组画开关与下拉。
 * @param {{ t: (key: string) => string }} props
 */
function SettingsPage({ t }) {
  const snapshot = React.useSyncExternalStore(subscribePreferences, getPreferencesSnapshot)
  const [pending, setPending] = React.useState(null)
  const [skinPending, setSkinPending] = React.useState(false)

  const toggle = React.useCallback((id, next) => {
    setPending(id)
    void (async () => {
      try {
        await setFeatureEnabled(id, next)
        // 偏好已落盘：宿主 touch 自己的 client bundle，client-hmr 只重载插件。
        await waitForClientReload()
      } catch {
        setPending(null)
      }
    })()
  }, [])

  const reset = React.useCallback(() => {
    setPending('reset')
    void (async () => {
      try {
        await resetPreferences()
        await waitForClientReload()
      } catch {
        setPending(null)
      }
    })()
  }, [])

  const pickSkin = React.useCallback((value) => {
    setSkinPending(true)
    void (async () => {
      try {
        await setSkin(value)
      } catch {
        /* store 已回滚并记录错误 */
      } finally {
        setSkinPending(false)
      }
    })()
  }, [])

  const busy = pending !== null
  const disabled = snapshot.disabled

  return h('div', { className: 'ct-fs' },
    FEATURE_CATALOG.map((group) => h('section', { key: group.id, className: 'ct-fs-group' },
      h('h3', { className: 'ct-fs-group-title' }, t(group.titleKey)),
      group.rows.map((row) => row.kind === 'select'
        ? rowSelect({ row, t, value: snapshot.skin, pending: skinPending, onPick: pickSkin })
        : rowSwitch({ row, t, disabled, busy, pending, toggle })),
    )),
    h('div', { className: 'ct-fs-footer' },
      h('button', {
        type: 'button',
        className: 'ct-fs-reset',
        disabled: busy || (disabled.size === 0 && snapshot.skin === 'claude'),
        onClick: reset,
      }, t('reset')),
      h('p', { className: 'ct-fs-hint' }, t('resetHint')),
    ),
    snapshot.error === 'save'
      ? h('p', { className: 'ct-fs-error', role: 'alert' }, t('saveFailed'))
      : null,
    // 设置导航叫 CodeMode（品牌），这里用安装包名 + 版本说明是哪个插件。
    h('p', { className: 'ct-fs-identity' }, `claude-code-mode v${PLUGIN_VERSION}`),
  )
}

/**
 * 等宿主触发的插件热重载：client-hmr 收到 rebuilt 后重新装载插件，apply 会
 * 自增 `window.__CT_APPLY_COUNT__`。等不到（headless、HMR 未运行、旧宿主）时
 * 回退到整页刷新，保证开关最终生效。
 * @returns {Promise<void>}
 */
function waitForClientReload() {
  const before = Number(window.__CT_APPLY_COUNT__) || 0
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const check = () => {
      if ((Number(window.__CT_APPLY_COUNT__) || 0) !== before) {
        resolve()
        return
      }
      if (Date.now() - startedAt >= CLIENT_RELOAD_TIMEOUT_MS) {
        window.location.reload()
        return
      }
      window.setTimeout(check, 100)
    }
    check()
  })
}

/**
 * 一行开关：标题 + 说明 + 右侧原生 Switch。
 * `requires` 指向另一个开关：那个开关关掉时，本开关在界面上禁用。
 * @param {{
 *   row: { id: string, labelKey: string, hintKey: string, requires?: string },
 *   t: (key: string) => string,
 *   disabled: ReadonlySet<string>,
 *   busy: boolean,
 *   pending: string | null,
 *   toggle: (id: string, next: boolean) => void,
 * }} props
 */
function rowSwitch({ row, t, disabled, busy, pending, toggle }) {
  const checked = !disabled.has(row.id)
  const blocked = row.requires !== undefined && disabled.has(row.requires)
  const label = t(row.labelKey)
  return h('div', { key: row.id, className: 'ct-fs-row', 'data-ct-fs-row': row.id },
    h('div', { className: 'ct-fs-row-text' },
      h('span', { className: 'ct-fs-row-label' }, label),
      h('span', { className: 'ct-fs-row-hint' }, t(row.hintKey)),
    ),
    h(Switch, {
      checked,
      disabled: busy || blocked,
      label,
      onChange: (next) => { if (!blocked) toggle(row.id, next) },
      className: 'ct-fs-switch',
    }),
    pending === row.id ? h('span', { className: 'ct-fs-saving', 'aria-hidden': 'true' }) : null,
  )
}

/**
 * 一行下拉：标题 + 说明 + 右侧原生 select。
 * @param {{
 *   row: { id: string, labelKey: string, hintKey: string, options: ReadonlyArray<{ value: string, labelKey: string }> },
 *   t: (key: string) => string,
 *   value: string,
 *   pending: boolean,
 *   onPick: (value: string) => void,
 * }} props
 */
function rowSelect({ row, t, value, pending, onPick }) {
  const label = t(row.labelKey)
  return h('div', { key: row.id, className: 'ct-fs-row', 'data-ct-fs-row': row.id },
    h('div', { className: 'ct-fs-row-text' },
      h('span', { className: 'ct-fs-row-label' }, label),
      h('span', { className: 'ct-fs-row-hint' }, t(row.hintKey)),
    ),
    h('select', {
      className: 'ct-fs-select',
      'data-ct-fs-select': row.id,
      value: row.options.some((option) => option.value === value) ? value : row.options[0]?.value,
      disabled: pending,
      'aria-label': label,
      onChange: (event) => { onPick(event.target.value) },
    }, row.options.map((option) => h('option', { key: option.value, value: option.value }, t(option.labelKey)))),
    pending ? h('span', { className: 'ct-fs-saving', 'aria-hidden': 'true' }) : null,
  )
}

/**
 * 导航图标：一颗四角星，颜色继承导航行文字色。
 * @param {{ size?: number }} [props]
 */
function FeatureIcon(props) {
  const size = typeof props?.size === 'number' ? props.size : 16
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
  }, h('path', {
    d: 'M8 1.6l1.55 4.85L14.4 8l-4.85 1.55L8 14.4 6.45 9.55 1.6 8l4.85-1.55z',
    fill: 'currentColor',
  }))
}

/**
 * 安装设置页。
 * @param {any} ctx
 * @returns {() => void}
 */
export function install(ctx) {
  let style = document.getElementById(STYLE_ID)
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = settingsCss

  let dispose = () => {}
  dispose = ctx.inject(['slots', 'locale'], (scope) => {
    const locale = scope.get('locale')
    scope.effect(() => locale.register(LOCALE_NS, DICTIONARIES), 'feature-settings: copy')
    const t = locale.bind(LOCALE_NS)
    const Page = () => h(SettingsPage, { t })
    const stops = [
      scope.slots.inject(SECTION_SLOT, () => scope.slots.register({
        name: SECTION_SLOT,
        id: SECTION_ID,
        order: SECTION_ORDER,
        label: () => t('nav'),
      }, Page)),
      scope.slots.inject(ICON_SLOT, () => scope.slots.register({
        name: ICON_SLOT,
        id: SECTION_ID,
      }, FeatureIcon)),
    ]
    return () => {
      for (const stop of stops) stop()
    }
  })

  return () => {
    if (typeof dispose === 'function') dispose()
    if (document.getElementById(STYLE_ID) === style) style?.remove()
  }
}
