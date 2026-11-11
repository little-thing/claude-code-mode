/** 设置页清单：开关分组、展示顺序与控件类型的唯一数据源。
 *
 * 每个开关是一个「用户概念」，可能由多个 feature 实现：
 *  - `id`：偏好里存的开关 id（`disabled` 集合的成员）；
 *  - `members`：这个开关控制的 feature id（`client/index.js` 的 FEATURES）；
 *  - `requires`：依赖的另一个开关；依赖关闭时本开关在界面上禁用。
 *
 * 皮肤不是开关，是外观组里的一个下拉取值（对应 SKINS 的 id 加 `native`）。
 * 文案 key 由设置页字典提供（`features/feature-settings/index.js`）。
 *
 * 新增功能时三处一起改：FEATURES（带 `gate`）、这里、字典（README 也补一行）。
 */

/** @type {ReadonlyArray<{
 *   id: string,
 *   titleKey: string,
 *   rows: ReadonlyArray<
 *     | { id: string, kind: 'switch', labelKey: string, hintKey: string, members: readonly string[], requires?: string }
 *     | { id: string, kind: 'select', labelKey: string, hintKey: string, options: ReadonlyArray<{ value: string, labelKey: string }> }
 *   >,
 * }>} */
export const FEATURE_CATALOG = [
  {
    id: 'features',
    titleKey: 'groupFeatures',
    rows: [
      {
        id: 'sidebar',
        kind: 'switch',
        labelKey: 'featureSidebar',
        hintKey: 'featureSidebarHint',
        members: ['workspace-browser', 'window-chrome'],
      },
      {
        id: 'split-view',
        kind: 'switch',
        labelKey: 'featureSplitView',
        hintKey: 'featureSplitViewHint',
        members: [],
        requires: 'sidebar',
      },
      {
        id: 'session-header',
        kind: 'switch',
        labelKey: 'featureSessionHeader',
        hintKey: 'featureSessionHeaderHint',
        members: ['conversation-header-menu', 'conversation-title-edit'],
      },
      {
        id: 'conversation-side-panel',
        kind: 'switch',
        labelKey: 'featureSidePanel',
        hintKey: 'featureSidePanelHint',
        members: ['conversation-side-panel'],
      },
      {
        id: 'conversation-rewind',
        kind: 'switch',
        labelKey: 'featureRewind',
        hintKey: 'featureRewindHint',
        members: ['conversation-rewind'],
      },
      {
        id: 'image-preview',
        kind: 'switch',
        labelKey: 'featureImagePreview',
        hintKey: 'featureImagePreviewHint',
        members: ['image-preview'],
      },
    ],
  },
  {
    id: 'appearance',
    titleKey: 'groupAppearance',
    rows: [
      {
        id: 'skin',
        kind: 'select',
        labelKey: 'skinLabel',
        hintKey: 'skinHint',
        options: [
          { value: 'claude', labelKey: 'skinOptionClaude' },
          { value: 'native', labelKey: 'skinOptionNative' },
        ],
      },
    ],
  },
]

/** 所有功能开关的 id（不含皮肤）。 */
export const FEATURE_IDS = FEATURE_CATALOG
  .flatMap((group) => group.rows)
  .filter((row) => row.kind === 'switch')
  .map((row) => row.id)

/**
 * 旧版本偏好里的 feature id → 新的开关 id。
 * 两个会话 header 交互合成一个开关、侧栏与窗口控件合成一个开关。
 * @type {Readonly<Record<string, string>>}
 */
export const LEGACY_SWITCH_IDS = {
  'workspace-browser': 'sidebar',
  'window-chrome': 'sidebar',
  'conversation-header-menu': 'session-header',
  'conversation-title-edit': 'session-header',
}
