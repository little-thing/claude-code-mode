/** 危险操作的确定性判定：只看「这条命令/这次写入实际会动到什么」。
 *
 * 设计原则来自 Claude Code 的关键路径检查：
 *  - 目标命中关键路径（家目录、根、工作目录及上级、系统盘）→ 拒绝，任何审批都不能放行；
 *  - 解析无法确定（未赋值变量、命令替换、`bash -c` 内联、多次 `cd`）→ 拒绝，而不是放行；
 *  - 解析本身失败时，只有文本里出现危险动作才要求审批；单纯的引号不平衡在真实
 *    shell 里就是语法错误、命令不会执行，一律拦截只会把模型写坏的普通命令
 *    变成人工噪音（Claude 也只在危险删除分析上做这种升级）；
 *  - 保护文件（改写权限/启动配置/本插件偏好）→ 拒绝。
 *
 * 这里不做「模型意图」判断，那是 auto-review 的活。本模块只保证：
 * 最危险的那几类操作不依赖任何模型的判断结果。
 */

import { basename, commandArgs, parseCommands } from './shell.js'

/** 拒绝理由前缀：客户端「最近拦截」和测试都按它识别。 */
export const DENIAL_PREFIX = 'danger-guard'

/** 命令长度上限：超过后不再相信静态解析的结论。 */
const MAX_COMMAND_LENGTH = 8000

/** 命令替换个数上限。 */
const MAX_SUBSTITUTIONS = 8


/** 函数定义递归的上限。 */
const MAX_FUNCTION_DEPTH = 4

/** 删除类命令名，用于 alias 值与 shell 选项的旁路判定。 */
const DANGEROUS_COMMAND_NAME = /\brm(?:dir)?\b|\bunlink\b|\bshred\b|\bdd\b|\bmkfs/u

/**
 * 解析失败时，只有文本里确实出现这些危险动作才升级为审批。
 *
 * 解析失败本身不说明危险：引号不平衡在真实 shell 里就是语法错误，命令不会
 * 执行；一律要求审批只会让模型写坏的普通命令也变成人工噪音。每一项都对应
 * `inspectShell` 里已有的一类判定，语义保持一致：删除类命令、受保护路径、
 * 提权与命名空间切换、内联脚本、远程脚本、`xargs` 拼参、git 破坏性操作、
 * 递归改权限。
 */
const PARSER_FAILURE_SIGNAL = new RegExp([
  String.raw`\b(?:rm(?:dir)?|unlink|shred|del|erase)\b`,
  String.raw`\bdd\b`,
  String.raw`\bmkfs(?:\.[a-z0-9]+)?\b`,
  String.raw`\bfind\b[^;&|\n]*-delete\b`,
  String.raw`(?:^|[/\s"'=])(?:\.zshrc|\.zprofile|\.zshenv|\.bashrc|\.bash_profile|\.bash_login|\.profile|\.ssh|\.gnupg|\.aws|\.kube|\.docker|\.netrc|\.npmrc|\.gitconfig|\.mcp\.json|\.dsh|\.claude(?:\.json)?|\.git)(?:[/\s"']|$)`,
  String.raw`\b(?:sudo|doas|runuser|pkexec)\b`,
  String.raw`\bsu\s+-c\b`,
  String.raw`\b(?:bash|sh|zsh|dash|ksh)\b[^;&|\n]*\s-[A-Za-z]*c[A-Za-z]*\b`,
  String.raw`\|\s*(?:ba|z|da|k)?sh\b`,
  String.raw`\bxargs\b`,
  String.raw`\bgit\s+(?:push\b[^;&|\n]*(?:--force|-f\b)|clean\b[^;&|\n]*-[A-Za-z]*[fdx]|filter-branch)\b`,
  String.raw`\bchmod\b[^;&|\n]*(?:-R|--recursive)\b[^;&|\n]*\b777\b|\bchmod\b[^;&|\n]*\b777\b[^;&|\n]*(?:-R|--recursive)\b`,
].join('|'), 'u')

/**
 * 函数定义：`f() { ... }` 或 `function f { ... }`。
 * 贪婪匹配函数体，宁可多检查也不要漏掉调用时才执行的命令。
 */
const FUNCTION_DEFINITION = /(?:\bfunction\s+[\w-]+\s*(?:\(\s*\))?|(?:^|[\s;&|])[\w-]+\s*\(\s*\))\s*\{([\s\S]*)\}/gu

/** `set -o NAME` / `bash -o NAME` / `set +o NAME`。 */
const SHELL_OPTION = /(?:^|[;&|\s])(?:set|bash|sh)\s+[-+]([a-zA-Z]*)[oO]\s+([a-z]+)|(?:^|[;&|\s])(?:set|bash|sh)\s+-([a-zA-Z]*[oO])(?=\s|$)/gu

/** 改变通配或解析行为的 shell 选项。 */
const PARSE_CHANGING_OPTIONS = new Set([
  'noglob', 'posix', 'dotglob', 'globstar', 'extglob', 'nullglob', 'nocaseglob', 'failglob',
])

/** alias 定义：`alias name='value'` / `alias name="value"` / `alias name=value`。 */
const ALIAS_DEFINITION = /\balias\s+([\w.-]+)=(?:'([^']*)'|"([^"]*)"|([^\s;&|]+))/gu

/** 删除类命令 → 是否接受 `-r` 之类的递归参数。 */
const DELETE_COMMANDS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'del', 'erase', 'rd'])

/** 会把内容落到指定路径的命令。 */
const CONTENT_WRITE_COMMANDS = new Set(['tee', 'cp', 'mv', 'install', 'ln', 'rsync'])

