import { describe, expect, it, vi } from "vitest";
import { 创建媒体播放会话应用 } from "../../媒体/播放会话/应用";
import { 生成视频消息, 生成锚点视频播放结果, 刷新异步队列, 创建延后Promise } from "../common/聊天媒体编排支架";
import type { 前端传输端口 } from "../../平台/传输";
import type { 媒体播放结果 } from "../../媒体";

describe("聊天媒体编排 - 视频预览源与缺源恢复", () => {
  it("新附件带协作分发片段时，视频预览优先走同一 swarm 主链，不回退 canonical/original 冷源", async () => {
    vi.resetModules();
    const attachmentId = "att-video-preview-swarm-first-1";
    const swarmPreviewSrc = `blob:http://media.local/swarm-preview-${attachmentId}`;
    const 解析协作分发源 = vi.fn(async () => ({
      src: swarmPreviewSrc,
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
    const 抓取视频预览 = vi.fn(async (input: { src: string }) => ({
      objectUrl: `blob:preview-${attachmentId}`,
      source: input.src.startsWith("blob:http://media.local/swarm-preview-")
        ? ("embedded_hint" as const)
        : ("none" as const),
      width: 1280,
      height: 720,
    }));
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
      抓取视频预览,
    });

    编排.同步媒体窗口附件([attachmentId]);
    await 刷新异步队列();
    await 刷新异步队列();

    expect(解析协作分发源).toHaveBeenCalledTimes(1);
    expect(抓取视频预览).toHaveBeenCalledWith(
      expect.objectContaining({
        src: swarmPreviewSrc,
        signal: expect.any(AbortSignal),
      })
    );
    expect(抓取视频预览).not.toHaveBeenCalledWith(
      expect.objectContaining({ src: `http://media.local/canonical-${attachmentId}.mp4` })
    );

    编排.销毁();
    vi.doUnmock("../../媒体/资产协作分发运行时.js");
    vi.resetModules();
  });

  it("当前自动播 owner 打开查看器时，会继续沿用热会话，不会先把视频打回 recovering 再清空 src", async () => {
    const attachmentId = "att-video-hot-owner-open-1";
    const swarmSrc = `blob:http://media.local/swarm-hot-owner-${attachmentId}`;
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

    const swarmPlayback: 媒体播放结果 = {
      mode: "swarm",
      attachmentId,
      kind: "video",
      src: swarmSrc,
      thumbnailUrl: null,
      hint: null,
    };
    let 已完成的查看器正式会话解析次数 = 0;
    const 解析播放结果 = vi.fn<
      (
        input: {
          attachmentId: string;
          kind: "image" | "video";
          surface?: "viewer" | "inline_autoplay";
          consumerId?: string;
        }
      ) => Promise<媒体播放结果>
    >(async (input) => {
      if (input.consumerId === `inline_autoplay:${attachmentId}`) {
        return swarmPlayback;
      }
      if (
        input.consumerId === `session:${attachmentId}` &&
        已完成的查看器正式会话解析次数 === 0
      ) {
        已完成的查看器正式会话解析次数 += 1;
        return swarmPlayback;
      }
      return new Promise<媒体播放结果>(() => undefined);
    });

    const viewerOpenCalls: Array<{ startAttachmentId: string; items: unknown[] }> = [];
    const viewerSyncCalls: Array<{ startAttachmentId: string; items: unknown[] }> = [];
    const 抓取视频预览 = vi.fn(async () => ({
      objectUrl: null,
      source: "none" as const,
      width: null,
      height: null,
    }));

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
      抓取视频预览,
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
    编排.处理自动播候选([
      {
        attachmentId,
        visibilityRatio: 0.95,
        distanceToViewportCenter: 0,
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await 刷新异步队列();
    }

    expect(编排.snapshot().inlineAutoplayOwnerAttachmentId).toBe(attachmentId);
    expect(编排.snapshot().inlineAutoplayPlaybackByAttachmentId[attachmentId]).toMatchObject({
      src: swarmSrc,
    });
    const 打开前解析次数 = 解析播放结果.mock.calls.length;
    const 打开前预览抓取次数 = 抓取视频预览.mock.calls.length;

    编排.打开查看器({
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
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await 刷新异步队列();
    }

    /**
     * 当前自动播 owner 已经握着同一条 swarm 会话；显式放大必须先用这条热源打开 viewer，
     * 同时给 viewer 正式会话补一条自己的 `session:*` consumer。
     *
     * 这样返回群聊再点同一条视频时，不会因为 inline autoplay consumer 已释放，
     * 又临时重解析成“附件当前不可获取”。
     *
     * 但如果同一附件的 preview 仍卡在 `missing_source`，打开查看器时允许顺手重试一次抓帧：
     * - viewer request 不能先退回空 src；
     * - 预览只利用当前已经热起来的 swarm 源再补一次 preview 真相。
     */
    expect(解析播放结果).toHaveBeenCalledTimes(打开前解析次数 + 1);
    expect(解析播放结果).toHaveBeenLastCalledWith(
      expect.objectContaining({
        attachmentId,
        kind: "video",
        consumerId: `session:${attachmentId}`,
      })
    );
    expect(抓取视频预览.mock.calls.length).toBeGreaterThanOrEqual(
      打开前预览抓取次数 + 1
    );
    expect(抓取视频预览.mock.calls.slice(打开前预览抓取次数)).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            src: swarmSrc,
            signal: expect.any(AbortSignal),
          }),
        ],
      ])
    );
    expect(viewerOpenCalls).toHaveLength(1);
    expect(viewerOpenCalls[0]?.items).toEqual([
      expect.objectContaining({
        attachmentId,
        kind: "video",
        src: swarmSrc,
      }),
    ]);
    expect(viewerSyncCalls).toHaveLength(0);

    (
      编排 as unknown as {
        关闭媒体查看器供测试(): void;
      }
    ).关闭媒体查看器供测试();
    await 刷新异步队列();

    编排.打开查看器({
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
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await 刷新异步队列();
    }

    expect(viewerOpenCalls).toHaveLength(2);
    expect(viewerOpenCalls[1]?.items).toEqual([
      expect.objectContaining({
        attachmentId,
        kind: "video",
        src: swarmSrc,
      }),
    ]);
    编排.销毁();
  });

  it("视频预览缺少协作分发片段时会直接进入 missing_source，不再回退 canonical/original 冷源", async () => {
    const attachmentId = "att-video-preview-loop-1";
    const 抓取视频预览 = vi.fn(async () => ({
      objectUrl: null,
      source: "none" as const,
      width: null,
      height: null,
    }));
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
      抓取视频预览,
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
      解析播放结果: vi.fn().mockResolvedValue(生成锚点视频播放结果(attachmentId)),
    });

    编排.同步媒体窗口附件([attachmentId]);
    await 刷新异步队列();
    expect(抓取视频预览).not.toHaveBeenCalled();
    expect(编排.snapshot().previewByAttachmentId[attachmentId]).toEqual({
      phase: "missing_source",
    });

    // 同一 sourceVersion 下再次同步，只允许维持 missing_source，不允许重新尝试冷源抓帧。
    编排.同步媒体窗口附件([attachmentId]);
    await 刷新异步队列();
    expect(抓取视频预览).not.toHaveBeenCalled();

    // sourceVersion 发生变化（会话恢复重裁决）后，若仍缺少 swarm 片段，也只允许重进 missing_source。
    编排.处理媒体会话信号(attachmentId, { type: "ENTER_RECOVERING" });
    await 刷新异步队列();
    await 刷新异步队列();
    expect(抓取视频预览).not.toHaveBeenCalled();
    expect(编排.snapshot().previewByAttachmentId[attachmentId]).toEqual({
      phase: "missing_source",
    });

    编排.销毁();
  });

  it("视频预览先进入 missing_source 后，同一 sourceVersion 下正式 swarm 播放源到位时也必须重试预览", async () => {
    const attachmentId = "att-video-preview-revive-1";
    const playback = {
      mode: "swarm",
      attachmentId,
      kind: "video",
      src: `blob:http://media.local/swarm-${attachmentId}`,
      thumbnailUrl: null,
      hint: null,
      contentHash: `hash-${attachmentId}`,
    } satisfies 媒体播放结果;
    const 抓取视频预览 = vi.fn(async (_input: { src: string }) => ({
      objectUrl: `blob:preview-${attachmentId}`,
      source: "early_frame" as const,
      width: 1280,
      height: 720,
    }));
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
      抓取视频预览,
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
      解析播放结果: vi.fn().mockResolvedValue(playback),
    });

    try {
      编排.同步媒体窗口附件([attachmentId]);
      await 刷新异步队列();
      expect(抓取视频预览).not.toHaveBeenCalled();
      expect(编排.snapshot().previewByAttachmentId[attachmentId]).toEqual({
        phase: "missing_source",
      });

      编排.处理自动播候选([
        {
          attachmentId,
          visibilityRatio: 0.91,
          distanceToViewportCenter: 0,
        },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await 刷新异步队列();
      await 刷新异步队列();

      expect(抓取视频预览).toHaveBeenCalledWith(
        expect.objectContaining({
          src: playback.src,
          signal: expect.any(AbortSignal),
        })
      );
      expect(编排.snapshot().previewByAttachmentId[attachmentId]).toEqual({
        phase: "ready",
        src: `blob:preview-${attachmentId}`,
        source: "early_frame",
      });
    } finally {
      编排.销毁();
    }
  });

  it("可见候选在真正成为 owner 前，也会先把 missing_source 补成 ready preview，不等正式 playback resolve", async () => {
    vi.resetModules();
    const attachmentId = "att-video-visible-preview-before-owner-1";
    const swarmPreviewSrc = `blob:http://media.local/swarm-preview-${attachmentId}`;
    const previewObjectUrl = `blob:preview-${attachmentId}`;
    const 解析协作分发源 = vi.fn(async () => ({
      src: swarmPreviewSrc,
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
    const 延后播放结果 = 创建延后Promise<媒体播放结果>();
    let locatorCallCount = 0;
    const transport: 前端传输端口 = {
      loadMediaLocator: vi.fn(async () => {
        locatorCallCount += 1;
        return {
          attachment_id: attachmentId,
          kind: "video" as const,
          status: "ready" as const,
          original_url: `http://media.local/original-${attachmentId}`,
          thumbnail_url: null,
          distribution:
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
              : null,
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
        };
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
    const 抓取视频预览 = vi.fn(async (input: { src: string }) => ({
      objectUrl: previewObjectUrl,
      source: input.src === swarmPreviewSrc ? ("embedded_hint" as const) : ("none" as const),
      width: 1280,
      height: 720,
    }));

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
      抓取视频预览,
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
      解析播放结果: vi.fn(() => 延后播放结果.promise),
    });

    编排.同步媒体窗口附件([attachmentId]);
    await 刷新异步队列();

    expect(编排.snapshot().previewByAttachmentId[attachmentId]).toEqual({
      phase: "missing_source",
    });
    expect(抓取视频预览).not.toHaveBeenCalled();

    编排.处理自动播候选([
      {
        attachmentId,
        visibilityRatio: 0.45,
        distanceToViewportCenter: 12,
      },
    ]);
    await 刷新异步队列();
    await 刷新异步队列();

    expect(抓取视频预览).toHaveBeenCalledWith(
      expect.objectContaining({
        src: swarmPreviewSrc,
        signal: expect.any(AbortSignal),
      })
    );
    expect(编排.snapshot().previewByAttachmentId[attachmentId]).toEqual({
      phase: "ready",
      src: previewObjectUrl,
      source: "embedded_hint",
    });

    编排.销毁();
  });
});
