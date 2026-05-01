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

/**
 * 前端运行时 owner 注册表。
 * 这里不是重新造架构描述，而是把“谁能拥有长生命周期真相”变成可执行门禁。
 */
const 前端运行时Owner注册表 = [
  { path: "frontend/聊天应用内核.ts", symbol: "创建聊天应用内核" },
  { path: "frontend/后台/应用内核.ts", symbol: "创建后台应用内核" },
  { path: "frontend/恢复/应用.ts", symbol: "创建恢复应用" },
  { path: "frontend/实时/应用.ts", symbol: "创建实时应用" },
  { path: "frontend/平台/浏览器应用平台.ts", symbol: "创建浏览器应用平台" },
  { path: "frontend/平台/应用生命周期.ts", symbol: "创建应用生命周期Actor" },
  { path: "frontend/实时会话运行时.ts", symbol: "创建实时会话Actor" },
  { path: "frontend/房间内核.ts", symbol: "创建房间内核" },
  { path: "frontend/房间时间线运行时.ts", symbol: "创建房间时间线Actor" },
  { path: "frontend/房间视口运行时.ts", symbol: "创建房间视口Actor" },
  { path: "frontend/媒体运行时.ts", symbol: "创建媒体运行时Actor" },
  { path: "frontend/媒体/全局丝滑自动播.ts", symbol: "判定播放连续性表面" },
  { path: "frontend/媒体/资产协作分发运行时.ts", symbol: "创建资产协作分发运行时" },
  { path: "frontend/平台/缓存更新运行时.ts", symbol: "创建缓存更新运行时" },
];

/**
 * 根目录迁移门面当前仍保留兼容入口。
 * 这里强制它们只做薄门面，避免真实 owner 又偷偷回流到根目录。
 */
