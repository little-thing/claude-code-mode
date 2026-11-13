/** 极简 shell 词法 + 简单命令拆解，只服务于危险操作判定。
 *
 * 不需要完整的 shell 语法：判定逻辑从严，解析器拿不准时由上层当成
 * 「无法确定」并拒绝。这里做三件事：
 *
 * 1. 逐字符扫描，同时完成「按控制符分段（`&&`、`||`、`;`、`|`、`&`、换行）」
 *    与「词法」；引号内的控制符不会被当成分隔符。
 * 2. `$(...)` 与反引号内的内容作为嵌套命令递归解析（嵌套命令同样要判）；
 *    `$VAR` / `${VAR}` 只记下「这一段是动态拼接」，字面值不可信。
 * 3. 从每段首词决定命令名，跳过 `sudo`、`env VAR=x` 这类前缀。
 *
 * 任何结构不确定（未闭合引号、未闭合 `$(`）都抛 SyntaxError，由上层拒绝。
 */

/** 会切分命令段的控制符（按长度优先匹配）。 */
const OPERATORS = ['&&', '||', ';;', '|&', ';', '|', '&', '\n']

/** 本身不执行、真正的命令在后面：跳过它继续找命令名。 */
const PREFIX_COMMANDS = new Set([
  'sudo', 'doas', 'nohup', 'time', 'command', 'exec', 'builtin', 'env', 'nice', 'ionice',
  'caffeinate', 'stdbuf', 'chroot', 'watch',
  // 提权或换命名空间：后面的命令一样要按同样的规则判。
  'unshare', 'nsenter', 'pkexec', 'runuser', 'su',
])

/** `xargs` / `parallel` 会把参数拼成真正的命令，单独标记。 */
const DISPATCH_COMMANDS = new Set(['xargs', 'parallel'])

/** 带自己选项的前缀：跳过后续 `-x` 参数再找命令。 */
const OPTION_PREFIXES = new Set([
  // 提权 / 换命名空间：自己的选项跳过后才是真正的命令。
  'sudo', 'doas', 'unshare', 'nsenter', 'pkexec', 'runuser', 'su',
  'env', 'command', 'nice', 'exec', 'nohup', 'time', 'stdbuf', 'caffeinate', 'watch', 'ionice',
])

/**
 * 带值的选项：`sudo -u root rm`、`nsenter -t 1 rm`、`su -u root -c 'cmd'`。
 * 只跳过选项本身而不跳过它的值，那个值会被当成命令名，后续判定静默失效。
 */
const OPTION_TAKES_VALUE = /^(?:-[ugoCDRhtpcTs]$|--(?:user|group|target|root|chroot|wd|command|setuid|setsid|shell)$)/u

/** 变量赋值形态（`FOO=bar`）。 */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * 把一段 shell 命令拆成简单命令列表（含嵌套命令替换内的命令）。
 * @param {string} source
 * @returns {{ words: Word[], raw: string }[]}
 */
export function parseCommands(source) {
  const text = String(source ?? '')
  const scanner = new Scanner(text)
  const segments = scanner.run()
  const commands = []
  for (const segment of segments) {
    if (segment.nested.length > 0) {
      // 命令替换产生的子命令也要参与判定；此处保留嵌套脚本文本。
      commands.push({ words: segment.words, raw: segment.raw.trim(), nested: segment.nested, connector: segment.connector })
    } else if (segment.words.length > 0 || segment.redirects.length > 0) {
      commands.push({ words: segment.words, redirects: segment.redirects, raw: segment.raw.trim(), connector: segment.connector })
    }
    for (const nested of segment.nested) {
      for (const inner of parseCommands(nested)) commands.push(inner)
    }
  }
  return commands
}

/**
 * @typedef {{
 *   text: string,
 *   quoted: boolean,
 *   dynamic: boolean,
 *   vars?: VarRef[],
 * }} Word
 * text 是去掉引号后的字面值；quoted 表示整词被引号包裹（不做通配展开）；
 * dynamic 表示含变量或命令替换，字面值不可信。
 *
 * vars 按出现顺序记录每个展开点，供上层做「正向证明」：
 * 判断这个目标会不会在变量为空时变成 / 或顶层目录。
 */

