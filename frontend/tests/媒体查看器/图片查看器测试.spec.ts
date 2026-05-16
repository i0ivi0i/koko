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
            msrc: "http://media.local/original-image-1",
            alt: "图片附件原图",
            width: 1200,
            height: 800,
            attachmentId: "att-image-1",
          },
          {
            src: "http://media.local/original-image-2",
            msrc: "http://media.local/original-image-2",
            alt: "第二张图片附件原图",
            width: 900,
            height: 1200,
            attachmentId: "att-image-2",
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

  it("图片查看器打开时会通过 pushState 接管浏览器返回键，让按返回不会退出群聊", async () => {
    const pushState = vi.spyOn(history, "pushState");
    const init = vi.fn();
    const loadAndOpen = vi.fn(() => true);
    const destroy = vi.fn();
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init,
      loadAndOpen,
      destroy,
      on: vi.fn(),
    }));
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVideoJsPlayerShell: vi.fn(() => 创建测试VideoJs播放器壳()),
    });

    viewer.打开({
      startAttachmentId: "att-image-back-1",
      items: [
        {
          kind: "image",
          attachmentId: "att-image-back-1",
          src: "http://media.local/back-image-1",
          alt: "图片返回键测试",
          width: 1200,
          height: 800,
        },
      ],
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(pushState).toHaveBeenCalledWith(
      expect.objectContaining({ __kokoMediaFullscreenSession: expect.any(String) }),
      "",
      expect.any(String)
    );
  });

  it("图片查看器打开后 popstate 触发，会程序化关闭 lightbox（不退出群聊）", async () => {
    const init = vi.fn();
    const loadAndOpen = vi.fn(() => true);
    const destroy = vi.fn();
    const eventListeners = new Map<string, (payload?: unknown) => void>();
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init,
      loadAndOpen,
      destroy,
      on: vi.fn((eventName: string, callback: (payload?: unknown) => void) => {
        eventListeners.set(eventName, callback);
      }),
    }));
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVideoJsPlayerShell: vi.fn(() => 创建测试VideoJs播放器壳()),
    });

    viewer.打开({
      startAttachmentId: "att-image-popstate-1",
      items: [
        {
          kind: "image",
          attachmentId: "att-image-popstate-1",
          src: "http://media.local/popstate-image-1",
          alt: "popstate 测试",
          width: 1200,
          height: 800,
        },
      ],
    });

    await Promise.resolve();
    await Promise.resolve();

    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    await Promise.resolve();

    expect(destroy).toHaveBeenCalled();
  });

  it("图片查看器主动关闭时会调用 history.back 消费 pushState 入的 entry，保 history 干净", async () => {
    const back = vi.spyOn(history, "back").mockImplementation(() => undefined);
    const pushState = vi.spyOn(history, "pushState");
    const init = vi.fn();
    const loadAndOpen = vi.fn(() => true);
    const destroy = vi.fn();
    const eventListeners = new Map<string, (payload?: unknown) => void>();
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init,
      loadAndOpen,
      destroy,
      on: vi.fn((eventName: string, callback: (payload?: unknown) => void) => {
        eventListeners.set(eventName, callback);
      }),
    }));
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVideoJsPlayerShell: vi.fn(() => 创建测试VideoJs播放器壳()),
    });

    viewer.打开({
      startAttachmentId: "att-image-consume-1",
      items: [
        {
          kind: "image",
          attachmentId: "att-image-consume-1",
          src: "http://media.local/consume-image-1",
          alt: "消费 entry 测试",
          width: 1200,
          height: 800,
        },
      ],
    });

    await Promise.resolve();
    await Promise.resolve();

    // 模拟实际 pushState 已落地：让 history.state 反映被 push 的内容
    const pushedState = pushState.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    if (pushedState) {
      history.replaceState(pushedState, "", window.location.href);
    }

    eventListeners.get("close")?.();
    await Promise.resolve();

    expect(back).toHaveBeenCalled();
  });
});
