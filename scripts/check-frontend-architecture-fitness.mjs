import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const 当前脚本路径 = fileURLToPath(import.meta.url);
const 当前文件目录 = dirname(当前脚本路径);
const 仓库根目录 = resolve(当前文件目录, "..");
const 前端目录 = join(仓库根目录, "frontend");
const 前端测试目录 = join(前端目录, "tests");
const 房间消息窗测试目录 = join(前端测试目录, "房间消息窗");
const 聊天应用内核测试目录 = join(前端测试目录, "聊天应用内核");
const 聊天媒体编排测试目录 = join(前端测试目录, "聊天媒体编排");
const 媒体查看器测试目录 = join(前端测试目录, "媒体查看器");

const 需要扫描的扩展名 = new Set([".ts", ".js", ".mjs"]);
const 跳过目录 = new Set(["dist", "node_modules", "tests"]);
const 前端根目录允许文件 = new Set([
  ".tsbuildinfo",
  "入口.ts",
  "app-sw.ts",
  "build.mjs",
  "css.d.ts",
  "dev-seeder.d.mts",
  "dev-seeder.mjs",
  "idb-chunk-store.d.ts",
  "index.html",
  "media-sw.ts",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "vitest.config.ts",
  "webtorrent.d.ts",
]);

/**
 * 前端运行时 owner 注册表。
 * 这里不是重新造架构描述，而是把“谁能拥有长生命周期真相”变成可执行门禁。
 */
const 前端运行时Owner注册表 = [
  { path: "frontend/总装/聊天应用内核.ts", symbol: "创建聊天应用内核" },
  { path: "frontend/后台/应用内核.ts", symbol: "创建后台应用内核" },
  { path: "frontend/恢复/应用.ts", symbol: "创建恢复应用" },
  { path: "frontend/实时/应用.ts", symbol: "创建实时应用" },
  { path: "frontend/平台/浏览器应用平台.ts", symbol: "创建浏览器应用平台" },
  { path: "frontend/平台/应用生命周期.ts", symbol: "创建应用生命周期Actor" },
  { path: "frontend/实时/会话运行时.ts", symbol: "创建实时会话Actor" },
  { path: "frontend/房间/运行时.ts", symbol: "创建房间内核" },
  { path: "frontend/时间线/运行时.ts", symbol: "创建房间时间线Actor" },
  { path: "frontend/时间线/视口运行时.ts", symbol: "创建房间视口Actor" },
  { path: "frontend/媒体/运行时.ts", symbol: "创建媒体运行时Actor" },
  { path: "frontend/媒体/全局丝滑自动播.ts", symbol: "判定播放连续性表面" },
  { path: "frontend/媒体/资产协作分发运行时.ts", symbol: "创建资产协作分发运行时" },
  { path: "frontend/平台/缓存更新运行时.ts", symbol: "创建缓存更新运行时" },
];

/**
 * 已经完成清零的根业务旧入口必须继续不存在。
 * 这样才能把门禁固定成“frontend 根目录只留入口/配置/声明/worker，业务 owner 一律不许回流”。
 */
