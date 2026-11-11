import { build, context } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const watch = process.argv.includes('--watch')

/** 插件版本：从 package.json 读，构建时注入 client bundle（不要在代码里手写）。 */
const { version } = JSON.parse(await readFile('package.json', 'utf8'))

await rm('lib', { recursive: true, force: true })
await mkdir('lib', { recursive: true })

/** 浏览器半边：宿主用 window.__ModuleLoader__ 装载，产物必须是该格式的单文件。 */
const client = {
  entryPoints: ['src/client/index.js'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  loader: { '.css': 'text', '.json': 'json' },
  define: { __CT_VERSION__: JSON.stringify(version) },
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
  legalComments: 'none',
  sourcemap: false,
}

/** 宿主半边：Node ESM，Node 内置模块保持 external。 */
const host = {
  entryPoints: ['src/host/index.js'],
  outfile: 'lib/host/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  legalComments: 'none',
  sourcemap: false,
}

if (watch) {
  const clientCtx = await context(client)
  const hostCtx = await context(host)
  await Promise.all([clientCtx.watch(), hostCtx.watch()])
  console.log('[claude-code-mode] watching src/ → lib/')
} else {
  // DSH 不包装插件 client 文件：文件必须自己注册 factory。
  // 产物 = CommonJS 模块体 + __ModuleLoader__ 注册壳。
  const result = await build({ ...client, write: false })
  const body = result.outputFiles[0].text
  const wrapped = `window.__ModuleLoader__.load({
  id: 'claude-code-mode',
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  },
});
`
  await writeFile('lib/client.js', wrapped)
  await build(host)
  console.log('[claude-code-mode] built lib/client.js and lib/host/index.js')
}
