// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { 媒体播放结果, 媒体播放位置 } from "../../媒体/媒体播放";
import type { 房间消息窗 } from "../../房间消息窗/壳";
import type { 消息展示项 } from "../../房间消息窗/视图";
import {
  创建单视频消息项,
  创建媒体消息窗,
  创建媒体消息项,
  等待时间线唯一播放器挂载,
  驱动时间线Canonical就绪,
} from "../common/房间消息窗媒体支架";

describe("房间消息窗媒体查看器 - 自动播位置与释放", () => {
  it("自动播视频 DOM 重挂载后会从运行时回灌的时间戳续播，而不是从头播放", async () => {
    const pane = 创建媒体消息窗();
    const positionEvents: Array<
      CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
    > = [];
    const 创建单视频消息 = (id: string): 消息展示项 => ({
      ...创建媒体消息项(),
      id,
      attachments: [
        {
          kind: "video",
          attachmentId: "att-video-1",
          width: 1280,
          height: 720,
          displayWidth: 320,
          displayHeight: 180,
          originalSrc: "http://media.local/original-video-1",
          posterSrc: null,
        },
      ],
    });
    const autoplayPlayback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;

    pane.addEventListener("room-inline-autoplay-position-changed", (event) => {
      const positionEvent = event as CustomEvent<{
        attachmentId: string;
        position: 媒体播放位置;
      }>;
      positionEvents.push(positionEvent);
      pane.inlineAutoplayPositionByAttachmentId = {
        [positionEvent.detail.attachmentId]: positionEvent.detail.position,
      };
    });
    pane.items = [创建单视频消息("m-video-before")];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": autoplayPlayback,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": autoplayPlayback,
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const beforeRemountVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(beforeRemountVideo).not.toBeNull();
    beforeRemountVideo!.currentTime = 18.25;
    beforeRemountVideo!.dispatchEvent(new Event("timeupdate"));
    expect(positionEvents).toHaveLength(1);
    const firstPositionEvent = positionEvents[0];
    expect(firstPositionEvent).toBeDefined();
    expect(firstPositionEvent!.detail).toMatchObject({
      attachmentId: "att-video-1",
      position: {
        src: "http://media.local/swarm-video-1",
        currentTime: 18.25,
      },
    });

    pane.items = [创建单视频消息("m-video-after")];
    await pane.updateComplete;

    const afterRemountVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(afterRemountVideo).not.toBeNull();
    expect(afterRemountVideo).toBe(beforeRemountVideo);
    afterRemountVideo!.dispatchEvent(new Event("loadedmetadata"));

    expect(afterRemountVideo!.currentTime).toBeCloseTo(18.25, 2);

    pane.remove();
  });

  it("同一消息行复用到新附件前，会先释放旧 preview video 源，避免退场 swarm 继续追旧请求", async () => {
    const pane = 创建媒体消息窗();
    const 创建复用单视频消息 = (messageId: string, attachmentId: string): 消息展示项 => ({
      ...创建媒体消息项(),
      id: messageId,
      attachments: [
        {
          kind: "video",
          attachmentId,
          width: 1280,
          height: 720,
          displayWidth: 320,
          displayHeight: 180,
          originalSrc: `http://media.local/original-${attachmentId}`,
          posterSrc: null,
        },
      ],
    });
    const oldPreviewSrc = "/webtorrent/hash-old/content-old.mp4";
    const newPreviewSrc = "/webtorrent/hash-new/content-new.mp4";
    pane.items = [创建复用单视频消息("m-reused", "att-old")];
    pane.mediaPlaybackByAttachmentId = {
      "att-old": {
        mode: "swarm",
        attachmentId: "att-old",
        kind: "video",
        src: oldPreviewSrc,
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const oldPreviewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-old"]:not([data-canonical-player="true"])'
    );
    expect(oldPreviewVideo).not.toBeNull();
    expect(oldPreviewVideo?.getAttribute("src")).toBe(oldPreviewSrc);

    const pauseSpy = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => undefined);
    const loadSpy = vi
      .spyOn(HTMLMediaElement.prototype, "load")
      .mockImplementation(() => undefined);

    try {
      pauseSpy.mockClear();
      loadSpy.mockClear();

      pane.items = [创建复用单视频消息("m-reused", "att-new")];
      pane.mediaPlaybackByAttachmentId = {
        "att-new": {
          mode: "swarm",
          attachmentId: "att-new",
          kind: "video",
          src: newPreviewSrc,
          thumbnailUrl: null,
          hint: null,
        } satisfies 媒体播放结果,
      };
      await pane.updateComplete;

      expect(pauseSpy).toHaveBeenCalled();
      expect(loadSpy).toHaveBeenCalled();

      const newPreviewVideo = pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-new"]:not([data-canonical-player="true"])'
      );
      expect(newPreviewVideo).not.toBeNull();
      expect(newPreviewVideo?.getAttribute("src")).toBe(newPreviewSrc);
    } finally {
      pauseSpy.mockRestore();
      loadSpy.mockRestore();
      pane.remove();
    }
  });

  it("虚拟列表纯滚动换窗不会同步几何扫描 preview video，避免滚动热路径强制回流", async () => {
    const pane = 创建媒体消息窗();
    const attachmentIds = Array.from({ length: 24 }, (_, index) => `att-scroll-release-${index + 1}`);
    pane.items = attachmentIds.map((attachmentId, index) =>
      创建单视频消息项(attachmentId, index + 1)
    );
    pane.mediaPlaybackByAttachmentId = Object.fromEntries(
      attachmentIds.map((attachmentId) => [
        attachmentId,
        {
          mode: "swarm",
          attachmentId,
          kind: "video",
          src: `/webtorrent/hash-${attachmentId}/content-${attachmentId}.mp4`,
          thumbnailUrl: null,
          hint: null,
        } satisfies 媒体播放结果,
      ])
    );
    document.body.appendChild(pane);
    await pane.updateComplete;

    const scrollContainer = pane.querySelector<HTMLElement>(".message-scroll");
    const previewVideos = Array.from(
      pane.querySelectorAll<HTMLVideoElement>(
        'video.message-video-preview:not([data-canonical-player="true"])'
      )
    );
    expect(scrollContainer).not.toBeNull();
    expect(previewVideos.length).toBeGreaterThan(0);
    const pauseSpy = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => undefined);
    const loadSpy = vi
      .spyOn(HTMLMediaElement.prototype, "load")
      .mockImplementation(() => undefined);

    try {
      pauseSpy.mockClear();
      loadSpy.mockClear();
      const scrollRectSpy = vi
        .spyOn(scrollContainer!, "getBoundingClientRect")
        .mockReturnValue(new DOMRect(0, 0, 320, 720));
      const videoRectSpies = previewVideos.map((video, index) =>
        vi.spyOn(video, "getBoundingClientRect").mockReturnValue(
          new DOMRect(0, 2_000 + index * 220, 320, 180)
        )
      );
      scrollContainer!.scrollTop = 10_000;
      scrollContainer!.dispatchEvent(new Event("scroll"));

      expect(scrollRectSpy).not.toHaveBeenCalled();
      for (const videoRectSpy of videoRectSpies) {
        expect(videoRectSpy).not.toHaveBeenCalled();
      }
      expect(pauseSpy).not.toHaveBeenCalled();
      expect(loadSpy).not.toHaveBeenCalled();
    } finally {
      pauseSpy.mockRestore();
      loadSpy.mockRestore();
      pane.remove();
    }
  });

  it("滚动清理只按当前虚拟窗口和现存表面推导视频期望，不扫描整段历史视频", async () => {
    const pane = 创建媒体消息窗();
    const attachmentIds = Array.from(
      { length: 36 },
      (_, index) => `att-scroll-scope-${index + 1}`
    );
    pane.items = attachmentIds.map((attachmentId, index) =>
      创建单视频消息项(attachmentId, index + 1)
    );
    pane.mediaPlaybackByAttachmentId = Object.fromEntries(
      attachmentIds.map((attachmentId) => [
        attachmentId,
        {
          mode: "swarm",
          attachmentId,
          kind: "video",
          src: `/webtorrent/hash-${attachmentId}/content-${attachmentId}.mp4`,
          thumbnailUrl: `http://media.local/poster-${attachmentId}`,
          hint: null,
        } satisfies 媒体播放结果,
      ])
    );

    type 测试虚拟项 = { key: string; index: number; start: number };
    const 创建虚拟项 = (indexes: number[]): 测试虚拟项[] =>
      indexes.map((index) => ({
        key: `m-${attachmentIds[index]}`,
        index,
        start: index * 240,
      }));
    const 内部虚拟器 = (
      pane as unknown as {
        读取消息虚拟器(): { getVirtualItems(): 测试虚拟项[] };
      }
    ).读取消息虚拟器();
    vi.spyOn(内部虚拟器, "getVirtualItems").mockReturnValue(创建虚拟项([0, 1]));

    document.body.appendChild(pane);
    await pane.updateComplete;

    const scrollContainer = pane.querySelector<HTMLElement>(".message-scroll");
    expect(scrollContainer).not.toBeNull();
    const 可触达附件 = new Set([
      "att-scroll-scope-1",
      "att-scroll-scope-2",
    ]);
    for (const video of pane.querySelectorAll<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id],video.message-video-preview[data-canonical-player="true"]'
    )) {
      const attachmentId = video.dataset.attachmentId?.trim();
      if (attachmentId) {
        可触达附件.add(attachmentId);
      }
    }

    type 时间线预算探针附件 = Extract<消息展示项["attachments"][number], { kind: "video" }>;
    type 时间线预算探针 = (
      attachment: 时间线预算探针附件,
      previewVideoSrc: string | null
    ) => unknown;
    const 内部面板 = pane as unknown as {
      读取时间线视频预算投影: 时间线预算探针;
    };
    const 原读取预算 = 内部面板.读取时间线视频预算投影.bind(pane);
    const 预算触达附件: string[] = [];
    const 预算Spy = vi
      .spyOn(内部面板, "读取时间线视频预算投影")
      .mockImplementation((attachment, previewVideoSrc) => {
        预算触达附件.push(attachment.attachmentId);
        return 原读取预算(attachment, previewVideoSrc);
      });

    try {
      scrollContainer!.dispatchEvent(new Event("scroll"));

      expect(预算触达附件.length).toBeGreaterThan(0);
      expect(new Set(预算触达附件).size).toBeLessThanOrEqual(可触达附件.size);
      expect(预算触达附件.every((attachmentId) => 可触达附件.has(attachmentId))).toBe(true);
    } finally {
      预算Spy.mockRestore();
      pane.remove();
    }
  });

  it("自动播时间戳上报只允许当前 owner，并对高频 timeupdate 做节流", async () => {
    const pane = 创建媒体消息窗();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const positionEvents: Array<
      CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
    > = [];
    const autoplayPlayback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;

    try {
      pane.items = [
        {
          ...创建媒体消息项(),
          attachments: [
            {
              kind: "video",
              attachmentId: "att-video-1",
              width: 1280,
              height: 720,
              displayWidth: 320,
              displayHeight: 180,
              originalSrc: "http://media.local/original-video-1",
              posterSrc: null,
            },
          ],
        },
      ];
      pane.addEventListener("room-inline-autoplay-position-changed", (event) => {
        positionEvents.push(
          event as CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
        );
      });
      pane.mediaPlaybackByAttachmentId = {
        "att-video-1": autoplayPlayback,
      };
      pane.inlineAutoplayPlaybackByAttachmentId = {
        "att-video-1": autoplayPlayback,
      };
      document.body.appendChild(pane);
      await pane.updateComplete;

      const nonOwnerVideo = pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-1"]'
      );
      expect(nonOwnerVideo).not.toBeNull();
      nonOwnerVideo!.currentTime = 8;
      nonOwnerVideo!.dispatchEvent(new Event("timeupdate"));
      expect(positionEvents).toHaveLength(0);

      pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
      await pane.updateComplete;
      await 等待时间线唯一播放器挂载(pane);

      const ownerVideo = pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-1"]'
      );
      expect(ownerVideo).not.toBeNull();
      ownerVideo!.currentTime = 10;
      ownerVideo!.dispatchEvent(new Event("timeupdate"));
      expect(positionEvents).toHaveLength(1);

      nowSpy.mockReturnValue(1_500);
      ownerVideo!.currentTime = 10.5;
      ownerVideo!.dispatchEvent(new Event("timeupdate"));
      expect(positionEvents).toHaveLength(1);

      nowSpy.mockReturnValue(2_000);
      ownerVideo!.currentTime = 11;
      ownerVideo!.dispatchEvent(new Event("timeupdate"));
      expect(positionEvents).toHaveLength(2);

      nowSpy.mockReturnValue(2_100);
      ownerVideo!.currentTime = 11.1;
      ownerVideo!.dispatchEvent(new Event("pause"));
      expect(positionEvents).toHaveLength(3);
      const flushedPositionEvent = positionEvents[2];
      expect(flushedPositionEvent).toBeDefined();
      expect(flushedPositionEvent!.detail.position.currentTime).toBeCloseTo(11.1, 2);
    } finally {
      nowSpy.mockRestore();
      pane.remove();
    }
  });

  it("自动播时间戳在同一秒内发生自然 loop 大跳变时，也会上报新的 0.x 事实", async () => {
    const pane = 创建媒体消息窗();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(5_000);
    const positionEvents: Array<
      CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
    > = [];
    const autoplayPlayback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;

    try {
      pane.items = [创建媒体消息项()];
      pane.addEventListener("room-inline-autoplay-position-changed", (event) => {
        positionEvents.push(
          event as CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
        );
      });
      pane.mediaPlaybackByAttachmentId = {
        "att-video-1": autoplayPlayback,
      };
      pane.inlineAutoplayPlaybackByAttachmentId = {
        "att-video-1": autoplayPlayback,
      };
      pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
      document.body.appendChild(pane);
      await pane.updateComplete;

      const ownerVideo = pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-1"]'
      );
      expect(ownerVideo).not.toBeNull();

      ownerVideo!.currentTime = 58.5;
      ownerVideo!.dispatchEvent(new Event("timeupdate"));
      expect(positionEvents).toHaveLength(1);

      nowSpy.mockReturnValue(5_200);
      ownerVideo!.currentTime = 0.35;
      ownerVideo!.dispatchEvent(new Event("timeupdate"));

      expect(positionEvents).toHaveLength(2);
      expect(positionEvents[1]?.detail.position.currentTime).toBeCloseTo(0.35, 2);
    } finally {
      nowSpy.mockRestore();
      pane.remove();
    }
  });

  it("自动播 owner 释放时会在暂停前强制 flush 最新时间戳", async () => {
    const pane = 创建媒体消息窗();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(3_000);
    const positionEvents: Array<
      CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
    > = [];
    const autoplayPlayback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;

    try {
      pane.addEventListener("room-inline-autoplay-position-changed", (event) => {
        positionEvents.push(
          event as CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
        );
      });
      pane.items = [
        {
          ...创建媒体消息项(),
          attachments: [
            {
              kind: "video",
              attachmentId: "att-video-1",
              width: 1280,
              height: 720,
              displayWidth: 320,
              displayHeight: 180,
              originalSrc: "http://media.local/original-video-1",
              posterSrc: null,
            },
          ],
        },
      ];
      pane.mediaPlaybackByAttachmentId = {
        "att-video-1": autoplayPlayback,
      };
      pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
      pane.inlineAutoplayPlaybackByAttachmentId = {
        "att-video-1": autoplayPlayback,
      };
      document.body.appendChild(pane);
      await pane.updateComplete;

      const pauseSpy = vi
        .spyOn(HTMLMediaElement.prototype, "pause")
        .mockImplementation(() => undefined);
      const ownerVideo = pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-1"]'
      );
      expect(ownerVideo).not.toBeNull();
      ownerVideo!.currentTime = 42.5;

      pane.inlineAutoplayOwnerAttachmentId = null;
      await pane.updateComplete;

      expect(pauseSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(positionEvents.length).toBeGreaterThan(0);
      const releaseFlushEvent = positionEvents.at(-1);
      expect(releaseFlushEvent).toBeDefined();
      expect(releaseFlushEvent!.detail.position.currentTime).toBeCloseTo(42.5, 2);
      pauseSpy.mockRestore();
    } finally {
      nowSpy.mockRestore();
      pane.remove();
    }
  });

  it("自动播时间戳上报会优先使用模板里的 canonical src，而不是浏览器展开后的 currentSrc 绝对地址", async () => {
    const pane = 创建媒体消息窗();
    const positionEvents: Array<
      CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
    > = [];
    const autoplayPlayback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "/webtorrent/demo-infohash/content-demo.mp4",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;

    pane.addEventListener("room-inline-autoplay-position-changed", (event) => {
      positionEvents.push(
        event as CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
      );
    });
    pane.items = [
      {
        ...创建媒体消息项(),
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-1",
            width: 1280,
            height: 720,
            displayWidth: 320,
            displayHeight: 180,
            originalSrc: "http://media.local/original-video-1",
            posterSrc: null,
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": autoplayPlayback,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": autoplayPlayback,
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerVideo).not.toBeNull();
    Object.defineProperty(ownerVideo!, "currentSrc", {
      configurable: true,
      value: new URL(autoplayPlayback.src, window.location.href).href,
    });
    ownerVideo!.currentTime = 12.5;
    ownerVideo!.dispatchEvent(new Event("timeupdate"));

    expect(positionEvents).toHaveLength(1);
    expect(positionEvents[0]?.detail).toMatchObject({
      attachmentId: "att-video-1",
      position: {
        src: autoplayPlayback.src,
        currentTime: 12.5,
      },
    });

    pane.remove();
  });

  it("有 poster 的视频释放自动播 owner 后仍显示保存时间点的视频帧", async () => {
    const pane = 创建媒体消息窗();
    const playback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: "http://media.local/poster-video-1",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [创建媒体消息项()];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback,
    };
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: playback.src,
        currentTime: 24.5,
        updatedAt: Date.now(),
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerVideo).not.toBeNull();
    const 就绪后的OwnerVideo = await 驱动时间线Canonical就绪(pane, "att-video-1");
    expect(就绪后的OwnerVideo?.autoplay).toBe(true);

    pane.inlineAutoplayOwnerAttachmentId = null;
    await pane.updateComplete;

    const releasedVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(releasedVideo).toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    pane.remove();
  });

  it("视频已经成为自动播 owner 后，卡片只保留 canonical player 这一颗真实视频", async () => {
    const pane = 创建媒体消息窗();
    const playback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: "http://media.local/poster-video-1",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [创建媒体消息项()];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback,
    };
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: playback.src,
        currentTime: 24.5,
        updatedAt: Date.now(),
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const ownerPreviewBeforeCanonical = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );
    expect(ownerPreviewBeforeCanonical).toBeNull();

    const canonicalVideo = await 驱动时间线Canonical就绪(pane, "att-video-1");
    const ownerPreviewAfterCanonical = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );

    /**
     * 真实房间里的卡顿来自 canonical 与 preview 双 `<video>` 同时存在。
     * owner 期间只允许唯一播放器这一颗真实视频，退场连续性改由 canonical 捕获的冻结帧承接。
     */
    expect(canonicalVideo?.dataset.canonicalPlayer).toBe("true");
    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-1"]')
    ).not.toBeNull();
    expect(ownerPreviewAfterCanonical).toBeNull();

    pane.remove();
  });
});
