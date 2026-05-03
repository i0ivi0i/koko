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
const sourceHashWorkerOutputFiles = [
  path.join(distDir, 'source-hash-worker.js'),
  path.join(distDir, 'source-hash-worker.js.map'),
]
const appShellHtmlPath = path.join(distDir, 'app-shell.html')
const appShellServiceWorkerOutputFiles = [
  path.join(distDir, 'app-sw.js'),
]
const appShellServiceWorkerRawOutputFiles = [
  path.join(distDir, 'app-sw.raw.js'),
]
const watchMode = process.argv.some((arg) => arg === '--watch' || arg.startsWith('--watch='))
// iOS Safari 16.4 之前不能解析 class static block，14.1 之前 private fields 也不稳。
// 在构建边界统一降级成熟依赖的新语法，避免 koko-chat-shell 在页面启动前整包解析失败。
const 浏览器构建目标 = ['safari14']
// Safari 早已支持 destructuring；这里显式保留该语法，只让 esbuild 转换真正会导致旧 WebKit
// 启动前解析失败的 class static block / private fields，避免落入 esbuild 暂不支持的 destructuring 降级路径。
const 浏览器构建能力覆盖 = { destructuring: true }

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

function 是否存在应用壳预缓存原始入口() {
  return statSync(path.join(distDir, 'app-sw.raw.js'), { throwIfNoEntry: false })?.isFile() === true
}

function 生成静态资源清单插件() {
  return {
    name: 'koko-asset-manifest',
    setup(build) {
      build.onEnd(async (result) => {
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
          ...sourceHashWorkerOutputFiles,
          ...appShellServiceWorkerOutputFiles,
          ...appShellServiceWorkerRawOutputFiles,
        ]))
        console.log(
          `[koko-build] manifest updated: js=${manifest.app_js} css=${manifest.app_css}`
        )
        /**
         * watch 模式下入口 JS hash 变化不会自动触发 app-sw.ts 重编：
         * 1. 但 app-sw 的 precache 清单正是由 dist 当前静态产物决定；
         * 2. 如果这里不立即重注入，worker 会继续引用上一轮 hash，安装时直接 redundant；
         * 3. 根 SW 一旦装不上，后面的 WebTorrent 自动播、预览、离线导航都会一起失真。
         */
        if (是否存在应用壳预缓存原始入口()) {
          await 注入应用壳预缓存清单()
        }
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
    // 否则导航失败时的 app-shell.html 预缓存回退会在 worker 求值后找不到对应条目。
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
  /**
   * watch 模式下 raw 入口必须保留下来：
   * 1. 后续 app rebuild 只会刷新 dist 资源和 manifest，不会天然触发 app-sw.ts rebuild；
   * 2. 这里若删掉 raw，静态壳更新后就没有可重注入的源文件，precache 只能永远停在旧 hash；
   * 3. 非 watch 单次构建仍删除 raw，避免把中间产物暴露成第二入口。
   */
  if (!watchMode) {
    rmSync(path.join(distDir, 'app-sw.raw.js'), { force: true })
  }
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
  target: 浏览器构建目标,
  supported: 浏览器构建能力覆盖,
  conditions: ['p2pml:core-as-bundle'],
  sourcemap: true,
  metafile: true,
  entryNames: 'app-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  alias: {
    debug: path.join(frontendRoot, '平台', '调试浏览器适配.ts'),
  },
  plugins: [生成静态资源清单插件()],
}

const mediaServiceWorkerBuildOptions = {
  entryPoints: ['media-sw.ts'],
  bundle: true,
  outfile: 'dist/media-sw.js',
  format: 'esm',
  platform: 'browser',
  target: 浏览器构建目标,
  supported: 浏览器构建能力覆盖,
  sourcemap: true,
}

const sourceHashWorkerBuildOptions = {
  entryPoints: ['媒体/源文件哈希.worker.ts'],
  bundle: true,
  outfile: 'dist/source-hash-worker.js',
  format: 'esm',
  platform: 'browser',
  target: 浏览器构建目标,
  supported: 浏览器构建能力覆盖,
  sourcemap: true,
}

const appShellServiceWorkerBuildOptions = {
  entryPoints: ['app-sw.ts'],
  bundle: true,
  outfile: 'dist/app-sw.raw.js',
  format: 'esm',
  platform: 'browser',
  target: 浏览器构建目标,
  supported: 浏览器构建能力覆盖,
  sourcemap: false,
  plugins: [生成应用壳预缓存插件()],
}

if (watchMode) {
  // watch 模式先串行产一轮基线，确保离线壳 HTML 与 precache 清单不会互相抢跑。
  await esbuild.build(appBuildOptions)
  await esbuild.build(mediaServiceWorkerBuildOptions)
  await esbuild.build(sourceHashWorkerBuildOptions)
  await esbuild.build(appShellServiceWorkerBuildOptions)
  const appContext = await esbuild.context(appBuildOptions)
  const mediaSwContext = await esbuild.context(mediaServiceWorkerBuildOptions)
  const sourceHashWorkerContext = await esbuild.context(sourceHashWorkerBuildOptions)
  const appShellSwContext = await esbuild.context(appShellServiceWorkerBuildOptions)
  await appContext.watch()
  await mediaSwContext.watch()
  await sourceHashWorkerContext.watch()
  await appShellSwContext.watch()
  console.log('[koko-build] watch mode started')
} else {
  await esbuild.build(appBuildOptions)
  await esbuild.build(mediaServiceWorkerBuildOptions)
  await esbuild.build(sourceHashWorkerBuildOptions)
  await esbuild.build(appShellServiceWorkerBuildOptions)
  console.log('[koko-build] build completed')
}
