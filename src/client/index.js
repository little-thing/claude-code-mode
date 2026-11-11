/** claude-code-mode 浏览器半边：按偏好装皮肤与功能。
 *
 * 入口只做装配，不放逻辑：
 *  - 偏好：core/preferences.js —— 宿主注入的首屏快照决定装哪些功能、用哪套皮肤
 *  - 皮肤：src/skins/<id>/   —— 颜色、字体等观感，可整套替换；`native` 表示不挂
 *  - 功能：src/client/features/<name>/ —— 结构/交互，与皮肤无关
 *
 * 皮肤是下拉选择而不是功能开关：它没有 install/teardown 的副作用，切换时只
 * 换样式与 body 标记，立即生效、不刷新页面。功能开关则决定装不装，保存后由
 * 设置页刷新一次页面完整生效。
 *
 * 设置页（features/feature-settings）自己也是功能，但 `alwaysOn`：用户关掉
 * 别的功能后必须还能回到设置里打开它们。
 */

import { mountFeatures } from './core/features.js'
import { getSkin, hydratePreferences, subscribePreferences } from './core/preferences.js'
import { mountSkin } from './core/skin.js'
import claudeSkin from '../skins/claude/index.js'
import * as workspaceBrowser from './features/workspace-browser/index.js'
import * as conversationRewind from './features/conversation-rewind/index.js'
import * as conversationSidePanel from './features/conversation-side-panel/index.js'
import * as conversationHeaderMenu from './features/conversation-header-menu/index.js'
import * as conversationTitleEdit from './features/conversation-title-edit/index.js'
import * as imagePreview from './features/image-preview/index.js'
import * as windowChrome from './features/window-chrome/index.js'
import * as featureSettings from './features/feature-settings/index.js'

/** 已登记的皮肤。新增皮肤时在这里补一行即可。 */
const SKINS = new Map([[claudeSkin.id, claudeSkin]])

const DEFAULT_SKIN = 'claude'
/** 不挂皮肤：DSH 原生观感。 */
const NATIVE_SKIN = 'native'
const SETTINGS_FEATURE_ID = 'feature-settings'

/**
 * 功能清单。顺序即安装顺序；卸载时倒序。`gate` 是偏好里的开关 id：一个开关可以
 * 控制多个 feature（`sidebar` = 会话树 + 窗口控件，`session-header` = 会话名下拉 +
 * 标题就地编辑）。`split-view` 不是独立 feature，由 workspace-browser 内部读取。
 * 皮肤不在这个列表里：它是取值不是开关。
 */
const FEATURES = [
  { id: 'image-preview', gate: 'image-preview', install: imagePreview.install },
  { id: 'workspace-browser', gate: 'sidebar', install: workspaceBrowser.install },
  { id: 'conversation-rewind', gate: 'conversation-rewind', install: conversationRewind.install },
  { id: 'conversation-side-panel', gate: 'conversation-side-panel', install: conversationSidePanel.install },
  { id: 'conversation-header-menu', gate: 'session-header', install: conversationHeaderMenu.install },
  { id: 'conversation-title-edit', gate: 'session-header', install: conversationTitleEdit.install },
  { id: 'window-chrome', gate: 'sidebar', install: windowChrome.install },
  { id: SETTINGS_FEATURE_ID, alwaysOn: true, install: featureSettings.install },
]

/**
 * @param {any} ctx 客户端 root context
 * @param {{ skin?: string }} [config]
 */
export function apply(ctx, config = {}) {
  // 插件每次被装载（首屏或 HMR 重载）都自增一次：设置页保存后靠它确认
  // 该重载的插件已经重新装载，没等到才回退到整页刷新。
  if (typeof window !== 'undefined') {
    window.__CT_APPLY_COUNT__ = (Number(window.__CT_APPLY_COUNT__) || 0) + 1
  }
  /** 配置里的皮肤只作为「默认皮肤」的兜底；用户选择优先。 */
  const configuredSkin = SKINS.get(config.skin ?? DEFAULT_SKIN) ?? claudeSkin

  let disposeFeatures = () => {}
  let disposeSkin = () => {}
  /** 当前已挂的皮肤 id；null 表示还没同步过。 */
  let mountedSkin = null

  const syncSkin = () => {
    const wanted = getSkin() === NATIVE_SKIN ? NATIVE_SKIN : (SKINS.get(getSkin())?.id ?? configuredSkin.id)
    if (wanted === mountedSkin) return
    if (typeof disposeSkin === 'function') {
      try {
        disposeSkin()
      } catch (error) {
        console.warn('[claude-code-mode] skin teardown failed', error)
      }
    }
    disposeSkin = () => {}
    mountedSkin = wanted
    if (wanted === NATIVE_SKIN) return
    disposeSkin = mountSkin(SKINS.get(wanted) ?? configuredSkin)
  }

  let unsubscribe = () => {}

  const start = () => {
    // 必须在装功能之前：装哪些功能、用哪套皮肤由宿主快照决定。
    hydratePreferences()
    syncSkin()
    // 皮肤下拉即时生效：偏好变化时重新挂 / 拆皮肤。
    unsubscribe = subscribePreferences(syncSkin)
    disposeFeatures = mountFeatures(ctx, FEATURES, { skin: configuredSkin })
  }

  const stop = () => {
    unsubscribe()
    disposeFeatures()
    disposeSkin()
  }

  if (typeof ctx?.effect === 'function') ctx.effect(() => {
    start()
    return stop
  })
  else {
    start()
    return stop
  }
}
