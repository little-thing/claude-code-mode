import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

async function imageFile(path) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_IMAGE_BYTES) throw new Error('视觉基线和实际截图必须是受限大小的普通文件')
  const bytes = await readFile(path)
  if (bytes.length < 24 || bytes.length > MAX_IMAGE_BYTES || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('无效 PNG 截图')
  if (bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 16_000_000) throw new Error('截图像素数量超限')
  return PNG.sync.read(bytes)
}

/** 只读取已经审核的基线，不生成、不覆盖，也不把当前截图自动确认为预期。 */
export async function compareVisuals({ baselineDir, environment, scenarioId, outputDir }) {
  const review = (reason, images = []) => ({ scenarioId, status: images.some(image => image.status === 'failed') ? 'failed' : 'review-required', reason, images })
  if (!/^[a-z][a-z0-9-]*$/.test(scenarioId)) throw new Error('无效视觉场景标识')
  if (!baselineDir) return review('未指定已审核的截图基线目录。')
  if (!environment?.environmentId) return review('未指定可重复的视觉环境标识（例如精确 E2B 模板构建 ID）。')
  let root
  let manifest
  try {
    const info = await lstat(baselineDir)
    if (!info.isDirectory() || info.isSymbolicLink()) return review('基线目录必须是实体目录。')
    root = await realpath(baselineDir)
    const path = join(root, 'APPROVED.json')
    const metadata = await lstat(path)
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 64 * 1024) return review('已审核基线清单无效。')
    manifest = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return review('缺少 APPROVED.json 或基线目录，等待维护者审核。')
    return review(`无法读取已审核基线：${error.message}`)
  }
  if (!manifest || manifest.schemaVersion !== 1 || manifest.approved !== true || typeof manifest.reviewedBy !== 'string' || !manifest.reviewedBy.trim() || !Number.isFinite(Date.parse(manifest.reviewedAt))) return review('基线尚未记录维护者审核人和审核时间。')
  const expected = manifest.environment
  if (!expected || expected.environmentId !== environment.environmentId || expected.platform !== environment.platform || expected.browserVersion !== environment.browserVersion || expected.locale !== environment.locale || ['width', 'height', 'deviceScaleFactor'].some(key => expected.viewport?.[key] !== environment.viewport?.[key])) return review('当前模板、系统、Chrome、语言或视口与已审核基线不一致。')
  const actualFiles = (await readdir(outputDir)).filter(name => /^[A-Za-z0-9_-]+\.png$/.test(name) && !name.startsWith('visual-') && name !== 'failure.png').sort()
  if (!actualFiles.length) return review('本场景未提供截图，视觉比较尚未执行。')
  const images = []
  const pendingReview = []
  for (const name of actualFiles) {
    const entry = manifest.images?.[`${scenarioId}/${name}`]
    if (!entry || !Number.isSafeInteger(entry.maxDiffPixels) || entry.maxDiffPixels < 0 || typeof entry.threshold !== 'number' || entry.threshold < 0 || entry.threshold > 1) {
      const reason = `截图 ${scenarioId}/${name} 尚无有效已审核基线。`
      pendingReview.push(reason)
      images.push({ name, status: 'review-required', reason })
      continue
    }
    try {
      const directory = join(root, scenarioId)
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('基线场景目录不是实体目录')
      const actual = await imageFile(join(outputDir, name))
      const baseline = await imageFile(join(directory, name))
      if (actual.width !== baseline.width || actual.height !== baseline.height) {
        await writeFile(join(outputDir, `visual-expected-${name}`), PNG.sync.write(baseline))
        images.push({ name, status: 'failed', reason: '截图尺寸与基线不一致。', expected: `visual-expected-${name}` })
        continue
      }
      const diff = new PNG({ width: actual.width, height: actual.height })
      const pixels = pixelmatch(actual.data, baseline.data, diff.data, actual.width, actual.height, { threshold: entry.threshold })
      const passed = pixels <= entry.maxDiffPixels
      if (!passed) {
        await writeFile(join(outputDir, `visual-expected-${name}`), PNG.sync.write(baseline))
        await writeFile(join(outputDir, `visual-diff-${name}`), PNG.sync.write(diff))
      }
      images.push({ name, status: passed ? 'passed' : 'failed', diffPixels: pixels, allowedPixels: entry.maxDiffPixels, ...passed ? {} : { expected: `visual-expected-${name}`, diff: `visual-diff-${name}` } })
    } catch (error) {
      if (error.code === 'ENOENT') {
        const reason = `截图 ${scenarioId}/${name} 的已审核基线文件缺失。`
        pendingReview.push(reason)
        images.push({ name, status: 'review-required', reason })
        continue
      }
      throw error
    }
  }
  return { scenarioId, status: images.some(image => image.status === 'failed') ? 'failed' : pendingReview.length ? 'review-required' : 'passed', images, ...pendingReview.length ? { reason: pendingReview.join(' ') } : {} }
}
