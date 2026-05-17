import { afterEach, describe, expect, it, vi } from "vitest";

import { 探测协作分发媒体源可读性 } from "../媒体/媒体协作分发.js";

/** 创建一个带有真实 body 的 Range 206 响应，用于模拟 WebTorrent streamURL 的正常返回 */
const 创建Range响应 = (body: BodyInit | null) =>
  new Response(body, {
    status: 206,
    headers: {
      "content-range": "bytes 0-1/1024",
    },
  });

describe("协作分发媒体源探测", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("响应已建立但首字节迟迟不到时，不应把 streamURL 判定为可读", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const hangingBody = new ReadableStream<Uint8Array>({
          start() {},
        });
        return new Response(hangingBody, {
          status: 206,
          headers: {
            "content-range": "bytes 0-1/1024",
          },
        });
      })
    );

    await expect(
      探测协作分发媒体源可读性("https://media.local/webtorrent/file.mp4", {
        首字节超时毫秒: 1,
      })
    ).rejects.toThrow("探测协作分发媒体源首字节超时");
  });

  /**
   * response.body === null 是 HTTP 头成功但 Service Worker/WebTorrent stream server
   * 尚未就绪的典型场景。当前代码把它当成探测成功，但这会让上层拿到一条
   * 永远读不出字节的 streamURL，直接制造黑灰视频占位。
   */
  it("response.body 为 null 时，不应把 streamURL 判定为可读", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => 创建Range响应(null))
    );

    await expect(
      探测协作分发媒体源可读性("https://media.local/webtorrent/nobody.mp4", {
        首字节超时毫秒: 50,
      })
    ).rejects.toThrow("探测协作分发媒体源缺少响应 body");
  });

  /**
   * 探测首字节成功后如果不取消 reader，ReadableStream 会继续拉取后续 chunk，
   * 等于把"只探测一个字节"变成了"悄悄下载整个文件"，浪费带宽和内存。
   * 正确行为：读到首字节后立即 cancel reader，释放底层连接。
   */
  it("首字节探测成功后，reader 必须被取消以避免继续拉流", async () => {
    let readerCancelled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([0xff]));
          },
          cancel() {
            readerCancelled = true;
          },
        });
        return 创建Range响应(body);
      })
    );

    await 探测协作分发媒体源可读性("https://media.local/webtorrent/ok.mp4", {
      首字节超时毫秒: 500,
    });

    expect(readerCancelled).toBe(true);
  });
});
