import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, realpath, lstat, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import semver from 'semver'
import { COVERAGE_GAPS, dismissFirstUse, selectScenarios } from './scenarios.mjs'
import { compareVisuals } from './visual.mjs'

const TOOL_ROOT = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(TOOL_ROOT, '../..')
const MAX_COMMAND_OUTPUT = 2 * 1024 * 1024
const forciblyStopped = new WeakSet()

function exactVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || semver.valid(version) !== version) {
    throw new Error('--dsh-version must be an exact published semantic version')
  }
}

export function validateOptions(options) {
  if (!options || !isAbsolute(options.repo ?? '')) throw new Error('--repo must be an absolute path')
  if (!isAbsolute(options.output ?? '')) throw new Error('--output must be an absolute path')
  exactVersion(options.dshVersion)
  selectScenarios(options)
  if (options.onlyRegression && !options.regression) throw new Error('--only-regression requires --regression')
  if (options.regression && !/^test\/e2e\/[a-zA-Z0-9_-]+\.spec\.mjs$/.test(options.regression)) {
    throw new Error('--regression must identify test/e2e/<name>.spec.mjs')
  }
  if (resolve(options.output) === resolve(options.repo)) throw new Error('Evidence directory cannot be the repository root')
  if (options.visualBaselines && !isAbsolute(options.visualBaselines)) throw new Error('--visual-baselines must be absolute')
  if (options.visualEnvironment && !/^[A-Za-z0-9_.:@/-]{1,200}$/.test(options.visualEnvironment)) throw new Error('Invalid --visual-environment identifier')
  return options
}

/** 只保留基础运行环境：GitHub、模型和 E2B 凭据均不流入被测宿主与浏览器。 */
export function verificationEnvironment(source = process.env, additions = {}) {
  const names = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'PLAYWRIGHT_BROWSERS_PATH']
  return {
    ...Object.fromEntries(names.filter((key) => typeof source[key] === 'string').map((key) => [key, source[key]])),
    CI: '1', NO_COLOR: '1', ...additions,
  }
}

export function redact(text, secrets = []) {
  let value = String(text ?? '')
  for (const secret of secrets) if (secret) value = value.split(secret).join('[REDACTED]')
  return value
    .replace(/([?&#](?:token|auth|api[_-]?key|access[_-]?token)=)[^\s&#"']+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]')
    .slice(0, 12_000)
}

export function parseStartupUrl(text) {
  for (const candidate of String(text).match(/https?:\/\/[^\s<>"']+/g) ?? []) {
    try {
      const url = new URL(candidate.replace(/\x1b\[[0-9;]*m/g, '').replace(/[),;]+$/, ''))
      if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.port) return url.href
    } catch { /* 诊断行可能含不是 URL 的文本 */ }
  }
  return null
}

function killGroup(child, signal) {
  if (!child?.pid) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
    if (signal === 'SIGKILL') forciblyStopped.add(child)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

export async function stopChild(child) {
  if (!child?.pid || forciblyStopped.has(child)) return
  killGroup(child, 'SIGTERM')
  if (child.exitCode !== null || child.signalCode !== null) return
  let timer
  await Promise.race([
    once(child, 'exit').catch(() => {}),
    new Promise((resolveTimeout) => { timer = setTimeout(resolveTimeout, 3_000) }),
  ])
  clearTimeout(timer)
  if (child.exitCode === null && child.signalCode === null) killGroup(child, 'SIGKILL')
}

/** 有界输出、超时和进程组清理；命令参数通过 argv 传递，不经过 shell。 */
export async function runCommand(command, args, { cwd, env = verificationEnvironment(), timeoutMs = 300_000 } = {}) {
  const child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  let text = ''
  let stdout = ''
  let exceeded = false
  const capture = (chunk) => {
    text += chunk.toString()
    if (Buffer.byteLength(text) > MAX_COMMAND_OUTPUT) {
      exceeded = true
      text = text.slice(-MAX_COMMAND_OUTPUT)
      killGroup(child, 'SIGKILL')
    }
  }
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); capture(chunk) })
  child.stderr.on('data', capture)
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; killGroup(child, 'SIGKILL') }, timeoutMs)
  try {
    const [code] = await once(child, 'exit')
    if (code !== 0 || timedOut || exceeded) {
      throw new Error(`${command} failed (${timedOut ? 'timeout' : exceeded ? 'output limit' : `exit ${code}`}): ${redact(text)}`)
    }
    return stdout
  } finally {
    clearTimeout(timer)
    await stopChild(child)
  }
}

