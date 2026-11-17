#!/usr/bin/env node
/**
 * release.mjs — 发版入口。日志先行。
 *
 * 一次发版做四件事：确认这一版有更新日志 → 升版本并重建产物 → 提交 + 打 tag →
 * 推送触发 CI（CI 只暂存到 npm，维护者 2FA 审批后才对外可见）。
 *
 * 「必须写日志」是硬校验：发版前把这一版的内容写进 CHANGELOG.md 的
 * `## Unreleased` 与 CHANGELOG_ZH.md 的 `## 未发布`，脚本把两段提升成
 * `## [x.y.z] — YYYY-MM-DD`。两份里任何一份为空都直接中止，不发版本。
 * 同样的校验以 `--check` 暴露给 CI（.github/workflows/publish.yml），
 * 绕过脚本手动 bump 也会在发版流水线上被拦住。
 *
 * 用法：
 *   node release.mjs                  # patch 发版：0.3.5 → 0.3.6
 *   node release.mjs --level minor    # 0.3.5 → 0.4.0
 *   node release.mjs --version 1.0.0  # 指定版本
 *   node release.mjs --dry-run        # 只演练：升到哪个版本、日志会长什么样
 *   node release.mjs --no-push        # 本地提交并打 tag，不推送
 *   node release.mjs --check          # 只校验当前 package.json 版本已有日志（CI 用）
 *
 * 约定：
 *   - 只允许在 main 上发版，且工作区必须干净（功能改动先提交）。
 *   - 版本号只有一个真源：package.json 的 version；`lib/` 由 npm 的 version
 *     lifecycle（`node build.mjs`）重建，不要手改产物里的版本号。
 *   - 提交信息与 npm version 惯例一致：`claude-code-mode x.y.z`；tag 为 `vx.y.z`。
 *   - 一次提交同时包含版本号与两份更新日志，tag 指向它。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const RELEASE_BRANCH = 'main'
/** 中英两份日志及其「未发布」小节标题。两份都必须有内容。 */
const CHANGELOGS = [
  { file: 'CHANGELOG.md', unreleased: '## Unreleased' },
  { file: 'CHANGELOG_ZH.md', unreleased: '## 未发布' },
]
const LEVELS = ['patch', 'minor', 'major']

const USAGE = `发版脚本（日志先行）

  node release.mjs                  升 patch 并发版（0.3.5 → 0.3.6）
  node release.mjs --level minor    升 minor
  node release.mjs --version 1.0.0  指定版本
  node release.mjs --dry-run        只演练，不写文件
  node release.mjs --no-push        本地提交打 tag，不推送
  node release.mjs --check          校验当前版本已有日志（CI 用）

发版前把这一版的内容写进：
  CHANGELOG.md    ## Unreleased
  CHANGELOG_ZH.md ## 未发布
（分类用 ### 新增 / 变更 / 修复，至少一条 "- " 列表项。）`

function fail(message, detail) {
  console.error(`\n[release] ${message}`)
  if (detail !== undefined && detail !== '') console.error(`\n${detail}`)
  process.exit(1)
}

/**
 * 同步执行并用退出码判定成败；失败时抛出带输出的错误。
 * @param {string} command 可执行文件
 * @param {string[]} args 参数
 * @returns {string} 去掉首尾空白的 stdout
 */
function run(command, args) {
  const output = execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return typeof output === 'string' ? output.trim() : ''
}

function tryRun(command, args) {
  try {
    return { ok: true, out: run(command, args) }
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() }
  }
}

function parseArgs(argv) {
  const options = { level: 'patch', version: null, dryRun: false, push: true, check: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--no-push') options.push = false
    else if (arg === '--check') options.check = true
    else if (arg === '--level') {
      options.level = argv[++index]
      if (options.level === undefined) fail('--level 需要一个值：patch / minor / major')
    } else if (arg.startsWith('--level=')) options.level = arg.slice('--level='.length)
    else if (arg === '--version') {
      options.version = argv[++index]
      if (options.version === undefined) fail('--version 需要一个值，例如 1.0.0')
    } else if (arg.startsWith('--version=')) options.version = arg.slice('--version='.length)
    else fail(`不认识的参数：${arg}`, USAGE)
  }
  if (!LEVELS.includes(options.level)) fail(`--level 只能是 ${LEVELS.join(' / ')}`)
  if (options.version !== null && !/^\d+\.\d+\.\d+$/.test(options.version)) fail(`--version 需要 x.y.z 形式：${options.version}`)
  return options
}

/**
 * 按 semver 语义递增一个稳定版本号（忽略预发布后缀）。
 * @param {string} version 当前版本
 * @param {'patch'|'minor'|'major'} level 递增级别
 * @returns {string} 新版本
 */
