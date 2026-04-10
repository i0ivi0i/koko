import { describe, expect, it, vi } from "vitest";
import { 创建媒体定位器 } from "../媒体/媒体定位";

describe("媒体定位器", () => {
  it("同一个 attachment 的 locator 会命中缓存，不重复请求后端", async () => {
    const loadMediaLocator = vi.fn(async () => ({
      attachment_id: "att-1",
      kind: "image" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-1",
      thumbnail_url: "http://media.local/thumb-1",
    }));
    const 定位器 = 创建媒体定位器({
      getSessionId: () => "s-test",
      loadMediaLocator,
    });

    const first = await 定位器.获取定位("att-1");
    const second = await 定位器.获取定位("att-1");

    expect(first.original_url).toBe("http://media.local/original-1");
    expect(second.original_url).toBe("http://media.local/original-1");
    expect(loadMediaLocator).toHaveBeenCalledTimes(1);
  });

  it("locator 被标记过期后会重新向后端重签", async () => {
    const loadMediaLocator = vi
      .fn()
      .mockResolvedValueOnce({
        attachment_id: "att-1",
        kind: "video" as const,
        status: "ready" as const,
        original_url: "http://media.local/original-stale",
        thumbnail_url: null,
      })
      .mockResolvedValueOnce({
        attachment_id: "att-1",
        kind: "video" as const,
        status: "ready" as const,
        original_url: "http://media.local/original-refresh",
        thumbnail_url: null,
      });
    const 定位器 = 创建媒体定位器({
      getSessionId: () => "s-test",
      loadMediaLocator,
    });

    await 定位器.获取定位("att-1");
    定位器.标记过期("att-1");
    const refreshed = await 定位器.获取定位("att-1");

    expect(refreshed.original_url).toBe("http://media.local/original-refresh");
    expect(loadMediaLocator).toHaveBeenCalledTimes(2);
  });
});
