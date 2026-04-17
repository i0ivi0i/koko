import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const 当前文件目录 = dirname(fileURLToPath(import.meta.url));
const 仓库根目录 = resolve(当前文件目录, "..");
const 前端目录 = join(仓库根目录, "frontend");

const 允许前缀 = [
  "frontend/平台/",
  "frontend/app-sw.ts",
  "frontend/media-sw.ts",
  "frontend/tests/",
];

const 需要扫描的扩展名 = new Set([".ts", ".js", ".mjs"]);

const 禁止模式 = [
  {
    label: "navigator.serviceWorker",
    pattern: /\bnavigator(?:\?\.)?serviceWorker\b/g,
  },
  {
    label: "navigator.storage",
    pattern: /\bnavigator(?:\?\.)?storage\b/g,
  },
  {
    label: "window.localStorage",
    pattern: /\bwindow\.localStorage\b/g,
  },
  {
    label: "globalThis.localStorage",
    pattern: /\bglobalThis\.localStorage\b/g,
  },
  {
    label: "BroadcastChannel",
    pattern: /\bnew\s+BroadcastChannel\b/g,
  },
  {
    label: "lifecycle listeners",
    pattern:
      /addEventListener\(\s*["'](?:visibilitychange|pagehide|pageshow|freeze|resume|controllerchange)["']/g,
  },
  {
    label: "lit @state runtime truth",
    pattern: /@state\s*\(/g,
  },
];

const 转成仓库相对路径 = (absolutePath) =>
  relative(仓库根目录, absolutePath).replaceAll("\\", "/");

const 命中允许名单 = (relativePath) =>
  允许前缀.some((prefix) => relativePath === prefix || relativePath.startsWith(prefix));

const 收集文件 = (directory) => {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "dist" || entry === "node_modules") {
      continue;
    }
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      files.push(...收集文件(absolutePath));
      continue;
    }
    if (!需要扫描的扩展名.has(absolutePath.slice(absolutePath.lastIndexOf(".")))) {
      continue;
    }
    files.push(absolutePath);
  }
  return files;
};

const 违规记录 = [];

for (const absolutePath of 收集文件(前端目录)) {
  const relativePath = 转成仓库相对路径(absolutePath);
  if (命中允许名单(relativePath)) {
    continue;
  }
  const source = readFileSync(absolutePath, "utf8");
  for (const rule of 禁止模式) {
    rule.pattern.lastIndex = 0;
    if (!rule.pattern.test(source)) {
      continue;
    }
    违规记录.push({
      file: relativePath,
      label: rule.label,
    });
  }
}

if (违规记录.length > 0) {
  console.error("前端浏览器应用宪法检查失败：发现越层浏览器全局访问。");
  for (const violation of 违规记录) {
    console.error(`- ${violation.file}: ${violation.label}`);
  }
  process.exit(1);
}

console.log("前端浏览器应用宪法检查通过。");