async function dshBinary(version, scratch, environment) {
  const supplied = process.env.CCM_DSH_BIN
  if (supplied) {
    if (!isAbsolute(supplied)) throw new Error('CCM_DSH_BIN must be absolute')
    const actual = (await runCommand(supplied, ['--version'], { env: environment, timeoutMs: 30_000 })).trim()
    if (actual !== version) throw new Error(`CCM_DSH_BIN version ${actual} does not match requested ${version}`)
    return supplied
  }
  const prefix = join(scratch, 'target-dsh')
  await mkdir(prefix, { recursive: true })
  await runCommand('npm', ['install', '--prefix', prefix, '--no-audit', '--no-fund', `@deepseek-ai/dsh@${version}`], {
    env: environment, timeoutMs: 600_000,
  })
  const binary = join(prefix, 'node_modules', '.bin', process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
  const actual = (await runCommand(binary, ['--version'], { env: environment, timeoutMs: 30_000 })).trim()
  if (actual !== version) throw new Error(`Installed DSH ${actual}, expected ${version}`)
  return binary
}

async function collectUnitTests(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link in test directory: ${entry.name}`)
    const path = join(directory, entry.name)
    if (entry.isDirectory() && entry.name !== 'e2e') result.push(...await collectUnitTests(path))
    else if (entry.isFile() && entry.name.endsWith('.test.mjs')) result.push(path)
  }
  return result.sort()
}

async function startHost(binary, { repo, home, workspace, fixturePlugin, scratch, log }) {
  const patch = join(scratch, 'verify.patch.yml')
  await writeFile(patch, `- insert:\n    - id: ccm-verifier-fixtures\n      name: ${JSON.stringify(fixturePlugin)}\n`)
  const env = verificationEnvironment(process.env, { DSH_HOME: home, CCM_FIXTURE_WORKSPACE: workspace })
  const child = spawn(binary, ['--profile', 'web', '--patch', patch, '--no-open', '--port', '0'], {
    cwd: repo, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  })
  let transcript = ''
  let resolved = false
  let timer
  const ready = new Promise((resolveReady, rejectReady) => {
    const capture = (chunk) => {
      transcript = (transcript + chunk.toString()).slice(-MAX_COMMAND_OUTPUT)
      const url = parseStartupUrl(transcript)
      if (url && !resolved) { resolved = true; resolveReady(url) }
    }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    child.once('error', rejectReady)
    child.once('exit', (code) => {
      if (!resolved) rejectReady(new Error(`DSH exited before readiness (${code}): ${redact(transcript)}`))
    })
    timer = setTimeout(() => rejectReady(new Error(`DSH startup timed out: ${redact(transcript)}`)), 90_000)
  })
  try {
    const url = await ready
    clearTimeout(timer)
    return { child, url, saveLog: () => writeFile(log, redact(transcript, [new URL(url).searchParams.get('token')])) }
  } catch (error) {
    clearTimeout(timer)
    await stopChild(child)
    await writeFile(log, redact(transcript))
    throw error
  }
}

async function validatedRegression(repo, name) {
  const root = await realpath(repo)
  const path = resolve(root, name)
  const actual = await realpath(path)
  if (actual !== path || !actual.startsWith(`${root}${sep}`)) throw new Error('Regression file may not traverse a symbolic link')
  if (!(await lstat(path)).isFile()) throw new Error('Regression path is not a regular file')
  return path
}

/** 合并后的 Issue 回归自动成为后续每轮兼容验收的一部分。 */
export async function discoverRegressions(repo) {
  const directory = join(repo, 'test/e2e')
  try {
    if (!(await lstat(directory)).isDirectory()) throw new Error('test/e2e must be a regular directory')
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link in regression directory: ${entry.name}`)
    if (!/^issue-[1-9][0-9]*\.spec\.mjs$/.test(entry.name)) continue
    if (!entry.isFile()) throw new Error(`Regression is not a regular file: ${entry.name}`)
    const name = `test/e2e/${entry.name}`
    await validatedRegression(repo, name)
    result.push(name)
  }
  return result.sort()
}

