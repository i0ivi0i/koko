// @vitest-environment happy-dom

import { describe,expect,it,vi } from "vitest";
import type { 媒体播放结果 } from "../../媒体/媒体播放";
import {
创建单视频消息项,
创建媒体消息窗,
创建媒体消息项,
等待时间线唯一播放器挂载
} from "../common/房间消息窗媒体支架";

describe("房间消息窗媒体查看器 / 冻结帧与隐藏接管", () => {

  it("高速回滑时有同源冻结帧，就用冻结帧顶住重新挂载的 video，禁止先露 poster 或首帧", async () => {
    const pane = 创建媒体消息窗();
    const playback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: "http://media.local/poster-video-1",
      hint: null,
    } satisfies 媒体播放结果;
    const frozenFrameBitmap = document.createElement("canvas");

    pane.items = [
      {
        ...创建媒体消息项(),
        id: "message-video-1",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-1",
            width: 1280,
            height: 720,
      layoutX: 0,
      layoutY: 0,
            displayWidth: 320,
            displayHeight: 180,
            posterSrc: "http://media.local/poster-video-1",
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback,
    };
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: playback.src,
        currentTime: 18.6,
        updatedAt: 1_715_000_000_000,
      },
    };
    const 画面缓存Owner = (
      pane as unknown as {
        时间线画面缓存Owner: {
          时间线自动播冻结帧: Map<
            string,
            {
              src: string;
              currentTime: number;
              bitmap: CanvasImageSource;
              width: number;
              height: number;
              updatedAt: number;
              dispose(): void;
            }
          >;
        };
      }
    ).时间线画面缓存Owner;
    Object.defineProperty(画面缓存Owner, "时间线自动播冻结帧", {
      configurable: true,
      value: new Map([
        [
          "att-video-1",
          {
            src: playback.src,
            currentTime: 18.6,
            bitmap: frozenFrameBitmap,
            width: 320,
            height: 180,
            updatedAt: 1_715_000_000_001,
            dispose: vi.fn(),
          },
        ],
      ]),
    });

    document.body.appendChild(pane);
    await pane.updateComplete;

    const frozenFrame = pane.querySelector<HTMLCanvasElement>(
      'canvas.message-video-frozen-frame[data-attachment-id="att-video-1"]'
    );
    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );

    expect(frozenFrame).not.toBeNull();
    expect(previewVideo).toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).toBeNull();

    pane.remove();
  });
  it("时间线冻结帧直接写入内存桥接帧，不能再回退成 webp dataUrl 编码", async () => {
    const pane = 创建媒体消息窗();
    const video = document.createElement("video");
    video.setAttribute("src", "http://media.local/freeze-video");
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 3.25,
    });
    Object.defineProperty(video, "readyState", {
      configurable: true,
      value: HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 720,
    });
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn(),
      toDataURL: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const 原始创建元素 = document.createElement.bind(document);
    const createElement = vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return canvas;
      }
      return 原始创建元素(tagName);
    });

    try {
      const 画面缓存Owner = (
        pane as unknown as {
          时间线画面缓存Owner: {
            捕获自动播冻结帧(attachmentId: string, video: HTMLVideoElement): void;
            时间线自动播冻结帧: Map<string, { bitmap: CanvasImageSource }>;
          };
        }
      ).时间线画面缓存Owner;
      画面缓存Owner.捕获自动播冻结帧("att-freeze-async", video);

      expect(drawImage).toHaveBeenCalledTimes(1);
      expect(canvas.toBlob).not.toHaveBeenCalled();
      expect(canvas.toDataURL).not.toHaveBeenCalled();
      expect(画面缓存Owner.时间线自动播冻结帧.get("att-freeze-async")?.bitmap).toBe(canvas);
    } finally {
      createElement.mockRestore();
    }
  });
  it("双视频自动播 owner 交接时，只要目标卡片已经有同源预览视频，也必须先走隐藏预热宿主而不是直接显露 canonical host", async () => {
    const pane = 创建媒体消息窗();
    const playback1 = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: "http://media.local/poster-video-1",
      hint: null,
    } satisfies 媒体播放结果;
    const playback2 = {
      mode: "swarm",
      attachmentId: "att-video-2",
      kind: "video",
      src: "http://media.local/swarm-video-2",
      thumbnailUrl: "http://media.local/poster-video-2",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [
      {
        ...创建媒体消息项(),
        id: "message-video-1",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-1",
            width: 720,
            height: 1280,
      layoutX: 0,
      layoutY: 0,
            displayWidth: 180,
            displayHeight: 320,
            posterSrc: "http://media.local/poster-video-1",
          },
        ],
      },
      {
        ...创建媒体消息项(),
        id: "message-video-2",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-2",
            width: 720,
            height: 1280,
      layoutX: 0,
      layoutY: 0,
            displayWidth: 180,
            displayHeight: 320,
            posterSrc: "http://media.local/poster-video-2",
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback1,
      "att-video-2": playback2,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback1,
    };

    document.body.appendChild(pane);
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    const 切换前预览视频 = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"]'
    );
    expect(切换前预览视频).not.toBeNull();
    expect(切换前预览视频?.dataset.canonicalPlayer).toBeUndefined();
    expect(切换前预览视频?.getAttribute("src")).toBe(playback2.src);
    Object.defineProperty(切换前预览视频!, "readyState", {
      configurable: true,
      value: 2,
    });

    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    await pane.updateComplete;

    /**
     * 真实房间里很多切换目标卡片没有保存续播点，但已经有同源 preview `<video>`。
     * 新模型允许 canonical 先挂到可见宿主下面，但必须继续由这张 preview 顶住，不能再额外长 hidden stage。
     */
    expect(
      pane.querySelector(
        '.message-video-canonical-host[data-attachment-id="att-video-2"]'
      )
    ).not.toBeNull();
    expect(
      pane.querySelector(
        '.message-video-canonical-stage-host[data-attachment-id="att-video-2"]'
      )
    ).toBeNull();
    expect(
      pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-2"]:not([data-canonical-player="true"])'
      )
    ).toBe(切换前预览视频);

    pane.remove();
  });
  it("初次自动播 owner 没有稳定像素底板且 canonical 尚未出帧时，必须先走隐藏预热宿主", async () => {
    const pane = 创建媒体消息窗();
    const playback = {
      mode: "swarm",
      attachmentId: "att-video-black-handoff",
      kind: "video",
      src: "http://media.local/swarm-video-black-handoff",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [
      {
        ...创建媒体消息项(),
        id: "message-video-black-handoff",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-black-handoff",
            width: 720,
            height: 1280,
      layoutX: 0,
      layoutY: 0,
            displayWidth: 180,
            displayHeight: 320,
            posterSrc: null,
          },
        ],
      },
    ];
    pane.inlineAutoplayOwnerAttachmentId = "att-video-black-handoff";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-black-handoff": playback,
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const card = pane.querySelector<HTMLElement>(
      '.message-video-card[data-attachment-id="att-video-black-handoff"]'
    );
    const visibleCanonicalHost = card?.querySelector(
      '.message-video-canonical-host[data-attachment-id="att-video-black-handoff"]'
    );
    const hiddenStageHost = card?.querySelector(
      '.message-video-canonical-stage-host[data-attachment-id="att-video-black-handoff"]'
    );
    const previewVideo = card?.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-black-handoff"]:not([data-canonical-player="true"])'
    );
    const posterCover = card?.querySelector<HTMLImageElement>("img.message-video-poster");

    /**
     * 新收口后的不变量是：
     * 1. 只要 owner 已经握有同源 canonical src，就必须先长出同源 preview bridge；
     * 2. canonical 仍然要在 hidden stage 里预热，揭帘前不能直接露 live video；
     * 3. 因而“冷 owner + 无 poster”不再允许退回默认占位图，这正是快滑黑闪的根因之一。
     */
    expect(visibleCanonicalHost).toBeNull();
    expect(hiddenStageHost).not.toBeNull();
    expect(previewVideo?.getAttribute("src")).toBe(playback.src);
    expect(posterCover).toBeNull();

    pane.remove();
  });
  it("刚退场 owner 的冻结帧尚未导出时，必须先保留同源续播预览而不是闪回 poster", async () => {
    const pane = 创建媒体消息窗();
    const releasedAttachmentId = "att-video-released-owner";
    const nextAttachmentId = "att-video-next-owner";
    const releasedSrc = "http://media.local/swarm-video-released-owner";
    const nextPlayback = {
      mode: "swarm",
      attachmentId: nextAttachmentId,
      kind: "video",
      src: "http://media.local/swarm-video-next-owner",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [
      创建单视频消息项(releasedAttachmentId, 1),
      创建单视频消息项(nextAttachmentId, 2),
    ];
    pane.mediaVideoBudgetByAttachmentId = {
      [releasedAttachmentId]: {
        attachmentId: releasedAttachmentId,
        tier: "cold_expression",
        reason: "inactive",
        canonicalVideoSrc: null,
        previewVideoSrc: null,
        allowInlineCanonical: false,
        allowPreviewVideo: false,
        formalByteSource: "none",
        webTorrentLifecycleState: null,
        activeWebTorrentReaderCount: 0,
      },
    };
    pane.inlineAutoplayOwnerAttachmentId = nextAttachmentId;
    pane.inlineAutoplayPlaybackByAttachmentId = {
      [nextAttachmentId]: nextPlayback,
    };
    pane.inlineAutoplayPositionByAttachmentId = {
      [releasedAttachmentId]: {
        src: releasedSrc,
        currentTime: 12.5,
        updatedAt: 1_777_500_000_000,
      },
    };
    (
      pane as unknown as {
        最近退场Owner附件Id: string | null;
      }
    ).最近退场Owner附件Id = releasedAttachmentId;

    document.body.appendChild(pane);
    await pane.updateComplete;

    const releasedCard = pane.querySelector<HTMLElement>(
      `.message-video-card[data-attachment-id="${releasedAttachmentId}"]`
    );
    const releasedPreview = releasedCard?.querySelector<HTMLVideoElement>(
      'video.message-video-preview:not([data-canonical-player="true"])'
    );

    expect(releasedCard).not.toBeNull();
    expect(releasedPreview).not.toBeNull();
    expect(releasedPreview?.getAttribute("src")).toBe(releasedSrc);
    expect(releasedCard?.querySelector("img.message-video-poster")).toBeNull();
    expect(releasedCard?.querySelector(".message-video-play-indicator")).toBeNull();

    releasedPreview?.dispatchEvent(new Event("loadedmetadata"));
    expect(releasedPreview?.currentTime).toBeCloseTo(12.5, 2);

    pane.remove();
  });

  it("当前 owner 交接若已经握有同源冻结帧，必须只露冻结帧一个 bridge surface，不能再让 preview 跟 visible canonical 一起争位", async () => {
    const pane = 创建媒体消息窗();
    const attachmentId = "att-video-single-slot";
    const playback = {
      mode: "swarm",
      attachmentId,
      kind: "video",
      src: "http://media.local/swarm-video-single-slot",
      thumbnailUrl: "http://media.local/poster-video-single-slot",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [创建单视频消息项(attachmentId, 1)];
    pane.mediaPlaybackByAttachmentId = {
      [attachmentId]: playback,
    };
    pane.inlineAutoplayPositionByAttachmentId = {
      [attachmentId]: {
        src: playback.src,
        currentTime: 12.5,
        updatedAt: 1_777_500_000_400,
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewVideo = pane.querySelector<HTMLVideoElement>(
      `video.message-video-preview[data-attachment-id="${attachmentId}"]:not([data-canonical-player="true"])`
    );
    expect(previewVideo).not.toBeNull();
    Object.defineProperty(previewVideo!, "readyState", {
      configurable: true,
      value: 2,
    });
    Object.defineProperty(previewVideo!, "currentTime", {
      configurable: true,
      value: 12.5,
    });
    previewVideo!.dataset.previewSrc = playback.src;
    previewVideo!.dataset.previewCommittedSrc = playback.src;

    const 画面缓存Owner = (
      pane as unknown as {
        时间线画面缓存Owner: {
          时间线自动播冻结帧: Map<
            string,
            {
              src: string;
              currentTime: number;
              bitmap: CanvasImageSource;
              width: number;
              height: number;
              updatedAt: number;
              dispose(): void;
            }
          >;
        };
      }
    ).时间线画面缓存Owner;
    Object.defineProperty(画面缓存Owner, "时间线自动播冻结帧", {
      configurable: true,
      value: new Map([
        [
          attachmentId,
          {
            src: playback.src,
            currentTime: 12.5,
            bitmap: document.createElement("canvas"),
            width: 320,
            height: 180,
            updatedAt: 1_777_500_000_401,
            dispose: vi.fn(),
          },
        ],
      ]),
    });

    pane.inlineAutoplayOwnerAttachmentId = attachmentId;
    pane.inlineAutoplayPlaybackByAttachmentId = {
      [attachmentId]: playback,
    };
    await pane.updateComplete;

    const card = pane.querySelector<HTMLElement>(
      `.message-video-card[data-attachment-id="${attachmentId}"]`
    );
    const visibleHost = card?.querySelector<HTMLElement>(
      `.message-video-canonical-host[data-attachment-id="${attachmentId}"]`
    );
    const frozenFrame = card?.querySelector<HTMLCanvasElement>(
      `canvas.message-video-frozen-frame[data-attachment-id="${attachmentId}"]`
    );
    const warmupPreview = card?.querySelector<HTMLVideoElement>(
      `video.message-video-preview[data-attachment-id="${attachmentId}"]:not([data-canonical-player="true"])`
    );

    expect(visibleHost).not.toBeNull();
    expect(visibleHost?.dataset.covered).toBe("true");
    expect(frozenFrame?.getAttribute("data-bridge-src")).toBe(playback.src);
    expect(warmupPreview).toBeNull();

    pane.remove();
  });

  it("刚退场 owner 仍带着上一拍 swarm playback 快照时，也必须优先露冻结帧而不是 canonical loading poster", async () => {
    const pane = 创建媒体消息窗();
    const releasedAttachmentId = "att-video-released-owner-stale-playback";
    const nextAttachmentId = "att-video-next-owner-stale-playback";
    const releasedPlayback = {
      mode: "swarm",
      attachmentId: releasedAttachmentId,
      kind: "video",
      src: "http://media.local/swarm-video-released-owner-stale-playback",
      thumbnailUrl: "http://media.local/poster-video-released-owner-stale-playback",
      hint: null,
    } satisfies 媒体播放结果;
    const nextPlayback = {
      mode: "swarm",
      attachmentId: nextAttachmentId,
      kind: "video",
      src: "http://media.local/swarm-video-next-owner-stale-playback",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [
      创建单视频消息项(releasedAttachmentId, 1),
      创建单视频消息项(nextAttachmentId, 2),
    ];
    pane.mediaPlaybackByAttachmentId = {
      [releasedAttachmentId]: releasedPlayback,
      [nextAttachmentId]: nextPlayback,
    };
    pane.mediaVideoBudgetByAttachmentId = {
      [releasedAttachmentId]: {
        attachmentId: releasedAttachmentId,
        tier: "heavy_playback",
        reason: "inline_autoplay_owner",
        canonicalVideoSrc: releasedPlayback.src,
        previewVideoSrc: null,
        allowInlineCanonical: true,
        allowPreviewVideo: false,
        formalByteSource: "webtorrent_official_stream",
        webTorrentLifecycleState: "source_ready",
        activeWebTorrentReaderCount: 1,
      },
    };
    pane.inlineAutoplayOwnerAttachmentId = nextAttachmentId;
    pane.inlineAutoplayPlaybackByAttachmentId = {
      [nextAttachmentId]: nextPlayback,
    };
    pane.inlineAutoplayPositionByAttachmentId = {
      [releasedAttachmentId]: {
        src: releasedPlayback.src,
        currentTime: 12.5,
        updatedAt: 1_777_500_000_100,
      },
    };
    (
      pane as unknown as {
        最近退场Owner附件Id: string | null;
        时间线隐藏接管附件Id: string | null;
      }
    ).最近退场Owner附件Id = releasedAttachmentId;
    (
      pane as unknown as {
        最近退场Owner附件Id: string | null;
        时间线隐藏接管附件Id: string | null;
      }
    ).时间线隐藏接管附件Id = nextAttachmentId;
    const 画面缓存Owner = (
      pane as unknown as {
        时间线画面缓存Owner: {
          时间线自动播冻结帧: Map<
            string,
            {
              src: string;
              currentTime: number;
              bitmap: CanvasImageSource;
              width: number;
              height: number;
              updatedAt: number;
              dispose(): void;
            }
          >;
        };
      }
    ).时间线画面缓存Owner;
    Object.defineProperty(画面缓存Owner, "时间线自动播冻结帧", {
      configurable: true,
      value: new Map([
        [
          releasedAttachmentId,
          {
            src: releasedPlayback.src,
            currentTime: 12.5,
            bitmap: document.createElement("canvas"),
            width: 320,
            height: 180,
            updatedAt: 1_777_500_000_101,
            dispose: vi.fn(),
          },
        ],
      ]),
    });

    document.body.appendChild(pane);
    await pane.updateComplete;

    const releasedCard = pane.querySelector<HTMLElement>(
      `.message-video-card[data-attachment-id="${releasedAttachmentId}"]`
    );
    const releasedFrozenFrame = releasedCard?.querySelector<HTMLCanvasElement>(
      `canvas.message-video-frozen-frame[data-attachment-id="${releasedAttachmentId}"]`
    );
    const releasedPreview = releasedCard?.querySelector<HTMLVideoElement>(
      'video.message-video-preview:not([data-canonical-player="true"])'
    );

    /**
     * 这是这次真实浏览器烟测抓到的那一拍：
     * 1. 旧卡还带着上一拍 swarm/playback 快照；
     * 2. 新卡已经开始 hidden stage 预热；
     * 3. 旧卡首个可见表面仍必须是它自己的冻结帧，而不是 canonical loading poster，
     *    更不能为了补救再重建第二颗 preview video。
     */
    expect(releasedCard).not.toBeNull();
    expect(releasedFrozenFrame?.getAttribute("data-bridge-src")).toBe(releasedPlayback.src);
    expect(releasedPreview).toBeNull();
    /**
     * poster 现在作为冻结帧 canvas 的安全网保留在 DOM 里（z-index: 0，被 canvas 覆盖），
     * 但卡片的首要可见表面仍然必须是冻结帧，不是 poster。
     */
    expect(releasedCard?.querySelector("img.message-video-poster")).not.toBeNull();
    expect(
      releasedCard?.querySelector(".message-video-canonical-host[data-attachment-id]")
    ).toBeNull();

    pane.remove();
  });

  it("退场 owner 有冻结帧时，必须同时渲染 poster 安全网兜底，防止 canvas 绘制失败后卡片全黑", async () => {
    const pane = 创建媒体消息窗();
    const attachmentId = "att-video-poster-safety-net";
    const playback = {
      mode: "swarm",
      attachmentId,
      kind: "video",
      src: "http://media.local/swarm-video-poster-safety",
      thumbnailUrl: "http://media.local/poster-video-poster-safety",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [
      创建单视频消息项(attachmentId, 1),
      创建单视频消息项("att-video-next-owner-safety", 2),
    ];
    pane.mediaPlaybackByAttachmentId = {
      [attachmentId]: playback,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-next-owner-safety";
    pane.inlineAutoplayPositionByAttachmentId = {
      [attachmentId]: {
        src: playback.src,
        currentTime: 5.2,
        updatedAt: 1_800_000_000_000,
      },
    };
    (
      pane as unknown as {
        最近退场Owner附件Id: string | null;
      }
    ).最近退场Owner附件Id = attachmentId;
    const 画面缓存Owner = (
      pane as unknown as {
        时间线画面缓存Owner: {
          时间线自动播冻结帧: Map<
            string,
            {
              src: string;
              currentTime: number;
              bitmap: CanvasImageSource;
              width: number;
              height: number;
              updatedAt: number;
              dispose(): void;
            }
          >;
        };
      }
    ).时间线画面缓存Owner;
    Object.defineProperty(画面缓存Owner, "时间线自动播冻结帧", {
      configurable: true,
      value: new Map([
        [
          attachmentId,
          {
            src: playback.src,
            currentTime: 5.2,
            bitmap: document.createElement("canvas"),
            width: 320,
            height: 180,
            updatedAt: 1_800_000_000_001,
            dispose: vi.fn(),
          },
        ],
      ]),
    });

    document.body.appendChild(pane);
    await pane.updateComplete;

    const card = pane.querySelector<HTMLElement>(
      `.message-video-card[data-attachment-id="${attachmentId}"]`
    );
    const frozenFrame = card?.querySelector<HTMLCanvasElement>(
      `canvas.message-video-frozen-frame[data-attachment-id="${attachmentId}"]`
    );
    const poster = card?.querySelector<HTMLImageElement>(
      `img.message-video-poster[data-attachment-id="${attachmentId}"]`
    );

    /**
     * 冻结帧仍是首要可见表面（z-index: 2，position: absolute 覆盖在上）；
     * 但 poster 必须同时存在于 DOM 里作为安全网（z-index: 0，position: relative）：
     * 如果 canvas drawImage 因 bitmap disposed / context lost 失败，
     * poster 透过透明 canvas 底部兜住整张卡片，避免用户看到纯黑背景。
     */
    expect(frozenFrame).not.toBeNull();
    expect(poster).not.toBeNull();
    expect(poster?.src).toContain("poster-video-poster-safety");

    pane.remove();
  });
});
