/** 功能层：按顺序安装功能，卸载时倒序拆掉。
 *
 * 一个功能 = { id, install(ctx, ui) -> teardown?, gate?, alwaysOn? }。
 * 安装哪些由宿主持久化的开关偏好决定（`core/preferences.js`）：`gate` 是偏好里
 * 存的那个开关 id（一个开关可以控制多个 feature，例如侧栏与窗口控件共用
 * `sidebar`）。`alwaysOn` 的功能不受开关影响——设置页自己必须是 alwaysOn，
 * 否则关掉它就再也打不开。
 *
 * 功能之间不互相 import；共用能力放 core/ 或 features 之外的 shared/。
 */

import { isFeatureEnabled } from './preferences.js'

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Array<{ id: string, install: (ctx: unknown, ui: unknown) => (() => void) | void, alwaysOn?: boolean }>} features
 * @param {unknown} ui
 * @returns {() => void}
 */
export function mountFeatures(ctx, features, ui) {
  /** @type {Array<() => void>} */
  const disposers = []

  for (const feature of features) {
    if (feature.alwaysOn !== true && !isFeatureEnabled(feature.gate ?? feature.id)) continue
    try {
      const dispose = feature.install(ctx, ui)
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch (error) {
      // 一个功能挂掉不影响其它功能，也不拖垮宿主启动
      console.warn(`[claude-code-mode] feature "${feature.id}" failed`, error)
    }
  }

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch (error) {
        console.warn('[claude-code-mode] feature teardown failed', error)
      }
    }
  }
}
