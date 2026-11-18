import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverRegressions, executeScenePlan, parseStartupUrl, redact, runCommand, summarizeScenarios, validateOptions, verificationEnvironment } from './run.mjs'
import { SCENARIOS, selectScenarios } from './scenarios.mjs'

test('verifier accepts exact versions and restricts regression paths', () => {
  const options = { repo: '/repo', output: '/evidence', dshVersion: '0.2.2-rc.1' }
  assert.equal(validateOptions(options), options)
  for (const dshVersion of ['latest', '^0.2.2', '0.2.2;echo bad', '01.2.3']) assert.throws(() => validateOptions({ ...options, dshVersion }))
  for (const regression of ['../outside.spec.mjs', 'test/e2e/../../evil.spec.mjs', '/tmp/evil.spec.mjs', 'test/e2e/test.js']) assert.throws(() => validateOptions({ ...options, regression }))
  assert.throws(() => validateOptions({ ...options, onlyRegression: true }))
  assert.equal(validateOptions({ ...options, regression: 'test/e2e/issue-1.spec.mjs' }).regression, 'test/e2e/issue-1.spec.mjs')
})

test('verification processes receive no service credentials', () => {
  const env = verificationEnvironment({ PATH: '/bin', HOME: '/existing-home', GITHUB_TOKEN: 'secret', CCM_MODEL_API_KEY: 'secret', E2B_API_KEY: 'secret', DSH_HOME: '/personal' }, { DSH_HOME: '/isolated' })
  assert.deepEqual(env, { PATH: '/bin', HOME: '/existing-home', CI: '1', NO_COLOR: '1', DSH_HOME: '/isolated' })
})

test('only loopback startup URLs are accepted and token text is redacted', () => {
  assert.equal(parseStartupUrl('docs https://example.com:443/?token=bad\nReady http://127.0.0.1:3210/?token=secret'), 'http://127.0.0.1:3210/?token=secret')
  assert.equal(parseStartupUrl('https://example.com:3000/'), null)
  assert.equal(redact('http://localhost:3/?token=secret&x=y Bearer abc.def\nprivate', ['private']), 'http://localhost:3/?token=[REDACTED]&x=y Bearer [REDACTED]\n[REDACTED]')
})

test('argv execution never interprets shell syntax', async () => {
  assert.equal(await runCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', '$(echo unsafe);`bad`']), '$(echo unsafe);`bad`')
})

test('timed out commands kill their spawned descendants', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ccm-verify-test-'))
  const output = join(directory, 'descendant.txt')
  try {
    await assert.rejects(runCommand(process.execPath, ['-e', `const {spawn}=require('node:child_process');spawn(process.execPath,['-e', 'setTimeout(()=>require("node:fs").writeFileSync(process.argv[1],"leaked"),800)',process.argv[1]],{stdio:'ignore'});setTimeout(()=>{},10000)`, output], { timeoutMs: 150 }), /timeout/)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await assert.rejects(readFile(output), { code: 'ENOENT' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('merged issue regressions are discovered deterministically and symbolic links are refused', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ccm-regressions-test-'))
  try {
    assert.deepEqual(await discoverRegressions(directory), [])
    const tests = join(directory, 'test/e2e')
    await mkdir(tests, { recursive: true })
    for (const name of ['issue-42.spec.mjs', 'issue-1.spec.mjs', 'helper.mjs', 'issue-0.spec.mjs', 'issue-01.spec.mjs']) {
      await writeFile(join(tests, name), 'export async function run() {}\n')
    }
    assert.deepEqual(await discoverRegressions(directory), ['test/e2e/issue-1.spec.mjs', 'test/e2e/issue-42.spec.mjs'])
    await symlink(join(tests, 'issue-1.spec.mjs'), join(tests, 'issue-7.spec.mjs'))
    await assert.rejects(discoverRegressions(directory), /Symbolic link/)
    await rm(join(tests, 'issue-7.spec.mjs'))
    await mkdir(join(tests, 'issue-9.spec.mjs'))
    await assert.rejects(discoverRegressions(directory), /regular file/)
    await rm(tests, { recursive: true })
    await symlink(join(directory, 'test'), tests)
    await assert.rejects(discoverRegressions(directory), /regular directory/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('core/full and exact scenario selection share a unique scenario manifest', () => {
  assert.equal(new Set(SCENARIOS.map(item => item.id)).size, SCENARIOS.length)
  assert.equal(selectScenarios({ suite: 'core' }).length, 6)
  assert.equal(selectScenarios({ suite: 'full' }).length, 10)
  assert.deepEqual(selectScenarios({ scenario: 'four-pane-grid' }).map(item => item.id), ['four-pane-grid'])
  assert.deepEqual(selectScenarios({ onlyRegression: true }), [])
  assert.throws(() => selectScenarios({ suite: 'other' }))
  assert.throws(() => selectScenarios({ scenario: 'unknown' }))
  assert.throws(() => selectScenarios({ scenario: 'sidebar-mounted', onlyRegression: true }))
  assert.ok(SCENARIOS.every(item => item.platform === 'web' && item.actions && item.assertions && item.fixture && typeof item.run === 'function'))
})

test('failed and blocked independent scenes do not prevent later scene execution', async () => {
  const visited = []
  const results = await executeScenePlan(['bad', 'blocked', 'good'].map(id => ({ id })), async scene => {
    visited.push(scene.id)
    if (scene.id === 'bad') throw new Error('assertion failed')
    if (scene.id === 'blocked') { const error = new Error('fixture unavailable'); error.blocked = true; throw error }
  })
  assert.deepEqual(visited, ['bad', 'blocked', 'good'])
  assert.deepEqual(results.map(item => item.status), ['failed', 'blocked', 'passed'])
  assert.deepEqual(summarizeScenarios([...results, { status: 'not-covered' }]), { passed: 1, failed: 1, blocked: 1, notCovered: 1 })
})
