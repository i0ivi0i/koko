// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { 创建媒体查看器 } from "../../媒体/媒体查看器";
import {
  创建测试VideoJs播放器壳,
  清理媒体查看器测试环境,
} from "../common/媒体查看器支架";

describe("媒体查看器适配器 - 图片 PhotoSwipe 会话", () => {
  afterEach(清理媒体查看器测试环境);

  it("会把图片附件映射给 PhotoSwipe 数据源，并从指定图片打开", () => {
    const init = vi.fn();
    const loadAndOpen = vi.fn();
    const destroy = vi.fn();
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init,
      loadAndOpen,
      destroy,
    }));
    const createVideoJsPlayerShell = vi.fn(() => 创建测试VideoJs播放器壳());
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVideoJsPlayerShell,
    });

    viewer.打开({
      startAttachmentId: "att-image-2",
      items: [
        {
          kind: "image",
          attachmentId: "att-image-1",
          src: "http://media.local/original-image-1",
          alt: "图片附件原图",
          width: 1200,
          height: 800,
        },
        {
          kind: "video",
          attachmentId: "att-video-1",
          src: "blob:http://media.local/video-1",
          posterSrc: "http://media.local/poster-video-1",
          width: 1280,
          height: 720,
        },
        {
          kind: "image",
          attachmentId: "att-image-2",
          src: "http://media.local/original-image-2",
          alt: "第二张图片附件原图",
          width: 900,
          height: 1200,
        },
      ],
    });

    expect(createPhotoSwipeLightbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSource: [
          {
            src: "http://media.local/original-image-1",
            alt: "图片附件原图",
            width: 1200,
            height: 800,
          },
          {
            src: "http://media.local/original-image-2",
            alt: "第二张图片附件原图",
            width: 900,
            height: 1200,
          },
        ],
      })
    );
    expect(init).toHaveBeenCalled();
    expect(loadAndOpen).toHaveBeenCalledWith(1);
    expect(createVideoJsPlayerShell).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("图片查看器打开完整图片时会先进入 backfilling，加载完成后再标记 complete", () => {
    const 信号记录: Array<{ attachmentId: string; signal: { type: string } }> = [];
    const 事件监听器 = new Map<string, (payload?: unknown) => void>();
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init: vi.fn(),
      loadAndOpen: vi.fn(() => true),
      destroy: vi.fn(),
      on: vi.fn((eventName: string, callback: (payload?: unknown) => void) => {
        事件监听器.set(eventName, callback);
      }),
    }));
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVideoJsPlayerShell: vi.fn(() => 创建测试VideoJs播放器壳()),
      onMediaSessionSignal: (attachmentId, signal) => {
        信号记录.push({ attachmentId, signal });
      },
    });

    viewer.打开({
      startAttachmentId: "att-image-complete-1",
      items: [
        {
          kind: "image",
          attachmentId: "att-image-complete-1",
          src: "http://media.local/blob/att-image-complete-1/full.webp",
          contentHash: "hash-image-complete-1",
          distribution: {
            swarm_id: "swarm-image-complete-1",
            announce_urls: ["wss://tracker.koko.local/announce"],
            web_seed_url: "http://media.local/blob/att-image-complete-1/original.png",
            join_ticket: null,
            ticket_expires_at: null,
            survival_mode: "server_assisted" as const,
          },
          alt: "图片附件原图",
          width: 1600,
          height: 900,
        },
      ],
    });

    expect(信号记录).toEqual([
      {
        attachmentId: "att-image-complete-1",
        signal: { type: "ASSET_BACKFILLING" },
      },
    ]);

    事件监听器.get("loadComplete")?.({
      slide: { index: 0 },
      content: {},
    });

    expect(信号记录).toEqual([
      {
        attachmentId: "att-image-complete-1",
        signal: { type: "ASSET_BACKFILLING" },
      },
      {
        attachmentId: "att-image-complete-1",
        signal: { type: "ASSET_COMPLETE" },
      },
    ]);
  });

  it("图片查看器创建失败时会释放聊天视口占用，不让滚动 owner 卡死", async () => {
    const error = new Error("photoswipe 创建失败");
    const onViewportCaptureStart = vi.fn();
    const onViewportCaptureEnd = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox: () => {
        throw error;
      },
      createVideoJsPlayerShell: vi.fn(() => 创建测试VideoJs播放器壳()),
      onViewportCaptureStart,
      onViewportCaptureEnd,
    });

    expect(() =>
      viewer.打开({
        startAttachmentId: "att-image-error-1",
        items: [
          {
            kind: "image",
            attachmentId: "att-image-error-1",
            src: "http://media.local/error-image-1",
            alt: "失败图片附件",
            width: 1200,
            height: 800,
          },
        ],
      })
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(onViewportCaptureStart).toHaveBeenCalledTimes(1);
    expect(onViewportCaptureEnd).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("打开媒体查看器失败", error);
  });
});
