/** mcp-tool-search 配置：归一化、校验、编译匹配器。
 *
 * 代码默认关闭；发行 patch（cordis.patch.yml）显式打开。这样升级不会静默改变
 * 已有 profile 的 MCP 行为。
 */

/** 默认选项。 */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  toolName: 'mcp_tool_search',
  include: '^mcp__',
  exclude: [],
  preload: [],
  maxResults: 8,
  /** 0 = 不限制；非 0 时只限制新激活数量，不卸载已经加载的工具。 */
  maxActiveTools: 0,
  hint: true,
})

/** DeepSeek function name 约束。 */
const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

/**
 * 编译一个匹配器。RegExp 去掉 g/y，避免 test() 的 lastIndex 造成状态泄漏。
 * @param {unknown} value
 * @param {string} label
 * @returns {RegExp}
 */
function compileMatcher(value, label) {
  if (value instanceof RegExp) {
    const flags = value.flags.replace(/[gy]/g, '')
    return new RegExp(value.source, flags)
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string or RegExp`)
  }
  try {
    return new RegExp(value)
  } catch (error) {
    throw new TypeError(`${label} is not a valid regular expression: ${error.message}`)
  }
}

/**
 * 去重、去空白的字符串数组。
 * @param {unknown} value
 * @param {string} label
 * @returns {string[]}
 */
function stringList(value, label) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array of strings`)
  const seen = new Set()
  for (const item of value) {
    if (typeof item !== 'string') throw new TypeError(`${label} must contain only strings`)
    const text = item.trim()
    if (text !== '') seen.add(text)
  }
  return [...seen]
}

/**
 * 把用户配置归一化成运行时选项。
 * @param {unknown} raw
 * @returns {{
 *   enabled: boolean,
 *   toolName: string,
 *   includeRe: RegExp,
 *   excludeRes: RegExp[],
 *   preload: string[],
 *   preloadSet: Set<string>,
 *   maxResults: number,
 *   maxActiveTools: number,
 *   hint: boolean,
 * }}
 */
export function resolveConfig(raw) {
  const base = {
    ...DEFAULT_CONFIG,
    ...(raw === true ? { enabled: true } : {}),
    ...(raw === false ? { enabled: false } : {}),
    ...(raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}),
  }

  if (typeof base.enabled !== 'boolean') throw new TypeError('enabled must be a boolean')
  if (typeof base.toolName !== 'string' || !TOOL_NAME_PATTERN.test(base.toolName)) {
    throw new TypeError('toolName must match [A-Za-z][A-Za-z0-9_-]{0,63}')
  }
  if (base.toolName === 'run_code') throw new TypeError('toolName "run_code" is reserved by DSH')

  const includeRe = compileMatcher(base.include, 'include')
  const excludeRes = (Array.isArray(base.exclude) ? base.exclude : [base.exclude])
    .filter((value) => value !== undefined)
    .map((value, index) => compileMatcher(value, `exclude[${index}]`))

  const preload = stringList(base.preload, 'preload')
  if (!Number.isInteger(base.maxResults) || base.maxResults < 1 || base.maxResults > 20) {
    throw new TypeError('maxResults must be an integer between 1 and 20')
  }
  if (!Number.isInteger(base.maxActiveTools) || base.maxActiveTools < 0) {
    throw new TypeError('maxActiveTools must be a non-negative integer')
  }
  if (typeof base.hint !== 'boolean') throw new TypeError('hint must be a boolean')

  return {
    enabled: base.enabled,
    toolName: base.toolName,
    includeRe,
    excludeRes,
    preload,
    preloadSet: new Set(preload),
    maxResults: base.maxResults,
    maxActiveTools: base.maxActiveTools,
    hint: base.hint,
  }
}