function bumpVersion(version, level) {
  const [major, minor, patch] = version.split('-')[0].split('.').map((part) => Number(part))
  if (![major, minor, patch].every((part) => Number.isInteger(part))) fail(`package.json 里的版本号无法解析：${version}`)
  if (level === 'major') return `${major + 1}.0.0`
  if (level === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/** 本地日期 YYYY-MM-DD，与日志里已有的日期写法一致。 */
function today() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function changelogPath(name) {
  return path.join(ROOT, name)
}

/**
 * 找出以标题行开头、到下一个二级标题之前的小节。
 * @param {string} text 整份日志
 * @param {(line: string) => boolean} matches 标题行判定
 * @returns {{ body: string, start: number, end: number } | null} 小节位置与正文
 */
function findSection(text, matches) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => matches(line.trim()))
  if (start === -1) return null
  let end = lines.findIndex((line, index) => index > start && /^##\s/.test(line))
  if (end === -1) end = lines.length
  return { body: lines.slice(start + 1, end).join('\n').replace(/\s+$/, ''), start, end }
}

/** 精确匹配 `## Unreleased` / `## 未发布` 这类固定标题。 */
function sectionExact(text, heading) {
  return findSection(text, (line) => line === heading)
}

/** 按版本号匹配 `## [1.2.3] — 日期`；必须是完整版本号，避免 0.3.5 命中 0.3.50。 */
function sectionOfVersion(text, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^##\\s*\\[${escaped}\\]`)
  return findSection(text, (line) => pattern.test(line))
}

function hasEntries(body) {
  return /^\s*-\s+\S/m.test(body)
}

/**
 * 校验某版本在两份日志里都有内容。
 * @param {string} version 版本号
 * @returns {string[]} 问题清单，空数组表示通过
 */
function verifyVersionLogged(version) {
  const problems = []
  for (const { file } of CHANGELOGS) {
    const filePath = changelogPath(file)
    if (!fs.existsSync(filePath)) {
      problems.push(`${file} 不存在`)
      continue
    }
    const found = sectionOfVersion(fs.readFileSync(filePath, 'utf8'), version)
    if (found === null) problems.push(`${file} 缺少 "## [${version}] — YYYY-MM-DD" 小节`)
    else if (!hasEntries(found.body)) problems.push(`${file} 的 "${version}" 小节没有内容（至少要一条 "- " 列表项）`)
  }
  return problems
}

/**
 * 收集两份日志的「未发布」正文，确认都写了内容。
 * @returns {{ file: string, heading: string, text: string, body: string }[]} 各文件待提升内容
 */
function collectUnreleased() {
  const empty = []
  const collected = []
  for (const { file, unreleased } of CHANGELOGS) {
    const filePath = changelogPath(file)
    if (!fs.existsSync(filePath)) {
      empty.push(`${file} 不存在`)
      continue
    }
    const text = fs.readFileSync(filePath, 'utf8')
    const found = sectionExact(text, unreleased)
    if (found === null) {
      empty.push(`${file} 找不到小节 "${unreleased}"`)
      continue
    }
    if (!hasEntries(found.body)) {
      empty.push(`${file} 的 "${unreleased}" 是空的`)
      continue
    }
    collected.push({ file, heading: unreleased, text, body: found.body })
  }
  if (empty.length > 0) {
    fail(
      '发版中止：更新日志没写完。用户是照着这份日志看「这次发生了什么」的，不能空着发。',
      [
        ...empty.map((item) => `  - ${item}`),
        '',
        '写法（两份都要）：',
        '  ## Unreleased / ## 未发布',
        '',
        '  ### 修复',
        '',
        '  - 一句话说清用户能感知到的变化。',
        '',
        '写完再执行同一条命令。',
      ].join('\n'),
    )
  }
  return collected
}

/**
 * 把「未发布」小节提升成本次版本小节，并保留一个空的「未发布」。
 * @param {{ text: string, heading: string, body: string }} entry 文件原文与正文
 * @param {string} version 版本号
 * @param {string} date 日期
 * @returns {string} 新全文
 */
function promote(entry, version, date) {
  const found = sectionExact(entry.text, entry.heading)
  const lines = entry.text.split('\n')
  const head = lines.slice(0, found.start + 1)
  const tail = lines.slice(found.end)
  const block = ['', `## [${version}] — ${date}`, '', ...entry.body.split('\n'), '']
  const merged = [...head, ...block, ...tail].join('\n')
  return merged.endsWith('\n') ? merged : `${merged}\n`
}

function ensureCleanWorktree() {
  const dirty = run('git', ['status', '--porcelain'])
  if (dirty !== '') fail('发版中止：工作区不干净。功能改动先提交，发版只包含版本号与日志。', dirty)
}

function ensureBranch() {
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch !== RELEASE_BRANCH) fail(`发版中止：当前在 ${branch}，发版只能在 ${RELEASE_BRANCH} 上做。`)
}

