/**
 * PoW 门禁管理模块：封装 challenge→solve→token 完整生命周期。
 *
 * 设计原则：
 * 1. token 在有效期内缓存复用，正常用户零感知。
 * 2. 过期自动重新解题，无需外部调度。
 * 3. 解题在 Web Worker 中执行，不阻塞主线程。
 * 4. 零外部 npm 依赖。
 */

/** 服务端 challenge 响应 */
type ChallengeResponse = {
  algorithm: string;
  salt: string;
  difficulty: number;
  expires_at: number;
  signature: string;
};

/** 服务端 verify 响应 */
type VerifyResponse = {
  pow_token: string;
};

/** Worker 解题结果 */
type SolveResult =
  | { ok: true; nonce: number; hash: string }
  | { ok: false; code: string };

/** PoW 门禁端口：对外只暴露"获取 token"一个方法 */
export type PoW门禁端口 = {
  获取token(): Promise<string>;
};

/**
 * 创建 PoW 门禁实例。
 *
 * token 在有效期内缓存复用，过期自动重新解题，正常用户零感知。
 *
 * @param baseUrl - 后端 API 基地址（如 "" 或 "http://localhost:8080"）
 */
export function 创建PoW门禁(baseUrl: string): PoW门禁端口 {
  /** 缓存的 token 和过期时间 */
  let cachedToken: string | null = null;
  let cachedExpiresAt = 0;

  /** token 是否仍在有效期内（提前 5 秒失效，避免到达服务端时刚好过期） */
  function token未过期(): boolean {
    return cachedToken !== null && Date.now() / 1000 < cachedExpiresAt - 5;
  }

  /** 在 Worker 中解题：不阻塞主线程，用户无感知 */
  function 在Worker中解题(
    salt: string,
    difficulty: number
  ): Promise<SolveResult> {
    return new Promise((resolve) => {
      const worker = new Worker("/dist/pow-solver.worker.js");
      worker.onmessage = (e: MessageEvent<SolveResult>) => {
        resolve(e.data);
        worker.terminate();
      };
      worker.onerror = () => {
        resolve({ ok: false, code: "worker_error" });
        worker.terminate();
      };
      worker.postMessage({ type: "solve", salt, difficulty });
    });
  }

  /**
   * 获取有效的 PoW token。
   *
   * 流程：检查缓存 → 请求 challenge → Worker 解题 → 提交验证 → 缓存 token。
   * 正常用户首次连接约 20-100ms，后续复用缓存 token 零开销。
   */
  async function 获取token(): Promise<string> {
    // 缓存命中直接返回
    if (token未过期() && cachedToken) {
      return cachedToken;
    }

    // 1. 请求 challenge
    const challengeRes = await fetch(`${baseUrl}/api/pow/challenge`);
    if (!challengeRes.ok) {
      throw new Error(`PoW challenge 请求失败: ${challengeRes.status}`);
    }
    const challenge: ChallengeResponse =
      (await challengeRes.json()) as ChallengeResponse;

    // 2. Worker 解题
    const solved = await 在Worker中解题(challenge.salt, challenge.difficulty);
    if (!solved.ok) {
      throw new Error(`PoW 解题失败: ${solved.code}`);
    }

    // 3. 提交验证
    const verifyRes = await fetch(`${baseUrl}/api/pow/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        salt: challenge.salt,
        difficulty: challenge.difficulty,
        expires_at: challenge.expires_at,
        signature: challenge.signature,
        nonce: solved.nonce,
        hash: solved.hash,
      }),
    });
    if (!verifyRes.ok) {
      throw new Error(`PoW verify 请求失败: ${verifyRes.status}`);
    }
    const { pow_token }: VerifyResponse =
      (await verifyRes.json()) as VerifyResponse;

    // 4. 缓存 token
    cachedToken = pow_token;
    cachedExpiresAt = challenge.expires_at;
    return pow_token;
  }

  return { 获取token };
}
