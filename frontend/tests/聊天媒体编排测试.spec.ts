import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { 创建聊天媒体编排 } from "../聊天媒体编排";
import type { 前端传输端口 } from "../传输";
import type { 消息事件 } from "../契约";
import { 创建内存媒体缓存仓库, type 媒体播放结果 } from "../媒体";

const 生成视频消息 = (attachmentId: string): 消息事件 =>
  ({
    attachments: [
      {
        attachment_id: attachmentId,
        kind: "video",
      },
    ],
  }) as unknown as 消息事件;

const 生成图片消息 = (attachmentId: string): 消息事件 =>
  ({
    attachments: [
      {
        attachment_id: attachmentId,
        kind: "image",
      },
    ],
  }) as unknown as 消息事件;

const 生成连续视频消息 = (count: number): 消息事件[] =>
  Array.from({ length: count }, (_, index) =>
    生成视频消息(`att-video-window-${index + 1}`)
  );

const 生成锚点视频播放结果 = (attachmentId: string): 媒体播放结果 => ({
  mode: "anchor",
  attachmentId,
  kind: "video",
  src: `http://media.local/original-${attachmentId}`,
  thumbnailUrl: null,
  hint: null,
});

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

describe("聊天媒体编排", () => {
  it("聊天媒体编排当前通过 runtime / player / viewer / distribution seam 协调媒体，不直接手搓底层浏览器能力", () => {
    const source = readFileSync(resolve(process.cwd(), "聊天媒体编排.ts"), "utf8");

    expect(source).toContain("创建媒体运行时Actor");
    expect(source).toContain("创建媒体播放器");
    expect(source).toContain("创建媒体查看器");
    expect(source).toContain("创建资产协作分发运行时");
    expect(source).not.toContain("new WebTorrent");
    expect(source).not.toContain("navigator.serviceWorker");
    expect(source).not.toContain("createServer(");
    expect(source).not.toContain("window.localStorage");
  });

  it("聊天媒体编排不再直接内联查看器打开/同步/关闭协作", () => {
    const source = readFileSync(resolve(process.cwd(), "聊天媒体编排.ts"), "utf8");

    expect(source).toContain('from "./媒体/壳层/查看器会话协作.js"');
    expect(source).toContain("创建查看器会话协作(");
    expect(source).not.toContain("const 投影查看器请求到当前播放真相 =");
    expect(source).not.toContain("const 是否应等待本地完整视频会话真相 =");
    expect(source).not.toContain("const 正式打开查看器 =");
    expect(source).not.toContain("const 同步当前查看器请求 =");
  });

  it("聊天媒体编排不再直接内联自动播稳定等待与播放结果解析", () => {
    const source = readFileSync(resolve(process.cwd(), "聊天媒体编排.ts"), "utf8");

    expect(source).toContain('from "./媒体/壳层/自动播协作.js"');
    expect(source).toContain("创建自动播协作(");
    expect(source).not.toContain("let inlineAutoplay启动定时器");
    expect(source).not.toContain("let inlineAutoplay解析代次");
    expect(source).not.toContain("const 读取自动播播放结果表 =");
    expect(source).not.toContain("const 清空自动播播放结果 =");
    expect(source).not.toContain("const 解析自动播播放结果 =");
    expect(source).not.toContain("const 调度自动播播放结果解析 =");
  });

  it("聊天媒体编排不再直接内联视频预览缺源阻断与缓存重试", () => {
    const source = readFileSync(resolve(process.cwd(), "聊天媒体编排.ts"), "utf8");

    expect(source).toContain('from "./媒体/壳层/视频预览协作.js"');
    expect(source).toContain("创建视频预览协作(");
    expect(source).not.toContain("const 视频预览状态表 =");
    expect(source).not.toContain("const 视频预览解析代次表 =");
    expect(source).not.toContain("const 视频预览缺源阻断版本表 =");
    expect(source).not.toContain("const 读取当前视频预览播放源 =");
    expect(source).not.toContain("const 读取视频canonical冷源地址 =");
    expect(source).not.toContain("const 解析视频预览 =");
  });

  it("聊天媒体编排不再直接内联协作补齐恢复与帮助链集合", () => {
    const source = readFileSync(resolve(process.cwd(), "聊天媒体编排.ts"), "utf8");

    expect(source).toContain('from "./媒体/壳层/协作补齐协作.js"');
    expect(source).toContain("创建协作补齐协作(");
    expect(source).not.toContain("const 已进入帮助链附件 =");
    expect(source).not.toContain("const 已恢复帮助任务附件 =");
    expect(source).not.toContain("const 处理协作分发事件 =");
    expect(source).not.toContain("const 激活附件协作补齐 =");
    expect(source).not.toContain("const 恢复当前房间缓存帮助任务 =");
  });

  it("聊天媒体编排统一复用附件释放和关停 helper，不再在多处复制销毁序列", () => {
    const source = readFileSync(resolve(process.cwd(), "聊天媒体编排.ts"), "utf8");

    expect(source).toContain("const 释放媒体附件会话 =");
    expect(source).toContain("const 执行媒体编排关停 =");
    expect(source).toMatch(/清空\(\): void \{\s+执行媒体编排关停\(\{/);
    expect(source).toMatch(/销毁\(\): void \{\s+执行媒体编排关停\(\{/);
  });

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
    const 编排 = 创建聊天媒体编排({
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

    编排.同步消息附件播放结果();
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
    vi.doMock("../媒体/资产协作分发运行时.js", () => ({
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

    const { 创建聊天媒体编排: 创建聊天媒体编排带协作分发桩 } = await import("../聊天媒体编排");
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
    const 编排 = 创建聊天媒体编排带协作分发桩({
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
    vi.doUnmock("../媒体/资产协作分发运行时.js");
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

    const 解析播放结果 = vi.fn<
      (
        input: {
          attachmentId: string;
          kind: "image" | "video";
          surface?: "viewer" | "inline_autoplay";
          consumerId?: string;
        }
      ) => Promise<媒体播放结果>
    >().mockResolvedValue({
      mode: "swarm",
      attachmentId,
      kind: "video",
      src: swarmSrc,
      thumbnailUrl: null,
      hint: null,
    });

    const viewerOpenCalls: Array<{ startAttachmentId: string; items: unknown[] }> = [];
    const viewerSyncCalls: Array<{ startAttachmentId: string; items: unknown[] }> = [];
    const 抓取视频预览 = vi.fn(async () => ({
      objectUrl: null,
      source: "none" as const,
      width: null,
      height: null,
    }));

    const 编排 = 创建聊天媒体编排({
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
     * 当前自动播 owner 已经握着同一条 swarm 会话；显式放大只能继续复用热会话，
     * 不能再触发一轮 recovering，把查看器 request 暂时投成 `src: ""`。
     *
     * 但如果同一附件的 preview 仍卡在 `missing_source`，打开查看器时允许顺手重试一次抓帧：
     * - 这不会改写当前 playback owner；
     * - 也不会让 viewer request 先退回空 src；
     * - 只是利用当前已经热起来的 swarm 源再补一次 preview 真相。
     */
    expect(解析播放结果).toHaveBeenCalledTimes(打开前解析次数);
    expect(抓取视频预览).toHaveBeenCalledTimes(打开前预览抓取次数 + 1);
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

    const 编排 = 创建聊天媒体编排({
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

    const 编排 = 创建聊天媒体编排({
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
    vi.doMock("../媒体/资产协作分发运行时.js", () => ({
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

    const { 创建聊天媒体编排: 创建聊天媒体编排带协作分发桩 } = await import("../聊天媒体编排");
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

    const 编排 = 创建聊天媒体编排带协作分发桩({
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

    const 编排 = 创建聊天媒体编排({
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

    const 编排 = 创建聊天媒体编排({
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

  it("缓存启动后只恢复当前帮助窗口里的本房间完整附件，不会把隐藏历史和别房间扫进来", async () => {
    const 激活协作补齐 = vi.fn(async () => {});
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

    const 编排 = 创建聊天媒体编排({
      transport: () => transport,
      读取会话编号: () => "s-test",
      读取当前房间标识: () => "r-current",
      读取消息: () => [生成图片消息("att-image-current-room-1")],
      媒体缓存仓库: 创建内存媒体缓存仓库({
        "att-image-current-room-1": {
          attachmentId: "att-image-current-room-1",
          roomId: "r-current",
          complete: true,
          kind: "image",
          contentHash: "hash-image-current-room-1",
          retainedAt: 1,
          lastAccessAt: 1,
        },
        "att-image-current-room-hidden-2": {
          attachmentId: "att-image-current-room-hidden-2",
          roomId: "r-current",
          complete: true,
          kind: "image",
          contentHash: "hash-image-current-room-hidden-2",
          retainedAt: 1,
          lastAccessAt: 1,
        },
        "att-image-other-room-1": {
          attachmentId: "att-image-other-room-1",
          roomId: "r-other",
          complete: true,
          kind: "image",
          contentHash: "hash-image-other-room-1",
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
        attachmentId: "att-image-current-room-1",
        kind: "image",
        src: "http://media.local/blob/att-image-current-room-1/full.webp",
        thumbnailUrl: "http://media.local/blob/att-image-current-room-1/preview.webp",
        contentHash: "hash-image-current-room-1",
        distribution: null,
        hint: null,
      }),
      激活协作补齐,
    });

    编排.同步媒体窗口附件(["att-image-current-room-1"]);
    await 刷新异步队列();

    expect(激活协作补齐).toHaveBeenCalledTimes(1);
    expect(激活协作补齐).toHaveBeenCalledWith({
      attachmentId: "att-image-current-room-1",
      consumerId: "session:att-image-current-room-1",
      kind: "image",
      onSessionEvent: expect.any(Function),
    });

    编排.销毁();
  });

  it("附件离开当前帮助窗口后，不能只因曾进入帮助链就继续长期占着活会话", async () => {
    vi.resetModules();
    const 释放协作分发消费者 = vi.fn();
    vi.doMock("../媒体/资产协作分发运行时.js", () => ({
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

    const { 创建聊天媒体编排: 创建聊天媒体编排带协作分发桩 } = await import("../聊天媒体编排");
    const 激活协作补齐 = vi.fn(async () => {});
    const 释放附件播放资源 = vi.fn();
    const 当前消息 = {
      value: [生成图片消息("att-image-help-chain-1")] as 消息事件[],
    };

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

    const 编排 = 创建聊天媒体编排带协作分发桩({
      transport: () => transport,
      读取会话编号: () => "s-test",
      读取消息: () => 当前消息.value,
      媒体缓存仓库: 创建内存媒体缓存仓库({
        "att-image-help-chain-1": {
          attachmentId: "att-image-help-chain-1",
          complete: true,
          kind: "image",
          contentHash: "hash-image-help-chain-1",
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
        attachmentId: "att-image-help-chain-1",
        kind: "image",
        src: "http://media.local/blob/att-image-help-chain-1/full.webp",
        thumbnailUrl: "http://media.local/blob/att-image-help-chain-1/preview.webp",
        contentHash: "hash-image-help-chain-1",
        distribution: null,
        hint: null,
      }),
      激活协作补齐,
      释放附件播放资源,
    });

    编排.同步媒体窗口附件(["att-image-help-chain-1"]);
    await 刷新异步队列();

    expect(激活协作补齐).toHaveBeenCalledTimes(1);
    expect(Object.keys(编排.snapshot().sessionByAttachmentId)).toContain("att-image-help-chain-1");

    当前消息.value = [生成图片消息("att-image-current-only-2")];
    编排.同步媒体窗口附件(["att-image-current-only-2"]);
    await 刷新异步队列();

    expect(释放附件播放资源).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentId: "att-image-help-chain-1" })
    );
    expect(Object.keys(编排.snapshot().sessionByAttachmentId)).not.toContain(
      "att-image-help-chain-1"
    );

    编排.销毁();
    vi.doUnmock("../媒体/资产协作分发运行时.js");
    vi.resetModules();
  });

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
    vi.doMock("../媒体/资产协作分发运行时.js", () => ({
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

    const { 创建聊天媒体编排: 创建聊天媒体编排带协作分发桩 } = await import("../聊天媒体编排");
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

    const 编排 = 创建聊天媒体编排带协作分发桩({
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
        consumerId: `session:${attachmentId}`,
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
    vi.doUnmock("../媒体/资产协作分发运行时.js");
    vi.resetModules();
  });

  it("连续观看多个可见视频再关闭查看器后，正式播放结果不会按观看次数累积", async () => {
    const 消息列表 = 生成连续视频消息(6);
    const 释放附件播放资源 = vi.fn();
    const 编排 = 创建聊天媒体编排({
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
    vi.doMock("../媒体/资产协作分发运行时.js", () => ({
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

    const { 创建聊天媒体编排: 创建聊天媒体编排带协作分发桩 } = await import("../聊天媒体编排");
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

    const 编排 = 创建聊天媒体编排带协作分发桩({
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

    vi.doUnmock("../媒体/资产协作分发运行时.js");
    vi.resetModules();
  });

  it("同步消息附件播放结果后，只保留近视口/当前交互窗口内的活媒体会话，而不是整房历史全养活", async () => {
    const 消息列表 = 生成连续视频消息(20);
    const 编排 = 创建聊天媒体编排({
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
      读取会话编号: () => "s-test",
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

    编排.处理自动播候选([
      {
        attachmentId: "att-video-window-1",
        visibilityRatio: 0.93,
        distanceToViewportCenter: 0,
      },
      {
        attachmentId: "att-video-window-2",
        visibilityRatio: 0.88,
        distanceToViewportCenter: 64,
      },
    ]);
    编排.同步消息附件播放结果();
    await 刷新异步队列();

    expect(Object.keys(编排.snapshot().sessionByAttachmentId).length).toBeLessThanOrEqual(12);
    编排.销毁();
  });

  it("窗口真相未到前，不会先把整房历史附件拉成活媒体会话", async () => {
    const 消息列表 = 生成连续视频消息(20);
    const 编排 = 创建聊天媒体编排({
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
      读取会话编号: () => "s-window-sync",
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

    编排.同步消息附件播放结果();
    expect(Object.keys(编排.snapshot().sessionByAttachmentId)).toHaveLength(0);

    编排.同步媒体窗口附件(
      Array.from({ length: 6 }, (_, index) => `att-video-window-${index + 1}`)
    );
    await 刷新异步队列();

    expect(Object.keys(编排.snapshot().sessionByAttachmentId).length).toBeLessThanOrEqual(6);
    编排.销毁();
  });
});
