import { describe, expect, it, vi } from "vitest";
import { 创建媒体播放会话应用 } from "../../媒体/播放会话/应用";
import { 生成视频消息, 生成图片消息, 生成锚点视频播放结果, 刷新异步队列, 创建延后Promise } from "../common/聊天媒体编排支架";
import type { 前端传输端口 } from "../../平台/传输";
import type { 媒体播放结果 } from "../../媒体";

describe("聊天媒体编排 - 查看器会话同步", () => {
  it("查看器在 no_online_seed 终态下再次手动打开时，会立刻触发一轮恢复重试", async () => {
    const attachmentId = "att-video-manual-retry-no-seed-1";
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
      .mockResolvedValue({
        mode: "degraded",
        attachmentId,
        kind: "video",
        src: "",
        thumbnailUrl: null,
        reason: "no_online_seed",
        hint: "当前没有在线种子，等待群友上线",
      });

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

    编排.同步消息附件播放结果();

    const request = {
      startAttachmentId: attachmentId,
      items: [
        {
          kind: "video" as const,
          attachmentId,
          src: `http://media.local/original-${attachmentId}`,
          posterSrc: null,
          width: 1280,
          height: 720,
        },
      ],
    };

    编排.打开查看器(request);
    await 刷新异步队列();
    expect(解析播放结果).toHaveBeenCalledTimes(1);

    // 再次手动点击“观看视频”属于显式重试，应立刻触发下一轮恢复解析，不等待 15 秒窗口。
    编排.打开查看器(request);
    await 刷新异步队列();
    expect(解析播放结果).toHaveBeenCalledTimes(2);

    编排.销毁();
  });

  it("查看器再次手动打开已可播视频时，也会重裁当前会话真相，避免旧 owner 压住删除态", async () => {
    const attachmentId = "att-video-manual-retry-deleted-1";
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

    const 第二轮恢复 = 创建延后Promise<媒体播放结果>();
    const 解析播放结果 = vi
      .fn<
        (
          input: {
            attachmentId: string;
            kind: "image" | "video";
            surface?: "viewer" | "inline_autoplay";
            consumerId?: string;
          }
        ) => Promise<媒体播放结果>
      >()
      .mockResolvedValueOnce(生成锚点视频播放结果(attachmentId))
      .mockImplementationOnce(() => 第二轮恢复.promise);

    const viewerOpenCalls: Array<{ startAttachmentId: string; items: unknown[] }> = [];
    const viewerSyncCalls: Array<{ startAttachmentId: string; items: unknown[] }> = [];

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

    (
      编排 as unknown as {
        设置媒体查看器供测试(viewer: {
          打开(input: { startAttachmentId: string; items: unknown[] }): void;
          同步?(input: { startAttachmentId: string; items: unknown[] }): void;
          销毁(): void;
        }): void;
      }
    ).设置媒体查看器供测试({
      打开: (input) => {
        viewerOpenCalls.push(input);
      },
      同步: (input) => {
        viewerSyncCalls.push(input);
      },
      销毁: () => undefined,
    });

    编排.同步消息附件播放结果();

    const request = {
      startAttachmentId: attachmentId,
      items: [
        {
          kind: "video" as const,
          attachmentId,
          src: `http://media.local/original-${attachmentId}`,
          posterSrc: null,
          width: 1280,
          height: 720,
        },
      ],
    };

    编排.打开查看器(request);
    await 刷新异步队列();
    expect(解析播放结果).toHaveBeenCalledTimes(1);
    expect(viewerOpenCalls).toHaveLength(1);
    expect(viewerOpenCalls[0]).toMatchObject({
      startAttachmentId: attachmentId,
      items: [
        {
          attachmentId,
          kind: "video",
          src: `http://media.local/original-${attachmentId}`,
        },
      ],
    });

    编排.打开查看器(request);
    await 刷新异步队列();
    expect(解析播放结果).toHaveBeenCalledTimes(2);
    expect(viewerOpenCalls).toHaveLength(1);
    expect(viewerSyncCalls.at(-1)).toMatchObject({
      startAttachmentId: attachmentId,
      items: [
        {
          attachmentId,
          kind: "video",
          src: "",
        },
      ],
    });

    第二轮恢复.resolve({
      mode: "degraded",
      attachmentId,
      kind: "video",
      src: "",
      thumbnailUrl: null,
      reason: "media_deleted",
      hint: "内容已删除",
    });
    await 刷新异步队列();
    expect(viewerOpenCalls).toHaveLength(1);
    expect(viewerSyncCalls.at(-1)).toMatchObject({
      startAttachmentId: attachmentId,
      items: [
        {
          attachmentId,
          kind: "video",
          src: "",
        },
      ],
    });

    编排.销毁();
  });

  it("图片查看器在播放真相未到达时等待会话，不会打开 original 或空 src", async () => {
    const attachmentId = "att-image-wait-swarm-1";
    const transport: 前端传输端口 = {
      loadMediaLocator: vi.fn(async () => ({
        attachment_id: attachmentId,
        kind: "image" as const,
        status: "ready" as const,
        original_url: `http://media.local/original-${attachmentId}`,
        thumbnail_url: null,
        distribution: null,
        blob_asset: null,
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

    const 图片恢复 = 创建延后Promise<媒体播放结果>();
    const 解析播放结果 = vi.fn(() => 图片恢复.promise);
    const viewerOpenCalls: Array<{ startAttachmentId: string; items: unknown[] }> = [];

    const 编排 = 创建媒体播放会话应用({
      transport: () => transport,
      读取会话编号: () => "s-test",
      读取消息: () => [生成图片消息(attachmentId)],
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

    (
      编排 as unknown as {
        设置媒体查看器供测试(viewer: {
          打开(input: { startAttachmentId: string; items: unknown[] }): void;
          同步?(input: { startAttachmentId: string; items: unknown[] }): void;
          销毁(): void;
        }): void;
      }
    ).设置媒体查看器供测试({
      打开: (input) => {
        viewerOpenCalls.push(input);
      },
      同步: () => undefined,
      销毁: () => undefined,
    });

    编排.同步媒体窗口附件([attachmentId]);
    await Promise.resolve();
    expect(解析播放结果).toHaveBeenCalledTimes(1);

    编排.打开查看器({
      startAttachmentId: attachmentId,
      items: [
        {
          kind: "image",
          attachmentId,
          src: "",
          alt: "图片附件原图",
          width: 1200,
          height: 800,
        },
      ],
    });
    await 刷新异步队列();

    expect(viewerOpenCalls).toHaveLength(0);

    图片恢复.resolve({
      mode: "swarm",
      attachmentId,
      kind: "image",
      src: `blob:http://media.local/swarm-${attachmentId}`,
      thumbnailUrl: null,
      contentHash: `hash-${attachmentId}`,
      distribution: {
        swarm_id: `swarm-${attachmentId}`,
        announce_urls: ["wss://tracker.koko.local/announce"],
        web_seed_url: `http://media.local/web-seed-${attachmentId}`,
        join_ticket: null,
        ticket_expires_at: null,
        survival_mode: "server_assisted" as const,
      },
      hint: null,
      formalByteSource: "webtorrent_official_stream",
    });
    await 刷新异步队列();

    expect(viewerOpenCalls).toEqual([
      {
        startAttachmentId: attachmentId,
        items: [
          {
            kind: "image",
            attachmentId,
            src: `blob:http://media.local/swarm-${attachmentId}`,
            alt: "图片附件原图",
            width: 1200,
            height: 800,
            contentHash: `hash-${attachmentId}`,
            distribution: {
              swarm_id: `swarm-${attachmentId}`,
              announce_urls: ["wss://tracker.koko.local/announce"],
              web_seed_url: `http://media.local/web-seed-${attachmentId}`,
              join_ticket: null,
              ticket_expires_at: null,
              survival_mode: "server_assisted" as const,
            },
          },
        ],
      },
    ]);

    编排.销毁();
  });
});
