/**
 * PoW 解题 Web Worker：在独立线程中暴力搜索满足难度的 nonce。
 *
 * 算法：SHA-256(salt + nonce.toString())，逐个递增 nonce 直到 hash 的前导零
 * 十六进制字符数 >= difficulty。
 *
 * 使用浏览器原生 SubtleCrypto，零外部依赖。
 * Worker 线程不会阻塞主线程，用户操作零感知。
 */

/** 主线程发来的解题请求 */
type SolveRequest = {
  type: "solve";
  salt: string;
  difficulty: number;
};

/** 返回给主线程的结果 */
type SolveResult =
  | { ok: true; nonce: number; hash: string }
  | { ok: false; code: string };

/** 将 ArrayBuffer 转为十六进制字符串 */
function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

/** 检查 hex 字符串是否有 n 个前导零 */
function hasLeadingZeros(hex: string, n: number): boolean {
  if (hex.length < n) return false;
  for (let i = 0; i < n; i++) {
    if (hex[i] !== "0") return false;
  }
  return true;
}

/** TextEncoder 复用，避免每次解题都实例化 */
const encoder = new TextEncoder();

/**
 * 暴力搜索满足难度的 nonce。
 * 每 10000 次循环让出控制权（实际 Worker 线程无 UI 冻结风险，但保留 bail-out 安全网）。
 */
async function solve(salt: string, difficulty: number): Promise<SolveResult> {
  const maxAttempts = 100_000_000; // 安全上限，避免无限循环
  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    const data = encoder.encode(salt + nonce.toString());
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashHex = bufferToHex(hashBuffer);
    if (hasLeadingZeros(hashHex, difficulty)) {
      return { ok: true, nonce, hash: hashHex };
    }
  }
  return { ok: false, code: "max_attempts_exceeded" };
}

// Worker 消息入口
self.addEventListener("message", (event: MessageEvent<SolveRequest>) => {
  const { salt, difficulty } = event.data;
  solve(salt, difficulty).then((result) => {
    self.postMessage(result);
  });
});
