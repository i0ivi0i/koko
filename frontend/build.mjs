import * as esbuild from 'esbuild'
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const frontendRoot = process.cwd()
const distDir = path.join(frontendRoot, 'dist')
const manifestPath = path.join(distDir, 'asset-manifest.json')
const watchMode = process.argv.some((arg) => arg === '--watch' || arg.startsWith('--watch='))

function 规范输出路径(filePath) {
  const relativePath = path.relative(frontendRoot, filePath)
  return `/${relativePath.replace(/\\/g, '/')}`
}

function 收集入口产物(metafile) {
  const outputs = Object.entries(metafile.outputs)
  const jsEntry = outputs.find(
    ([filePath, meta]) => meta.entryPoint === '入口.ts' && filePath.endsWith('.js')
  )
  if (!jsEntry) {
    throw new Error('未找到入口 JS 构建产物')
  }
  const [jsFilePath, jsMeta] = jsEntry
  if (!jsMeta.cssBundle) {
    throw new Error('未找到入口 CSS 构建产物')
  }
  return {
    app_js: 规范输出路径(jsFilePath),
    app_css: 规范输出路径(jsMeta.cssBundle),
  }
}

function 生成静态资源清单插件() {
  return {
    name: 'koko-asset-manifest',
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) {
          return
        }
        if (!result.metafile) {
          throw new Error('构建缺少 metafile，无法生成静态资源清单')
        }
        mkdirSync(distDir, { recursive: true })
        const manifest = 收集入口产物(result.metafile)
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
        清理旧构建产物(new Set([
          path.join(frontendRoot, manifest.app_js.slice(1)),
          path.join(frontendRoot, `${manifest.app_js.slice(1)}.map`),
          path.join(frontendRoot, manifest.app_css.slice(1)),
          path.join(frontendRoot, `${manifest.app_css.slice(1)}.map`),
          manifestPath,
        ]))
        console.log(
          `[koko-build] manifest updated: js=${manifest.app_js} css=${manifest.app_css}`
        )
      })
    },
  }
}

function 清理旧构建产物(保留文件) {
  if (!statSync(distDir, { throwIfNoEntry: false })?.isDirectory()) {
    return
  }
  for (const entry of readdirSync(distDir, { withFileTypes: true })) {
    const absolutePath = path.join(distDir, entry.name)
    if (entry.isDirectory()) {
      rmSync(absolutePath, { recursive: true, force: true })
      continue
    }
    if (!保留文件.has(absolutePath)) {
      rmSync(absolutePath, { force: true })
    }
  }
}

const sharedOptions = {
  entryPoints: ['入口.ts'],
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  metafile: true,
  entryNames: 'app-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  plugins: [生成静态资源清单插件()],
}

if (watchMode) {
  const ctx = await esbuild.context(sharedOptions)
  await ctx.watch()
  console.log('[koko-build] watch mode started')
} else {
  await esbuild.build(sharedOptions)
  console.log('[koko-build] build completed')
}
