import { join } from 'node:path'

/** 场景清单也是本地、公开 PR CI 和私有云端调度共享的行为契约。 */
export const SCENARIOS = Object.freeze([
  { id: 'sidebar-mounted', feature: 'sidebar', parityIds: [1, 3], core: true, actions: '加载项目和合成会话', assertions: '插件列表可见、尺寸有效、没有 slot 错误', run: sidebar },
  { id: 'title-rename', feature: 'session-header', parityIds: [59], core: true, actions: '点击标题、Enter 保存、Esc 取消', assertions: '标题和侧栏同步，取消不提交', run: titleRename },
  { id: 'fork-tree-and-collapse', feature: 'sidebar', parityIds: [3, 10], core: true, actions: '从菜单分叉、折叠和展开', assertions: 'fork 挂到父会话下，折叠保留父行与摘要', run: forkTree },
  { id: 'split-open-refresh-close', feature: 'split-view', parityIds: [46, 48, 49], core: true, actions: '打开两屏、刷新、关闭另一屏', assertions: '会话身份和布局恢复，关闭保留原主屏', run: splitRestore },
  { id: 'theme-light-and-dark', feature: 'skin', parityIds: [], core: true, actions: '切换深浅主题并截图', assertions: '当前会话文字和背景可区分，界面没有越界', run: theme },
  { id: 'preferences-disable-split-and-skin', feature: 'preferences', parityIds: [], core: true, actions: '保存关闭分屏和皮肤的偏好并刷新', assertions: '侧栏仍可用，分屏安装点与菜单均退出，恢复设置生效', run: preferences },
  { id: 'search-palette', feature: 'sidebar', parityIds: [], core: false, actions: '打开搜索、查找当前夹具、切换分类、Esc 关闭', assertions: '命中与无结果状态正确，打开结果选择对应会话', run: search },
  { id: 'session-pin-and-archive', feature: 'sidebar', parityIds: [], core: false, actions: '置顶、取消置顶、归档、显示已归档、取消归档', assertions: '树归属和筛选同步，归档不弹确认', run: pinArchive },
  { id: 'four-pane-grid', feature: 'split-view', parityIds: [51, 52], core: false, actions: '打开四个会话、刷新、关闭主屏', assertions: '最多2×2、身份唯一、刷新恢复、相邻屏提升', run: fourPane },
  { id: 'jobs-panel-session-isolation', feature: 'conversation-side-panel', parityIds: [], core: false, actions: '通过更多菜单打开后台任务，在两屏分别切换', assertions: '入口条没有 jobs，面板仅影响所属会话', run: jobsIsolation },
].map(scenario => Object.freeze({ platform: 'web', fixture: 'synthetic-workspace-and-four-sessions', ...scenario })))

export const COVERAGE_GAPS = Object.freeze([
  { id: 'visual-baseline', feature: 'skin', reason: '尚无经维护者批准且匹配当前系统、Chrome和字体的像素基线；保存截图及布局断言，不将截图冒充视觉比较。' },
  { id: 'image-preview', feature: 'image-preview', reason: '图片入口与原图灯箱尚无公开E2E夹具。' },
  { id: 'rewind-files', feature: 'rewind', reason: '消息与文件回退当前由单测覆盖，浏览器回退流程尚未迁移。' },
  { id: 'jobs-lifecycle', feature: 'conversation-side-panel', reason: '本轮只验入口、空态和会话隔离；运行输出、停止、清空尚无完整宿主夹具。' },
  { id: 'mcp-provider-roundtrip', feature: 'mcp-tool-search', reason: '宿主单测会运行；真实工具调用与重启恢复尚未接入本浏览器入口。' },
  { id: 'desktop-native', feature: 'desktop', reason: 'Linux/Web验证不能代替macOS/Windows的原生窗口、菜单和系统剪贴板验收。' },
])

export function selectScenarios({ suite = 'core', scenario, onlyRegression = false } = {}) {
  if (!['core', 'full'].includes(suite)) throw new Error('--suite must be core or full')
  if (scenario) {
    const found = SCENARIOS.find(item => item.id === scenario)
    if (!found) throw new Error(`Unknown scenario: ${scenario}`)
    if (onlyRegression) throw new Error('--scenario cannot be combined with --only-regression')
    return [found]
  }
  return onlyRegression ? [] : SCENARIOS.filter(item => suite === 'full' || item.core)
}

