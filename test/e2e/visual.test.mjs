import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PNG } from 'pngjs'
import { compareVisuals } from './visual.mjs'

const environment = { environmentId: 'template-build-1', platform: 'linux', browserVersion: 'chrome-1', locale: 'zh-CN', viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 } }

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ccm-visual-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const baselineDir = join(root, 'baseline')
  const outputDir = join(root, 'output')
  await mkdir(join(baselineDir, 'sidebar-mounted'), { recursive: true })
  await mkdir(outputDir)
  const png = new PNG({ width: 2, height: 2 })
  png.data.fill(255)
  const image = PNG.sync.write(png)
  await writeFile(join(outputDir, 'sidebar.png'), image)
  await writeFile(join(baselineDir, 'sidebar-mounted/sidebar.png'), image)
  const manifest = { schemaVersion: 1, approved: true, reviewedBy: 'maintainer', reviewedAt: '2026-11-18T00:00:00Z', environment, images: { 'sidebar-mounted/sidebar.png': { maxDiffPixels: 0, threshold: 0 } } }
  await writeFile(join(baselineDir, 'APPROVED.json'), JSON.stringify(manifest))
  return { baselineDir, outputDir, environment, scenarioId: 'sidebar-mounted', manifest }
}

test('missing or unapproved baselines require review without creating a golden image', async t => {
  const input = await fixture(t)
  assert.equal((await compareVisuals({ ...input, baselineDir: undefined })).status, 'review-required')
  assert.equal((await compareVisuals({ ...input, environment: { ...environment, environmentId: null } })).status, 'review-required')
  input.manifest.approved = false
  await writeFile(join(input.baselineDir, 'APPROVED.json'), JSON.stringify(input.manifest))
  assert.equal((await compareVisuals(input)).status, 'review-required')
})

test('only environment-matching approved baselines are compared and differences produce evidence', async t => {
  const input = await fixture(t)
  assert.equal((await compareVisuals({ ...input, environment: { ...environment, browserVersion: 'other' } })).status, 'review-required')
  assert.equal((await compareVisuals(input)).status, 'passed')
  const png = new PNG({ width: 2, height: 2 })
  png.data.fill(0)
  for (let pixel = 3; pixel < png.data.length; pixel += 4) png.data[pixel] = 255
  await writeFile(join(input.outputDir, 'sidebar.png'), PNG.sync.write(png))
  const failed = await compareVisuals(input)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.images[0].diffPixels, 4)
  assert.ok((await readFile(join(input.outputDir, 'visual-diff-sidebar.png'))).length > 0)
  assert.ok((await readFile(join(input.outputDir, 'visual-expected-sidebar.png'))).length > 0)
  assert.equal((await readFile(join(input.baselineDir, 'APPROVED.json'), 'utf8')), JSON.stringify(input.manifest))
  await writeFile(join(input.outputDir, 'zz-unapproved.png'), PNG.sync.write(png))
  const mixed = await compareVisuals(input)
  assert.equal(mixed.status, 'failed', 'later missing baseline cannot erase an earlier verified pixel mismatch')
  assert.equal(mixed.images[0].status, 'failed')
  await writeFile(join(input.outputDir, 'aa-unapproved.png'), PNG.sync.write(png))
  const firstMissing = await compareVisuals(input)
  assert.equal(firstMissing.status, 'failed', 'an earlier missing baseline cannot skip comparison of later approved images')
  assert.ok(firstMissing.images.some(image => image.name === 'sidebar.png' && image.status === 'failed'))
})

test('a baseline symlink is rejected instead of reading outside the approved directory', async t => {
  const input = await fixture(t)
  const path = join(input.baselineDir, 'sidebar-mounted/sidebar.png')
  await rm(path)
  await symlink(join(input.outputDir, 'sidebar.png'), path)
  await assert.rejects(compareVisuals(input), /普通文件/)
})
