/* 设置页渲染冒烟：这里锁的是「组件不会因为读偏好而抛错」。
 *
 * 背景：偏好快照里的 `disabled` 是 Set，曾经在设置页误用数组的 `.includes()`。
 * 渲染期抛错会被 React 吞掉，整块设置面板直接空白（Web 与桌面端同时中招），
 * 而控制台不一定有痕迹。所以用静态断言盯住用法本身。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getPreferencesSnapshot } from '../../src/client/core/preferences.js'

const SETTINGS = fileURLToPath(new URL('../../src/client/features/feature-settings/index.js', import.meta.url))

test('偏好快照的 disabled 是 Set（不是数组）', () => {
  const snapshot = getPreferencesSnapshot()
  assert.ok(snapshot.disabled instanceof Set, 'disabled 必须是 Set')
  assert.equal(typeof snapshot.disabled.has, 'function')
})

test('设置页不把 disabled 当数组用', () => {
  const source = readFileSync(SETTINGS, 'utf8')
  assert.equal(
    /\.disabled\.includes\(/u.test(source),
    false,
    'disabled 是 Set，用 .includes() 会在渲染期抛错并让整个设置页空白；请用 .has()',
  )
})

test('设置页每个开关项都有对应的文案 key', async () => {
  const { FEATURE_CATALOG } = await import('../../src/client/core/catalog.js')
  const source = readFileSync(SETTINGS, 'utf8')
  const rows = FEATURE_CATALOG.flatMap((group) => group.rows)
  const missing = []
  for (const row of rows) {
    // 文案以 `labelKey: 'xxx'` 的形式出现在字典里，形如 `xxx: '文案'`。
    if (!new RegExp(`^\\s{4}${row.labelKey}:`, 'mu').test(source)) missing.push(row.labelKey)
    if (row.hintKey !== undefined && !new RegExp(`^\\s{4}${row.hintKey}:`, 'mu').test(source)) {
      missing.push(row.hintKey)
    }
  }
  assert.deepEqual(missing, [], 'catalog 里的每个 labelKey/hintKey 都要在字典里有文案')
})