/** 首次使用提示只通过真实按钮完成或关闭，不修改宿主 DOM 来绕过。 */
export async function dismissFirstUse(page) {
  const notice = page.getByRole('button', { name: /^(继续|Continue)$/ })
  await notice.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {})
  if (await notice.isVisible().catch(() => false)) await notice.click()
  const signIn = page.getByRole('dialog', { name: /^(开始使用|Get started)$/ })
  await signIn.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {})
  if (await signIn.isVisible().catch(() => false)) await signIn.getByRole('button', { name: /^(关闭|Close)$/ }).click()
}

const ROW = '[data-ct-wb-session]'
const SHELL = '[data-ct-shell]'
const ERRORS = '[data-slot-error], [data-ct-shell-error], [data-ct-sp-error]'

export function controls({ page, expect, fixtures, outputDir }) {
  const row = id => page.locator(`${ROW}[data-ct-wb-session="${id}"]`)
  const shell = id => page.locator(`${SHELL}[data-ct-shell="${id}"]`)
  const project = () => page.locator(`[data-ct-wb-workspace="${fixtures.workspaceId}"]`)
  const expand = async () => {
    const header = project().locator('.ct-wb-project').first()
    await expect(header).toBeVisible()
    if (await header.getAttribute('aria-expanded') === 'false') await header.click()
  }
  const menu = async (id, label) => {
    await row(id).click({ button: 'right' })
    await page.getByRole('menuitem', { name: label, exact: true }).click()
  }
  return {
    row, shell, project, expand, menu,
    first: fixtures.sessions[0], other: fixtures.sessions[1],
    capture: name => page.screenshot({ path: join(outputDir, `${name}.png`), animations: 'disabled' }),
    noErrors: () => expect(page.locator(ERRORS)).toHaveCount(0),
    bounds: async () => {
      const geometry = await page.locator(SHELL).evaluateAll(nodes => nodes.map(node => {
        const { x, y, width, height } = node.getBoundingClientRect()
        return { x, y, width, height }
      }))
      const viewport = page.viewportSize()
      for (const bounds of geometry) {
        expect(bounds.width).toBeGreaterThan(200)
        expect(bounds.height).toBeGreaterThan(200)
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.y).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1)
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1)
      }
      return geometry
    },
  }
}

async function sidebar(context) {
  const { page, expect } = context
  const ui = controls(context)
  await expect(page.locator('[data-slot="sidebar.workspaces"] .ct-wb')).toBeVisible()
  await ui.expand()
  for (const item of context.fixtures.sessions) await expect(ui.row(item.id)).toBeVisible()
  const box = await page.locator('.ct-wb').boundingBox()
  expect(box.width).toBeGreaterThan(120)
  expect(box.x).toBeGreaterThanOrEqual(0)
  await ui.noErrors()
  await ui.capture('sidebar')
}

async function titleRename(context) {
  const { page, expect } = context
  const ui = controls(context)
  await ui.expand()
  await ui.row(ui.first.id).click()
  const title = page.locator('[data-ct-session-title]').filter({ hasText: ui.first.title }).first()
  await title.click()
  const editor = page.locator('input.ct-title-editor')
  await expect(editor).toBeFocused()
  await editor.fill('CCM 重命名已保存')
  await editor.press('Enter')
  await expect(ui.row(ui.first.id)).toContainText('CCM 重命名已保存')
  const saved = page.locator('[data-ct-session-title]').filter({ hasText: 'CCM 重命名已保存' }).first()
  await expect(saved).toBeVisible()
  await saved.click()
  await editor.fill('CCM 此修改应取消')
  await editor.press('Escape')
  await expect(ui.row(ui.first.id)).toContainText('CCM 重命名已保存')
  await expect(editor).toHaveCount(0)
  await ui.capture('title-renamed')
}

