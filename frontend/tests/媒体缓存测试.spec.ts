import { describe, expect, it } from "vitest";
import {
  创建内存媒体缓存仓库,
  创建媒体缓存,
  type 媒体缓存记录,
} from "../媒体/媒体缓存";

describe("媒体缓存", () => {
  it("首次标记 complete 后会持久化 attachment 完整资产记录", async () => {
    const 仓库 = 创建内存媒体缓存仓库();
    const 缓存 = 创建媒体缓存({ repo: 仓库, now: () => 1_775_942_400_000 });

    await 缓存.标记完整("att-video-1", {
      kind: "video",
      contentHash: "hash-1",
    });

    expect(await 仓库.读取("att-video-1")).toMatchObject<Partial<媒体缓存记录>>({
      attachmentId: "att-video-1",
      complete: true,
      kind: "video",
      contentHash: "hash-1",
      retainedAt: 1_775_942_400_000,
      lastAccessAt: 1_775_942_400_000,
    });
  });

  it("重新创建 owner 后会恢复 complete 资产，而不是丢失为临时缓存", async () => {
    const 仓库 = 创建内存媒体缓存仓库();
    await 仓库.保存({
      attachmentId: "att-video-1",
      complete: true,
      kind: "video",
      contentHash: "hash-1",
      retainedAt: 1_775_942_400_000,
      lastAccessAt: 1_775_942_500_000,
    });
    const 缓存 = 创建媒体缓存({ repo: 仓库 });

    await 缓存.启动();

    expect(缓存.snapshot()["att-video-1"]).toMatchObject({
      complete: true,
      kind: "video",
      contentHash: "hash-1",
      retainedAt: 1_775_942_400_000,
      lastAccessAt: 1_775_942_500_000,
    });
  });
});