/**
 * @typedef {{
 *   kind: 'var' | 'cmdsub',
 *   name: string | null,
 *   guarded: boolean,
 *   fallback: string | null,
 * }} VarRef
 * kind=cmdsub 表示命令替换（无法静态求值）；
 * guarded 表示带 `:?`（值为空时 shell 会中止），fallback 是 `:-default` 的默认值。
 */

/** 逐字符扫描器：一次遍历同时产出分段与词法结果。 */
class Scanner {
  /** @param {string} source */
  constructor(source) {
    this.source = source
    this.index = 0
    this.segments = []
    this.current = newSegment()
    this.currentStart = 0
    this.word = newWord()
    this.quote = null
    // 重定向：`> file` 的 file 不是命令参数，但它是写入目标，必须单独记下来判定。
    this.pendingRedirect = null
    /** 下一段与当前段之间的连接符（`|`、`&&`、`;` …），管道与顺序执行要分开判。 */
    this.nextConnector = null
    /** heredoc 分隔符；非空时正文按数据跳过。 */
    this.heredocDelimiter = null
    this.heredocPending = false
  }

  run() {
    while (this.index < this.source.length) {
      // heredoc 正文是数据不是命令：`cat > f <<EOF` 里的引号和 `rm -rf` 字样
      // 都不该参与解析，否则正常的写文件会被当成语法错误或危险命令。
      if (this.heredocDelimiter !== null) {
        this.consumeHeredocBody()
        continue
      }
      const char = this.source[this.index]
      if (this.quote === "'") {
        this.consumeSingleQuoted()
        continue
      }
      if (this.quote === '"') {
        this.consumeDoubleQuoted()
        continue
      }
      this.consumeBare(char)
    }
    if (this.quote !== null) throw new SyntaxError('unbalanced quote')
    this.flushWord()
    this.flushSegment()
    return this.segments
  }

  consumeSingleQuoted() {
    const open = this.index - 1
    const close = this.source.indexOf("'", this.index)
    if (close < 0 || open < 0) throw new SyntaxError('unbalanced single quote')
    this.word.text += this.source.slice(open + 1, close)
    this.word.started = true
    this.word.quoted = true
    this.index = close + 1 // 跳过收尾单引号
    this.quote = null
  }

  consumeDoubleQuoted() {
    const char = this.source[this.index]
    if (char === '"') {
      this.word.started = true
      this.word.quoted = true
      this.quote = null
      this.index += 1
      return
    }
    if (char === '\\') {
      const next = this.source[this.index + 1]
      if (next === undefined) {
        this.word.dynamic = true
        this.word.started = true
        this.index += 1
        return
      }
      // 双引号内只有 $ ` " \ 换行可转义，其余反斜杠按字面保留。
      if ('$`"\\\n'.includes(next)) {
        this.word.text += next === '\n' ? '' : next
      } else {
        this.word.text += `\\${next}`
      }
      this.word.started = true
      this.index += 2
      return
    }
    if (char === '`') {
      this.consumeBacktick()
      return
    }
    if (char === '$') {
      this.consumeDollar()
      return
    }
    this.word.text += char
    this.word.started = true
    this.index += 1
  }