/** rsync 的删除与移走语义。 */
const RSYNC_DESTRUCTIVE = new Set([
  '--delete', '--delete-after', '--delete-before', '--delete-during', '--delete-delay',
  '--delete-excluded', '--remove-source-files', '--del',
])

/** 这一段是不是删除类命令。 */
function isDeleteCommand(parsed) {
  const info = commandArgs(parsed)
  return info !== null && DELETE_COMMANDS.has(info.name)
}

/** 直接执行内联脚本的解释器：内联脚本文本必须再过一遍解析。 */
const INLINE_SCRIPT = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'python', 'python3', 'node', 'ruby', 'perl'])

/** 邮箱/网卡/设备这类绝对不等于「根」的路径。 */
const SYSTEM_PREFIXES = ['/bin', '/sbin', '/usr', '/etc', '/var', '/System', '/Library', '/Applications', '/private', '/opt', '/boot', '/dev']

/**
 * 临时目录：不算关键路径。
 * macOS 上 /tmp 是指向 /private/tmp 的符号链接，解析真实路径后会落进 /private 里，
 * 不排除的话「删掉自己写的临时文件」会被当成删除系统目录。
 */
const SAFE_TEMP = ['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', '/var/folders', '/private/var/folders']

/** 家目录下需要保护但用户仍可能正常操作的子目录（相对家目录）。 */
const HOME_SENSITIVE = ['Library', 'Documents', 'Desktop', 'Pictures', 'Movies', 'Music', 'Downloads', 'Library/Application Support', 'Library/Preferences']

/** 受保护的绝对文件（相对家目录）。 */
export const HOME_PROTECTED_FILES = [
  '.bashrc', '.bash_profile', '.bash_login', '.zshrc', '.zprofile', '.zshenv', '.zlogin',
  '.profile', '.gitconfig', '.gitignore_global', '.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmrc',
  '.ssh', '.gnupg', '.netrc', '.aws', '.kube', '.docker', '.mcp.json', '.claude', '.claude.json',
  // `.dsh` 存会话与设置，要保护；`.dsh-dev` 只是开发测试目录，不该挡。
  '.dsh', '.codex', '.cursor', '.config', '.wakatime.cfg',
]

/** 项目内受保护目录：改写它们等于改写权限与版本控制事实。 */
export const PROJECT_PROTECTED = ['.git', '.dsh', '.mcp.json', '.agentignore', 'CLAUDE.md', 'AGENTS.md']

/**
 * 展开 `~` 与 `$HOME`，返回用于判定的绝对路径；无法展开时返回 null。
 * @param {string} value
 * @param {{ home: string, cwd: string }} env
 * @returns {string | null}
 */