async function forkTree(context) {
  const { page, expect } = context
  const ui = controls(context)
  await ui.expand()
  const before = await page.locator(ROW).evaluateAll(rows => rows.map(node => node.dataset.ctWbSession))
  await ui.menu(ui.first.id, '分叉会话')
  const child = ui.project().locator(`${ROW}.is-child`).first()
  await expect(child).toBeVisible()
  const childId = await child.getAttribute('data-ct-wb-session')
  expect(before).not.toContain(childId)
  await ui.row(ui.first.id).getByRole('button', { name: '隐藏嵌套会话', exact: true }).click()
  await expect(ui.row(ui.first.id)).toBeVisible()
  await expect(ui.row(childId)).toBeHidden()
  await expect(ui.project().locator('.ct-wb-summary')).toContainText('1 个嵌套会话')
  await ui.project().locator('.ct-wb-summary').click()
  await expect(ui.row(childId)).toBeVisible()
  await ui.capture('fork-tree')
}

async function splitRestore(context) {
  const { page, expect } = context
  const ui = controls(context)
  await ui.expand()
  await ui.row(ui.first.id).click()
  await ui.menu(ui.other.id, '在分屏中打开')
  await expect(page.locator(SHELL)).toHaveCount(2)
  await expect(ui.shell(ui.first.id)).toBeVisible()
  await expect(ui.shell(ui.other.id)).toBeVisible()
  await ui.bounds()
  await page.reload()
  await dismissFirstUse(page)
  await expect(page.locator(SHELL)).toHaveCount(2)
  await ui.bounds()
  await ui.capture('split-restored')
  await ui.shell(ui.other.id).locator('[data-ct-split-pane-close]').click()
  await expect(page.locator(SHELL)).toHaveCount(1)
  await expect(ui.shell(ui.first.id)).toBeVisible()
  await expect(page.locator('[data-ct-split-pane-close]')).toHaveCount(0)
}