  consumeBare(char) {
    if (char === '\\') {
      const next = this.source[this.index + 1]
      if (next === undefined) {
        this.word.dynamic = true
        this.word.started = true
        this.index += 1
        return
      }
      if (next === '\n') {
        this.index += 2
        return
      }
      this.word.text += next
      this.word.started = true
      this.index += 2
      return
    }
    if (char === "'" || char === '"') {
      this.quote = char
      this.word.started = true
      this.index += 1
      return
    }
    if (char === ' ' || char === '\t' || char === '\r') {
      this.flushWord()
      this.index += 1
      return
    }
    if (char === '#' && !this.word.started) {
      const close = this.source.indexOf('\n', this.index)
      this.index = close < 0 ? this.source.length : close
      return
    }
    if (char === '`') {
      this.consumeBacktick()
      return
    }
    if (char === '$') {
      this.consumeDollar()
      return
    }
    const operator = OPERATORS.find((candidate) => this.source.startsWith(candidate, this.index))
    if (operator !== undefined) {
      this.flushWord()
      this.flushSegment()
      // `|` 才是管道；`&&`、`;` 只是顺序执行，两者混为一谈会误判。
      this.nextConnector = operator
      this.index += operator.length
      return
    }
    // 重定向：`>`、`<`、`2>` 等不算命令词，但目标路径要记下来单独判定。
    if ('<>'.includes(char)) {
      const following = this.source[this.index + 1]
      if (following === '&') {
        // 2>&1 / >&2 之类，没有文件目标，整段吃掉。
        this.index += this.source[this.index + 2] === undefined ? 2 : 3
        return
      }
      this.flushWord()
      if ('0123456789'.includes(this.source[this.index - 1] ?? '') && !this.word.started) {
        // `2>` 里的 fd 数字已经并进上一个词，这里不用再处理。
        this.index += 1
      }
      if (char === '<' && following === '<') {
        // `<<` / `<<-`：下一个词是分隔符，正文按数据跳过，不参与解析。
        this.heredocPending = true
        this.index += this.source[this.index + 2] === '-' ? 3 : 2
        return
      }
      const append = following === '>'
      this.pendingRedirect = char === '<' ? '<' : append ? '>>' : '>'
      this.index += append ? 2 : 1
      return
    }
    if (char === '~' && !this.word.started) {
      // 未加引号的波浪号会被 shell 展开成家目录；加引号则是字面量。
      this.word.text += '~'
      this.word.started = true
      this.index += 1
      return
    }
    if ('*?[]'.includes(char) && !this.word.quoted && this.word.text.indexOf(' HIDDEN') < 0) {
      // 未加引号的通配符：可能命中大量目标，按「动态」处理。
      this.word.dynamic = true
    }
    this.word.text += char
    this.word.started = true
    this.index += 1
  }

  consumeBacktick() {
    const close = this.source.indexOf('`', this.index + 1)
    if (close < 0) throw new SyntaxError('unbalanced backtick substitution')
    this.current.nested.push(this.source.slice(this.index + 1, close))
    this.word.text += ' HIDDEN'
    this.word.dynamic = true
    this.word.started = true
    this.index = close + 1
  }

  consumeDollar() {
    const next = this.source[this.index + 1]
    if (next === '(') {
      const inner = readBalanced(this.source, this.index + 2)
      if (inner === null) throw new SyntaxError('unbalanced command substitution')
      this.current.nested.push(inner.content)
      this.recordVar({ kind: 'cmdsub', name: null, guarded: false, fallback: null })
      this.index = inner.end + 1
    } else if (next === '{') {
      const close = this.source.indexOf('}', this.index + 2)
      if (close < 0) throw new SyntaxError('unbalanced parameter expansion')
      this.recordVar(parseParamExpansion(this.source.slice(this.index + 2, close)))
      this.index = close + 1
      this.word.dynamic = true
      this.word.started = true
      return
    } else {
      const match = /^[A-Za-z_][A-Za-z0-9_]*|^[0-9@*#?$!-]/u.exec(this.source.slice(this.index + 1))
      if (match === null) {
        this.word.text += '$'
        this.index += 1
        this.word.started = true
        return
      }
      this.recordVar({ kind: 'var', name: match[0], guarded: false, fallback: null })
      this.index += 1 + match[0].length
    }
    this.word.dynamic = true
    this.word.started = true
  }

  /** 占位并记下这次展开的结构。 */
  recordVar(ref) {
    this.word.text += ' HIDDEN'
    this.word.vars ??= []
    this.word.vars.push(ref)
  }

  /** 跳过 heredoc 正文，直到分隔符行（正文是数据，不是命令）。 */
  consumeHeredocBody() {
    const delimiter = this.heredocDelimiter
    this.heredocDelimiter = null
    let from = this.index
    while (from <= this.source.length) {
      const lineEnd = this.source.indexOf('\n', from)
      const line = this.source.slice(from, lineEnd < 0 ? this.source.length : lineEnd).trim()
      if (line === delimiter || line === `${delimiter};`) {
        this.index = lineEnd < 0 ? this.source.length : lineEnd + 1
        return
      }
      if (lineEnd < 0) break
      from = lineEnd + 1
    }
    this.index = this.source.length
  }

  flushWord() {
    if (!this.word.started) return
    const word = {
      text: this.word.text,
      quoted: this.word.quoted,
      dynamic: this.word.dynamic,
      ...(this.word.vars === undefined ? {} : { vars: this.word.vars }),
    }
    if (this.heredocPending) {
      this.heredocPending = false
      this.heredocDelimiter = word.text
      this.word = newWord()
      return
    }
    if (this.pendingRedirect !== null) {
      this.current.redirects.push({ op: this.pendingRedirect, target: word })
      this.pendingRedirect = null
    } else {
      this.current.words.push(word)
    }
    this.word = newWord()
  }

  flushSegment() {
    // 直接取；第一段没有前驱，自然是 null。
    this.current.connector = this.nextConnector
    this.nextConnector = null
    this.current.raw = this.source.slice(this.currentStart, this.index)
    this.currentStart = Math.min(this.index + 1, this.source.length)
    this.segments.push(this.current)
    this.current = newSegment()
  }
}

function newWord() {
  return { text: '', started: false, quoted: false, dynamic: false, vars: undefined }
}

function newSegment() {
  return { words: [], nested: [], redirects: [], raw: '', connector: null }
}

/**
 * 读取与 `(` 配对的 `)`，跳过引号内的括号。
 * @param {string} text
 * @param {number} from `(` 之后的位置
 * @returns {{ content: string, end: number } | null}
 */
function readBalanced(text, from) {
  let depth = 1
  let quote = null
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]
    if (quote !== null) {
      if (char === '\\' && quote !== "'") {
        index += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return { content: text.slice(from, index), end: index }
    }
  }
  return null
}

