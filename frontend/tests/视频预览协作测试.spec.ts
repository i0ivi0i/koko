import { describe, expect, it, vi } from "vitest";
import { 创建视频预览协作 } from "../媒体/壳层/视频预览协作";
import type { 预览缓存端口, 预览缓存记录 } from "../媒体";

const 刷新异步队列 = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

const 创建延后Promise = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const 创建预览缓存桩 = (): 预览缓存端口 => {
  const recordsByContentHash = new Map<string, 预览缓存记录>();
  const attachmentToContentHash = new Map<string, string>();
  return {
    async 保存(record) {
      recordsByContentHash.set(record.contentHash, record);
    },
    async 写入附件索引(attachmentId, contentHash) {
      attachmentToContentHash.set(attachmentId, contentHash);
    },
    async 按内容读取(contentHash) {
      return recordsByContentHash.get(contentHash) ?? null;
    },
    async 按附件读取(attachmentId) {
      const contentHash = attachmentToContentHash.get(attachmentId);
      return contentHash ? recordsByContentHash.get(contentHash) ?? null : null;
    },
    snapshot() {
      return {
        recordsByContentHash: Object.fromEntries(recordsByContentHash),
        attachmentToContentHash: Object.fromEntries(attachmentToContentHash),
      };
    },
  };
};

type 视频预览协作依赖 = Parameters<typeof 创建视频预览协作>[0];

describe("视频预览协作", () => {
  it("首轮抓帧失败后，只要同一 sourceVersion 下正式 swarm 源已经到位，也必须允许再次重试", async () => {
    const 抓取视频预览 = vi
      .fn()
      .mockResolvedValueOnce({
        objectUrl: null,
        source: "none",
        width: 0,
        height: 0,
      })
      .mockResolvedValueOnce({
        objectUrl: "blob:preview-retry-success",
        source: "early_frame",
        width: 1280,
        height: 720,
      });
    const deps: 视频预览协作依赖 = {
      读取附件条目: (attachmentId) => ({ attachmentId, kind: "video" }),
      读取会话播放源版本: () => 7,
      读取当前视频预览播放源: () => ({
        src: "http://127.0.0.1:8080/webtorrent/retry/content.mp4",
        contentHash: "content-hash-retry",
      }),
      获取媒体定位: vi.fn(async () => {
        throw new Error("当前测试已有会话播放源，不应再请求 locator");
      }),
      解析协作分发预览源: vi.fn(async () => {
        throw new Error("当前测试已有会话播放源，不应再解析 swarm source");
      }),
      释放协作分发消费者: vi.fn(),
      预览缓存: 创建预览缓存桩(),
      抓取视频预览,
      接收媒体运行时事实: vi.fn(),
      请求重渲染: vi.fn(),
      同步当前查看器请求: vi.fn(),
      构造预览ConsumerId: (attachmentId) => `preview:${attachmentId}`,
    };

    const 协作 = 创建视频预览协作(deps);
    协作.解析视频预览("att-video-retry");
    await 刷新异步队列();

    expect(协作.读取视频预览状态("att-video-retry")).toEqual({
      phase: "missing_source",
    });
    expect(抓取视频预览).toHaveBeenCalledTimes(1);

    协作.解析视频预览("att-video-retry");
    await 刷新异步队列();

    expect(抓取视频预览).toHaveBeenCalledTimes(2);
    expect(协作.读取视频预览状态("att-video-retry")).toEqual({
      phase: "ready",
      src: "blob:preview-retry-success",
      source: "early_frame",
    });
  });

  it("同内容的多处视频预览并发解析时只创建一个抓帧读流任务", async () => {
    const frame = 创建延后Promise<{
      objectUrl: string;
      source: "early_frame";
      width: number;
      height: number;
    }>();
    const 抓取视频预览 = vi.fn(() => frame.promise);
    const deps: 视频预览协作依赖 = {
      读取附件条目: (attachmentId) => ({ attachmentId, kind: "video" }),
      读取会话播放源版本: () => 1,
      读取当前视频预览播放源: () => ({
        src: "http://127.0.0.1:8080/webtorrent/same/content.mp4",
        contentHash: "content-hash-same",
      }),
      获取媒体定位: vi.fn(async () => {
        throw new Error("当前测试已有会话播放源，不应再请求 locator");
      }),
      解析协作分发预览源: vi.fn(async () => {
        throw new Error("当前测试已有会话播放源，不应再解析 swarm source");
      }),
      释放协作分发消费者: vi.fn(),
      预览缓存: 创建预览缓存桩(),
      抓取视频预览,
      接收媒体运行时事实: vi.fn(),
      请求重渲染: vi.fn(),
      同步当前查看器请求: vi.fn(),
      构造预览ConsumerId: (attachmentId) => `preview:${attachmentId}`,
    };

    const 协作 = 创建视频预览协作(deps);
    协作.解析视频预览("att-video-a");
    协作.解析视频预览("att-video-b");
    await 刷新异步队列();

    expect(抓取视频预览).toHaveBeenCalledTimes(1);

    frame.resolve({
      objectUrl: "blob:preview-content-hash-same",
      source: "early_frame",
      width: 1280,
      height: 720,
    });
    await 刷新异步队列();

    expect(协作.读取视频预览状态("att-video-a")).toEqual({
      phase: "ready",
      src: "blob:preview-content-hash-same",
      source: "early_frame",
    });
    expect(协作.读取视频预览状态("att-video-b")).toEqual({
      phase: "ready",
      src: "blob:preview-content-hash-same",
      source: "early_frame",
    });
  });
});
