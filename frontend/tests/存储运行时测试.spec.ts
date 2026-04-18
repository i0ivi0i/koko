// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { createFakeStorage } from "./common/聊天测试支架";
import { 创建存储运行时 } from "../平台/存储运行时";

describe("存储运行时", () => {
  it("会统一托管壳层本地记忆端口，不让调用方自己散落 localStorage 细节", () => {
    const storage = createFakeStorage();
    const runtime = 创建存储运行时({ storage });
    const memory = runtime.壳层记忆();

    memory.写入当前房间标识("r-platform");
    memory.写入当前房间短码("ROOM99");

    expect(memory.读取当前房间标识()).toBe("r-platform");
    expect(memory.读取当前房间短码()).toBe("ROOM99");
  });

  it("默认存储源会在取端口时读取当前 localStorage，而不是把第一次启动时的句柄永久抓死", () => {
    const firstStorage = createFakeStorage();
    const secondStorage = createFakeStorage();
    Object.defineProperty(window, "localStorage", {
      value: firstStorage,
      configurable: true,
    });

    const runtime = 创建存储运行时();
    runtime.壳层记忆().写入当前房间标识("r-first");

    Object.defineProperty(window, "localStorage", {
      value: secondStorage,
      configurable: true,
    });

    runtime.壳层记忆().写入当前房间标识("r-second");

    expect(firstStorage.getItem("koko_current_room_id")).toBe("r-first");
    expect(secondStorage.getItem("koko_current_room_id")).toBe("r-second");
  });

  it("媒体资产仓库也通过平台存储运行时统一暴露，不让媒体 owner 自己散落 localStorage 键名", async () => {
    const storage = createFakeStorage();
    const runtime = 创建存储运行时({ storage });
    const repo = runtime.媒体资产仓库?.();

    await repo?.保存({
      attachmentId: "att-video-1",
      complete: true,
      kind: "video",
      contentHash: "hash-1",
      retainedAt: 1_775_942_400_000,
      lastAccessAt: 1_775_942_500_000,
    });

    expect(await repo?.读取("att-video-1")).toMatchObject({
      attachmentId: "att-video-1",
      complete: true,
      kind: "video",
      contentHash: "hash-1",
      retainedAt: 1_775_942_400_000,
      lastAccessAt: 1_775_942_500_000,
    });
  });

  it("平台存储运行时会暴露协作分发缓存仓库与 best-effort 持久化申请", async () => {
    const storage = createFakeStorage();
    const persist = vi.fn().mockResolvedValue(true);
    const runtime = 创建存储运行时({
      storage,
      navigator: {
        storage: {
          persist,
        },
      },
    });

    const persisted = await runtime.请求持久化存储?.();
    const repo = runtime.协作分发缓存仓库?.();

    repo?.写入全部({
      "torrent-info-hash-1": {
        torrentInfoHash: "torrent-info-hash-1",
        torrentUrl: "http://media.local/torrent-1",
        bytes: [1, 2, 3],
      },
    });

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persisted).toBe(true);
    expect(repo?.读取全部()).toMatchObject({
      "torrent-info-hash-1": {
        torrentInfoHash: "torrent-info-hash-1",
        torrentUrl: "http://media.local/torrent-1",
        bytes: [1, 2, 3],
      },
    });
  });

  it("请求持久化存储时会先读取 persisted/estimate，并把结果作为 best-effort 平台事件发布", async () => {
    const storage = createFakeStorage();
    const persisted = vi.fn().mockResolvedValue(true);
    const estimate = vi.fn().mockResolvedValue({
      quota: 1024 * 1024 * 1024,
      usage: 128 * 1024 * 1024,
    });
    const persist = vi.fn();
    const runtime = 创建存储运行时({
      storage,
      navigator: {
        storage: {
          persisted,
          estimate,
          persist,
        },
      },
    });
    const 事件记录: Array<{ type: string; persisted: boolean }> = [];
    runtime.订阅事件?.((event) => {
      if (event.type === "STORAGE_PERSISTENCE_RESULT") {
        事件记录.push(event);
      }
    });

    const result = await runtime.请求持久化存储?.();

    expect(persisted).toHaveBeenCalledTimes(1);
    expect(estimate).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
    expect(result).toBe(true);
    expect(事件记录).toEqual([
      {
        type: "STORAGE_PERSISTENCE_RESULT",
        persisted: true,
      },
    ]);
  });
});
