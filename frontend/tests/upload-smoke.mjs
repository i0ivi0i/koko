/**
 * 上传冒烟测试 - 使用 Playwright 测量 Tus PATCH 转发吞吐量
 * 运行: npx playwright test tests/upload-smoke.mjs  或  node tests/upload-smoke.mjs
 */
import { chromium } from "playwright";
import { resolve } from "node:path";

const BASE = "http://127.0.0.1:8080";
const ROOM = "1234b";
const TEST_FILE = resolve("D:\\200-生活\\230-照片备份\\233-Telegram\\色色\\VID_20230823_122115_920.mp4");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 收集 PATCH /files/* 网络请求的时序
  const patchTimings = [];
  page.on("requestfinished", async (req) => {
    if (req.method() === "PATCH" && req.url().includes("/files/")) {
      const timing = req.timing();
      const resp = await req.response();
      const size = parseInt(req.headers()["content-length"] || "0", 10);
      const durationMs = timing.responseEnd - timing.requestStart;
      const throughputMiBs = size > 0 && durationMs > 0
        ? (size / 1048576) / (durationMs / 1000)
        : 0;
      patchTimings.push({ url: req.url(), size, durationMs, throughputMiBs });
      console.log(
        `[PATCH] ${size} bytes in ${durationMs.toFixed(0)}ms = ${throughputMiBs.toFixed(2)} MiB/s`
      );
    }
  });

  console.log(`导航到 ${BASE} ...`);
  await page.goto(BASE, { waitUntil: "networkidle" });

  // 等待页面完成身份恢复（"正在回到聊天空间" 消失后出现输入框）
  await page.waitForSelector('input[placeholder="房间短码"]', { timeout: 30000 });
  // 等待"进房"按钮可交互
  await page.waitForFunction(() => {
    const btns = [...document.querySelectorAll("button")];
    const enterBtn = btns.find(b => b.textContent?.includes("进房"));
    return enterBtn && !enterBtn.disabled;
  }, { timeout: 15000 });

  console.log(`进入房间 ${ROOM} ...`);
  await page.fill('input[placeholder="房间短码"]', ROOM);
  await page.click('button:has-text("进房")');

  // 等待房间加载 - 出现输入消息框
  await page.waitForSelector('input[placeholder="输入消息"]', { timeout: 15000 });
  console.log("已进入房间。");

  // 找到文件 input 并上传
  console.log(`上传文件: ${TEST_FILE}`);
  const startTime = Date.now();

  // 找到隐藏的 file input
  const fileInput = await page.locator('input[type="file"]');
  await fileInput.setInputFiles(TEST_FILE);

  // 等待上传完成 - 监听网络请求完成（PATCH 请求）
  // 给 30 秒超时
  await page.waitForTimeout(2000); // 先等 2 秒让请求发出

  // 等待没有更多 PATCH 请求（稳定 3 秒无新请求）
  let lastCount = patchTimings.length;
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000);
    if (patchTimings.length > 0 && patchTimings.length === lastCount) {
      break;
    }
    lastCount = patchTimings.length;
  }

  const totalDuration = Date.now() - startTime;
  const totalBytes = patchTimings.reduce((sum, p) => sum + p.size, 0);
  const totalThroughput = totalBytes > 0
    ? (totalBytes / 1048576) / (totalDuration / 1000)
    : 0;

  console.log("\n=== 上传冒烟测试结果 ===");
  console.log(`总 PATCH 请求数: ${patchTimings.length}`);
  console.log(`总传输字节: ${(totalBytes / 1048576).toFixed(2)} MiB`);
  console.log(`总耗时: ${totalDuration}ms`);
  console.log(`端到端吞吐: ${totalThroughput.toFixed(2)} MiB/s`);

  if (patchTimings.length === 0) {
    console.log("\n⚠️  没有捕获到 PATCH 请求，可能上传机制不走 Tus 或文件选择未触发。");
  }

  await browser.close();
  process.exit(patchTimings.length > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("测试失败:", err);
  process.exit(1);
});
