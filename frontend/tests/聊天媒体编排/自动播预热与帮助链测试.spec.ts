import { describe, expect, it, vi } from "vitest";
import { 创建媒体播放会话应用 } from "../../媒体/播放会话/应用";
import { 生成视频消息, 刷新异步队列 } from "../common/聊天媒体编排支架";
import type { 前端传输端口 } from "../../平台/传输";
import type { 消息事件 } from "../../聊天共享/契约";
import type { 媒体播放结果 } from "../../媒体";

describe("聊天媒体编排 - 自动播预热与帮助链", () => {
  it("可见自动播候选只保留预热层，不会在真正自动播前提前启动正式媒体会话", async () => {
    const attachmentId = "att-video-inline-prewarm-1";
    const playback = {
      mode: "swarm",
      attachmentId,
      kind: "video",
      src: `blob:http://media.local/swarm-${attachmentId}`,
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;
    const transport: 前端传输端口 = {
      loadMediaLocator: vi.fn(async () => ({
        attachment_id: attachmentId,
        kind: "video" as const,
        status: "ready" as const,
        original_url: `http://media.local/original-${attachmentId}`,
        thumbnail_url: null,
        distribution: null,
        file_asset: {
          asset_id: attachmentId,
          content_hash: `hash-${attachmentId}`,
          kind: "single_file_video" as const,
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
          distribution: null,
        },
      })),
      buildAttachmentContentUrl: vi.fn(
        (id: string, sessionId: string, variant: "original" | "thumbnail" = "original") =>
          `http://test.local/api/attachments/${id}/content?session_id=${sessionId}&variant=${variant}`
      ),
      prepareMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
      abandonMediaUpload: vi.fn(async () => {}),
      completeMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
    } as unknown as 前端传输端口;
    const 解析播放结果 = vi
      .fn<(
        input: {
          attachmentId: string;
          kind: "image" | "video";
          surface?: "viewer" | "inline_autoplay";
          consumerId?: string;
        }
      ) => Promise<媒体播放结果>>()
      .mockResolvedValue(playback);
    const 编排 = 创建媒体播放会话应用({
      transport: () => transport,
      读取会话编号: () => "s-test",
      读取消息: () => [生成视频消息(attachmentId)],
      读取草稿: () => [],
      写入草稿列表: () => {},
      请求重渲染: () => {},
      回收媒体草稿预览地址: () => {},
      登记程序滚动来源: () => {},
      清除程序滚动来源: () => {},
      抓取视频预览: vi.fn(async () => ({
        objectUrl: null,
        source: "none" as const,
        width: null,
        height: null,
      })),
    });

    (
      编排 as unknown as {
        设置媒体播放器供测试(player: {
          解析播放结果(input: {
            attachmentId: string;
            kind: "image" | "video";
            surface?: "viewer" | "inline_autoplay";
            consumerId?: string;
          }): Promise<媒体播放结果>;
          激活协作补齐?(input: {
            attachmentId: string;
            kind: "image" | "video";
            consumerId?: string;
          }): Promise<void>;
          释放附件播放资源?(input: {
            attachmentId: string;
            consumerId?: string;
            丢弃未完成补齐?: boolean;
          }): void;
        }): void;
      }
    ).设置媒体播放器供测试({ 解析播放结果 });

    编排.同步媒体窗口附件([attachmentId]);
    await 刷新异步队列();
    expect(解析播放结果).toHaveBeenCalledTimes(0);

    编排.处理自动播候选([
      {
        attachmentId,
        visibilityRatio: 0.92,
        distanceToViewportCenter: 0,
      },
    ]);
    await 刷新异步队列();

    expect(解析播放结果).toHaveBeenCalledTimes(0);
    expect(编排.snapshot().playbackByAttachmentId[attachmentId]).toBeUndefined();
    expect(编排.snapshot().inlineAutoplayPlaybackByAttachmentId).toEqual({});

    编排.销毁();
  });

  it("自动播候选预览解析只启动排序后的少数候选，避免滚动中批量开 swarm", async () => {
    const attachmentIds = [
      "att-video-preheat-1",
      "att-video-preheat-2",
      "att-video-preheat-3",
    ] as const;
    const loadMediaLocator = vi.fn(async (_sessionId: string, attachmentId: string) => ({
      attachment_id: attachmentId,
      kind: "video" as const,
      status: "ready" as const,
      original_url: `http://media.local/original-${attachmentId}`,
      thumbnail_url: null,
      distribution: null,
      file_asset: {
        asset_id: attachmentId,
        content_hash: `hash-${attachmentId}`,
        kind: "single_file_video" as const,
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
        distribution: null,
      },
    }));
    const transport: 前端传输端口 = {
      loadMediaLocator,
      buildAttachmentContentUrl: vi.fn(
        (id: string, sessionId: string, variant: "original" | "thumbnail" = "original") =>
          `http://test.local/api/attachments/${id}/content?session_id=${sessionId}&variant=${variant}`
      ),
      prepareMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
      abandonMediaUpload: vi.fn(async () => {}),
      completeMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
    } as unknown as 前端传输端口;
    const 编排 = 创建媒体播放会话应用({
      transport: () => transport,
      读取会话编号: () => "s-test",
      读取消息: () => attachmentIds.map(生成视频消息),
      读取草稿: () => [],
      写入草稿列表: () => {},
      请求重渲染: () => {},
      回收媒体草稿预览地址: () => {},
      登记程序滚动来源: () => {},
      清除程序滚动来源: () => {},
      抓取视频预览: vi.fn(async () => ({
        objectUrl: null,
        source: "none" as const,
        width: null,
        height: null,
      })),
    });

    编排.处理自动播候选([
      { attachmentId: attachmentIds[2], visibilityRatio: 0.82, distanceToViewportCenter: 20 },
      { attachmentId: attachmentIds[0], visibilityRatio: 0.92, distanceToViewportCenter: 0 },
      { attachmentId: attachmentIds[1], visibilityRatio: 0.88, distanceToViewportCenter: 10 },
    ]);
    await 刷新异步队列();

    expect(loadMediaLocator.mock.calls.map(([, attachmentId]) => attachmentId)).toEqual([
      attachmentIds[0],
      attachmentIds[1],
    ]);

    编排.销毁();
  });

  it("自动播放视频拿到 swarm 后会晋升后台补齐帮助链", async () => {
    const attachmentId = "att-video-inline-help-chain-1";
    const playback = {
      mode: "swarm",
      attachmentId,
      kind: "video",
      src: `blob:http://media.local/swarm-${attachmentId}`,
      thumbnailUrl: null,
      contentHash: `hash-${attachmentId}`,
      hint: null,
    } satisfies 媒体播放结果;
    const transport: 前端传输端口 = {
      loadMediaLocator: vi.fn(async () => ({
        attachment_id: attachmentId,
        kind: "video" as const,
        status: "ready" as const,
        original_url: `http://media.local/original-${attachmentId}`,
        thumbnail_url: null,
        distribution: null,
        file_asset: {
          asset_id: attachmentId,
          content_hash: `hash-${attachmentId}`,
          kind: "single_file_video" as const,
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
          distribution: null,
        },
      })),
      buildAttachmentContentUrl: vi.fn(
        (id: string, sessionId: string, variant: "original" | "thumbnail" = "original") =>
          `http://test.local/api/attachments/${id}/content?session_id=${sessionId}&variant=${variant}`
      ),
      prepareMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
      abandonMediaUpload: vi.fn(async () => {}),
      completeMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
    } as unknown as 前端传输端口;
    const 解析播放结果 = vi
      .fn<(
        input: {
          attachmentId: string;
          kind: "image" | "video";
          surface?: "viewer" | "inline_autoplay";
          consumerId?: string;
        }
      ) => Promise<媒体播放结果>>()
      .mockResolvedValue(playback);
    const 激活协作补齐 = vi.fn(async () => {});
    const 编排 = 创建媒体播放会话应用({
      transport: () => transport,
      读取会话编号: () => "s-test",
      读取消息: () => [生成视频消息(attachmentId)],
      读取草稿: () => [],
      写入草稿列表: () => {},
      请求重渲染: () => {},
      回收媒体草稿预览地址: () => {},
      登记程序滚动来源: () => {},
      清除程序滚动来源: () => {},
      抓取视频预览: vi.fn(async () => ({
        objectUrl: null,
        source: "none" as const,
        width: null,
        height: null,
      })),
    });

    (
      编排 as unknown as {
        设置媒体播放器供测试(player: {
          解析播放结果(input: {
            attachmentId: string;
            kind: "image" | "video";
            surface?: "viewer" | "inline_autoplay";
            consumerId?: string;
          }): Promise<媒体播放结果>;
          激活协作补齐?(input: {
            attachmentId: string;
            kind: "image" | "video";
            consumerId?: string;
            onSessionEvent?: (event: unknown) => void;
          }): Promise<void>;
          释放附件播放资源?(input: {
            attachmentId: string;
            consumerId?: string;
            丢弃未完成补齐?: boolean;
          }): void;
        }): void;
      }
    ).设置媒体播放器供测试({ 解析播放结果, 激活协作补齐 });

    try {
      编排.同步媒体窗口附件([attachmentId]);
      编排.处理自动播候选([
        {
          attachmentId,
          visibilityRatio: 0.95,
          distanceToViewportCenter: 0,
        },
      ]);
      await 刷新异步队列();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await 刷新异步队列();

      expect(解析播放结果).toHaveBeenCalledWith(
        expect.objectContaining({
          attachmentId,
          surface: "inline_autoplay",
          consumerId: `inline_autoplay:${attachmentId}`,
        })
      );
      expect(激活协作补齐).toHaveBeenCalledWith(
        expect.objectContaining({
          attachmentId,
          kind: "video",
          consumerId: `backfill:${attachmentId}`,
          onSessionEvent: expect.any(Function),
        })
      );
    } finally {
      编排.销毁();
    }
  });

  it("自动播放视频滚出当前窗口后，释放 UI 会话但不释放后台补齐帮助链", async () => {
    const attachmentId = "att-video-inline-backfill-retain-1";
    const nextAttachmentId = "att-video-inline-backfill-retain-2";
    const playback = {
      mode: "swarm",
      attachmentId,
      kind: "video",
      src: `blob:http://media.local/swarm-${attachmentId}`,
      thumbnailUrl: null,
      contentHash: `hash-${attachmentId}`,
      hint: null,
    } satisfies 媒体播放结果;
    const transport: 前端传输端口 = {
      loadMediaLocator: vi.fn(async () => {
        throw new Error("unused");
      }),
      buildAttachmentContentUrl: vi.fn(
        (id: string, sessionId: string, variant: "original" | "thumbnail" = "original") =>
          `http://test.local/api/attachments/${id}/content?session_id=${sessionId}&variant=${variant}`
      ),
      prepareMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
      abandonMediaUpload: vi.fn(async () => {}),
      completeMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
    } as unknown as 前端传输端口;
    const 激活协作补齐 = vi.fn(async () => {});
    const 释放附件播放资源 = vi.fn();
    const 当前消息 = {
      value: [生成视频消息(attachmentId), 生成视频消息(nextAttachmentId)] as 消息事件[],
    };
    const 编排 = 创建媒体播放会话应用({
      transport: () => transport,
      读取会话编号: () => "s-test",
      读取消息: () => 当前消息.value,
      读取草稿: () => [],
      写入草稿列表: () => {},
      请求重渲染: () => {},
      回收媒体草稿预览地址: () => {},
      登记程序滚动来源: () => {},
      清除程序滚动来源: () => {},
      抓取视频预览: vi.fn(async () => ({
        objectUrl: null,
        source: "none" as const,
        width: null,
        height: null,
      })),
    });

    (
      编排 as unknown as {
        设置媒体播放器供测试(player: {
          解析播放结果(input: {
            attachmentId: string;
            kind: "image" | "video";
            surface?: "viewer" | "inline_autoplay";
            consumerId?: string;
          }): Promise<媒体播放结果>;
          激活协作补齐?(input: {
            attachmentId: string;
            kind: "image" | "video";
            consumerId?: string;
            onSessionEvent?: (event: unknown) => void;
          }): Promise<void>;
          释放附件播放资源?(input: {
            attachmentId: string;
            consumerId?: string;
            丢弃未完成补齐?: boolean;
          }): void;
        }): void;
      }
    ).设置媒体播放器供测试({
      解析播放结果: vi.fn(async () => playback),
      激活协作补齐,
      释放附件播放资源,
    });

    try {
      编排.同步媒体窗口附件([attachmentId]);
      编排.处理自动播候选([
        {
          attachmentId,
          visibilityRatio: 0.95,
          distanceToViewportCenter: 0,
        },
      ]);
      await 刷新异步队列();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await 刷新异步队列();

      expect(激活协作补齐).toHaveBeenCalledWith(
        expect.objectContaining({
          attachmentId,
          consumerId: `backfill:${attachmentId}`,
        })
      );

      编排.释放消息流自动播Owner();
      编排.处理自动播候选([
        {
          attachmentId: nextAttachmentId,
          visibilityRatio: 0.95,
          distanceToViewportCenter: 0,
        },
      ]);
      编排.同步媒体窗口附件([nextAttachmentId]);
      await 刷新异步队列();

      expect(释放附件播放资源).toHaveBeenCalledWith({
        attachmentId,
        consumerId: `inline_autoplay:${attachmentId}`,
      });
      expect(释放附件播放资源).toHaveBeenCalledWith({
        attachmentId,
        consumerId: `session:${attachmentId}`,
      });
      expect(释放附件播放资源).not.toHaveBeenCalledWith({
        attachmentId,
        consumerId: `backfill:${attachmentId}`,
      });

      当前消息.value = [生成视频消息(nextAttachmentId)];
      编排.同步消息附件播放结果();
      await 刷新异步队列();

      expect(释放附件播放资源).toHaveBeenCalledWith({
        attachmentId,
        consumerId: `backfill:${attachmentId}`,
      });
    } finally {
      编排.销毁();
    }
  });
});