/**
 * 取一段简单命令的实际命令名（跳过 sudo / env / 变量赋值等前缀）。
 * @param {Word[]} words
 * @returns {{ name: string, index: number } | null}
 */
export function resolveCommand(words) {
  let index = 0
  while (index < words.length) {
    const word = words[index]
    if (ASSIGNMENT.test(word.text)) {
      index += 1
      continue
    }
    if (word.text === '--') {
      index += 1
      continue
    }
    const base = basename(word.text)
    if (PREFIX_COMMANDS.has(base)) {
      index += 1
      if (OPTION_PREFIXES.has(base)) {
        while (index < words.length && words[index].text.startsWith('-')) {
          // `sudo -u root rm`、`nsenter -t 1 rm`：带值选项要把它的值一起跳过，
          // 否则那个值会被当成命令名，后面的危险判定整段失效。
          index += OPTION_TAKES_VALUE.test(words[index].text) ? 2 : 1
        }
      }
      continue
    }
    return { name: base, index }
  }
  return null
}

/**
 * 取路径最后一段（`/bin/rm` → `rm`）。
 * @param {string} value
 * @returns {string}
 */
export function basename(value) {
  const trimmed = String(value ?? '').replace(/\/+$/u, '')
  const at = trimmed.lastIndexOf('/')
  return at < 0 ? trimmed : trimmed.slice(at + 1)
}

/**
 * 取命令参数。
 * @param {{ words: Word[], raw: string }} command
 * @returns {{ name: string, args: Word[] } | null}
 */
export function commandArgs(command) {
  const resolved = resolveCommand(command.words)
  if (resolved === null) return null
  return { name: resolved.name, args: command.words.slice(resolved.index + 1), nested: command.nested ?? [] }
}

/**
 * 解析 `${...}` 的内容，得到变量名、是否有 `:?`、以及 `:-default` 的默认值。
 * `${VAR}` / `${VAR:-def}` / `${VAR:?}` / `${VAR:?msg}` / `${VAR:=def}`。
 * @param {string} body 花括号里的内容
 * @returns {VarRef}
 */
export function parseParamExpansion(body) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*#?!$-])(:?[-=?+])?([\s\S]*)?$/u.exec(body.trim())
  if (match === null) return { kind: 'var', name: null, guarded: false, fallback: null }
  const [, name, operator, rest = ''] = match
  return {
    kind: 'var',
    name,
    // `:?` 与 `?` 在变量为空（或未设置）时让 shell 报错退出，命令不会执行。
    guarded: operator === ':?' || operator === '?',
    // `:-` / `:=` / `-` 在为空时给默认值。
    fallback: operator === ':-' || operator === ':=' || operator === '-' || operator === '='
      ? stripQuotes(rest.trim())
      : null,
  }
}

/** 去掉默认值两端的成对引号。 */
function stripQuotes(text) {
  if (text.length >= 2) {
    const first = text[0]
    if ((first === '"' || first === "'") && text[text.length - 1] === first) return text.slice(1, -1)
  }
  return text
}