async function theme(context) {
  const { page, expect } = context
  const ui = controls(context)
  await ui.expand()
  await ui.row(ui.first.id).click()
  await page.emulateMedia({ colorScheme: 'light' })
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
  await ui.capture('light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
  const colors = await ui.row(ui.first.id).evaluate(node => {
    const style = getComputedStyle(node)
    return { foreground: style.color, background: style.backgroundColor }
  })
  expect(colors.foreground).not.toBe(colors.background)
  await ui.bounds()
  await ui.capture('dark')
}

async function preferences(context) {
  const { page, expect, baseURL } = context
  const ui = controls(context)
  let response = await page.request.put(new URL('/claude-code-mode/preferences', baseURL).href, { data: { disabled: ['split-view'], skin: 'native' } })
  expect(response.ok()).toBe(true)
  await page.reload()
  await dismissFirstUse(page)
  await expect(page.locator('body')).not.toHaveAttribute('data-ct-skin')
  await expect(page.locator(`${SHELL}, [data-ct-shell-grid]`)).toHaveCount(0)
  await ui.expand()
  await expect(ui.row(ui.first.id)).toBeVisible()
  await ui.row(ui.other.id).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '在分屏中打开', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await ui.capture('native-skin-split-disabled')
  response = await page.request.put(new URL('/claude-code-mode/preferences', baseURL).href, { data: { disabled: [], skin: 'claude' } })
  expect(response.ok()).toBe(true)
  await page.reload()
  await dismissFirstUse(page)
  await expect(page.locator('body')).toHaveAttribute('data-ct-skin', 'claude')
}

async function search(context) {
  const { page, expect } = context
  const ui = controls(context)
  await ui.expand()
  await page.locator('.ct-wb-search-entry').click()
  const dialog = page.getByRole('dialog', { name: '搜索', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: '会话', exact: true }).click()
  await dialog.getByRole('textbox', { name: '搜索', exact: true }).fill(ui.first.title)
  await expect(dialog.getByRole('option').filter({ hasText: ui.first.title })).toHaveCount(1)
  await dialog.getByRole('textbox', { name: '搜索', exact: true }).fill('CCM_NO_RESULTS_9f527541')
  await expect(dialog.locator('.ct-search-empty')).toContainText('未找到')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.locator('.ct-wb-search-entry').click()
  await dialog.getByRole('textbox', { name: '搜索', exact: true }).fill(ui.first.title)
  await dialog.getByRole('option').filter({ hasText: ui.first.title }).click()
  await expect(dialog).toHaveCount(0)
  await expect(ui.row(ui.first.id)).toHaveAttribute('aria-current', 'true')
}

async function pinArchive(context) {
  const { page, expect } = context
  const ui = controls(context)
  await ui.expand()
  await ui.row(ui.first.id).click()
  await ui.menu(ui.first.id, '置顶会话')
  await expect(page.locator(`.ct-wb-group.is-pinned ${ROW}[data-ct-wb-session="${ui.first.id}"]`)).toBeVisible()
  await expect(ui.project().locator(`${ROW}[data-ct-wb-session="${ui.first.id}"]`)).toHaveCount(0)
  await ui.menu(ui.first.id, '取消置顶')
  await expect(ui.project().locator(`${ROW}[data-ct-wb-session="${ui.first.id}"]`)).toBeVisible()
  await ui.menu(ui.other.id, '归档会话')
  await expect(ui.row(ui.other.id)).toHaveCount(0)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await ui.project().locator('.ct-wb-project').first().hover()
  await ui.project().getByRole('button', { name: '分组和排序', exact: true }).click()
  await page.getByRole('menuitem', { name: '显示', exact: true }).hover()
  await page.getByRole('menuitemradio', { name: '全部对话（显示已归档）', exact: true }).click()
  await expect(ui.row(ui.other.id)).toBeVisible()
  await ui.menu(ui.other.id, '取消归档')
  await expect(ui.row(ui.other.id)).not.toHaveClass(/is-archived/)
  await ui.capture('pin-and-archive')
}

async function fourPane(context) {
  const { page, expect, fixtures } = context
  const ui = controls(context)
  await ui.expand()
  await ui.row(ui.first.id).click()
  for (const [index, item] of fixtures.sessions.slice(1, 4).entries()) {
    // 右列上下都有会话后，聚焦主屏再从菜单补入左下空位。
    if (index === 2) await ui.shell(ui.first.id).click({ position: { x: 20, y: 90 } })
    await ui.menu(item.id, '在分屏中打开')
  }
  await expect(page.locator(SHELL)).toHaveCount(4)
  const ids = await page.locator(SHELL).evaluateAll(nodes => nodes.map(node => node.dataset.ctShell))
  expect(new Set(ids).size).toBe(4)
  const geometry = await ui.bounds()
  expect(new Set(geometry.map(item => Math.round(item.x))).size).toBe(2)
  expect(new Set(geometry.map(item => Math.round(item.y))).size).toBe(2)
  await ui.row(ui.other.id).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '在分屏中打开', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.reload()
  await dismissFirstUse(page)
  await expect(page.locator(SHELL)).toHaveCount(4)
  expect((await page.locator(SHELL).evaluateAll(nodes => nodes.map(node => node.dataset.ctShell))).sort()).toEqual(ids.sort())
  await ui.capture('four-pane-restored')
  await ui.shell(ui.first.id).locator('[data-ct-split-pane-close]').click()
  await expect(page.locator(SHELL)).toHaveCount(3)
  await expect(ui.shell(ui.first.id)).toHaveCount(0)
  await ui.bounds()
}

async function jobsIsolation(context) {
  const { page, expect } = context
  const ui = controls(context)
  await ui.expand()
  await ui.row(ui.first.id).click()
  const toggleJobs = async id => {
    await ui.shell(id).locator('[data-ct-sp-more]').click()
    const entry = page.locator('[data-ct-sp-menu-jobs]')
    await expect(entry).toBeVisible()
    await entry.click()
  }
  await expect(page.locator('[data-ct-sp-entry="ct-jobs"]')).toHaveCount(0)
  await toggleJobs(ui.first.id)
  await expect(ui.shell(ui.first.id).locator('[data-ct-jobs-panel]')).toBeVisible()
  await expect(ui.shell(ui.first.id).locator('[data-ct-jobs-panel]')).toContainText('没有后台任务')
  await ui.menu(ui.other.id, '在分屏中打开')
  await expect(page.locator(SHELL)).toHaveCount(2)
  await expect(ui.shell(ui.other.id).locator('[data-ct-jobs-panel]')).toHaveCount(0)
  await toggleJobs(ui.other.id)
  await expect(ui.shell(ui.other.id).locator('[data-ct-jobs-panel]')).toBeVisible()
  await toggleJobs(ui.first.id)
  await expect(ui.shell(ui.first.id).locator('[data-ct-jobs-panel]')).toHaveCount(0)
  await expect(ui.shell(ui.other.id).locator('[data-ct-jobs-panel]')).toBeVisible()
  await ui.capture('jobs-per-session')
}