const 前端迁移门面规则 = [
  {
    path: "frontend/后台查询编排.ts",
    ownerPath: "frontend/后台/查询编排.ts",
    requiredSnippets: ['export * from "./后台/查询编排.js";'],
    forbiddenSnippets: ["export function 创建后台查询编排("],
  },
  {
    path: "frontend/后台会话编排.ts",
    ownerPath: "frontend/后台/会话编排.ts",
    requiredSnippets: ['export * from "./后台/会话编排.js";'],
    forbiddenSnippets: ["export function 创建后台会话编排("],
  },
  {
    path: "frontend/后台壳编排.ts",
    ownerPath: "frontend/后台/壳编排.ts",
    requiredSnippets: ['export * from "./后台/壳编排.js";'],
    forbiddenSnippets: ["export function 创建后台壳编排("],
  },
  {
    path: "frontend/后台应用内核.ts",
    ownerPath: "frontend/后台/应用内核.ts",
    requiredSnippets: ['export * from "./后台/应用内核.js";'],
    forbiddenSnippets: ["class 后台应用内核", "export function 创建后台应用内核("],
  },
  {
    path: "frontend/后台壳.ts",
    ownerPath: "frontend/后台/壳.ts",
    requiredSnippets: [
      'export { 后台壳 } from "./后台/壳.js";',
      'import "./后台/壳.js";',
    ],
    forbiddenSnippets: ["class 后台壳"],
  },
  {
    path: "frontend/传输.ts",
    ownerPath: "frontend/平台/传输.ts",
    requiredSnippets: ['export * from "./平台/传输.js";'],
    forbiddenSnippets: ["export function 创建前端传输(", "const 实时连接 = new 实时连接适配(baseUrl);"],
  },
  {
    path: "frontend/存储.ts",
    ownerPath: "frontend/平台/存储.ts",
    requiredSnippets: ['export * from "./平台/存储.js";'],
    forbiddenSnippets: ["export function 创建浏览器存储(", "const 设备匿名凭证存储键 ="],
  },
  {
    path: "frontend/调试兼容.ts",
    ownerPath: "frontend/平台/调试兼容.ts",
    requiredSnippets: [
      'export * from "./平台/调试兼容.js";',
      'export { default } from "./平台/调试兼容.js";',
    ],
    forbiddenSnippets: ['import debugFactory from "./node_modules/debug/src/browser.js";', "debugFactory"],
  },
  {
    path: "frontend/应用生命周期.ts",
    ownerPath: "frontend/平台/应用生命周期.ts",
    requiredSnippets: ['export * from "./平台/应用生命周期.js";'],
    forbiddenSnippets: ["createMachine(", "createActor(", "const 应用生命周期机 ="],
  },
  {
    path: "frontend/应用运行时.ts",
    ownerPath: "frontend/平台/应用运行时.ts",
    requiredSnippets: ['export * from "./平台/应用运行时.js";'],
    forbiddenSnippets: ["const 翻译平台事件为内核命令 =", "export function 创建应用运行时("],
  },
  {
    path: "frontend/聊天应用编排桥接.ts",
    ownerPath: "frontend/总装/聊天应用编排桥接.ts",
    requiredSnippets: ['export * from "./总装/聊天应用编排桥接.js";'],
    forbiddenSnippets: ["export interface 聊天内核平台端口", "export function 创建聊天内核平台桥接("],
  },
  {
    path: "frontend/阅读推进编排.ts",
    ownerPath: "frontend/房间/壳层/阅读推进.ts",
    requiredSnippets: ['export * from "./房间/壳层/阅读推进.js";'],
    forbiddenSnippets: ["const 阅读推进节流毫秒 = 400;", "export function 创建阅读推进编排("],
  },
  {
    path: "frontend/房间恢复编排.ts",
    ownerPath: "frontend/恢复/壳层/房间恢复编排.ts",
    requiredSnippets: ['export * from "./恢复/壳层/房间恢复编排.js";'],
    forbiddenSnippets: ["export function 创建房间恢复编排(", "const 房间快照恢复 = 创建恢复应用("],
  },
  {
    path: "frontend/房间时间线.ts",
    ownerPath: "frontend/时间线/领域.ts",
    requiredSnippets: ['export * from "./时间线/领域.js";'],
    forbiddenSnippets: ["function 合并房间时间线消息(", "export function 推进房间时间线("],
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
    path: "frontend/房间消息窗.ts",
    pattern: /\bnew\s+WebTorrent\b|\bcreateServer\s*\(|\bstreamURL\b/g,
  },
  {
    label: "global smooth autoplay must not own player or bytes",
    path: "frontend/媒体/全局丝滑自动播.ts",
    pattern: /\bnew\s+WebTorrent\b|\bcreateServer\s*\(|\bstreamURL\b|\bvideojs\b|\bdocument\.createElement\b/g,
  },
  {
    label: "chat media owner fallback",
    path: "frontend/聊天媒体编排.ts",
    pattern:
      /创建资产协作分发运行时|const 启动查看器起始附件会话\s*=|const 补启动查看器正式会话Consumer\s*=|const 当前请求命中热自动播会话\s*=/g,
  },
  {
    label: "legacy room realtime facade fallback",
    path: "frontend/房间实时编排.ts",
    pattern:
      /let realtimeSocket|function ensureRealtimeSocket|处理实时控制面结果\(|登记待补发创建消息\(/g,
  },
  {
    label: "legacy recovery facade fallback",
    path: "frontend/聊天恢复/壳层/房间快照恢复.ts",
    pattern:
      /function 同步首页房间历史|function 进入房间快照|function 处理恢复失败|function resolveFallbackRoomCode/g,
  },
];

const 禁止新增前端文件规则 = [
  {
    label: "duplicate global WebTorrent owner file",
    pattern: /全局唯一WebTorrent|WebTorrent状态机|WebTorrent生命周期机/i,
  },
];

const 热点文件行数上限 = [
  // 同时钉住有效源码和物理行数：有效行防逻辑回胖，物理行防大文件靠注释/留白继续失控。
  { path: "frontend/房间消息窗.ts", maxEffectiveLines: 1800, maxPhysicalLines: 2150 },
  { path: "frontend/房间消息窗/附件渲染.ts", maxEffectiveLines: 820, maxPhysicalLines: 930 },
  { path: "frontend/房间消息窗/消息虚拟列表.ts", maxEffectiveLines: 180, maxPhysicalLines: 160 },
  { path: "frontend/聊天应用内核.ts", maxEffectiveLines: 1500, maxPhysicalLines: 1500 },
  { path: "frontend/聊天壳.ts", maxEffectiveLines: 1750, maxPhysicalLines: 1800 },
  { path: "frontend/聊天媒体编排.ts", maxEffectiveLines: 1450, maxPhysicalLines: 1500 },
  { path: "frontend/恢复/应用.ts", maxEffectiveLines: 320, maxPhysicalLines: 360 },
  { path: "frontend/实时/应用.ts", maxEffectiveLines: 260, maxPhysicalLines: 300 },
  { path: "frontend/房间实时编排.ts", maxEffectiveLines: 20, maxPhysicalLines: 20 },
  { path: "frontend/聊天恢复/壳层/房间快照恢复.ts", maxEffectiveLines: 20, maxPhysicalLines: 20 },
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

  for (const importRegex of importRegexes) {
    for (const match of source.matchAll(importRegex)) {
      const importPath = match[1].replaceAll("\\", "/");
      if (importPath.endsWith("/平台/index.js")) {
        continue;
      }
      if (
        relativePath === "frontend/传输.ts" &&
        (importPath === "./平台/传输.js" || importPath.endsWith("/平台/传输.js"))
      ) {
        continue;
      }
      if (
        relativePath === "frontend/存储.ts" &&
        (importPath === "./平台/存储.js" || importPath.endsWith("/平台/存储.js"))
      ) {
        continue;
      }
      if (
        relativePath === "frontend/调试兼容.ts" &&
        (importPath === "./平台/调试兼容.js" || importPath.endsWith("/平台/调试兼容.js"))
      ) {
        continue;
      }
      if (
        relativePath === "frontend/应用生命周期.ts" &&
        (importPath === "./平台/应用生命周期.js" ||
          importPath.endsWith("/平台/应用生命周期.js"))
      ) {
        continue;
      }
      if (
        relativePath === "frontend/聊天应用内核.ts" &&
        (importPath === "./平台/应用生命周期.js" ||
          importPath.endsWith("/平台/应用生命周期.js"))
      ) {
        continue;
      }
      if (
        relativePath === "frontend/应用运行时.ts" &&
        (importPath === "./平台/应用运行时.js" || importPath.endsWith("/平台/应用运行时.js"))
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

const 检查迁移门面规则 = () => {
  const violations = [];

  for (const rule of 前端迁移门面规则) {
    let facadeSource;
    let ownerSource;
    try {
      facadeSource = 读取源码(rule.path);
    } catch {
      violations.push({
        file: rule.path,
        label: "migration facade missing",
        detail: "迁移门面文件不存在",
      });
      continue;
    }

    try {
      ownerSource = 读取源码(rule.ownerPath);
    } catch {
      violations.push({
        file: rule.ownerPath,
        label: "migration owner missing",
        detail: "真实 owner 文件不存在",
      });
      continue;
    }

    for (const snippet of rule.requiredSnippets) {
      if (facadeSource.includes(snippet)) {
        continue;
      }
      violations.push({
        file: rule.path,
        label: "migration facade drift",
        detail: `缺少门面片段: ${snippet}`,
      });
    }

    for (const snippet of rule.forbiddenSnippets) {
      if (!facadeSource.includes(snippet)) {
        continue;
      }
      violations.push({
        file: rule.path,
        label: "migration facade owns implementation",
        detail: `门面不应继续承载实现片段: ${snippet}`,
      });
    }

    if (
      rule.ownerPath.startsWith("frontend/后台/") &&
      去掉注释(ownerSource).includes("/操作台/")
    ) {
      violations.push({
        file: rule.ownerPath,
        label: "migration owner semantic drift",
        detail: "后台 owner 真实代码不应再引用操作台目录",
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
        detail: "命中已禁回流的前端兼容片段",
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
        detail: "WebTorrent 生命周期 owner 只能落在资产协作分发运行时，禁止新增第二 owner 文件",
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
    ...检查迁移门面规则(),
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
