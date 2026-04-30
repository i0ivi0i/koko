import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const 当前脚本路径 = fileURLToPath(import.meta.url);
const 当前文件目录 = dirname(当前脚本路径);
const 仓库根目录 = resolve(当前文件目录, "..");
const 前端目录 = join(仓库根目录, "frontend");
const 前端测试目录 = join(前端目录, "tests");
const 房间消息窗测试目录 = join(前端测试目录, "房间消息窗");

const 需要扫描的扩展名 = new Set([".ts", ".js", ".mjs"]);
const 跳过目录 = new Set(["dist", "node_modules", "tests"]);

/**
 * 前端运行时 owner 注册表。
 * 这里不是重新造架构描述，而是把“谁能拥有长生命周期真相”变成可执行门禁。
 */
const 前端运行时Owner注册表 = [
  { path: "frontend/聊天应用内核.ts", symbol: "创建聊天应用内核" },
  { path: "frontend/后台应用内核.ts", symbol: "创建后台应用内核" },
  { path: "frontend/平台/浏览器应用平台.ts", symbol: "创建浏览器应用平台" },
  { path: "frontend/应用生命周期.ts", symbol: "创建应用生命周期Actor" },
  { path: "frontend/实时会话运行时.ts", symbol: "创建实时会话Actor" },
  { path: "frontend/房间内核.ts", symbol: "创建房间内核" },
  { path: "frontend/房间时间线运行时.ts", symbol: "创建房间时间线Actor" },
  { path: "frontend/房间视口运行时.ts", symbol: "创建房间视口Actor" },
  { path: "frontend/媒体运行时.ts", symbol: "创建媒体运行时Actor" },
  { path: "frontend/媒体/全局丝滑自动播.ts", symbol: "判定播放连续性表面" },
  { path: "frontend/媒体/资产协作分发运行时.ts", symbol: "创建资产协作分发运行时" },
  { path: "frontend/平台/缓存更新运行时.ts", symbol: "创建缓存更新运行时" },
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
];

const 禁止新增前端文件规则 = [
  {
    label: "duplicate global WebTorrent owner file",
    pattern: /全局唯一WebTorrent|WebTorrent状态机|WebTorrent生命周期机/i,
  },
];

const 热点文件行数上限 = [
  // 这里看的是“有效源码行数”而不是物理行数，避免中文注释、块注释和留白被误判成架构退化。
  { path: "frontend/聊天应用内核.ts", maxEffectiveLines: 1800 },
  { path: "frontend/聊天媒体编排.ts", maxEffectiveLines: 1800 },
];

const 退役前端测试文件 = [
  {
    path: "frontend/tests/房间消息窗媒体查看器测试.spec.ts",
    reason: "房间消息窗媒体测试必须按 owner 拆到 frontend/tests/房间消息窗/",
  },
];

const 房间消息窗媒体测试上限 = {
  directory: "frontend/tests/房间消息窗/",
  maxEffectiveLines: 950,
  maxTestCases: 18,
};

const 房间消息窗媒体测试支架上限 = {
  path: "frontend/tests/common/房间消息窗媒体支架.ts",
  maxEffectiveLines: 350,
};

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
    const lineCount = 统计有效源码行数(readSource(hotFile.path));
    if (lineCount <= hotFile.maxEffectiveLines) {
      continue;
    }
    violations.push({
      file: hotFile.path,
      label: "hotspot growth ratchet",
      detail: `${lineCount} 行超过有效上限 ${hotFile.maxEffectiveLines} 行`,
    });
  }
  return violations;
};

const 检查房间消息窗媒体测试边界 = () => {
  const violations = [];

  for (const retired of 退役前端测试文件) {
    if (!文件存在(join(仓库根目录, retired.path))) {
      continue;
    }
    violations.push({
      file: retired.path,
      label: "retired test hotspot revived",
      detail: retired.reason,
    });
  }

  const supportSource = 读取源码(房间消息窗媒体测试支架上限.path);
  const supportLineCount = 统计有效源码行数(supportSource);
  if (supportLineCount > 房间消息窗媒体测试支架上限.maxEffectiveLines) {
    violations.push({
      file: 房间消息窗媒体测试支架上限.path,
      label: "room media test support growth",
      detail: `${supportLineCount} 行超过有效上限 ${房间消息窗媒体测试支架上限.maxEffectiveLines} 行`,
    });
  }
  if (/\bexpect\s*\(/.test(去掉注释(supportSource))) {
    violations.push({
      file: 房间消息窗媒体测试支架上限.path,
      label: "room media test support owns assertions",
      detail: "测试支架只能准备上下文，断言必须留在按 owner 拆分的 spec 中",
    });
  }

  for (const absolutePath of 收集文件(房间消息窗测试目录)) {
    const relativePath = 转成仓库相对路径(absolutePath);
    if (!relativePath.endsWith(".spec.ts")) {
      continue;
    }
    const source = readFileSync(absolutePath, "utf8");
    const lineCount = 统计有效源码行数(source);
    if (lineCount > 房间消息窗媒体测试上限.maxEffectiveLines) {
      violations.push({
        file: relativePath,
        label: "room media spec growth ratchet",
        detail: `${lineCount} 行超过有效上限 ${房间消息窗媒体测试上限.maxEffectiveLines} 行`,
      });
    }

    const testCount = source.match(/^\s+it\s*\(/gm)?.length ?? 0;
    if (testCount > 房间消息窗媒体测试上限.maxTestCases) {
      violations.push({
        file: relativePath,
        label: "room media spec test-count ratchet",
        detail: `${testCount} 个用例超过上限 ${房间消息窗媒体测试上限.maxTestCases} 个`,
      });
    }
  }

  return violations;
};

export const 收集架构适应度违规 = () => {
  const files = 收集文件(前端目录);
  const 违规记录 = [
    ...检查Owner注册表(),
    ...检查未登记XStateOwner(files),
    ...检查禁回流片段(files),
    ...检查禁用前端文件名(files),
    ...检查热点文件增长(),
    ...检查房间消息窗媒体测试边界(),
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