function ensureRemoteAndUpToDate() {
  if (!tryRun('git', ['remote', 'get-url', 'origin']).ok) fail('发版中止：没有 origin 远程。')
  const fetched = tryRun('git', ['fetch', 'origin', RELEASE_BRANCH])
  if (!fetched.ok) fail('发版中止：git fetch 失败，检查网络与远程地址。', fetched.out)
  const local = run('git', ['rev-parse', 'HEAD'])
  const remoteHead = run('git', ['rev-parse', `origin/${RELEASE_BRANCH}`])
  if (local === remoteHead) return
  if (!tryRun('git', ['merge-base', '--is-ancestor', `origin/${RELEASE_BRANCH}`, 'HEAD']).ok) {
    fail(`发版中止：本地 ${RELEASE_BRANCH} 落后于 origin，先拉取再发版。`)
  }
  console.log(`[release] 注意：本地有 ${RELEASE_BRANCH} 尚未推送的提交，发版时会一起推上去。`)
}

function ensureTagFree(version) {
  const tag = `v${version}`
  if (tryRun('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]).ok) fail(`发版中止：本地已存在 tag ${tag}。`)
  const remoteTag = tryRun('git', ['ls-remote', '--tags', 'origin', tag])
  if (remoteTag.ok && remoteTag.out !== '') fail(`发版中止：远程已存在 tag ${tag}。`)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const current = pkg.version

  if (options.check) {
    const problems = verifyVersionLogged(current)
    if (problems.length > 0) {
      fail(`发布中止：${current} 没有可读的更新日志。`, problems.map((item) => `  - ${item}`).join('\n'))
    }
    console.log(`[release] 更新日志检查通过：${CHANGELOGS.map((item) => item.file).join(' / ')} 都记录了 ${current}。`)
    return
  }

  ensureCleanWorktree()
  ensureBranch()
  ensureRemoteAndUpToDate()

  const target = options.version ?? bumpVersion(current, options.level)
  const date = today()
  ensureTagFree(target)

  if (verifyVersionLogged(target).length === 0) fail(`发版中止：${target} 已经有完整的日志小节，可能是重复发版。`)

  const entries = collectUnreleased()
  const previews = entries.map((entry) => ({ ...entry, promoted: promote(entry, target, date) }))

  if (options.dryRun) {
    console.log(`[release] 演练：${current} → ${target}（${date}）`)
    for (const preview of previews) {
      console.log(`\n--- ${preview.file} ---\n## [${target}] — ${date}\n${preview.body}`)
    }
    console.log('\n[release] 演练结束：没有改动任何文件。去掉 --dry-run 即正式发版。')
    return
  }

  // 先落日志再升版本：任何一步失败都留下可读状态，不会出现「版本变了但没日志」。
  for (const preview of previews) fs.writeFileSync(changelogPath(preview.file), preview.promoted)
  const loggedProblems = verifyVersionLogged(target)
  if (loggedProblems.length > 0) fail('发版中止：日志提升后校验失败，未改动版本号。', loggedProblems.map((item) => `  - ${item}`).join('\n'))

  try {
    // --no-git-tag-version：提交与 tag 由本脚本统一做，保证一次提交同时含版本号与日志。
    run('npm', ['version', target, '--no-git-tag-version'])
  } catch (error) {
    fail('升版本失败（package.json 可能已改动，先 git checkout -- package.json 再重试）。', `${error.stdout ?? ''}${error.stderr ?? ''}`.trim())
  }

  run('git', ['add', '-A'])
  run('git', ['commit', '-m', `claude-code-mode ${target}`])
  run('git', ['tag', `v${target}`])
  const commit = run('git', ['rev-parse', '--short', 'HEAD'])

  if (options.push) {
    run('git', ['push', 'origin', RELEASE_BRANCH])
    run('git', ['push', 'origin', `v${target}`])
  }

  const remoteUrl = run('git', ['remote', 'get-url', 'origin'])
  const slug = /github\.com[:/](.+?)(?:\.git)?$/.exec(remoteUrl)?.[1] ?? null
  console.log(`\n[release] 已发布 ${target}（提交 ${commit}，tag v${target}）`)
  console.log(`[release] 更新日志：${CHANGELOGS.map((item) => item.file).join(' / ')}`)
  if (options.push) {
    if (slug !== null) console.log(`[release] CI：https://github.com/${slug}/actions`)
    console.log('[release] 下一步：等 Publish workflow 打出 "staged with id ..." 后，用 2FA 审批：')
    console.log('           npm stage approve <id>   （或 npmjs.com 包页的 Staged 标签）')
  } else {
    console.log('[release] 未推送（--no-push）：确认无误后手动推送 main 与 tag。')
  }
}

main()
