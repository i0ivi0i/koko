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
    const frozenFrameSrc = "data:image/webp;base64,ZmFrZQ==";

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
            { src: string; currentTime: number; dataUrl: string; updatedAt: number }
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
            dataUrl: frozenFrameSrc,
            updatedAt: 1_715_000_000_001,
          },
        ],
      ]),
    });

    document.body.appendChild(pane);
    await pane.updateComplete;

    const frozenFrame = pane.querySelector<HTMLImageElement>(
      'img.message-video-frozen-frame[data-attachment-id="att-video-1"]'
    );
    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );

    expect(frozenFrame?.getAttribute("src")).toBe(frozenFrameSrc);
    expect(previewVideo).toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).toBeNull();

    pane.remove();
  });
  it("时间线冻结帧导出走异步 toBlob，避免同步 toDataURL 卡住滚动热路径", async () => {
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
    const toDataURL = vi.fn(() => {
      throw new Error("不应同步 toDataURL");
    });
    const toBlob = vi.fn((callback: BlobCallback) => {
      callback(new Blob(["freeze"], { type: "image/webp" }));
    });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob,
      toDataURL,
    } as unknown as HTMLCanvasElement;
    const 原始创建元素 = document.createElement.bind(document);
    const createElement = vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return canvas;
      }
      return 原始创建元素(tagName);
    });

    class 假FileReader {
      result: string | ArrayBuffer | null = null;
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

      readAsDataURL(): void {
        this.result = "data:image/webp;base64,freeze";
        queueMicrotask(() =>
          this.onload?.(undefined as unknown as ProgressEvent<FileReader>)
        );
      }
    }

    vi.stubGlobal("FileReader", 假FileReader);

    try {
      const 画面缓存Owner = (
        pane as unknown as {
          时间线画面缓存Owner: {
            捕获自动播冻结帧(attachmentId: string, video: HTMLVideoElement): void;
            时间线自动播冻结帧: Map<string, { dataUrl: string }>;
          };
        }
      ).时间线画面缓存Owner;
      画面缓存Owner.捕获自动播冻结帧("att-freeze-async", video);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(drawImage).toHaveBeenCalledTimes(1);
      expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.82);
      expect(toDataURL).not.toHaveBeenCalled();
      expect(
        画面缓存Owner.时间线自动播冻结帧.get("att-freeze-async")?.dataUrl
      ).toBe("data:image/webp;base64,freeze");
    } finally {
      createElement.mockRestore();
      vi.unstubAllGlobals();
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
     * 这里只锁“冷 owner 且没有稳定像素底板”的特例：
     * 1. 当时间线 playback 事实还没回灌，且没有真实海报、运行时预览、冻结帧和已 ready 首帧时，
     *    默认占位图不足以证明 canonical 可以直接露给用户；
     * 2. 这时唯一播放器必须先在隐藏宿主里完成首帧预热，卡片表面只保留冷态占位；
     * 3. 一旦存在真实海报或既有连续性证据，仍然允许复用原有显露路径，不把正常交接一起误伤。
     */
    expect(visibleCanonicalHost).toBeNull();
    expect(hiddenStageHost).not.toBeNull();
    expect(previewVideo).toBeNull();
    expect(posterCover?.getAttribute("src")).toContain("data:image/svg+xml");
    expect(posterCover?.classList.contains("message-video-poster--canonical-cover")).toBe(true);

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
            { src: string; currentTime: number; dataUrl: string; updatedAt: number }
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
            dataUrl: "data:image/webp;base64,single-slot-freeze",
            updatedAt: 1_777_500_000_401,
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
    const frozenFrame = card?.querySelector<HTMLImageElement>(
      `img.message-video-frozen-frame[data-attachment-id="${attachmentId}"]`
    );
    const warmupPreview = card?.querySelector<HTMLVideoElement>(
      `video.message-video-preview[data-attachment-id="${attachmentId}"]:not([data-canonical-player="true"])`
    );

    expect(visibleHost).not.toBeNull();
    expect(visibleHost?.dataset.covered).toBe("true");
    expect(frozenFrame?.getAttribute("src")).toBe("data:image/webp;base64,single-slot-freeze");
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
            { src: string; currentTime: number; dataUrl: string; updatedAt: number }
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
            dataUrl: "data:image/webp;base64,retiring-hold-frame",
            updatedAt: 1_777_500_000_101,
          },
        ],
      ]),
    });

    document.body.appendChild(pane);
    await pane.updateComplete;

    const releasedCard = pane.querySelector<HTMLElement>(
      `.message-video-card[data-attachment-id="${releasedAttachmentId}"]`
    );
    const releasedFrozenFrame = releasedCard?.querySelector<HTMLImageElement>(
      `img.message-video-frozen-frame[data-attachment-id="${releasedAttachmentId}"]`
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
    expect(releasedFrozenFrame?.getAttribute("src")).toBe(
      "data:image/webp;base64,retiring-hold-frame"
    );
    expect(releasedPreview).toBeNull();
    expect(releasedCard?.querySelector("img.message-video-poster")).toBeNull();
    expect(
      releasedCard?.querySelector(".message-video-canonical-host[data-attachment-id]")
    ).toBeNull();

    pane.remove();
  });
});
