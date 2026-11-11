/* 皮肤与深色/浅色主题的自适应约束。
 *
 * 这里防的是「深色主题下分组图标、chevron、行操作按钮消失」这类回归：
 * 皮肤在共享块里写死一个浅色墨色，深色块又没有重新声明，于是深色底上还是深色字。
 *
 * 三条断言：
 *  1. 插件 CSS 引用的每个 --dsw-* 令牌，都必须是 DSH 真的定义过的（快照见
 *     test/theme/dsh-tokens.json）。引用不存在的令牌只会拿到各自写的浅色回退值，
 *     在深色主题里就是浅色字压深色底。
 *  2. 皮肤共享块里带绝对色值的声明，深色块必须重新声明（或进 BOTH_THEMES 白名单）。
 *  3. 皮肤深色块声明的令牌必须也在共享块里出现，避免只在深色下存在的孤儿令牌。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SKIN_PATH = join(ROOT, 'src/skins/claude/skin.css')
const LIGHT_SELECTOR = "body[data-ct-skin='claude']"
const DARK_SELECTOR = "body[data-ct-skin='claude'][data-ds-dark-theme]"

/** 深浅两套主题下刻意保持同一个值（并且必须保持）的令牌，附理由。 */
const BOTH_THEMES = new Map([
  ['--ct-accent', '品牌强调色在深浅底上都是 Claude 橙'],
  ['--ct-wb-shimmer-color', '运行中光带在深浅底上都是白色高光'],
  ['--ct-image-preview-mask', '原图灯箱遮罩深浅都压到 72% 黑'],
])

/** 令牌是否真的在 DSH 里定义过。 */
function dshTokens() {
  const fixture = JSON.parse(readFileSync(join(ROOT, 'test/theme/dsh-tokens.json'), 'utf8'))
  return { version: fixture.dshVersion, names: new Set(fixture.tokens) }
}

/** 收集插件源码里所有 CSS 文件。 */
function cssFiles(dir = join(ROOT, 'src')) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...cssFiles(path))
    else if (entry.endsWith('.css')) out.push(path)
  }
  return out
}

/** 取出 `selector { ... }` 的声明块文本（只处理本文件用到的扁平块）。 */
function blockOf(css, selector) {
  const start = css.indexOf(`${selector} {`)
  assert.notEqual(start, -1, `skin.css 里找不到 ${selector} 声明块`)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error(`${selector} 声明块没有闭合`)
}

/** 把声明块拆成 Map<token, value>，忽略注释与普通属性。 */
function declarations(block) {
  const out = new Map()
  const body = block.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const raw of body.split(';')) {
    const line = raw.trim()
    if (!line.startsWith('--')) continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    out.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  return out
}

const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklab|oklch|lab|lch|color)\(/i

test('插件引用的 --dsw-* 令牌都存在于 DSH 主题', () => {
  const { version, names } = dshTokens()
  const missing = []
  for (const file of cssFiles()) {
    const css = readFileSync(file, 'utf8')
    for (const match of css.matchAll(/var\(\s*(--dsw-[a-z0-9-]+)/g)) {
      if (!names.has(match[1])) missing.push(`${relative(ROOT, file)}: ${match[1]}`)
    }
  }
  assert.deepEqual(
    [...new Set(missing)].sort(),
    [],
    `DSH ${version} 没有这些令牌，插件 CSS 会退到各自的浅色回退值，深色主题下必然失效`,
  )
})

test('皮肤共享块的绝对色值在深色块里有对应声明', () => {
  const css = readFileSync(SKIN_PATH, 'utf8')
  const light = declarations(blockOf(css, LIGHT_SELECTOR))
  const dark = declarations(blockOf(css, DARK_SELECTOR))

  const offenders = []
  for (const [token, value] of light) {
    if (!COLOR_LITERAL.test(value)) continue
    if (dark.has(token)) continue
    if (BOTH_THEMES.has(token)) continue
    offenders.push(`${token}: ${value}`)
  }
  assert.deepEqual(
    offenders,
    [],
    '共享块写死色值的令牌深色块没有重新声明：深色主题会继续用浅色值（把确实两套同值的令牌加进 BOTH_THEMES 并写明理由）',
  )
})

test('皮肤深色块不声明共享块里没有的令牌', () => {
  const css = readFileSync(SKIN_PATH, 'utf8')
  const light = declarations(blockOf(css, LIGHT_SELECTOR))
  const dark = declarations(blockOf(css, DARK_SELECTOR))
  const orphans = [...dark.keys()].filter((token) => !light.has(token))
  assert.deepEqual(orphans, [], '深色块只能覆盖共享块已有的令牌')
})

test('皮肤不重复声明 DSH 不存在的别名令牌', () => {
  const { names } = dshTokens()
  const css = readFileSync(SKIN_PATH, 'utf8')
  const declared = [...declarations(blockOf(css, LIGHT_SELECTOR)).keys()]
  const unknown = declared.filter((token) => token.startsWith('--dsw-alias-') && !names.has(token))
  assert.deepEqual(unknown, [], '皮肤不要凭空声明 DSH 别名令牌，应改功能层引用真实令牌或从墨色派生')
})
