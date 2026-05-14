import { afterEach, describe, expect, it, vi } from "vitest";

import { 探测协作分发媒体源可读性 } from "../媒体/媒体协作分发.js";

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
});
