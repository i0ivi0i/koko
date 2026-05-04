import { describe, expect, it, vi } from "vitest";
import { 创建视频预览协作 } from "../媒体/壳层/视频预览协作";
import type { 预览缓存端口, 预览缓存记录 } from "../媒体/预览缓存";

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

  it("同附件预览加载中时，可见候选不能用已有播放源反复重启同一个抓帧任务", async () => {
    const attachmentId = "att-video-loading-owner";
    const frame = 创建延后Promise<{
      objectUrl: string;
      source: "early_frame";
      width: number;
      height: number;
    }>();
    const 抓取视频预览 = vi.fn(() => frame.promise);
    const deps: 视频预览协作依赖 = {
      读取附件条目: (id) => ({ attachmentId: id, kind: "video" }),
      读取会话播放源版本: () => 3,
      读取当前视频预览播放源: () => ({
        src: `http://127.0.0.1:8080/webtorrent/${attachmentId}/content.mp4`,
        contentHash: `hash-${attachmentId}`,
      }),
      获取媒体定位: vi.fn(async () => {
        throw new Error("已有会话播放源时不应请求 locator");
      }),
      解析协作分发预览源: vi.fn(async () => {
        throw new Error("已有会话播放源时不应解析 swarm source");
      }),
      释放协作分发消费者: vi.fn(),
      预览缓存: 创建预览缓存桩(),
      抓取视频预览,
      接收媒体运行时事实: vi.fn(),
      请求重渲染: vi.fn(),
      同步当前查看器请求: vi.fn(),
      构造预览ConsumerId: (id) => `preview:${id}`,
    };

    const 协作 = 创建视频预览协作(deps);
    协作.解析视频预览(attachmentId);
    await 刷新异步队列();

    expect(抓取视频预览).toHaveBeenCalledTimes(1);
    expect(协作.读取视频预览状态(attachmentId)).toEqual({
      phase: "loading",
    });

    协作.解析视频预览(attachmentId, { trigger: "visible_candidate" } as never);
    await 刷新异步队列();
    expect(抓取视频预览).toHaveBeenCalledTimes(1);

    frame.resolve({
      objectUrl: `blob:preview-${attachmentId}`,
      source: "early_frame",
      width: 1280,
      height: 720,
    });
    await 刷新异步队列();

    expect(协作.读取视频预览状态(attachmentId)).toEqual({
      phase: "ready",
      src: `blob:preview-${attachmentId}`,
      source: "early_frame",
    });
  });

  it("同版 missing_source 视频进入可见候选后，也必须允许受控重试 locator/swarm 预览", async () => {
    const attachmentId = "att-video-visible-retry";
    const 构造定位结果 = (
      distribution: {
        content_id: string;
        content_hash: string;
        swarm_id: string;
        web_seed_until: string;
        torrent_url: string;
        torrent_info_hash: string;
        announce_urls: string[];
        web_seed_url: string;
        join_ticket: null;
        ticket_expires_at: null;
        media_state: {
          code: "MEDIA_READY";
          retry_after_ms: null;
        };
        survival_mode: "server_assisted";
      } | null
    ) =>
      ({
        attachment_id: attachmentId,
        kind: "video" as const,
        status: "ready" as const,
        thumbnail_url: null,
        distribution,
        file_asset: {
          asset_id: attachmentId,
          content_hash: `hash-${attachmentId}`,
          kind: "file_video" as const,
          variants: {
            canonical: {
              id: "canonical",
              mime_type: "video/mp4",
              url: `http://media.local/canonical-${attachmentId}.mp4`,
              width: 1280,
              height: 720,
            },
          },
          origin: {
            original_url: `http://media.local/original-${attachmentId}`,
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only" as const,
          },
          distribution: {
            swarm_id: `swarm-${attachmentId}`,
            announce_urls: ["ws://127.0.0.1:7072"],
            web_seed_url: `http://media.local/web-seed-${attachmentId}`,
            join_ticket: null,
            ticket_expires_at: null,
            survival_mode: "server_assisted" as const,
          },
        },
      }) as Awaited<ReturnType<视频预览协作依赖["获取媒体定位"]>>;
    let locatorCallCount = 0;
    const 获取媒体定位: 视频预览协作依赖["获取媒体定位"] = vi.fn(
      async (_attachmentId: string, _options?: { forceRefresh?: boolean }) => {
        locatorCallCount += 1;
        return 构造定位结果(
          locatorCallCount >= 2
            ? {
                content_id: `content_${attachmentId}`,
                content_hash: `hash-${attachmentId}`,
                swarm_id: `swarm-${attachmentId}`,
                web_seed_until: "1775942400",
                torrent_url: `http://media.local/torrent-${attachmentId}`,
                torrent_info_hash: `torrent-info-hash-${attachmentId}`,
                announce_urls: ["ws://127.0.0.1:7072"],
                web_seed_url: `http://media.local/web-seed-${attachmentId}`,
                join_ticket: null,
                ticket_expires_at: null,
                media_state: {
                  code: "MEDIA_READY" as const,
                  retry_after_ms: null,
                },
                survival_mode: "server_assisted" as const,
              }
            : null
        );
      }
    );
    const 解析协作分发预览源 = vi.fn(async () => ({
      src: `blob:http://media.local/swarm-preview-${attachmentId}`,
    }));
    const 抓取视频预览 = vi.fn(async () => ({
      objectUrl: `blob:preview-${attachmentId}`,
      source: "embedded_hint" as const,
      width: 1280,
      height: 720,
    }));
    const deps: 视频预览协作依赖 = {
      读取附件条目: (id) => ({ attachmentId: id, kind: "video" }),
      读取会话播放源版本: () => 9,
      读取当前视频预览播放源: () => null,
      获取媒体定位,
      解析协作分发预览源,
      释放协作分发消费者: vi.fn(),
      预览缓存: 创建预览缓存桩(),
      抓取视频预览,
      接收媒体运行时事实: vi.fn(),
      请求重渲染: vi.fn(),
      同步当前查看器请求: vi.fn(),
      构造预览ConsumerId: (id) => `preview:${id}`,
    };

    const 协作 = 创建视频预览协作(deps);

    协作.解析视频预览(attachmentId);
    await 刷新异步队列();

    expect(协作.读取视频预览状态(attachmentId)).toEqual({
      phase: "missing_source",
    });
    expect(获取媒体定位).toHaveBeenCalledTimes(1);
    expect(解析协作分发预览源).not.toHaveBeenCalled();
    expect(抓取视频预览).not.toHaveBeenCalled();

    // 默认路径在同一 sourceVersion + 无当前 swarm 播放源时仍会阻断，避免空转风暴。
    协作.解析视频预览(attachmentId);
    await 刷新异步队列();
    expect(获取媒体定位).toHaveBeenCalledTimes(1);

    // 可见候选属于高价值信号：必须允许再试一次，而不是一直躺到 owner 真切过来。
    协作.解析视频预览(attachmentId, { trigger: "visible_candidate" } as never);
    await 刷新异步队列();

    expect(获取媒体定位).toHaveBeenCalledTimes(2);
    expect(解析协作分发预览源).toHaveBeenCalledTimes(1);
    expect(抓取视频预览).toHaveBeenCalledWith({
      src: `blob:http://media.local/swarm-preview-${attachmentId}`,
      signal: expect.any(AbortSignal),
    });
    expect(协作.读取视频预览状态(attachmentId)).toEqual({
      phase: "ready",
      src: `blob:preview-${attachmentId}`,
      source: "embedded_hint",
    });
  });

  it("附件退场后，进行中的预览解析不会把旧状态重新写回已删除附件", async () => {
    const attachmentId = "att-preview-retired-1";
    const locatorDeferred = 创建延后Promise<{
      attachment_id: string;
      kind: "video";
      status: "ready";
      thumbnail_url: null;
      distribution: {
        content_id: string;
        content_hash: string;
        swarm_id: string;
        web_seed_until: string;
        torrent_url: string;
        torrent_info_hash: string;
        announce_urls: string[];
        web_seed_url: string;
        join_ticket: null;
        ticket_expires_at: null;
        media_state: {
          code: "MEDIA_READY";
          retry_after_ms: null;
        };
        survival_mode: "server_assisted";
      };
      file_asset: {
        asset_id: string;
        content_hash: string;
        kind: "file_video";
        variants: {
          canonical: {
            id: "canonical";
            mime_type: "video/mp4";
            url: string;
            width: number;
            height: number;
          };
        };
        origin: {
          original_url: string;
          expires_at_epoch_seconds: number;
          available: true;
          role: "cold_backup_only";
        };
        distribution: {
          swarm_id: string;
          announce_urls: string[];
          web_seed_url: string;
          join_ticket: null;
          ticket_expires_at: null;
          survival_mode: "server_assisted";
        };
      };
    }>();
    const 获取媒体定位 = vi.fn(async () => await locatorDeferred.promise);
    const 解析协作分发预览源 = vi.fn(async () => ({
      src: `blob:http://media.local/swarm-preview-${attachmentId}`,
    }));
    const 抓取视频预览 = vi.fn(async () => ({
      objectUrl: `blob:preview-${attachmentId}`,
      source: "embedded_hint" as const,
      width: 1280,
      height: 720,
    }));
    const deps: 视频预览协作依赖 = {
      读取附件条目: (id) => ({ attachmentId: id, kind: "video" }),
      读取会话播放源版本: () => 11,
      读取当前视频预览播放源: () => null,
      获取媒体定位,
      解析协作分发预览源,
      释放协作分发消费者: vi.fn(),
      预览缓存: 创建预览缓存桩(),
      抓取视频预览,
      接收媒体运行时事实: vi.fn(),
      请求重渲染: vi.fn(),
      同步当前查看器请求: vi.fn(),
      构造预览ConsumerId: (id) => `preview:${id}`,
    };

    const 协作 = 创建视频预览协作(deps);
    协作.解析视频预览(attachmentId);
    await 刷新异步队列();
    协作.删除视频预览状态(attachmentId);

    locatorDeferred.resolve({
      attachment_id: attachmentId,
      kind: "video",
      status: "ready",
      thumbnail_url: null,
      distribution: {
        content_id: `content_${attachmentId}`,
        content_hash: `hash-${attachmentId}`,
        swarm_id: `swarm-${attachmentId}`,
        web_seed_until: "1775942400",
        torrent_url: `http://media.local/torrent-${attachmentId}`,
        torrent_info_hash: `torrent-info-hash-${attachmentId}`,
        announce_urls: ["ws://127.0.0.1:7072"],
        web_seed_url: `http://media.local/web-seed-${attachmentId}`,
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY",
          retry_after_ms: null,
        },
        survival_mode: "server_assisted",
      },
      file_asset: {
        asset_id: attachmentId,
        content_hash: `hash-${attachmentId}`,
        kind: "file_video",
        variants: {
          canonical: {
            id: "canonical",
            mime_type: "video/mp4",
            url: `http://media.local/canonical-${attachmentId}.mp4`,
            width: 1280,
            height: 720,
          },
        },
        origin: {
          original_url: `http://media.local/original-${attachmentId}`,
          expires_at_epoch_seconds: 1775942400,
          available: true,
          role: "cold_backup_only",
        },
        distribution: {
          swarm_id: `swarm-${attachmentId}`,
          announce_urls: ["ws://127.0.0.1:7072"],
          web_seed_url: `http://media.local/web-seed-${attachmentId}`,
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "server_assisted",
        },
      },
    });
    await 刷新异步队列();

    expect(获取媒体定位).toHaveBeenCalledTimes(1);
    expect(解析协作分发预览源).toHaveBeenCalledTimes(1);
    expect(抓取视频预览).toHaveBeenCalledTimes(1);
    expect(协作.读取视频预览状态(attachmentId)).toBeNull();
  });

  it("附件退场时会中止正在进行的隐藏抓帧探针，并在收尾后释放 preview consumer", async () => {
    const attachmentId = "att-preview-abort-1";
    const 释放协作分发消费者 = vi.fn();
    let 抓帧Signal: AbortSignal | null = null;
    const 抓取视频预览 = vi.fn(
      ({ signal }: { src: string; signal?: AbortSignal }) =>
        new Promise<{
          objectUrl: null;
          source: "none";
          width: null;
          height: null;
        }>((resolve) => {
          抓帧Signal = signal ?? null;
          signal?.addEventListener(
            "abort",
            () => {
              resolve({
                objectUrl: null,
                source: "none",
                width: null,
                height: null,
              });
            },
            { once: true }
          );
        })
    );
    const deps: 视频预览协作依赖 = {
      读取附件条目: (id) => ({ attachmentId: id, kind: "video" }),
      读取会话播放源版本: () => 12,
      读取当前视频预览播放源: () => null,
      获取媒体定位: vi.fn(async () => ({
        attachment_id: attachmentId,
        kind: "video" as const,
        status: "ready" as const,
        thumbnail_url: null,
        distribution: {
          content_id: `content_${attachmentId}`,
          content_hash: `hash-${attachmentId}`,
          swarm_id: `swarm-${attachmentId}`,
          web_seed_until: "1775942400",
          torrent_url: `http://media.local/torrent-${attachmentId}`,
          torrent_info_hash: `torrent-info-hash-${attachmentId}`,
          announce_urls: ["ws://127.0.0.1:7072"],
          web_seed_url: `http://media.local/web-seed-${attachmentId}`,
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
          survival_mode: "server_assisted" as const,
        },
        file_asset: {
          asset_id: attachmentId,
          content_hash: `hash-${attachmentId}`,
          kind: "file_video" as const,
          variants: {
            canonical: {
              id: "canonical",
              mime_type: "video/mp4",
              url: `http://media.local/canonical-${attachmentId}.mp4`,
              width: 1280,
              height: 720,
            },
          },
          origin: {
            original_url: `http://media.local/original-${attachmentId}`,
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only" as const,
          },
          distribution: {
            swarm_id: `swarm-${attachmentId}`,
            announce_urls: ["ws://127.0.0.1:7072"],
            web_seed_url: `http://media.local/web-seed-${attachmentId}`,
            join_ticket: null,
            ticket_expires_at: null,
            survival_mode: "server_assisted" as const,
          },
        },
      })),
      解析协作分发预览源: vi.fn(async () => ({
        src: `blob:http://media.local/swarm-preview-${attachmentId}`,
      })),
      释放协作分发消费者,
      预览缓存: 创建预览缓存桩(),
      抓取视频预览,
      接收媒体运行时事实: vi.fn(),
      请求重渲染: vi.fn(),
      同步当前查看器请求: vi.fn(),
      构造预览ConsumerId: (id) => `preview:${id}`,
    };

    const 协作 = 创建视频预览协作(deps);
    协作.解析视频预览(attachmentId);
    await 刷新异步队列();

    const 当前抓帧Signal = 抓帧Signal as AbortSignal | null;
    if (!当前抓帧Signal) {
      throw new Error("测试前提失败：抓帧 signal 没有建立");
    }
    expect(当前抓帧Signal.aborted).toBe(false);

    协作.删除视频预览状态(attachmentId);
    await 刷新异步队列();

    expect(当前抓帧Signal.aborted).toBe(true);
    expect(释放协作分发消费者).toHaveBeenCalledWith({
      attachmentId,
      consumerId: `preview:${attachmentId}`,
    });
    expect(协作.读取视频预览状态(attachmentId)).toBeNull();
  });
});
