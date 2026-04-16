import * as esbuild from 'esbuild'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import workboxBuild from 'workbox-build'

const frontendRoot = process.cwd()
const distDir = path.join(frontendRoot, 'dist')
const manifestPath = path.join(distDir, 'asset-manifest.json')
const { injectManifest } = workboxBuild
const mediaServiceWorkerOutputFiles = [
  path.join(distDir, 'media-sw.js'),
  path.join(distDir, 'media-sw.js.map'),
]
const appShellHtmlPath = path.join(distDir, 'app-shell.html')
const appShellServiceWorkerOutputFiles = [
  path.join(distDir, 'app-sw.js'),
]
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

function 写入离线应用壳(manifest) {
  const template = readFileSync(path.join(frontendRoot, 'index.html'), 'utf8')
  const html = template
    .replace('{{APP_CSS_PATH}}', manifest.app_css)
    .replace('{{APP_JS_PATH}}', manifest.app_js)
  // 离线导航回退必须指向一份“已经注入真实构建产物路径”的稳定 HTML，
  // 否则 service worker 即使命中了导航路由，也只会回一个没脚本的空壳。
  writeFileSync(appShellHtmlPath, `${html}\n`, 'utf8')
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
        写入离线应用壳(manifest)
        // media-sw.js 是固定文件名，watch 模式下 app 重建时也必须保留，
        // 否则只改页面代码就会把 service worker 构建产物误删掉。
        清理旧构建产物(new Set([
          path.join(frontendRoot, manifest.app_js.slice(1)),
          path.join(frontendRoot, `${manifest.app_js.slice(1)}.map`),
          path.join(frontendRoot, manifest.app_css.slice(1)),
          path.join(frontendRoot, `${manifest.app_css.slice(1)}.map`),
          manifestPath,
          appShellHtmlPath,
          ...mediaServiceWorkerOutputFiles,
          ...appShellServiceWorkerOutputFiles,
        ]))
        console.log(
          `[koko-build] manifest updated: js=${manifest.app_js} css=${manifest.app_css}`
        )
      })
    },
  }
}

function 创建应用壳预缓存注入配置() {
  return {
    swSrc: path.join('dist', 'app-sw.raw.js'),
    swDest: path.join('dist', 'app-sw.js'),
    globDirectory: 'dist',
    // app-sw.js 现在经由 Rust 挂在站点根路径 `/app-sw.js`。
    // 因此 Workbox 注入的 precache URL 也必须显式映射回线上真实的 `/dist/*` 地址，
    // 否则 createHandlerBoundToURL('/dist/app-shell.html') 会在脚本求值阶段找不到对应预缓存条目。
    modifyURLPrefix: {
      '': '/dist/',
    },
    globPatterns: [
      '**/*.{html,js,css,png,jpg,jpeg,webp,gif,svg,woff,woff2}',
    ],
    globIgnores: [
      '**/*.map',
      '**/app-sw.js',
      '**/app-sw.raw.js',
      '**/media-sw.js',
      '**/media-sw.js.map',
      '**/asset-manifest.json',
      '**/api/**',
      '**/socket.io/**',
      '**/media/**',
      '**/attachments/**',
    ],
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
  }
}

async function 注入应用壳预缓存清单() {
  const result = await injectManifest(创建应用壳预缓存注入配置())
  for (const warning of result.warnings ?? []) {
    console.warn(`[koko-build] workbox warning: ${warning}`)
  }
  rmSync(path.join(distDir, 'app-sw.raw.js'), { force: true })
  console.log(`[koko-build] app shell precache injected: files=${result.count}`)
}

function 生成应用壳预缓存插件() {
  return {
    name: 'koko-app-shell-workbox',
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length > 0) {
          return
        }
        // app-sw 只拿 dist 中已经构建好的静态壳资源做 precache，不接触运行时聊天数据。
        await 注入应用壳预缓存清单()
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

const appBuildOptions = {
  entryPoints: ['入口.ts'],
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  conditions: ['p2pml:core-as-bundle'],
  sourcemap: true,
  metafile: true,
  entryNames: 'app-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  alias: {
    debug: path.join(frontendRoot, '调试兼容.ts'),
  },
  plugins: [生成静态资源清单插件()],
}

const mediaServiceWorkerBuildOptions = {
  entryPoints: ['media-sw.ts'],
  bundle: true,
  outfile: 'dist/media-sw.js',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
}

const appShellServiceWorkerBuildOptions = {
  entryPoints: ['app-sw.ts'],
  bundle: true,
  outfile: 'dist/app-sw.raw.js',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
  plugins: [生成应用壳预缓存插件()],
}

if (watchMode) {
  // watch 模式先串行产一轮基线，确保离线壳 HTML 与 precache 清单不会互相抢跑。
  await esbuild.build(appBuildOptions)
  await esbuild.build(mediaServiceWorkerBuildOptions)
  await esbuild.build(appShellServiceWorkerBuildOptions)
  const appContext = await esbuild.context(appBuildOptions)
  const mediaSwContext = await esbuild.context(mediaServiceWorkerBuildOptions)
  const appShellSwContext = await esbuild.context(appShellServiceWorkerBuildOptions)
  await appContext.watch()
  await mediaSwContext.watch()
  await appShellSwContext.watch()
  console.log('[koko-build] watch mode started')
} else {
  await esbuild.build(appBuildOptions)
  await esbuild.build(mediaServiceWorkerBuildOptions)
  await esbuild.build(appShellServiceWorkerBuildOptions)
  console.log('[koko-build] build completed')
}
