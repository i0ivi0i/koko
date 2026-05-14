import { execSync } from "child_process";
import { readdirSync } from "fs";

const PRESETS = {
  publish: "媒体发布",
  dedup: "去重",
  upload: "上传",
  media: "媒体",
  hash: "哈希",
};

const arg = process.argv[2] || "dedup";
const pattern = PRESETS[arg] || arg;
const files = readdirSync("tests").filter(f => f.includes(pattern) && f.endsWith(".spec.ts"));
if (files.length === 0) { console.error("No matching test file for:", pattern, `(arg: ${arg})`); process.exit(1); }

const testFiles = files.map(f => `"tests/${f}"`).join(" ");
console.log(`Running ${files.length} file(s): ${files.join(", ")}`);
try {
  execSync(`npx vitest run ${testFiles} --reporter=verbose`, { stdio: "inherit", env: { ...process.env, FORCE_COLOR: "0" } });
} catch (e) {
  process.exit(e.status ?? 1);
}