export function resolvePath(value, env) {
  const text = String(value ?? '')
  if (text === '') return null
  let expanded = text
  // 引号里的 `~` 不会被 shell 展开，按字面处理（会被当成相对路径）。
  if (expanded === '~') expanded = env.home
  else if (expanded.startsWith('~/')) expanded = `${env.home}/${expanded.slice(2)}`
  else if (/^\$\{?HOME\}?(?=\/|$)/u.test(expanded)) expanded = expanded.replace(/^\$\{?HOME\}?/u, env.home)
  else if (expanded.includes(' HIDDEN')) return null
  else if (/^\$|`/u.test(expanded)) return null
  if (!expanded.startsWith('/')) expanded = `${env.cwd}/${expanded}`
  return normalize(expanded)
}

/**
 * 去掉 `.`、`..` 与重复斜杠；不做符号链接解析（`realpath` 由调用方负责）。
 * @param {string} path
 * @returns {string}
 */
export function normalize(path) {
  const parts = String(path).split('/')
  const out = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length > 0) out.pop()
      continue
    }
    out.push(part)
  }
  return `/${out.join('/')}`
}

/** 本插件允许写的自身路径：安装副本与本插件的偏好/审计目录。 */
const OWN_PATH_PATTERNS = [
  /\/claude-code-mode\/(?:lib|src|test|docs)?\/?.*$/u,
  /\/node_modules\/claude-code-mode\/.*$/u,
  /\/claude-code-mode\.jsonl$/u,
]

/**
 * 是否是本插件自己的安装/数据路径（允许写）。
 * @param {string} path
 * @param {GuardEnv} env
 * @returns {boolean}
 */
function isOwnDataPath(path, env) {
  const relative = path.startsWith(`${env.home}/`) ? path.slice(env.home.length) : path
  if (!relative.includes('claude-code-mode')) return false
  // 只放行 `~/.dsh` 与 `~/.dsh-dev` 之下、且确实属于本插件的那部分。
  if (!/^\.dsh(?:-dev)?\//u.test(relative.replace(/^\//u, ''))) return false
  return OWN_PATH_PATTERNS.some((pattern) => pattern.test(relative))
}

/** 系统通常有值的变量：用它们的实际值展开，空展开对它们没有意义。 */
function knownVariableValue(name, env) {
  switch (name) {
    case 'HOME': return env.home
    case 'PWD': return env.cwd
    case 'OLDPWD': return env.home
    case 'TMPDIR': return '/tmp'
    case 'USER': case 'LOGNAME': return process.env.USER ?? 'user'
    default: return undefined
  }
}

/**
 * 把目标词按「最坏情况」展开：能拿到确定值的（本命令赋值、`:-` 默认值、系统变量）
 * 用确定值，其余未保护的变量按空值展开。
 *
 * 这是 Claude Code 的判定方式：只有能证明「变量为空时会落到 / 或顶层目录」才拦。
 * 全部变量都有 `:?` 保护时返回 null —— 为空会让 shell 直接中止，命令不会跑。
 * @param {import('./shell.js').Word} word
 * @param {GuardEnv} env
 * @param {Map<string, string>} assignments
 * @returns {string | null}
 */
export function expandWorstCase(word, env, assignments) {
  const refs = word.vars ?? []
  /** 每个展开点的值：字符串=确定值，null=受 :? 保护，undefined=可能为空。 */
  const values = refs.map((ref) => {
    if (ref.kind === 'cmdsub') return undefined
    const assigned = ref.name === null ? undefined : assignments.get(ref.name)
    if (assigned !== undefined) return assigned
    const known = ref.name === null ? undefined : knownVariableValue(ref.name, env)
    if (known !== undefined) return known
    if (ref.fallback !== null) return ref.fallback
    if (ref.guarded === true) return null
    return undefined
  })

  // 只要还有「可能为空」的变量，就按空值展开 —— 这是最坏情况。
  // 反过来，所有变量要么有确定值、要么受 :? 保护，就不存在空展开。
  const hasPossiblyEmpty = values.some((value) => value === undefined)
  if (!hasPossiblyEmpty && values.every((value) => value === null)) {
    // 全部受保护：为空时 shell 中止，命令不会执行。
    return null
  }

  let index = 0
  return word.text.replace(/ HIDDEN/gu, () => {
    const value = values[index]
    index += 1
    if (value === null) return ''
    return value === undefined ? '' : value
  })
}

/**
 * 判定单个删除目标。返回拒绝项或 null。
 * @param {import('./shell.js').Word} target
 * @param {GuardEnv} env
 * @param {Map<string, string>} assignments
 * @returns {{ rule: string, detail: string } | null}
 */
export function judgeDeleteTarget(target, env, assignments = new Map()) {
  // 没有展开点：就是字面路径，直接判。
  if (target.vars === undefined || target.vars.length === 0) {
    return judgeLiteralTarget(target.text, env)
  }
  // 命令替换的输在执行前拿不到，静态检查无法证明安全 —— 这一条 Claude 也拦。
  if (target.vars.some((ref) => ref.kind === 'cmdsub')) {
    return deny('dynamic-delete-target', '删除目标是命令替换的输出，执行前无法检查', '').detail
      ? { rule: 'dynamic-delete-target', detail: `${DENIAL_PREFIX}: 删除目标是命令替换的输出，执行前无法检查` }
      : null
  }
  const expanded = expandWorstCase(target, env, assignments)
  if (expanded === null) {
    // 每个变量都有 :? 保护：为空会让 shell 中止，不会执行删除。
    return null
  }
  return judgeLiteralTarget(expanded.trim(), env)
}

/**
 * Windows / Git Bash 形态的目标。macOS 上这些可能是普通文件名，
 * 但在 Git Bash 里会落盘到别处 —— 位置无法确定时按 Claude 的方式保守拒绝。
 * @param {string} text
 * @returns {{ rule: string, detail: string } | null}
 */
export function judgeWindowsTarget(text) {
  const value = text.trim()
  // 只有反斜杠：Git Bash 里这是当前盘根。
  if (/^\\+$/u.test(value)) {
    return { rule: 'drive-root', detail: `${DENIAL_PREFIX}: 目标是 Git Bash 的盘符根目录` }
  }
  // 盘符根：C:\ / C:/ / C:
  if (/^[A-Za-z]:[\\/]*$/u.test(value)) {
    return { rule: 'drive-root', detail: `${DENIAL_PREFIX}: 目标是 Windows 盘符根目录 ${value}` }
  }
  // 系统盘位置
  if (/^[A-Za-z]:[\\/]+(?:Windows|Program Files(?: \(x86\))?|Users)(?:[\\/]|$)/iu.test(value)) {
    return { rule: 'critical-path-delete', detail: `${DENIAL_PREFIX}: 目标是 Windows 系统目录 ${value}` }
  }
  // PowerShell / cmd 的用户目录变量
  if (/^(?:\$env:USERPROFILE|\$HOME|%USERPROFILE%)$/iu.test(value)) {
    return { rule: 'critical-path-delete', detail: `${DENIAL_PREFIX}: 目标是用户主目录 ${value}` }
  }
  return null
}

/** 判一个字面路径会不会删到危险位置。 */
function judgeLiteralTarget(text, env) {
  const windows = judgeWindowsTarget(text)
  if (windows !== null) return windows
  const path = resolvePath(text, env)
  if (path === null) return { rule: 'dynamic-delete-target', detail: `${DENIAL_PREFIX}: 删除目标「${text}」无法展开成确定路径` }
  const critical = criticalKind(path, env)
  if (critical !== null) return { rule: 'critical-path-delete', detail: `${DENIAL_PREFIX}: 删除 ${critical}：${path}` }
  const guarded = protectedFileKind(path, env)
  if (guarded !== null) return { rule: 'protected-path-delete', detail: `${DENIAL_PREFIX}: 删除${guarded}：${path}` }
  return null
}

/**
 * 判断一个已规范化的绝对路径是否属于「删了会出事」的关键路径。
 * @param {string} path 规范化后的绝对路径
 * @param {GuardEnv} env
 * @returns {string | null} 命中时返回人类可读的类别
 */
export function criticalKind(path, env) {
  if (path === '/') return '文件系统根目录'
  // 根下的一层路径（/tmp、/Users、/opt…）都是顶层目录，删掉影响面太大。
  if (/^\/[^/]*$/u.test(path)) return '顶层目录'
  // 家目录下再带通配，等于清空家目录内容。
  if (path.startsWith(`${env.home}/`) && /[*?[\]]/u.test(path)) return '家目录下的通配目标'
  if (path === env.home) return '家目录'
  if (path === env.cwd) return '当前工作目录'
  if (isAncestorOf(path, env.cwd)) return '当前工作目录的上级目录'
  // 挂载盘：与 Claude Code 的判定范围对齐（/Volumes/X、/Volumes/X/Y、/mnt/x、/mnt/c/x、/media/…）。
  if (/^\/(?:system\/)?volumes(?:\/[^/]+){0,2}$/iu.test(path)) return '挂载磁盘或其上层目录'
  if (/^\/mnt\/(?:[^/]+|[a-z]\/[^/]+)$/iu.test(path)) return '挂载点根目录'
  if (/^\/(?:run\/)?media(?:\/[^/]+){0,3}$/iu.test(path)) return '可移动介质挂载目录'
  if (/^\/[A-Za-z]:?$/u.test(path)) return '盘符根目录'
  // 系统目录按整棵子树判：删 /etc/passwd、/System/Library 与删 /etc 一样危险。
  // 临时目录是例外：macOS 的 /tmp 其实是 /private/tmp，删自己写的临时文件是日常操作。
  if (!SAFE_TEMP.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    for (const prefix of SYSTEM_PREFIXES) {
      if (path === prefix || path.startsWith(`${prefix}/`)) return `系统目录 ${prefix}`
    }
  }
  for (const sensitive of HOME_SENSITIVE) {
    const absolute = `${env.home}/${sensitive}`
    if (path === absolute) return `家目录敏感目录 ~/${sensitive}`
  }
  return null
}

/**
 * a 是否是 b 的上级（或相等）。
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function isAncestorOf(a, b) {
  if (a === b) return true
  return b.startsWith(a === '/' ? '/' : `${a}/`)
}

/**
 * 判断一次写入/编辑是否落在受保护文件上。
 * @param {string} path 规范化后的绝对路径
 * @param {GuardEnv} env
 * @returns {string | null}
 */
export function protectedFileKind(path, env) {
  // 本插件自己的安装与数据目录必须可写：升级、部署、写审计都在这里，
  // 拦掉等于让守卫把自己的发布路径封死。
  if (isOwnDataPath(path, env)) return null
  for (const name of HOME_PROTECTED_FILES) {
    const absolute = `${env.home}/${name}`
    if (path === absolute || path.startsWith(`${absolute}/`)) return `受保护的配置文件 ~/${name}`
  }
  if (path.startsWith(`${env.cwd}/`)) {
    const relative = path.slice(env.cwd.length + 1)
    const head = relative.split('/')[0]
    if (PROJECT_PROTECTED.includes(head)) return `项目内受保护路径 ${head}`
  }
  for (const root of env.protectedPaths ?? []) {
    if (path === root || path.startsWith(`${root}/`)) return `受保护路径 ${root}`
  }
  return null
}

/**
 * @typedef {{ home: string, cwd: string, protectedPaths?: string[] }} GuardEnv
 */

/**
 * 一段命令的有效工作目录跟踪结果。
 * @typedef {{ command: any, cwd: string, uncertain: boolean }} ScopedCommand
 */

/**
 * 按 `cd` 追踪每条命令执行时的工作目录。
 *
 * shell 里 `cd X && rm -rf Y` 的 Y 是相对 X 的，不是相对会话 cwd。
 * 不跟踪就会把删除目标解析到错误的位置，于是危险的删除被当成普通路径放行。
 * cd 目标无法确定（变量、命令替换）时，后续所有相对路径都按「不确定」处理。
 * @param {{ words: import('./shell.js').Word[], redirects?: any[], nested?: string[], raw: string }[]} commands
 * @param {GuardEnv} env
 * @returns {{ scoped: ScopedCommand[], uncertain: boolean }}
 */
export function scopeByCd(commands, env) {
  const scoped = []
  let cwd = env.cwd
  let uncertain = false
  for (const command of commands) {
    const info = commandArgs(command)
    if (info !== null && info.name === 'cd') {
      const target = info.args.find((arg) => !arg.text.startsWith('-'))
      if (target === undefined) {
        cwd = env.home // 裸 cd 回 home
      } else if (target.dynamic) {
        uncertain = true
      } else {
        const next = resolvePath(target.text, { ...env, cwd })
        if (next === null) uncertain = true
        else cwd = next
      }
      continue
    }
    scoped.push({ command, cwd, uncertain })
  }
  return { scoped, uncertain }
}

/**
 * 判定一条 bash 命令。
 * @param {string} command
 * @param {GuardEnv} env
 * @returns {{ rule: string, detail: string, command: string } | null}
 */
export function inspectShell(command, env, depth = 0) {
  const text = String(command ?? '')
  // 超长命令：解析器与 shell 的分词可能在边界处不一致，静态结论不可信。
  if (text.length > MAX_COMMAND_LENGTH && /rm(?:dir)?|unlink|shred|del\b|erase\b/iu.test(text)) {
    return deny('command-too-long', `命令长度 ${text.length} 超过 ${MAX_COMMAND_LENGTH}，静态解析不可信`, text.slice(0, 200))
  }
  // 控制字符：bash 与分析器的分词可能不一致。
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text) && /rm(?:dir)?|unlink|shred/iu.test(text)) {
    return deny('unusual-characters', '命令含控制字符，无法确认 shell 的实际分词', text.slice(0, 200))
  }
  // IFS 改变单词分割：`IFS=/ ; rm -rf $X` 这类命令的字面形态不可信。
  if (/(?:^|[;&|\s({])IFS=/u.test(text) && /rm(?:dir)?|unlink|shred|del\b|erase\b/iu.test(text)) {
    return deny('ifs-override', '命令修改了 IFS，删除目标的实际分词无法静态确定', text.slice(0, 200))
  }
  // 函数定义：函数体里的命令在调用时才执行，字面上看是一次 `f` 调用。
  // 把函数体取出来单独判一次（嵌套有上限，避免病态输入）。
  if (depth < MAX_FUNCTION_DEPTH) {
    for (const match of text.matchAll(FUNCTION_DEFINITION)) {
      const hit = inspectShell(match[1], env, depth + 1)
      if (hit !== null) return { ...hit, detail: `${hit.detail}（在函数定义里）` }
    }
  }
  // alias 把危险命令藏进别名，之后按别名调用。
  for (const match of text.matchAll(ALIAS_DEFINITION)) {
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (DANGEROUS_COMMAND_NAME.test(value)) {
      return deny('alias-dangerous', `alias ${match[1]} 展开后包含删除类命令：${value}`, text.slice(0, 200))
    }
  }
  // `set -o` / `bash -o` 改变通配与解析行为：dotglob 会让 `*` 匹配隐藏项，
  // globstar 打开 `**` 递归，posix 改变整体语义。
  if (DANGEROUS_COMMAND_NAME.test(text)) {
    for (const match of text.matchAll(SHELL_OPTION)) {
      const option = (match[2] ?? match[3] ?? '').trim()
      if (PARSE_CHANGING_OPTIONS.has(option)) {
        return deny('shell-option', `命令启用了 shell 选项 ${option}，删除目标的实际展开无法静态确定`, text.slice(0, 200))
      }
    }
    // bash 的合法短选项只在固定字符集里；出现别的字符说明解析可能不一致。
    for (const match of text.matchAll(/(?:^|[;&|\s])bash\s+(-[^\s;|&]+)/gu)) {
      if (/[^abcefhiklmnoprstuvxBCDEHIOPT]/u.test(match[1].replace(/^-+/u, ''))) {
        return deny('shell-option', `bash 收到无法识别的选项 ${match[1]}`, text.slice(0, 200))
      }
    }
  }
  // sed 从 heredoc 读脚本：脚本内容会被执行，但解析器把 heredoc 当数据跳过了。
  if (/\bsed\b[^\n]*<<-?\s*\S/u.test(text)) {
    return deny('sed-heredoc-script', 'sed 从 heredoc 读取脚本，内容无法静态确认', text.slice(0, 200))
  }
  let commands
  try {
    commands = parseCommands(command)
  } catch (error) {
    // 解析失败本身不说明危险：未闭合的引号在真实 shell 里就是语法错误，
    // 命令不会执行。只有文本里确实出现危险动作时，解析失败才意味着
    // 「无法确认」——交给用户审批；否则放行，把判断留给外部权限流。
    if (!PARSER_FAILURE_SIGNAL.test(text)) return null
    return deny('unparsed-shell', `无法解析的命令（${messageOf(error)}），无法确认实际动作`, command)
  }
  // 命令替换个数上限（Claude 的 tooManySubstitutions）。
  // 两个前提缺一不可：
  //   1. 只在**要判删除目标**时才看——否则写一段带代码块的文档都会被拦；
  //   2. 用解析结果统计而不是正则扫原文——heredoc 正文里的反引号是数据。
  const substitutions = commands.reduce((total, entry) => total + (entry.nested?.length ?? 0), 0)
  if (substitutions > MAX_SUBSTITUTIONS && commands.some((entry) => isDeleteCommand(entry))) {
    return deny('too-many-substitutions', `命令含 ${substitutions} 个命令替换，删除目标不可静态判定`, text.slice(0, 200))
  }
  if (isRemotePipeToShell(commands)) {
    return deny('remote-script-pipe', '把远端下载的脚本直接交给 shell 执行', command)
  }
  // `X=rm; $X -rf ~`：命令名藏在变量里，字面上看不到 rm。
  const rmAliases = new Set()
  for (const parsed of commands) {
    for (const word of parsed.words) {
      const match = /^([A-Za-z_]\w*)=(?:\S*\/)?rm(?:dir)?$/u.exec(word.text)
      if (match !== null) rmAliases.add(match[1])
    }
  }
  const { scoped, uncertain } = scopeByCd(commands, env)
  // 收集本命令里的变量赋值：`X=/tmp/build && rm -rf "$X"/*` 的 X 是确定的。
  const assignments = new Map()
  let sawDelete = false
  for (const entry of scoped) {
    const scopedEnv = { ...env, cwd: entry.cwd }
    for (const word of entry.command.words) {
      const match = /^([A-Za-z_]\w*)=(.*)$/su.exec(word.text)
      if (match === null) continue
      // 值里还有展开点就不算确定值。
      assignments.set(match[1], word.vars === undefined ? match[2] : undefined)
    }
    for (const [name, value] of assignments) if (value === undefined) assignments.delete(name)
    const hit = inspectCommand(entry.command, scopedEnv, command, assignments)
    if (hit !== null) return hit
    const info = commandArgs(entry.command)
    if (info !== null && DELETE_COMMANDS.has(info.name)) sawDelete = true
  }
  if (uncertain && sawDelete) {
    return deny('uncertain-cwd-delete', '执行删除前的 cd 目标无法确定，无法判定实际删除位置', command)
  }
  if (rmAliases.size > 0) {
    // 命令里把某个变量赋成了 rm，之后的删除动作无法静态确认。
    for (const alias of rmAliases) {
      if (new RegExp(`\\$\\{?${alias}\\b`, 'u').test(command)) {
        return deny('rm-via-variable', `删除命令来自变量 ${alias}，无法确认实际执行内容`, command)
      }
    }
  }
  return null
}

/**
 * @param {{ words: import('./shell.js').Word[], raw: string }} parsed
 * @param {GuardEnv} env
 * @param {string} whole
 * @returns {{ rule: string, detail: string, command: string } | null}
 */
function inspectCommand(parsed, env, whole, rmAssignments = new Map()) {
  // `su -c '…'` / `runuser -c '…'` 把整条命令塞进一个字符串参数里，
  // 命令名不在 words 里，必须在常规解析之前先把它取出来重判。
  const first = parsed.words[0]
  if (first !== undefined && ['su', 'runuser', 'pkexec'].includes(basename(first.text))) {
    const texts = parsed.words.map((word) => word.text)
    const at = texts.findIndex((text) => text === '-c' || text === '--command')
    const body = at >= 0 ? texts[at + 1] ?? '' : ''
    if (body !== '') {
      const hit = inspectShell(body, env)
      if (hit !== null) return { ...hit, command: parsed.raw }
    }
  }

  // 重定向是 bash 自己的写入通道，不经过 fs 服务，也不会出现在命令参数里。
  // `echo x >> ~/.zshrc` 走的就是这条路，必须单独判。
  for (const redirect of parsed.redirects ?? []) {
    if (redirect.op === '<') continue
    const path = resolvePath(redirect.target.text, env)
    if (path === null) {
      return deny('dynamic-redirect-target', `重定向目标「${redirect.target.text}」无法展开成确定路径`, parsed.raw)
    }
    const guarded = protectedFileKind(path, env)
    if (guarded !== null) return deny('protected-path-write', `重定向写入${guarded}：${path}`, parsed.raw)
  }

  const info = commandArgs(parsed)
  if (info === null) {
    // 首词本身是变量/替换：只有它看起来像删除工具时才从严。
    if (parsed.raw.includes('rm ')) return deny('dynamic-command', '命令名来自变量或命令替换，无法确认执行了什么', parsed.raw)
    return null
  }
  const { name, args } = info
  const optionSet = collectOptions(args)

  if (['xargs', 'parallel'].includes(name)) {
    // `xargs rm -rf`：参数列表里真正的命令同样要判。
    const inner = args.filter((arg) => !arg.text.startsWith('-')).map((arg) => arg.text).join(' ')
    const hit = inner === '' ? null : inspectShell(inner, env)
    if (hit !== null) return { ...hit, command: parsed.raw }
    if (inner !== '' && /(^|\s)(rm|rmdir|unlink|shred)(\s|$)/u.test(inner)) {
      return deny('dynamic-delete-target', 'xargs 把文件列表拼进删除命令，无法确认实际路径', parsed.raw)
    }
    return null
  }

  if (DELETE_COMMANDS.has(name)) {
    const targets = args.filter((arg) => !arg.text.startsWith('-'))
    if (targets.length === 0) return null
    for (const target of targets) {
      const hit = judgeDeleteTarget(target, env, rmAssignments)
      if (hit !== null) return { ...hit, command: parsed.raw }
    }
    return null
  }

  if (name === 'find') {
    for (let at = 0; at < args.length; at += 1) {
      const term = args[at].text
      if (term === '-delete') {
        // 按搜索起点判，而不是见到 -delete 就拦：`find . -name "*.log" -delete`
        // 是最常见的清日志写法，一律拒绝属于误报。
        // 起点在工作目录之内，等同于用户在自己的工作区里删文件，放行；
        // 起点是根 / 家目录 / 系统目录才拦。
        const start = args.find((arg) => !arg.text.startsWith('-'))?.text ?? '.'
        const startPath = resolvePath(start, env)
        if (startPath !== null && (startPath === env.cwd || startPath.startsWith(`${env.cwd}/`))) {
          return null
        }
        const critical = startPath === null ? null : criticalKind(startPath, env)
        if (critical !== null) {
          return deny('find-delete', `find -delete 从 ${critical} 开始批量删除：${startPath}`, parsed.raw)
        }
        return null
      }
      if (term !== '-exec' && term !== '-execdir' && term !== '-ok' && term !== '-okdir') continue
      const inner = []
      for (let next = at + 1; next < args.length; next += 1) {
        if (args[next].text === ';' || args[next].text === '+' || args[next].text === '\\;') break
        inner.push(args[next].text)
      }
      const hit = inner.length === 0 ? null : inspectShell(inner.join(' '), env)
      if (hit !== null) return { ...hit, command: parsed.raw }
    }
    return null
  }

  // `sed -i` 原地改写文件，目标同样按受保护路径判。
  if (name === 'sed' && args.some((arg) => /^-[a-zA-Z]*i/u.test(arg.text))) {
    const operands = args.filter((arg) => !arg.text.startsWith('-'))
    const last = operands[operands.length - 1]
    if (last !== undefined) {
      const path = resolvePath(last.text, env)
      const guarded = path === null ? null : protectedFileKind(path, env)
      if (guarded !== null) return deny('protected-path-write', `sed -i 改写${guarded}：${path}`, parsed.raw)
    }
    return null
  }

  // sed 的 w 命令把匹配内容写到文件、e 命令执行命令，都无法静态确认目标。
  // sed 脚本里的 w（写文件）与 e（执行）作为独立命令出现：
  // `s/a/b/w /tmp/out`、`s/a/b/e`、`1w out.txt` 都要拦；
  // 但 `s/w/x/` 这种把 w 当普通字符的不能误伤。
  if (name === 'sed' && args.some((arg) => /(?:^|[\s/])[wWeE](?=\s|$)/u.test(arg.text))) {
    return deny('sed-write-or-exec', 'sed 脚本含 w（写文件）或 e（执行命令）动作', parsed.raw)
  }

  // rsync 的删除/移走语义要单独判：它同时是「落到路径」的命令，
  // 放在那个分支里会被提前 return 掉，实测 `rsync -av --delete / /tmp/` 因此漏报。
  if (name === 'rsync') {
    const destructive = args.some((arg) => RSYNC_DESTRUCTIVE.has(arg.text))
    if (destructive) return deny('rsync-delete', 'rsync 带删除/移走语义', parsed.raw)
  }

  // 会把内容落到指定路径的命令：目标同样按受保护路径判。
  // 这里只拦「写到受保护路径」，不 return，后面还有别的规则要看。
  if (CONTENT_WRITE_COMMANDS.has(name)) {
    const operands = args.filter((arg) => !arg.text.startsWith('-'))
    if (operands.length > 0) {
      const last = operands[operands.length - 1]
      const path = resolvePath(last.text, env)
      if (path !== null) {
        const guarded = protectedFileKind(path, env)
        if (guarded !== null) return deny('protected-path-write', `${name} 写入${guarded}：${path}`, parsed.raw)
      }
    }
  }

  if (name === 'git') {
    // `git -C <path> clean` / `git -c k=v push`：全局选项在子命令之前，
    // 不能把 `-C` 当成子命令，否则后面的危险判定整段失效。
    const texts = args.map((arg) => arg.text)
    const OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env'])
    let at = 0
    while (at < texts.length && texts[at].startsWith('-')) at += OPTIONS_WITH_VALUE.has(texts[at]) ? 2 : 1
    const sub = texts[at]
    const rest = texts.slice(at + 1)
    if (sub === 'push' && rest.some((arg) => /^(--force(-with-lease)?|-f|--mirror|--delete|\+)/u.test(arg) || /^\+/u.test(arg))) {
      return deny('force-push', '强制推送/改写远端历史', parsed.raw)
    }
    if (sub === 'reset' && rest.includes('--hard')) {
      if (rest.some((arg) => arg.startsWith('--hard') && arg.includes('origin/'))) {
        return deny('reset-origin', 'git reset --hard origin/* 会丢弃本地提交', parsed.raw)
      }
    }
    if (sub === 'clean' && rest.some((arg) => /^-[a-zA-Z]*f/u.test(arg))) {
      const force = rest.some((arg) => /^-[a-zA-Z]*x/u.test(arg))
      if (force) return deny('git-clean', 'git clean -fx 会删除未跟踪且被忽略的文件', parsed.raw)
    }
    if (['filter-branch', 'filter-repo'].includes(sub ?? '')) return deny('history-rewrite', `git ${sub} 会改写历史`, parsed.raw)
    return null
  }

  if (['terraform', 'pulumi', 'cdk'].includes(name) && args.some((arg) => arg.text === 'destroy')) {
    return deny('infra-destroy', `${name} destroy 会销毁基础设施`, parsed.raw)
  }

  if (name === 'dd' && args.some((arg) => /^of=\/dev\//u.test(arg.text))) {
    return deny('raw-device-write', 'dd 直接写设备节点', parsed.raw)
  }

  if ((name === 'mkfs' || name.startsWith('mkfs.')) || name === 'diskutil' && args.some((arg) => ['eraseDisk', 'eraseVolume', 'partitionDisk', 'eraseVolume'].includes(arg.text))) {
    return deny('format-disk', `${name} 会格式化磁盘`, parsed.raw)
  }

  if (['chmod', 'chown', 'chgrp'].includes(name) && optionSet.recursive) {
    for (const target of args.filter((arg) => !arg.text.startsWith('-') && !/^[0-7]+$/u.test(arg.text))) {
      const path = resolvePath(target.text, env)
      if (path === null) return deny('recursive-permission', `${name} -R 的目标无法确定`, parsed.raw)
      const critical = criticalKind(path, env) ?? protectedFileKind(path, env)
      if (critical !== null) return deny('recursive-permission', `${name} 递归修改${critical}：${path}`, parsed.raw)
    }
    return null
  }

  if (INLINE_SCRIPT.has(name)) {
    const script = inlineScript(name, args)
    if (script !== null) {
      const hit = inspectShell(script, env)
      if (hit !== null) return { ...hit, command: parsed.raw }
    }
    return null
  }

  if (name === 'eval') {
    const body = args.map((arg) => arg.text).join(' ')
    const hit = inspectShell(body, env)
    if (hit !== null) return { ...hit, command: parsed.raw }
  }

  // `su -c '...'` / `runuser -c '...'` 把命令当字符串传，同样要按脚本再判一次。
  if (['su', 'runuser', 'pkexec'].includes(name)) {
    const at = args.findIndex((arg) => arg.text === '-c' || arg.text === '--command')
    const body = at >= 0 ? args[at + 1]?.text ?? '' : ''
    if (body !== '') {
      const hit = inspectShell(body, env)
      if (hit !== null) return { ...hit, command: parsed.raw }
    }
  }

  // `trap`/`source`/`.`/`shift` 会把字符串或另一个文件当代码跑，内容无法静态确定。
  if (['trap', 'source', 'shift'].includes(name)) {
    const body = args.map((arg) => arg.text).join(' ')
    if (/\brm(?:dir)?\b/u.test(body)) {
      return deny('dynamic-eval', `${name} 会执行/拼接包含删除操作的代码`, parsed.raw)
    }
  }

  return null
}

/**
 * 取解释器的内联脚本文本（`-c '...'`、`-e`、`-m`）。
 * @param {string} name
 * @param {import('./shell.js').Word[]} args
 * @returns {string | null}
 */
export function inlineScript(name, args) {
  const texts = args.map((arg) => arg.text)
  if (['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish'].includes(name)) {
    // `-c`、`-lc`、`-ec` 这些都是「执行内联脚本」，不能只认裸 `-c`。
    const at = texts.findIndex((text) => /^-[A-Za-z]*c[A-Za-z]*$/u.test(text))
    return at >= 0 ? texts[at + 1] ?? '' : null
  }
  if (['python', 'python3', 'node', 'ruby', 'perl'].includes(name)) {
    const at = texts.findIndex((text) => text === '-c' || text === '-e' || text === '-E')
    return at >= 0 ? texts[at + 1] ?? '' : null
  }
  return null
}

/**
 * 抽出一条命令里所有「删除类目标」的原始路径。
 * 供上层做符号链接解析：`rm -rf link/` 会跟随链接删掉目标内容，
 * 只看字面路径的判定挡不住。
 * @param {string} command
 * @param {GuardEnv} env
 * @returns {string[]}
 */
export function deleteTargets(command, env) {
  let commands
  try {
    commands = parseCommands(command)
  } catch {
    return []
  }
  const { scoped } = scopeByCd(commands, env)
  const found = []
  for (const entry of scoped) {
    const baseEnv = { ...env, cwd: entry.cwd }
    const collect = (list) => {
      for (const parsed of list) {
        if (parsed.nested !== undefined) {
          for (const nested of parsed.nested) {
            try {
              collect(parseCommands(nested))
            } catch {
              /* 嵌套解析失败留给主判定 */
            }
          }
        }
        const info = commandArgs(parsed)
        if (info === null) continue
        // 只收删除类命令的目标。只读命令（ls/cat/readlink…）的参数不是删除目标，
        // 把它们也算进来会把 `ls -ld some-link` 这类核对命令误判成删除。
        const deleting = DELETE_COMMANDS.has(info.name)
        const findDelete = info.name === 'find' && info.args.some((arg) => arg.text === '-delete')
        if (!deleting && !findDelete) continue
        // git 的全局选项后面才是真正的子命令，目标要从子命令参数里取。
        const operands = info.args.filter((arg) => !arg.text.startsWith('-'))
        for (const arg of operands) {
          const path = resolvePath(arg.text, baseEnv)
          if (path === null) continue
          // `rm -rf dir/` 的尾部斜杠会让 shell 跟随符号链接，必须按链接目标判。
          found.push({ path, followsSymlink: arg.text.endsWith('/') })
        }
      }
    }
    collect([entry.command])
  }
  return found.filter((entry) => entry !== undefined)
}

/** PowerShell 删除类命令。 */
const PWSH_REMOVE = /\b(?:Remove-Item|Clear-Content|ri|del|erase|rd|rmdir|rm)\b/iu
/** PowerShell 里指向系统或用户根的路径与变量。 */
const PWSH_CRITICAL = [
  [/^(?:[A-Za-z]:[\\/]*|[\\/]+)$/u, '盘符或文件系统根目录'],
  [/^[A-Za-z]:[\\/]+(?:Windows|Program Files(?: \(x86\))?|Users)(?:[\\/]|$)/iu, 'Windows 系统目录'],
  [/^\$env:(?:USERPROFILE|SystemRoot|SystemDrive|ProgramFiles(?:\w+)?)$/iu, '系统或用户目录变量'],
  [/^(?:\$HOME|~)(?:[\\/]|$)/u, '用户主目录'],
  [/^%USERPROFILE%$/iu, '用户主目录'],
]

/**
 * 判一条 PowerShell 命令。只覆盖「删除类命令 + 系统/用户根目标」这一档，
 * 和 Claude Code 对 PowerShell 的处理一致：这类直接拒绝，不给询问机会。
 * @param {string} command
 * @returns {{ rule: string, detail: string } | null}
 */
export function inspectPowerShell(command) {
  const text = String(command ?? '')
  if (!PWSH_REMOVE.test(text)) return null
  // 去掉引号后逐个 token 判目标。
  for (const raw of text.split(/[\s;|&(){}]+/u)) {
    const token = raw.replace(/^['"]|['"]$/gu, '').trim()
    if (token === '') continue
    for (const [pattern, label] of PWSH_CRITICAL) {
      if (pattern.test(token)) {
        return { rule: 'critical-path-delete', detail: `${DENIAL_PREFIX}: 删除 ${label}：${token}` }
      }
    }
  }
  return null
}

/**
 * 是否是把远端脚本直接喂给 shell（`curl … | bash`）。
 * @param {{ words: import('./shell.js').Word[], raw: string }[]} commands
 * @returns {boolean}
 */
export function isRemotePipeToShell(commands) {
  for (let index = 0; index < commands.length; index += 1) {
    const info = commandArgs(commands[index])
    if (info === null) continue
    if (!['curl', 'wget', 'http', 'https'].includes(info.name)) continue
    for (let next = index + 1; next < commands.length; next += 1) {
      // 只有真的用 `|` 接过去才算「喂给解释器」。
      // `curl -o f && python3 f` 是先落盘再读，不是执行下载内容。
      const connector = commands[next]?.connector
      if (connector !== undefined && connector !== '|' && connector !== '|&') break
      const down = commandArgs(commands[next])
      if (down !== null && ['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'python', 'python3', 'node', 'ruby', 'perl'].includes(down.name)) {
        return true
      }
    }
  }
  return false
}

function collectOptions(args) {
  const set = { recursive: false }
  for (const arg of args) {
    if (!arg.text.startsWith('-')) continue
    set.recursive = set.recursive || /R/u.test(arg.text)
  }
  return set
}

function deny(rule, detail, command) {
  return { rule, detail: `${DENIAL_PREFIX}: ${detail}`, command }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}