const 前端已清零根文件规则 = [
  {
    path: "frontend/契约.ts",
    ownerPath: "frontend/聊天共享/契约.ts",
    requiredOwnerSnippets: ["export interface 消息事件 {", "export interface 房间快照 {"],
  },
  {
    path: "frontend/传输.ts",
    ownerPath: "frontend/平台/传输.ts",
    requiredOwnerSnippets: ["export function 创建前端传输(", "const 实时连接 = new 实时连接适配(baseUrl);"],
  },
  {
    path: "frontend/存储.ts",
    ownerPath: "frontend/平台/存储.ts",
    requiredOwnerSnippets: ["export function 创建浏览器存储(", "const 设备匿名凭证存储键 ="],
  },
  {
    path: "frontend/状态.ts",
    ownerPath: "frontend/总装/聊天状态.ts",
    requiredOwnerSnippets: ["export interface 聊天状态", "export const 初始聊天状态"],
  },
  {
    path: "frontend/应用运行时.ts",
    ownerPath: "frontend/平台/应用运行时.ts",
    requiredOwnerSnippets: ["const 翻译平台事件为内核命令 =", "export function 创建应用运行时("],
  },
  {
    path: "frontend/聊天应用编排桥接.ts",
    ownerPath: "frontend/总装/聊天应用编排桥接.ts",
    requiredOwnerSnippets: ["export interface 聊天内核平台端口", "export function 创建聊天内核平台桥接("],
  },
  {
    path: "frontend/后台查询编排.ts",
    ownerPath: "frontend/后台/查询编排.ts",
    requiredOwnerSnippets: [
      "export function 创建后台查询编排(",
      'import type { 后台查询传输端口 } from "../平台/传输.js";',
    ],
  },
  {
    path: "frontend/后台会话编排.ts",
    ownerPath: "frontend/后台/会话编排.ts",
    requiredOwnerSnippets: [
      "export function 创建后台会话编排(",
      'import type { 后台会话传输端口 } from "../平台/传输.js";',
    ],
  },
  {
    path: "frontend/后台壳编排.ts",
    ownerPath: "frontend/后台/壳编排.ts",
    requiredOwnerSnippets: ["export function 创建后台壳编排(", "snapshot(): 后台壳快照"],
  },
  {
    path: "frontend/后台应用内核.ts",
    ownerPath: "frontend/后台/应用内核.ts",
    requiredOwnerSnippets: ["class 后台应用内核", "export function 创建后台应用内核("],
  },
  {
    path: "frontend/后台壳.ts",
    ownerPath: "frontend/后台/壳.ts",
    requiredOwnerSnippets: [
      "export class 后台壳 extends LitElement",
      'customElements.define("koko-admin-shell", 后台壳);',
    ],
  },
  {
    path: "frontend/房间时间线.ts",
    ownerPath: "frontend/时间线/领域.ts",
    requiredOwnerSnippets: ["function 合并房间时间线消息(", "export function 推进房间时间线("],
  },
  {
    path: "frontend/房间恢复编排.ts",
    ownerPath: "frontend/恢复/壳层/房间恢复编排.ts",
    requiredOwnerSnippets: ["export function 创建房间恢复编排(", 'from "../应用.js"'],
  },
  {
    path: "frontend/房间视口运行时.ts",
    ownerPath: "frontend/时间线/视口运行时.ts",
    requiredOwnerSnippets: ["const 房间视口机 = createMachine(", "export function 创建房间视口Actor()"],
  },
  {
    path: "frontend/房间时间线运行时.ts",
    ownerPath: "frontend/时间线/运行时.ts",
    requiredOwnerSnippets: ["const 房间时间线机 = createMachine(", "export function 创建房间时间线Actor()"],
  },
  {
    path: "frontend/实时会话运行时.ts",
    ownerPath: "frontend/实时/会话运行时.ts",
    requiredOwnerSnippets: ["const 实时会话机 = createMachine(", "export function 创建实时会话Actor()"],
  },
  {
    path: "frontend/房间滚动器.ts",
    ownerPath: "frontend/时间线/滚动器.ts",
    requiredOwnerSnippets: ["export class 房间滚动器", "export interface 房间滚动器依赖"],
  },
  {
    path: "frontend/房间消息窗.ts",
    ownerPath: "frontend/房间消息窗/壳.ts",
    requiredOwnerSnippets: ["export class 房间消息窗 extends LitElement", 'customElements.define("koko-room-message-pane", 房间消息窗);'],
  },
  {
    path: "frontend/媒体运行时.ts",
    ownerPath: "frontend/媒体/运行时.ts",
    requiredOwnerSnippets: ["const 媒体运行时机 = createMachine(", "export function 创建媒体运行时Actor()"],
  },
  {
    path: "frontend/文本布局.ts",
    ownerPath: "frontend/房间消息窗/文本布局.ts",
    requiredOwnerSnippets: ["export function 创建文本布局器()", "export const 默认文本布局器 = 创建文本布局器()"],
  },
  {
    path: "frontend/视图.ts",
    ownerPath: "frontend/房间消息窗/视图.ts",
    requiredOwnerSnippets: ["export function 派生聊天列表展示项(", "export function 派生壳级操作台状态("],
  },
  {
    path: "frontend/调试兼容.ts",
    ownerPath: "frontend/平台/调试浏览器适配.ts",
    requiredOwnerSnippets: ["debugFactory", 'from "../node_modules/debug/src/browser.js"'],
  },
  {
    path: "frontend/应用生命周期.ts",
    ownerPath: "frontend/平台/应用生命周期.ts",
    requiredOwnerSnippets: ["createMachine(", "const 应用生命周期机 ="],
  },
  {
    path: "frontend/阅读推进编排.ts",
    ownerPath: "frontend/房间/壳层/阅读推进.ts",
    requiredOwnerSnippets: ["const 阅读推进节流毫秒 = 400;", "export function 创建阅读推进编排("],
  },
  {
    path: "frontend/房间内核.ts",
    ownerPath: "frontend/房间/运行时.ts",
    requiredOwnerSnippets: ["const 房间编排机 = createMachine(", "export function 创建房间内核()"],
  },
  {
    path: "frontend/房间实时编排.ts",
    ownerPath: "frontend/实时/应用.ts",
    requiredOwnerSnippets: [
      "export const 创建房间实时编排 = 创建实时应用;",
      "export type 房间实时编排依赖 = 实时应用依赖;",
    ],
  },
];

