/** 纯搜索：分词、字段加权 BM25、精确/前缀/CJK 匹配。
 *
 * 不依赖 DSH、ctx 或网络，方便直接用 node --test 固定排序行为。
 */

const WORD_PATTERN = /[a-z0-9]+|[\u3400-\u4dbf\u4e00-\u9fff]+/g
const COMPACT_PATTERN = /[^a-z0-9\u3400-\u4dbf\u4e00-\u9fff]+/g

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it',
  'its', 'me', 'my', 'of', 'on', 'or', 'our', 'so', 'than', 'that', 'the', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'to', 'tool', 'tools', 'up', 'use',
  'used', 'using', 'was', 'we', 'were', 'what', 'when', 'which', 'who', 'will', 'with',
  'you', 'your', 'mcp',
])

const K1 = 1.2
const B = 0.75

/**
 * 小写并把 camelCase / PascalCase 拆开。
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
}

/**
 * 分词：英文按词，中文按单字 + bigram；同时给出单数形式。
 * @param {unknown} value
 * @returns {string[]}
 */
export function tokenize(value) {
  if (typeof value !== 'string' || value.length === 0) return []
  const tokens = []
  const text = normalize(value)
  WORD_PATTERN.lastIndex = 0
  let match
  while ((match = WORD_PATTERN.exec(text)) !== null) {
    const chunk = match[0]
    if (/^[a-z0-9]+$/.test(chunk)) {
      if (chunk.length < 2 || STOPWORDS.has(chunk)) continue
      tokens.push(chunk)
      if (chunk.length > 3 && chunk.endsWith('s') && !chunk.endsWith('ss')) tokens.push(chunk.slice(0, -1))
      continue
    }
    if (chunk.length <= 4) tokens.push(chunk)
    for (const character of chunk) tokens.push(character)
    for (let index = 0; index < chunk.length - 1; index += 1) tokens.push(chunk.slice(index, index + 2))
  }
  return tokens
}

/**
 * 去掉分隔符的紧凑形式，用来匹配 `Mach-O` / `inspect_macho` / `inspect macho`。
 * @param {unknown} value
 * @returns {string}
 */
export function compact(value) {
  return typeof value === 'string' ? value.toLowerCase().replace(COMPACT_PATTERN, '') : ''
}

/**
 * 截断并压缩空白，用于模型可见的搜索结果。
 * @param {string} value
 * @param {number} limit
 * @returns {string}
 */
export function clipText(value, limit) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

/**
 * 建一个字段索引。
 * @param {Array<{ name: string, description: string, server: string }>} entries
 * @returns {{
 *   docs: Array<{
 *     entry: { name: string, description: string, server: string },
 *     nameTokens: string[],
 *     descriptionTokens: string[],
 *     serverTokens: string[],
 *     nameLower: string,
 *     nameCompact: string,
 *     descriptionLower: string,
 *   }>,
 *   stats: Record<string, { avgLength: number, df: Map<string, number> }>,
 *   N: number,
 * }}
 */
export function createSearchIndex(entries) {
  const docs = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string') continue
    const description = typeof entry.description === 'string' ? entry.description : ''
    const server = typeof entry.server === 'string' ? entry.server : ''
    docs.push({
      entry: { name: entry.name, description, server },
      nameTokens: tokenize(entry.name),
      descriptionTokens: tokenize(description),
      serverTokens: tokenize(server),
      nameLower: entry.name.toLowerCase(),
      nameCompact: compact(entry.name),
      descriptionLower: description.toLowerCase(),
    })
  }

  const stats = {}
  for (const field of ['name', 'description', 'server']) {
    const df = new Map()
    let total = 0
    for (const doc of docs) {
      const tokens = doc[`${field}Tokens`]
      total += tokens.length
      for (const token of new Set(tokens)) df.set(token, (df.get(token) ?? 0) + 1)
    }
    stats[field] = { df, avgLength: docs.length === 0 ? 1 : total / docs.length }
  }

  return { docs, stats, N: docs.length }
}

/**
 * 单字段 BM25。
 * @param {string[]} tokens
 * @param {string[]} queryTokens
 * @param {{ avgLength: number, df: Map<string, number> }} stats
 * @param {number} weight
 * @param {number} N
 * @returns {number}
 */
function bm25(tokens, queryTokens, stats, weight, N) {
  if (tokens.length === 0) return 0
  const counts = new Map()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)

  let score = 0
  const average = stats.avgLength > 0 ? stats.avgLength : 1
  for (const token of queryTokens) {
    const tf = counts.get(token)
    if (tf === undefined) continue
    const df = stats.df.get(token) ?? 0
    if (df === 0) continue
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
    const norm = 1 - B + B * (tokens.length / average)
    score += weight * idf * ((tf * (K1 + 1)) / (tf + K1 * norm))
  }
  return score
}

/**
 * 前缀/词干级匹配的补充分。
 * @param {string[]} tokens
 * @param {string[]} queryTokens
 * @param {number} weight
 * @returns {number}
 */
function prefixBonus(tokens, queryTokens, weight) {
  if (tokens.length === 0) return 0
  const unique = new Set(tokens)
  let bonus = 0
  for (const query of queryTokens) {
    if (query.length < 3) continue
    for (const token of unique) {
      if (token === query) continue
      if (token.startsWith(query) || (token.length >= 4 && query.startsWith(token))) bonus += weight
    }
  }
  return bonus
}

/**
 * 在索引上搜索。
 * @param {ReturnType<typeof createSearchIndex>} index
 * @param {string} query
 * @param {{ limit?: number, server?: string }} [options]
 * @returns {Array<{ name: string, description: string, server: string }>}
 */
export function searchIndex(index, query, options = {}) {
  const text = typeof query === 'string' ? query.trim() : ''
  if (text === '' || index === undefined || index.docs.length === 0) return []

  const limit = Number.isInteger(options.limit) ? Math.min(20, Math.max(1, options.limit)) : 8
  const wantedServer = typeof options.server === 'string' ? options.server.trim() : ''
  const queryTokens = [...new Set(tokenize(text))]
  if (queryTokens.length === 0) return []

  const compactQuery = compact(text)
  const lowerQuery = text.toLowerCase()
  const results = []

  for (const doc of index.docs) {
    if (wantedServer !== '' && doc.entry.server !== wantedServer) continue

    let score = bm25(doc.nameTokens, queryTokens, index.stats.name, 6, index.N)
      + bm25(doc.descriptionTokens, queryTokens, index.stats.description, 1, index.N)
      + bm25(doc.serverTokens, queryTokens, index.stats.server, 2, index.N)
      + prefixBonus(doc.nameTokens, queryTokens, 1.5)
      + prefixBonus(doc.descriptionTokens, queryTokens, 0.25)

    if (compactQuery !== '' && doc.nameCompact === compactQuery) score += 30
    else if (compactQuery.length >= 3 && doc.nameCompact.includes(compactQuery)) score += 8
    if (lowerQuery.length >= 4 && doc.descriptionLower.includes(lowerQuery)) score += 3

    if (score > 0) results.push({ score, doc })
  }

  results.sort((left, right) => right.score - left.score || left.doc.entry.name.localeCompare(right.doc.entry.name))
  return results.slice(0, limit).map(({ doc }) => ({
    name: doc.entry.name,
    description: clipText(doc.entry.description, 240),
    server: doc.entry.server,
  }))
}