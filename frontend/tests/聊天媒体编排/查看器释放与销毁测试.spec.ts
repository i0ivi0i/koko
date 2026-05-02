import { describe, expect, it, vi } from "vitest";
import { 创建媒体播放会话应用 } from "../../媒体/播放会话/应用";
import { 创建内存媒体缓存仓库 } from "../../媒体";
import { 生成视频消息, 生成图片消息, 生成连续视频消息, 刷新异步队列 } from "../common/聊天媒体编排支架";
import type { 前端传输端口 } from "../../平台/传输";
import type { 媒体播放结果 } from "../../媒体";

describe("聊天媒体编排 - 查看器释放与销毁", () => {
  it("视频查看器关闭后，当前时间线只保留预览状态，不再把正式播放源长期挂回卡片", async () => {
    vi.resetModules();
    const attachmentId = "att-video-viewer-close-keep-preview-1";
    const previewSrc = `blob:preview-${attachmentId}`;
    const swarmSrc = `blob:http://media.local/swarm-${attachmentId}`;
    const 解析协作分发源 = vi.fn(async () => ({
      src: swarmSrc,
      hint: "正在协作分发" as const,
      locallyComplete: false,
    }));
    const 释放协作分发消费者 = vi.fn();
    vi.doMock("../../媒体/资产协作分发运行时.js", () => ({
      创建资产协作分发运行时: () => ({
        解析协作分发源,
        释放协作分发消费者,
        读取预算: () => ({}),
        读取会话状态: () => null,
        send: () => undefined,
        重置: () => undefined,
        销毁: () => undefined,
      }),
    }));

    const { 创建媒体播放会话应用: 创建媒体播放会话应用带协作分发桩 } = await import("../../媒体/播放会话/应用");
    const 释放附件播放资源 = vi.fn();
    const 激活协作补齐 = vi.fn(async () => {});

    const transport: 前端传输端口 = {
      loadMediaLocator: vi.fn(async () => ({
        attachment_id: attachmentId,
        kind: "video" as const,
        status: "ready" as const,
        original_url: `http://media.local/original-${attachmentId}`,
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

    const 编排 = 创建媒体播放会话应用带协作分发桩({
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
        objectUrl: previewSrc,
        source: "embedded_hint" as const,
        width: 1280,
        height: 720,
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
    ).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "swarm",
        attachmentId,
        kind: "video",
        src: swarmSrc,
        thumbnailUrl: null,
        contentHash: `hash-${attachmentId}`,
        hint: "正在协作分发",
      }),
      激活协作补齐,
      释放附件播放资源,
    });

    (
      编排 as unknown as {
        设置媒体查看器供测试(viewer: {
          打开(input: { startAttachmentId: string; items: unknown[] }): void;
          同步?(input: { startAttachmentId: string; items: unknown[] }): void;
          销毁(): void;
        }): void;
        关闭媒体查看器供测试(): void;
      }
    ).设置媒体查看器供测试({
      打开: () => undefined,
      同步: () => undefined,
      销毁: () => undefined,
    });

    编排.打开查看器({
      startAttachmentId: attachmentId,
      items: [
        {
          kind: "video" as const,
          attachmentId,
          src: swarmSrc,
          posterSrc: null,
          width: 1280,
          height: 720,
        },
      ],
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await 刷新异步队列();
    }

    expect(编排.snapshot().previewByAttachmentId[attachmentId]).toEqual({
      phase: "ready",
      src: previewSrc,
      source: "embedded_hint",
    });
    const 关闭查看器前预览释放次数 = 释放协作分发消费者.mock.calls.length;

    编排.处理媒体会话信号(attachmentId, {
      type: "PLAYER_PLAYING",
    });
    expect(激活协作补齐).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId,
        consumerId: `backfill:${attachmentId}`,
      })
    );

    (
      编排 as unknown as {
        关闭媒体查看器供测试(): void;
      }
    ).关闭媒体查看器供测试();
    await 刷新异步队列();

    expect(释放附件播放资源).toHaveBeenCalledWith({
      attachmentId,
      consumerId: `session:${attachmentId}`,
    });
    expect(释放协作分发消费者).toHaveBeenCalledTimes(关闭查看器前预览释放次数);
    expect(编排.snapshot().sessionByAttachmentId[attachmentId]).toMatchObject({
      attachmentId,
      playback: null,
    });
    expect(编排.snapshot().playbackByAttachmentId[attachmentId]).toBeUndefined();
    expect(编排.snapshot().previewByAttachmentId[attachmentId]).toEqual({
      phase: "ready",
      src: previewSrc,
      source: "embedded_hint",
    });

    编排.销毁();
    vi.doUnmock("../../媒体/资产协作分发运行时.js");
    vi.resetModules();
  });

  it("连续观看多个可见视频再关闭查看器后，正式播放结果不会按观看次数累积", async () => {
    const 消息列表 = 生成连续视频消息(6);
    const 释放附件播放资源 = vi.fn();
    const 编排 = 创建媒体播放会话应用({
      transport: () =>
        ({
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
        }) as unknown as 前端传输端口,
      读取会话编号: () => "s-video-stress",
      读取消息: () => 消息列表,
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
          释放附件播放资源?(input: {
            attachmentId: string;
            consumerId?: string;
            丢弃未完成补齐?: boolean;
          }): void;
        }): void;
        设置媒体查看器供测试(viewer: {
          打开(input: { startAttachmentId: string; items: unknown[] }): void;
          同步?(input: { startAttachmentId: string; items: unknown[] }): void;
          销毁(): void;
        }): void;
        关闭媒体查看器供测试(): void;
      }
    ).设置媒体播放器供测试({
      解析播放结果: vi.fn(
        async ({ attachmentId, kind }: { attachmentId: string; kind: "image" | "video" }) =>
          ({
            mode: "swarm",
            attachmentId,
            kind,
            src: `blob:http://media.local/swarm-${attachmentId}`,
            thumbnailUrl: null,
            contentHash: `hash-${attachmentId}`,
            hint: null,
          }) satisfies 媒体播放结果
      ),
      释放附件播放资源,
    });
    (
      编排 as unknown as {
        设置媒体查看器供测试(viewer: {
          打开(input: { startAttachmentId: string; items: unknown[] }): void;
          同步?(input: { startAttachmentId: string; items: unknown[] }): void;
          销毁(): void;
        }): void;
      }
    ).设置媒体查看器供测试({
      打开: () => undefined,
      同步: () => undefined,
      销毁: () => undefined,
    });

    const attachmentIds = Array.from({ length: 6 }, (_, index) => `att-video-window-${index + 1}`);
    编排.同步媒体窗口附件(attachmentIds);
    for (const attachmentId of attachmentIds) {
      编排.打开查看器({
        startAttachmentId: attachmentId,
        items: attachmentIds.map((itemId) => ({
          kind: "video" as const,
          attachmentId: itemId,
          src: `http://media.local/original-${itemId}`,
          posterSrc: null,
          width: 1280,
          height: 720,
        })),
      });
      await 刷新异步队列();
      (
        编排 as unknown as {
          关闭媒体查看器供测试(): void;
        }
      ).关闭媒体查看器供测试();
      await 刷新异步队列();
    }

    expect(Object.keys(编排.snapshot().playbackByAttachmentId)).toHaveLength(0);
    expect(Object.keys(编排.snapshot().sessionByAttachmentId)).toHaveLength(6);
    expect(释放附件播放资源).toHaveBeenCalledTimes(6);

    编排.销毁();
  });

  it("显式销毁编排时，已保留的帮助任务仍会被正确释放", async () => {
    vi.resetModules();
    const 释放协作分发消费者 = vi.fn();
    vi.doMock("../../媒体/资产协作分发运行时.js", () => ({
      创建资产协作分发运行时: () => ({
        解析协作分发源: vi.fn(async () => null),
        释放协作分发消费者,
        读取预算: () => ({}),
        读取会话状态: () => null,
        send: () => undefined,
        重置: () => undefined,
        销毁: () => undefined,
      }),
    }));

    const { 创建媒体播放会话应用: 创建媒体播放会话应用带协作分发桩 } = await import("../../媒体/播放会话/应用");
    const 释放附件播放资源 = vi.fn();

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

    const 编排 = 创建媒体播放会话应用带协作分发桩({
      transport: () => transport,
      读取会话编号: () => "s-test",
      读取消息: () => [生成图片消息("att-image-destroy-1")],
      媒体缓存仓库: 创建内存媒体缓存仓库({
        "att-image-destroy-1": {
          attachmentId: "att-image-destroy-1",
          complete: true,
          kind: "image",
          contentHash: "hash-image-destroy-1",
          retainedAt: 1,
          lastAccessAt: 1,
        },
      }),
      读取草稿: () => [],
      写入草稿列表: () => {},
      请求重渲染: () => {},
      回收媒体草稿预览地址: () => {},
      登记程序滚动来源: () => {},
      清除程序滚动来源: () => {},
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
    ).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "anchor",
        attachmentId: "att-image-destroy-1",
        kind: "image",
        src: "http://media.local/blob/att-image-destroy-1/full.webp",
        thumbnailUrl: "http://media.local/blob/att-image-destroy-1/preview.webp",
        contentHash: "hash-image-destroy-1",
        distribution: null,
        hint: null,
      }),
      激活协作补齐: vi.fn(async () => {}),
      释放附件播放资源,
    });

    编排.同步媒体窗口附件(["att-image-destroy-1"]);
    await 刷新异步队列();

    编排.销毁();

    expect(释放附件播放资源).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentId: "att-image-destroy-1" })
    );
    expect(释放协作分发消费者).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-image-destroy-1",
        consumerId: "preview:att-image-destroy-1",
      })
    );

    vi.doUnmock("../../媒体/资产协作分发运行时.js");
    vi.resetModules();
  });
});