/** 独立场景失败只影响自身；上游准备失败通过 blocked 明确区分。 */
export async function executeScenePlan(scenes, execute) {
  const results = []
  for (const scene of scenes) {
    const { run: _run, ...metadata } = scene
    const started = Date.now()
    try {
      await execute(scene)
      results.push({ ...metadata, status: 'passed', durationMs: Date.now() - started })
    } catch (error) {
      results.push({ ...metadata, status: error.blocked ? 'blocked' : 'failed', durationMs: Date.now() - started, detail: redact(error.stack ?? error) })
    }
  }
  return results
}

export function summarizeScenarios(scenarios) {
  return {
    passed: scenarios.filter(item => item.status === 'passed').length,
    failed: scenarios.filter(item => item.status === 'failed').length,
    blocked: scenarios.filter(item => item.status === 'blocked').length,
    notCovered: scenarios.filter(item => item.status === 'not-covered').length,
  }
}

export async function verify(options) {
  validateOptions(options)
  const { repo, output: outputDir, dshVersion, regression, onlyRegression, scenario, suite = 'core' } = options
  const selected = selectScenarios(options)
  const regressions = scenario ? [] : onlyRegression ? [regression] : [...new Set([...(await discoverRegressions(repo)), ...(regression ? [regression] : [])])].sort()
  const scenePlan = [
    ...selected,
    ...regressions.map(path => ({ id: `regression:${path}`, feature: 'issue-regression', platform: 'web', parityIds: [], regression: path })),
  ]
  await mkdir(outputDir, { recursive: true })
  const scratch = await mkdtemp(join(tmpdir(), 'ccm-verify-'))
  const checks = []
  const report = {
    passed: false, dshVersion, suite, checks, screenshots: [], scenarios: [],
    coverage: { visualComparison: 'not-covered', fullProduct: false, gaps: COVERAGE_GAPS },
    visual: { results: [] },
  }
  let host
  let browser
  let context
  let currentPage
  let sceneDir
  const check = async (name, action) => {
    try {
      await action()
      checks.push({ name, passed: true })
    } catch (error) {
      checks.push({ name, passed: false, detail: redact(error.stack ?? error) })
      if (currentPage && sceneDir) await currentPage.screenshot({ path: join(sceneDir, 'failure.png') }).catch(() => {})
      throw error
    }
  }
  const closeContext = async () => {
    if (!context) return
    await context.tracing.stop({ path: join(sceneDir, 'trace.zip') }).catch(() => {})
    await context.close().catch(() => {})
    context = null
    currentPage = null
  }
  try {
    const environment = verificationEnvironment(process.env, { DSH_HOME: join(scratch, 'home') })
    await check('runtime-node', async () => {
      const [major, minor] = process.versions.node.split('.').map(Number)
      if (major < 24 || (major === 24 && minor < 9)) throw new Error('DSH verification requires Node.js >=24.9.0')
      await realpath(repo)
    })
    let binary
    await check('install-dsh', async () => { binary = await dshBinary(dshVersion, scratch, environment) })
    await check('install-dependencies', () => runCommand('pnpm', ['install', '--frozen-lockfile'], { cwd: repo, env: environment, timeoutMs: 600_000 }))
    await check('unit-tests', async () => {
      const tests = await collectUnitTests(join(repo, 'test'))
      if (!tests.length) throw new Error('No existing unit tests found')
      await runCommand(process.execPath, ['--test', ...tests], { cwd: repo, env: environment })
    })
    let tarball
    await check('build-and-pack', async () => {
      await runCommand(process.execPath, ['build.mjs'], { cwd: repo, env: environment })
      const packing = await runCommand('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], { cwd: repo, env: environment })
      const parsed = JSON.parse(packing)
      const values = Array.isArray(parsed) ? parsed : Object.values(parsed)
      if (values.length !== 1 || !/^[\w.-]+\.tgz$/.test(values[0].filename)) throw new Error('npm pack did not return exactly one tarball')
      tarball = join(scratch, values[0].filename)
      const client = await readFile(join(repo, 'lib/client.js'), 'utf8')
      if (!client.startsWith('window.__ModuleLoader__.load(')) throw new Error('Client artifact is not self-registering')
    })
    await check('install-plugin-tarball', () => runCommand(binary, ['plugin', '--profile', 'web', 'add', tarball], {
      cwd: repo, env: environment, timeoutMs: 600_000,
    }))
    const workspace = join(scratch, 'workspace')
    await mkdir(workspace)
    await writeFile(join(workspace, 'README.md'), '# Isolated CCM verification fixture\n')
    const fixturePlugin = join(scratch, 'fixture-plugin.mjs')
    await copyFile(join(TOOL_ROOT, 'fixture-plugin.mjs'), fixturePlugin)
    await check('host-startup', async () => {
      host = await startHost(binary, { repo, home: environment.DSH_HOME, workspace, fixturePlugin, scratch, log: join(outputDir, 'host.log') })
    })
    const { chromium, expect: baseExpect } = await import('@playwright/test')
    const expect = baseExpect.configure({ timeout: 15_000 })
    await check('browser-startup', async () => {
      const channel = process.env.CCM_BROWSER_CHANNEL ?? 'chrome'
      if (!['chrome', 'chromium'].includes(channel)) throw new Error('CCM_BROWSER_CHANNEL must be chrome or chromium')
      browser = await chromium.launch({ channel, headless: true, env: verificationEnvironment() })
    })
    report.visual.environment = {
      environmentId: options.visualEnvironment ?? process.env.CCM_VISUAL_ENVIRONMENT_ID ?? null,
      platform: process.platform, browserVersion: browser.version(), locale: 'zh-CN',
      viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
    }
    const baseURL = new URL('/', host.url).href
    report.scenarios = await executeScenePlan(scenePlan, async scene => {
      await closeContext()
      sceneDir = join(outputDir, scene.id.replace(/[^a-zA-Z0-9_-]/g, '_'))
      await mkdir(sceneDir, { recursive: true })
      let fixtures
      const errors = []
      try {
        context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'UTC', colorScheme: 'light' })
        context.setDefaultTimeout(15_000)
        context.setDefaultNavigationTimeout(45_000)
        await context.tracing.start({ screenshots: true, snapshots: true, sources: false })
        currentPage = await context.newPage()
        currentPage.on('pageerror', error => errors.push(redact(error.message)))
        await currentPage.goto(host.url, { waitUntil: 'domcontentloaded' })
        const preferences = await currentPage.request.put(new URL('/claude-code-mode/preferences', baseURL).href, { data: { disabled: [], skin: 'claude' } })
        if (!preferences.ok()) throw new Error(`Preferences reset failed: ${preferences.status()}`)
        const response = await currentPage.request.post(new URL('/ccm-verifier/fixtures?fresh=1', baseURL).href)
        if (!response.ok()) throw new Error(`Fixture setup failed: ${response.status()} ${await response.text()}`)
        fixtures = await response.json()
        if (!Array.isArray(fixtures.sessions) || new Set(fixtures.sessions.map(item => item.id)).size < 4) throw new Error('Fixture setup requires four distinct session identities')
        await currentPage.reload()
        await dismissFirstUse(currentPage)
      } catch (cause) {
        checks.push({ name: `scenario-setup:${scene.id}`, passed: false, detail: redact(cause.stack ?? cause) })
        const error = new Error(`Scenario setup failed: ${cause.message}`, { cause })
        error.blocked = true
        throw error
      }
      await check(scene.id, async () => {
        const args = { page: currentPage, expect, baseURL, repo, outputDir: sceneDir, fixtures }
        if (scene.regression) {
          const module = await import(pathToFileURL(await validatedRegression(repo, scene.regression)).href)
          if (typeof module.run !== 'function') throw new Error('Regression module must export async function run(context)')
          await module.run(args)
        } else await scene.run(args)
        expect(errors, 'Uncaught browser errors').toEqual([])
        await expect(currentPage.locator('[data-slot-error], [data-ct-shell-error], [data-ct-sp-error]')).toHaveCount(0)
      })
      if (!scene.regression) {
        const visual = await compareVisuals({
          baselineDir: options.visualBaselines ?? join(PROJECT_ROOT, 'test/e2e/visual-baselines'),
          environment: report.visual.environment, scenarioId: scene.id, outputDir: sceneDir,
        })
        report.visual.results.push(visual)
        if (visual.status === 'failed') await check(`visual:${scene.id}`, async () => { throw new Error('Approved screenshot baseline differs; inspect actual, baseline and visual-diff images.') })
      }
    })
  } catch (error) {
    if (!checks.some(item => !item.passed)) checks.push({ name: 'verifier', passed: false, detail: redact(error.stack ?? error) })
    const known = new Set(report.scenarios.map(item => item.id))
    for (const { run: _run, ...scene } of scenePlan) {
      if (!known.has(scene.id)) report.scenarios.push({ ...scene, status: 'blocked', detail: 'Upstream installation or host/browser startup failed; see prerequisite checks.' })
    }
  } finally {
    await closeContext()
    if (browser) await browser.close().catch(() => {})
    if (host) {
      await stopChild(host.child)
      await host.saveLog().catch(() => {})
    }
    await rm(scratch, { recursive: true, force: true })
    const visualPassed = report.visual.results.length > 0 && report.visual.results.every(item => item.status === 'passed')
    report.coverage.visualComparison = visualPassed ? 'passed' : report.visual.results.some(item => item.status === 'failed') ? 'failed' : 'review-required'
    for (const gap of COVERAGE_GAPS) {
      if (gap.id !== 'visual-baseline' || !visualPassed) report.scenarios.push({ id: gap.id, feature: gap.feature, status: 'not-covered', detail: gap.reason })
    }
    report.summary = summarizeScenarios(report.scenarios)
    report.passed = checks.every(item => item.passed) && report.summary.failed === 0 && report.summary.blocked === 0 && report.summary.passed > 0
    report.status = report.passed ? report.visual.results.some(item => item.status === 'review-required') ? 'review-required' : 'passed' : 'failed'
    if (!report.passed) {
      const failures = checks.filter(item => !item.passed)
      report.failure = { kind: failures.length > 0 && failures.every(item => item.name.startsWith('visual:')) ? 'visual-review' : report.summary.failed > 0 ? 'product' : 'environment' }
    }
    const files = await readdir(outputDir, { recursive: true })
    report.screenshots = files.filter(name => name.endsWith('.png')).sort()
    await writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    await writeFile(join(outputDir, 'report.md'), [
      `# DSH ${dshVersion} Web verification`, '', `Suite: ${suite}; result: **${report.passed ? 'passed' : 'failed'}**`, '',
      `Scenarios: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.blocked} blocked, ${report.summary.notCovered} not covered.`, '',
      `Visual comparison: ${report.coverage.visualComparison}.`, '',
      ...checks.map(item => `- [${item.passed ? 'x' : ' '}] ${item.name}${item.detail ? `\n\n\`\`\`text\n${item.detail}\n\`\`\`\n` : ''}`),
      '', '## Visual review', '', ...report.visual.results.map(item => `- ${item.scenarioId}: ${item.status}${item.reason ? ` — ${item.reason}` : ''}`),
      '', '## Coverage gaps', '', ...COVERAGE_GAPS.map(gap => `- ${gap.id}: ${gap.reason}`), '',
      'All fixtures are synthetic. The isolated DSH instance has been stopped. Trace URLs may include its expired local session token.', '',
    ].join('\n'))
  }
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      repo: { type: 'string', default: PROJECT_ROOT }, 'dsh-version': { type: 'string' },
      output: { type: 'string', default: join(PROJECT_ROOT, '.e2e-output') },
      suite: { type: 'string', default: 'core' }, scenario: { type: 'string' },
      'visual-baselines': { type: 'string' }, 'visual-environment': { type: 'string' },
      regression: { type: 'string' }, 'only-regression': { type: 'boolean', default: false },
    } })
    const result = await verify({ repo: values.repo, dshVersion: values['dsh-version'], output: values.output, suite: values.suite, scenario: values.scenario, regression: values.regression, onlyRegression: values['only-regression'], visualBaselines: values['visual-baselines'], visualEnvironment: values['visual-environment'] })
    console.log(JSON.stringify({ passed: result.passed, status: result.status, summary: result.summary, checks: result.checks.map(({ name, passed }) => ({ name, passed })) }))
    if (!result.passed) process.exitCode = 1
  } catch (error) {
    console.error(redact(error.message))
    process.exitCode = 1
  }
}