const 架构规则 = [
  {
    label: "platform internal import boundary",
  },
];

const 前端禁回流片段规则 = [
  {
    label: "locator original_url fallback",
    pattern: /\blocator\.original_url\b/g,
  },
  {
    label: "video preview cold-source fallback",
    path: "frontend/媒体/壳层/视频预览协作.ts",
    pattern:
      /读取视频canonical冷源地址|file_asset\?\.variants\.canonical\?\.url|file_asset\?\.origin\.original_url/g,
  },
  {
    label: "reuseOnly playback barrier",
    path: "frontend/媒体/媒体播放.ts",
    pattern: /\breuseOnly\b/g,
  },
  {
    label: "reuseOnly runtime barrier",
    path: "frontend/媒体/资产协作分发运行时.ts",
    pattern: /\breuseOnly\b/g,
  },
  {
    label: "room message pane WebTorrent byte owner barrier",
    path: "frontend/房间消息窗/壳.ts",
    pattern: /\bnew\s+WebTorrent\b|\bcreateServer\s*\(|\bstreamURL\b/g,
  },
  {
    label: "room message pane autoplay observer wrapper",
    path: "frontend/房间消息窗/壳.ts",
    pattern:
      /private\s+dispatch自动播候选\s*\(|private\s+调度自动播候选\s*\(|private\s+取消自动播候选调度\s*\(|private\s+清理自动播候选观察\s*\(|private\s+根据矩形计算自动播候选\s*\(|private\s+同步自动播候选观察\s*\(|private\s+读取自动播候选\s*\(/g,
  },
  {
    label: "global smooth autoplay must not own player or bytes",
    path: "frontend/媒体/全局丝滑自动播.ts",
    pattern: /\bnew\s+WebTorrent\b|\bcreateServer\s*\(|\bstreamURL\b|\bvideojs\b|\bdocument\.createElement\b/g,
  },
  {
    label: "chat media owner fallback",
    path: "frontend/媒体/播放会话/应用.ts",
    pattern:
      /创建资产协作分发运行时|const 启动查看器起始附件会话\s*=|const 补启动查看器正式会话Consumer\s*=|const 当前请求命中热自动播会话\s*=/g,
  },
  {
    label: "legacy room realtime owner reflux",
    path: "frontend/房间实时编排.ts",
    pattern:
      /let realtimeSocket|function ensureRealtimeSocket|处理实时控制面结果\(|登记待补发创建消息\(/g,
  },
  {
    label: "legacy recovery owner reflux",
    path: "frontend/聊天恢复/壳层/房间快照恢复.ts",
    pattern:
      /function 同步首页房间历史|function 进入房间快照|function 处理恢复失败|function resolveFallbackRoomCode/g,
  },
];

const 禁止新增前端文件规则 = [
  {
    label: "duplicate global WebTorrent owner file",
    pattern: /全局唯一WebTorrent|WebTorrent状态机|WebTorrent生命周期机/i,
    detail: "WebTorrent 生命周期 owner 只能落在资产协作分发运行时，禁止新增第二 owner 文件",
  },
  {
    label: "legacy recovery facade file",
    pattern: /frontend\/聊天恢复\/壳层\/房间快照恢复\.ts$/,
    detail: "旧房间快照恢复过渡门面必须彻底删除，不得以兼容入口形式回流",
  },
];

const 热点文件行数上限 = [
  // 同时钉住有效源码和物理行数：有效行防逻辑回胖，物理行防大文件靠注释/留白继续失控。
  { path: "frontend/总装/聊天状态.ts", maxEffectiveLines: 220, maxPhysicalLines: 280 },
  { path: "frontend/房间消息窗/壳.ts", maxEffectiveLines: 1700, maxPhysicalLines: 1890 },
  { path: "frontend/房间消息窗/附件渲染.ts", maxEffectiveLines: 808, maxPhysicalLines: 929 },
  { path: "frontend/房间消息窗/消息虚拟列表.ts", maxEffectiveLines: 180, maxPhysicalLines: 160 },
  { path: "frontend/房间消息窗/视图.ts", maxEffectiveLines: 780, maxPhysicalLines: 900 },
  { path: "frontend/房间消息窗/文本布局.ts", maxEffectiveLines: 240, maxPhysicalLines: 300 },
  { path: "frontend/媒体/运行时.ts", maxEffectiveLines: 700, maxPhysicalLines: 820 },
  { path: "frontend/时间线/滚动器.ts", maxEffectiveLines: 470, maxPhysicalLines: 540 },
  { path: "frontend/总装/聊天应用内核.ts", maxEffectiveLines: 1250, maxPhysicalLines: 1250 },
  { path: "frontend/总装/聊天壳.ts", maxEffectiveLines: 1650, maxPhysicalLines: 1700 },
  { path: "frontend/媒体/播放会话/应用.ts", maxEffectiveLines: 1450, maxPhysicalLines: 1500 },
  { path: "frontend/恢复/应用.ts", maxEffectiveLines: 320, maxPhysicalLines: 360 },
  { path: "frontend/实时/应用.ts", maxEffectiveLines: 260, maxPhysicalLines: 300 },
];

const 前端测试热点边界 = [
  {
    label: "room media",
    directory: "frontend/tests/房间消息窗/",
    directoryAbsolutePath: 房间消息窗测试目录,
    maxEffectiveLines: 950,
    maxTestCases: 18,
    support: {
      path: "frontend/tests/common/房间消息窗媒体支架.ts",
      maxEffectiveLines: 350,
    },
    retiredFiles: [
      {
        path: "frontend/tests/房间消息窗媒体查看器测试.spec.ts",
        reason: "房间消息窗媒体测试必须按 owner 拆到 frontend/tests/房间消息窗/",
      },
    ],
  },
  {
    label: "chat app kernel",
    directory: "frontend/tests/聊天应用内核/",
    directoryAbsolutePath: 聊天应用内核测试目录,
    maxEffectiveLines: 950,
    maxTestCases: 15,
    support: {
      path: "frontend/tests/common/聊天应用内核支架.ts",
      maxEffectiveLines: 350,
    },
    retiredFiles: [
      {
        path: "frontend/tests/聊天应用内核测试.spec.ts",
        reason: "聊天应用内核测试必须按 owner 拆到 frontend/tests/聊天应用内核/",
      },
    ],
  },
  {
    label: "chat media orchestration",
    directory: "frontend/tests/聊天媒体编排/",
    directoryAbsolutePath: 聊天媒体编排测试目录,
    maxEffectiveLines: 950,
    maxTestCases: 12,
    support: {
      path: "frontend/tests/common/聊天媒体编排支架.ts",
      maxEffectiveLines: 350,
    },
    retiredFiles: [
      {
        path: "frontend/tests/聊天媒体编排测试.spec.ts",
        reason: "聊天媒体编排测试必须按 owner 拆到 frontend/tests/聊天媒体编排/",
      },
    ],
  },
  {
    label: "media viewer",
    directory: "frontend/tests/媒体查看器/",
    directoryAbsolutePath: 媒体查看器测试目录,
    maxEffectiveLines: 950,
    maxTestCases: 10,
    supportFiles: [
      {
        path: "frontend/tests/common/媒体查看器支架.ts",
        maxEffectiveLines: 40,
      },
      {
        path: "frontend/tests/common/媒体查看器DOM支架.ts",
        maxEffectiveLines: 350,
      },
      {
        path: "frontend/tests/common/媒体查看器VideoJs支架.ts",
        maxEffectiveLines: 160,
      },
    ],
    retiredFiles: [
      {
        path: "frontend/tests/媒体查看器测试.spec.ts",
        reason: "媒体查看器适配器测试必须按 viewer owner 拆到 frontend/tests/媒体查看器/",
      },
    ],
  },
];

const 转成仓库相对路径 = (absolutePath) =>
  relative(仓库根目录, absolutePath).replaceAll("\\", "/");

const 读取源码 = (relativePath) =>
  readFileSync(join(仓库根目录, relativePath), "utf8");

const 模块说明符正则 = /^\s*import(?:[\s\S]*?\bfrom\s*)?["']([^"']+)["']\s*;?|^\s*export[\s\S]*?\bfrom\s*["']([^"']+)["']\s*;?/gm;

const 文件存在 = (absolutePath) => {
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
};

const 去掉注释 = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const 提取模块说明符 = (source) => {
  const specifiers = [];
  for (const match of source.matchAll(模块说明符正则)) {
    const specifier = match[1] ?? match[2];
    if (specifier) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
};

const 枚举相对导入候选路径 = (importerAbsolutePath, specifier) => {
  if (!specifier.startsWith(".")) {
    return [];
  }

  const resolved = resolve(dirname(importerAbsolutePath), specifier);
  if (extname(resolved)) {
    return [resolved];
  }

  return [
    resolved,
    `${resolved}.ts`,
    `${resolved}.js`,
    `${resolved}.mjs`,
    `${resolved}.d.ts`,
    join(resolved, "index.ts"),
    join(resolved, "index.js"),
    join(resolved, "index.mjs"),
  ];
};

export const 统计有效源码行数 = (source) => {
  let 位于块注释内 = false;
  let count = 0;
  for (const line of source.split(/\r?\n/)) {
    let text = line.trim();
    if (!text) {
      continue;
    }
    while (text) {
      if (位于块注释内) {
        const commentEnd = text.indexOf("*/");
        if (commentEnd === -1) {
          text = "";
          break;
        }
        text = text.slice(commentEnd + 2).trim();
        位于块注释内 = false;
        continue;
      }
      if (text.startsWith("//") || text === "*" || text.startsWith("* ")) {
        text = "";
        break;
      }
      if (text.startsWith("/*")) {
        const commentEnd = text.indexOf("*/", 2);
        if (commentEnd === -1) {
          位于块注释内 = true;
          text = "";
          break;
        }
        text = text.slice(commentEnd + 2).trim();
        continue;
      }
      count += 1;
      break;
    }
  }
  return count;
};

export const 统计物理源码行数 = (source) => source.split(/\r?\n/).length;

const 收集文件 = (directory) => {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (跳过目录.has(entry)) {
      continue;
    }

    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      files.push(...收集文件(absolutePath));
      continue;
    }
    if (!需要扫描的扩展名.has(extname(absolutePath))) {
      continue;
    }
    files.push(absolutePath);
  }
  return files;
};

const 平台内层Import违规 = (relativePath, source) => {
  if (relativePath.startsWith("frontend/平台/")) {
    return [];
  }

  const violations = [];
  const importRegexes = [
    /\bfrom\s+["']([^"']*平台\/[^"']+)["']/g,
    /^\s*import\s+["']([^"']*平台\/[^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']*平台\/[^"']+)["']\s*\)/g,
  ];
  const 平台传输直连允许文件 = new Set([
    "frontend/总装/聊天壳.ts",
    "frontend/媒体/播放会话/应用.ts",
    "frontend/总装/聊天应用内核.ts",
    "frontend/总装/应用装配.ts",
    "frontend/总装/聊天应用编排桥接.ts",
    "frontend/后台/壳.ts",
    "frontend/后台/会话编排.ts",
    "frontend/后台/应用内核.ts",
    "frontend/后台/查询编排.ts",
    "frontend/恢复/壳层/房间恢复编排.ts",
    "frontend/聊天实时/壳层/实时控制面协作.ts",
  ]);
  const 平台存储直连允许文件 = new Set([
    "frontend/总装/聊天应用内核.ts",
    "frontend/总装/聊天应用编排桥接.ts",
    "frontend/总装/聊天状态.ts",
    "frontend/恢复/应用.ts",
    "frontend/房间消息窗/视图.ts",
    "frontend/恢复/壳层/房间恢复编排.ts",
  ]);

  for (const importRegex of importRegexes) {
    for (const match of source.matchAll(importRegex)) {
      const importPath = match[1].replaceAll("\\", "/");
      if (importPath.endsWith("/平台/index.js")) {
        continue;
      }
      if (
        平台传输直连允许文件.has(relativePath) &&
        (importPath.endsWith("/平台/传输.js") || importPath === "./平台/传输.js")
      ) {
        continue;
      }
      if (
        平台存储直连允许文件.has(relativePath) &&
        (importPath.endsWith("/平台/存储.js") || importPath === "./平台/存储.js")
      ) {
        continue;
      }
      if (
        relativePath === "frontend/总装/聊天壳.ts" &&
        (importPath === "./平台/应用运行时.js" ||
          importPath.endsWith("/平台/应用运行时.js"))
      ) {
        continue;
      }
      if (
        relativePath === "frontend/总装/聊天应用内核.ts" &&
        (importPath === "./平台/应用生命周期.js" ||
          importPath.endsWith("/平台/应用生命周期.js"))
      ) {
        continue;
      }
      if (
        relativePath === "frontend/总装/应用装配.ts" &&
        (importPath === "../平台/应用运行时.js" ||
          importPath.endsWith("/平台/应用运行时.js"))
      ) {
        continue;
      }
      violations.push({
        file: relativePath,
        label: 架构规则[0].label,
        detail: importPath,
      });
    }
  }
  return violations;
};

const 检查Owner注册表 = () => {
  const violations = [];
  for (const owner of 前端运行时Owner注册表) {
    let source;
    try {
      source = 读取源码(owner.path);
    } catch {
      violations.push({
        file: owner.path,
        label: "runtime owner registry",
        detail: "注册表文件不存在",
      });
      continue;
    }
    if (!source.includes(owner.symbol)) {
      violations.push({
        file: owner.path,
        label: "runtime owner registry",
        detail: `找不到注册 owner 符号 ${owner.symbol}`,
      });
    }
  }
  return violations;
};

const 检查前端根目录白名单 = () => {
  const violations = [];
  for (const entry of readdirSync(前端目录)) {
    const absolutePath = join(前端目录, entry);
    const stats = statSync(absolutePath);
    if (!stats.isFile()) {
      continue;
    }
    if (前端根目录允许文件.has(entry)) {
      continue;
    }
    violations.push({
      file: `frontend/${entry}`,
      label: "unexpected frontend root file",
      detail: "frontend 根目录只允许入口、配置、声明、service worker 和开发脚本白名单文件",
    });
  }
  return violations;
};

const 检查已清零根文件规则 = () => {
  const violations = [];

  for (const rule of 前端已清零根文件规则) {
    const absolutePath = join(仓库根目录, rule.path);
    if (文件存在(absolutePath)) {
      violations.push({
        file: rule.path,
        label: "deleted root business file revived",
        detail: "已清零的 frontend 根业务旧入口又出现了，必须删除并改回真实 owner",
      });
      continue;
    }

    let ownerSource;
    try {
      ownerSource = 读取源码(rule.ownerPath);
    } catch {
      violations.push({
        file: rule.ownerPath,
        label: "deleted root owner missing",
        detail: "已清零旧根入口对应的真实 owner 文件不存在",
      });
      continue;
    }

    for (const snippet of rule.requiredOwnerSnippets) {
      if (ownerSource.includes(snippet)) {
        continue;
      }
      violations.push({
        file: rule.ownerPath,
        label: "deleted root owner drift",
        detail: `真实 owner 缺少关键实现片段: ${snippet}`,
      });
    }
  }

  return violations;
};

const 检查旧根路径导入 = (directories) => {
  const deletedRootTargets = new Map(
    前端已清零根文件规则.map((rule) => [join(仓库根目录, rule.path), rule.path])
  );
  const scanFiles = directories.flatMap((directory) => 收集文件(directory));
  const violations = [];

  for (const absolutePath of scanFiles) {
    const source = readFileSync(absolutePath, "utf8");
    for (const specifier of 提取模块说明符(source)) {
      const hit = 枚举相对导入候选路径(absolutePath, specifier).find((candidate) =>
        deletedRootTargets.has(candidate)
      );
      if (!hit) {
        continue;
      }
      violations.push({
        file: 转成仓库相对路径(absolutePath),
        label: "deleted frontend root import",
        detail: `禁止继续 import 已清零旧根路径 ${deletedRootTargets.get(hit)}，应改向真实 owner`,
      });
    }
  }

  return violations;
};

const 检查未登记XStateOwner = (files) => {
  const registered = new Set(前端运行时Owner注册表.map((owner) => owner.path));
  const violations = [];
  for (const absolutePath of files) {
    const relativePath = 转成仓库相对路径(absolutePath);
    const source = readFileSync(absolutePath, "utf8");
    if (!/\bcreate(?:Actor|Machine)\s*\(/.test(source)) {
      continue;
    }
    if (registered.has(relativePath)) {
      continue;
    }
    violations.push({
      file: relativePath,
      label: "unregistered xstate owner",
      detail: "新增长生命周期 actor/machine 必须先登记 owner",
    });
  }
  return violations;
};

const 检查禁回流片段 = (files) => {
  const violations = [];
  for (const absolutePath of files) {
    const relativePath = 转成仓库相对路径(absolutePath);
    const source = 去掉注释(readFileSync(absolutePath, "utf8"));
    for (const rule of 前端禁回流片段规则) {
      if (rule.path && rule.path !== relativePath) {
        continue;
      }
      rule.pattern.lastIndex = 0;
      if (!rule.pattern.test(source)) {
        continue;
      }
      violations.push({
        file: relativePath,
        label: rule.label,
        detail: "命中已禁回流的前端旧架构片段",
      });
    }
  }
  return violations;
};

const 检查禁用前端文件名 = (files) => {
  const violations = [];
  for (const absolutePath of files) {
    const relativePath = 转成仓库相对路径(absolutePath);
    for (const rule of 禁止新增前端文件规则) {
      rule.pattern.lastIndex = 0;
      if (!rule.pattern.test(relativePath)) {
        continue;
      }
      violations.push({
        file: relativePath,
        label: rule.label,
        detail: rule.detail ?? "命中禁用前端文件命名规则",
      });
    }
  }
  return violations;
};

export const 检查热点文件增长 = (
  hotFiles = 热点文件行数上限,
  readSource = 读取源码
) => {
  const violations = [];
  for (const hotFile of hotFiles) {
    const source = readSource(hotFile.path);
    const effectiveLineCount = 统计有效源码行数(source);
    if (
      hotFile.maxEffectiveLines !== undefined &&
      effectiveLineCount > hotFile.maxEffectiveLines
    ) {
      violations.push({
        file: hotFile.path,
        label: "hotspot growth ratchet",
        detail: `${effectiveLineCount} 行超过有效上限 ${hotFile.maxEffectiveLines} 行`,
      });
    }
    const physicalLineCount = 统计物理源码行数(source);
    if (
      hotFile.maxPhysicalLines !== undefined &&
      physicalLineCount > hotFile.maxPhysicalLines
    ) {
      violations.push({
        file: hotFile.path,
        label: "hotspot physical growth ratchet",
        detail: `${physicalLineCount} 行超过物理上限 ${hotFile.maxPhysicalLines} 行`,
      });
    }
  }
  return violations;
};

const 检查前端测试热点边界 = () => {
  const violations = [];

  for (const boundary of 前端测试热点边界) {
    for (const retired of boundary.retiredFiles) {
      if (!文件存在(join(仓库根目录, retired.path))) {
        continue;
      }
      violations.push({
        file: retired.path,
        label: "retired test hotspot revived",
        detail: retired.reason,
      });
    }

    const supportFiles = boundary.supportFiles ?? [boundary.support];
    for (const support of supportFiles) {
      const supportSource = 读取源码(support.path);
      const supportLineCount = 统计有效源码行数(supportSource);
      if (supportLineCount > support.maxEffectiveLines) {
        violations.push({
          file: support.path,
          label: `${boundary.label} test support growth`,
          detail: `${supportLineCount} 行超过有效上限 ${support.maxEffectiveLines} 行`,
        });
      }
      if (/\bexpect\s*\(/.test(去掉注释(supportSource))) {
        violations.push({
          file: support.path,
          label: `${boundary.label} test support owns assertions`,
          detail: "测试支架只能准备上下文，断言必须留在按 owner 拆分的 spec 中",
        });
      }
    }

    for (const absolutePath of 收集文件(boundary.directoryAbsolutePath)) {
      const relativePath = 转成仓库相对路径(absolutePath);
      if (!relativePath.endsWith(".spec.ts")) {
        continue;
      }
      const source = readFileSync(absolutePath, "utf8");
      const lineCount = 统计有效源码行数(source);
      if (lineCount > boundary.maxEffectiveLines) {
        violations.push({
          file: relativePath,
          label: `${boundary.label} spec growth ratchet`,
          detail: `${lineCount} 行超过有效上限 ${boundary.maxEffectiveLines} 行`,
        });
      }

      const testCount = source.match(/^\s+it\s*\(/gm)?.length ?? 0;
      if (testCount > boundary.maxTestCases) {
        violations.push({
          file: relativePath,
          label: `${boundary.label} spec test-count ratchet`,
          detail: `${testCount} 个用例超过上限 ${boundary.maxTestCases} 个`,
        });
      }
    }
  }

  return violations;
};

export const 收集架构适应度违规 = () => {
  const files = 收集文件(前端目录);
  const 违规记录 = [
    ...检查Owner注册表(),
    ...检查前端根目录白名单(),
    ...检查已清零根文件规则(),
    ...检查旧根路径导入([
      前端目录,
      前端测试目录,
      join(仓库根目录, "scripts"),
    ]),
    ...检查未登记XStateOwner(files),
    ...检查禁回流片段(files),
    ...检查禁用前端文件名(files),
    ...检查热点文件增长(),
    ...检查前端测试热点边界(),
  ];

  for (const absolutePath of files) {
    const relativePath = 转成仓库相对路径(absolutePath);
    const source = readFileSync(absolutePath, "utf8");
    违规记录.push(...平台内层Import违规(relativePath, source));
  }
  return 违规记录;
};

if (process.argv[1] && resolve(process.argv[1]) === 当前脚本路径) {
  const 违规记录 = 收集架构适应度违规();
  if (违规记录.length > 0) {
    console.error("前端架构适应度检查失败：发现浏览器应用化防漂移规则被破坏。");
    for (const violation of 违规记录) {
      console.error(`- ${violation.file}: ${violation.label} (${violation.detail})`);
    }
    process.exit(1);
  }

  console.log("前端架构适应度检查通过。");
}
