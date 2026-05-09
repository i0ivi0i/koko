// @vitest-environment happy-dom

import { describe,expect,it,vi } from "vitest";
import type { 媒体播放结果 } from "../../媒体/媒体播放";
import {
创建媒体消息窗,
创建媒体消息项,
等待时间线唯一播放器挂载,
驱动时间线Canonical就绪
} from "../common/房间消息窗媒体支架";

describe("房间消息窗媒体查看器 / 海报预热与候选预算", () => {

  it("双视频自动播 owner 再次切回旧附件时，禁止复用上一次遗留的可见接管就绪缓存", async () => {
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
            displayWidth: 320,
            displayHeight: 569,
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
    Object.defineProperty(切换前预览视频!, "readyState", {
      configurable: true,
      value: 2,
    });

    const 旧附件残留就绪源 = new URL(playback2.src, window.location.href).href;
    const pane内部探针 = pane as any as {
      时间线唯一播放器可见接管就绪源: Map<string, string>;
    };
    pane内部探针.时间线唯一播放器可见接管就绪源.set(
      "att-video-2",
      旧附件残留就绪源
    );

    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-2": playback2,
    };
    await pane.updateComplete;

    /**
     * 真实房间里同一条附件会多次进出 owner。
     * reveal gate 只能认“这一次 handoff 刚刚确认就绪”的事实，
     * 但 canonical 宿主本身可以先挂在可见位下面，由当前 cover 继续挡住。
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

    pane.remove();
  });
  it(
    "双视频自动播 owner 交接时，会等 canonical 在可见宿主下自己出帧后才揭帘到新卡片",
    async () => {
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
      {
        ...创建媒体消息项(),
        id: "message-video-2",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-2",
            width: 1280,
            height: 720,
      layoutX: 0,
      layoutY: 0,
            displayWidth: 320,
            displayHeight: 180,
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
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-2": {
        src: playback2.src,
        currentTime: 22.5,
        updatedAt: Date.now(),
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    const 隐藏预热视频 = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"][data-canonical-player="true"]'
    );
    expect(隐藏预热视频).not.toBeNull();

    Object.defineProperty(隐藏预热视频!, "readyState", {
      configurable: true,
      value: 1,
    });
    隐藏预热视频!.dispatchEvent(new Event("loadedmetadata"));
    隐藏预热视频!.dispatchEvent(new Event("seeked"));
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-2"]')
    ).not.toBeNull();
    expect(
      pane.querySelector(
        '.message-video-canonical-stage-host[data-attachment-id="att-video-2"]'
      )
    ).toBeNull();

    let 首帧提交回调:
      | ((now: number, metadata: VideoFrameCallbackMetadata) => void)
      | null = null;
    Object.defineProperty(隐藏预热视频!, "requestVideoFrameCallback", {
      configurable: true,
      value: ((callback: (now: number, metadata: VideoFrameCallbackMetadata) => void) => {
        首帧提交回调 = callback;
        return 1;
      }) as unknown as HTMLVideoElement["requestVideoFrameCallback"],
    });
    Object.defineProperty(隐藏预热视频!, "readyState", {
      configurable: true,
      value: 3,
    });
    隐藏预热视频!.dispatchEvent(new Event("canplay"));
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    /**
     * 进入自动播时真正需要的是“这帧已经提交给屏幕”，而不是只收到了 canplay：
     * 1. canonical 可以先挂在可见宿主下面；
     * 2. 但 RVFC 回来前，cover 仍必须继续顶住，不能把 live video 裸露给用户；
     * 3. 所以这里仍只验证“揭帘不能提前发生”，而不是要求继续走 stage host。
     */
    expect(首帧提交回调).not.toBeNull();
    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-2"]')
    ).not.toBeNull();
    expect(
      pane.querySelector(
        '.message-video-canonical-stage-host[data-attachment-id="att-video-2"]'
      )
    ).toBeNull();

    const 已登记首帧提交回调 =
      首帧提交回调 as unknown as (
        now: number,
        metadata: VideoFrameCallbackMetadata
      ) => void;
    已登记首帧提交回调(0, {
      presentedFrames: 1,
      expectedDisplayTime: 0,
      presentationTime: 0,
      width: 320,
      height: 180,
      mediaTime: 22.5,
      processingDuration: 0,
      captureTime: 0,
      receiveTime: 0,
      rtpTimestamp: 0,
    } as VideoFrameCallbackMetadata);
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    const 揭帘后可见宿主 = pane.querySelector<HTMLElement>(
      '.message-video-canonical-host[data-attachment-id="att-video-2"]'
    );
    const 揭帘后隐藏预热宿主 = pane.querySelector<HTMLElement>(
      '.message-video-canonical-stage-host[data-attachment-id="att-video-2"]'
    );
    const 揭帘后Canonical视频 = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"][data-canonical-player="true"]'
    );
    const 揭帘后预览视频 = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"]:not([data-canonical-player="true"])'
    );

    expect(揭帘后可见宿主).not.toBeNull();
    expect(揭帘后隐藏预热宿主).toBeNull();
    expect(揭帘后Canonical视频).toBe(隐藏预热视频);
    expect(揭帘后Canonical视频?.autoplay).toBe(true);
    expect(揭帘后Canonical视频?.currentTime).toBeCloseTo(22.5, 2);
    expect(揭帘后预览视频 === null || 揭帘后预览视频?.dataset.canonicalPlayer !== "true").toBe(
      true
    );

    揭帘后Canonical视频?.dispatchEvent(new Event("playing"));
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    const 可见宿主首帧提交回调 =
      首帧提交回调 as unknown as (
        now: number,
        metadata: VideoFrameCallbackMetadata
      ) => void;
    可见宿主首帧提交回调(1, {
      presentedFrames: 2,
      expectedDisplayTime: 0,
      presentationTime: 0,
      width: 320,
      height: 180,
      mediaTime: 22.5,
      processingDuration: 0,
      captureTime: 0,
      receiveTime: 0,
      rtpTimestamp: 1,
    } as VideoFrameCallbackMetadata);
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    expect(
      pane.querySelector(
        'video.message-video-preview[data-attachment-id="att-video-2"]:not([data-canonical-player="true"])'
      )
    ).toBeNull();

      pane.remove();
    },
    10_000
  );
  it("有 poster 的 swarm 视频在未成为 owner 前继续显示 poster overlay，不裸露 playback.src 冷帧", async () => {
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

    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    const previewPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(previewVideo).not.toBeNull();
    expect(previewVideo?.getAttribute("src")).toBe(playback.src);
    expect(previewPoster).not.toBeNull();
    expect(previewPoster?.getAttribute("src")).toBe("http://media.local/poster-video-1");

    pane.remove();
  });
  it("有 poster 的 swarm 视频成为 owner 前后，会先保留 poster 直到 canonical ready", async () => {
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

    document.body.appendChild(pane);
    await pane.updateComplete;

    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-1"]')
    ).toBeNull();
    expect(
      pane.querySelector('video.message-video-preview[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    await pane.updateComplete;

    const ownerVideo = await 驱动时间线Canonical就绪(pane, "att-video-1");
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(ownerVideo?.getAttribute("poster")).toBeNull();
    expect(ownerVideo?.autoplay).toBe(true);
    /* poster 有封面就永远渲染（z:0），canonical (z:3) 自然遮住 */
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    pane.remove();
  });

  it("历史首帧就绪源不能单独把有 poster 的冷 owner 提前揭帘", async () => {
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

    document.body.appendChild(pane);
    await pane.updateComplete;
    (
      pane as unknown as {
        时间线画面缓存Owner: {
          标记首帧已就绪(attachmentId: string, src: string | null): void;
        };
        时间线隐藏接管附件Id: string | null;
      }
    ).时间线画面缓存Owner.标记首帧已就绪("att-video-1", playback.src);
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback,
    };
    (
      pane as unknown as {
        时间线隐藏接管附件Id: string | null;
      }
    ).时间线隐藏接管附件Id = "att-video-1";
    await pane.updateComplete;

    /**
     * 这里只给“历史 ready 过这条 src”这一个事实，不给当前 DOM committed frame：
     * 1. 旧 ready 结论只能说明这条源曾经可播过；
     * 2. 不能因此把新 owner 直接揭成 `covered=false`；
     * 3. 也不能提前长一颗黑底 preview video 去顶掉 poster。
     */
    const 冷首轮状态 = {
      posterPresent: Boolean(
        pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
      ),
      previewPresent: Boolean(
        pane.querySelector(
          'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
        )
      ),
      canonicalPresent: Boolean(
        pane.querySelector(
          'video.message-video-preview[data-attachment-id="att-video-1"][data-canonical-player="true"]'
        )
      ),
      canonicalPoster:
        pane
          .querySelector<HTMLVideoElement>(
            'video.message-video-preview[data-attachment-id="att-video-1"][data-canonical-player="true"]'
          )
          ?.getAttribute("poster") ?? null,
      canonicalHostCovered:
        pane
          .querySelector('.message-video-canonical-host[data-attachment-id="att-video-1"]')
          ?.getAttribute("data-covered") ?? null,
      stageHostPresent: Boolean(
        pane.querySelector('.message-video-canonical-stage-host[data-attachment-id="att-video-1"]')
      ),
    };
    expect(冷首轮状态).toMatchObject({
      posterPresent: true,
      previewPresent: false,
      canonicalHostCovered: "true",
    });

    pane.remove();
  });
  it("有 poster 的 swarm 视频进入自动播预热窗口时，会把同一颗 video 提前提升到 auto preload", async () => {
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

    document.body.appendChild(pane);
    await pane.updateComplete;

    const trigger = pane.querySelector<HTMLButtonElement>(
      'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
    );
    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(trigger).not.toBeNull();
    expect(previewVideo).not.toBeNull();
    expect(previewVideo?.preload).toBe("metadata");

    Object.defineProperty(previewVideo!, "readyState", {
      configurable: true,
      value: HTMLMediaElement.HAVE_METADATA,
    });
    Object.defineProperty(previewVideo!, "networkState", {
      configurable: true,
      value: HTMLMediaElement.NETWORK_IDLE,
    });
    const loadSpy = vi.spyOn(previewVideo!, "load").mockImplementation(() => {});

    (
      pane as unknown as {
        预热时间线视频首帧(button: HTMLButtonElement, attachmentId: string): void;
      }
    ).预热时间线视频首帧(trigger!, "att-video-1");

    expect(previewVideo?.preload).toBe("auto");
    expect(loadSpy).toHaveBeenCalledTimes(1);

    loadSpy.mockRestore();
    pane.remove();
  });
  it("自动播首帧预热只提升排序后的少数候选，避免滚动时批量 load 视频", async () => {
    const pane = 创建媒体消息窗();
    const 创建播放 = (attachmentId: string): 媒体播放结果 => ({
      mode: "swarm",
      attachmentId,
      kind: "video",
      src: `http://media.local/swarm-${attachmentId}`,
      thumbnailUrl: `http://media.local/poster-${attachmentId}`,
      hint: null,
    });
    pane.items = [
      {
        ...创建媒体消息项(),
        id: "message-preheat-budget",
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
            posterSrc: "http://media.local/poster-att-video-1",
          },
          {
            kind: "video",
            attachmentId: "att-video-2",
            width: 1280,
            height: 720,
      layoutX: 0,
      layoutY: 0,
            displayWidth: 320,
            displayHeight: 180,
            posterSrc: "http://media.local/poster-att-video-2",
          },
          {
            kind: "video",
            attachmentId: "att-video-3",
            width: 1280,
            height: 720,
      layoutX: 0,
      layoutY: 0,
            displayWidth: 320,
            displayHeight: 180,
            posterSrc: "http://media.local/poster-att-video-3",
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": 创建播放("att-video-1"),
      "att-video-2": 创建播放("att-video-2"),
      "att-video-3": 创建播放("att-video-3"),
    };

    document.body.appendChild(pane);
    await pane.updateComplete;
    const syntheticThirdTrigger = document.createElement("button");
    syntheticThirdTrigger.className = "message-video-preview-trigger";
    syntheticThirdTrigger.dataset.attachmentId = "att-video-3";
    const syntheticThirdVideo = document.createElement("video");
    syntheticThirdVideo.className = "message-video-preview";
    syntheticThirdVideo.dataset.attachmentId = "att-video-3";
    syntheticThirdVideo.src = "http://media.local/swarm-att-video-3";
    syntheticThirdVideo.preload = "metadata";
    syntheticThirdTrigger.append(syntheticThirdVideo);
    pane.append(syntheticThirdTrigger);

    const 读取预览视频 = (attachmentId: string) =>
      pane.querySelector<HTMLVideoElement>(
        `video.message-video-preview[data-attachment-id="${attachmentId}"]`
      );
    const firstVideo = 读取预览视频("att-video-1");
    const secondVideo = 读取预览视频("att-video-2");
    const thirdVideo = 读取预览视频("att-video-3");
    expect(firstVideo).not.toBeNull();
    expect(secondVideo).not.toBeNull();
    expect(thirdVideo).not.toBeNull();
    const videos = [firstVideo!, secondVideo!, thirdVideo!];
    for (const video of videos) {
      Object.defineProperty(video, "readyState", {
        configurable: true,
        value: HTMLMediaElement.HAVE_METADATA,
      });
    }
    const loadSpies = videos.map((video) => vi.spyOn(video, "load").mockImplementation(() => {}));

    (
      pane as unknown as {
        预热自动播候选首帧(
          candidates: Array<{
            attachmentId: string;
            visibilityRatio: number;
            distanceToViewportCenter: number;
          }>
        ): void;
      }
    ).预热自动播候选首帧([
      { attachmentId: "att-video-2", visibilityRatio: 0.9, distanceToViewportCenter: 4 },
      { attachmentId: "att-video-1", visibilityRatio: 0.8, distanceToViewportCenter: 8 },
      { attachmentId: "att-video-3", visibilityRatio: 0.7, distanceToViewportCenter: 12 },
    ]);

    expect(secondVideo?.preload).toBe("auto");
    expect(firstVideo?.preload).toBe("auto");
    expect(thirdVideo?.preload).toBe("metadata");
    expect(loadSpies[1]).toHaveBeenCalledTimes(1);
    expect(loadSpies[0]).toHaveBeenCalledTimes(1);
    expect(loadSpies[2]).not.toHaveBeenCalled();

    loadSpies.forEach((spy) => spy.mockRestore());
    pane.remove();
  });
  it("有 poster 的 swarm 视频首帧事件回抛 currentSrc 绝对地址时，也能识别为同源并移除 poster", async () => {
    const pane = 创建媒体消息窗();
    const playback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "/webtorrent/demo-infohash/content-demo.mp4",
      thumbnailUrl: "http://media.local/poster-video-1",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [创建媒体消息项()];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback,
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(previewVideo).not.toBeNull();
    expect(previewVideo?.getAttribute("poster")).toBe("http://media.local/poster-video-1");

    Object.defineProperty(previewVideo!, "currentSrc", {
      configurable: true,
      value: new URL(playback.src, window.location.href).href,
    });
    Object.defineProperty(previewVideo!, "readyState", {
      configurable: true,
      value: 4,
    });
    previewVideo!.dispatchEvent(new Event("loadeddata"));
    await pane.updateComplete;

    const readyPreviewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(readyPreviewVideo?.getAttribute("poster")).toBeNull();

    pane.remove();
  });
  it("有 poster 的 swarm 视频从预览切到自动播时复用同一颗 video 节点", async () => {
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

    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(previewVideo).not.toBeNull();
    expect(previewVideo?.autoplay).toBe(false);

    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    const ownerWarmupVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );
    expect(ownerWarmupVideo).toBeNull();
    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-1"]')
    ).not.toBeNull();
    expect(
      pane.querySelector('.message-video-canonical-stage-host[data-attachment-id="att-video-1"]')
    ).toBeNull();
    const ownerVideo = await 驱动时间线Canonical就绪(pane, "att-video-1");
    expect(ownerVideo).not.toBe(previewVideo);
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(ownerVideo?.autoplay).toBe(true);

    pane.remove();
  });
  it("自动播 owner 暂退且播放快照还未回灌时，仍用保存的同源视频帧而不是退回 poster", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [创建媒体消息项()];
    pane.inlineAutoplayOwnerAttachmentId = null;
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    pane.mediaPlaybackByAttachmentId = {};
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: "http://media.local/swarm-video-1",
        currentTime: 31.25,
        updatedAt: Date.now(),
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const restoredVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(restoredVideo).not.toBeNull();
    expect(restoredVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(restoredVideo?.autoplay).toBe(false);
    /* poster 有封面就永远渲染（z:0），video (z:1) 自然遮住 */
    expect(
      pane.querySelector<HTMLImageElement>(
        'img.message-video-poster[data-attachment-id="att-video-1"]'
      )
    ).not.toBeNull();
    expect(restoredVideo?.getAttribute("poster")).toBe("http://media.local/poster-video-1");

    restoredVideo!.dispatchEvent(new Event("loadedmetadata"));
    expect(restoredVideo!.currentTime).toBeCloseTo(31.25, 2);
    Object.defineProperty(restoredVideo!, "readyState", {
      configurable: true,
      value: 4,
    });
    restoredVideo!.dispatchEvent(new Event("loadeddata"));
    await pane.updateComplete;
    expect(restoredVideo?.getAttribute("poster")).toBeNull();
    /* 出帧后 poster 仍在 DOM — z:1 video 遮住 z:0 poster */
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    pane.remove();
  });

  /**
   * T1: 非 owner 有封面 + 有预算时，<img> poster 和 <video> preview 必须共存于 DOM。
   * poster 在 z:0 作为兜底，video 在 z:1 有帧时自然遮住 poster。
   * 如果 poster 不在 DOM，video 未出帧前用户就看到黑卡片。
   */
  it("T1: 非 owner 有 poster 且被分配 preview 预算时，poster 和 preview video 共存于 DOM", async () => {
    const pane = 创建媒体消息窗();
    const 创建播放 = (attachmentId: string): 媒体播放结果 => ({
      mode: "swarm",
      attachmentId,
      kind: "video",
      src: `http://media.local/swarm-${attachmentId}`,
      thumbnailUrl: `http://media.local/poster-${attachmentId}`,
      hint: null,
    });
    pane.items = [
      {
        ...创建媒体消息项(),
        id: "msg-owner",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-owner",
            width: 1280,
            height: 720,
            layoutX: 0,
            layoutY: 0,
            displayWidth: 320,
            displayHeight: 180,
            posterSrc: "http://media.local/poster-att-owner",
          },
        ],
      },
      {
        ...创建媒体消息项(),
        id: "msg-non-owner",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-non-owner",
            width: 1280,
            height: 720,
            layoutX: 0,
            layoutY: 0,
            displayWidth: 320,
            displayHeight: 180,
            posterSrc: "http://media.local/poster-att-non-owner",
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-owner": 创建播放("att-owner"),
      "att-non-owner": 创建播放("att-non-owner"),
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-owner";

    document.body.appendChild(pane);
    await pane.updateComplete;

    const nonOwnerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-non-owner"]'
    );
    const nonOwnerPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-non-owner"]'
    );

    /* 两者必须共存：poster 兜底 + video 准备接管 */
    expect(nonOwnerVideo).not.toBeNull();
    expect(nonOwnerPoster).not.toBeNull();

    pane.remove();
  });

  /**
   * T2: 有保存播放位置但 video 未出帧时，<img> poster 必须存在于 DOM。
   * 旧逻辑基于"意图"压制 poster（shouldReuseSavedTimelineFrameAsPreview），
   * 导致 video 还没 decode 帧时就看到黑卡片。
   */
  it("T2: 非 owner 有 poster 且有保存播放位置、video 未出帧时，poster 存在于 DOM", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [创建媒体消息项()];
    pane.inlineAutoplayOwnerAttachmentId = null;
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    pane.mediaPlaybackByAttachmentId = {};
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: "http://media.local/swarm-video-1",
        currentTime: 31.25,
        updatedAt: Date.now(),
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    /* video 未出帧 → poster 必须兜底，不能黑卡片 */
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    pane.remove();
  });

  /**
   * T3: video 出帧后，poster 仍然留在 DOM（z-index 栈让 video 帧遮住 poster）。
   * 新策略"有封面就渲染"意味着 poster 永远不从 DOM 移除，
   * 这比"出帧后压制 poster"更简洁，且不会产生闪烁。
   */
  it("T3: 有保存位置的 video 出帧后，poster 仍在 DOM（z-index 栈让 video 帧遮住 poster）", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [创建媒体消息项()];
    pane.inlineAutoplayOwnerAttachmentId = null;
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    pane.mediaPlaybackByAttachmentId = {};
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: "http://media.local/swarm-video-1",
        currentTime: 31.25,
        updatedAt: Date.now(),
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const video = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    video!.dispatchEvent(new Event("loadedmetadata"));
    Object.defineProperty(video!, "readyState", { configurable: true, value: 4 });
    video!.dispatchEvent(new Event("loadeddata"));
    await pane.updateComplete;

    /* poster 仍在 DOM — 有封面就永远渲染，z:1 video 帧自然遮住 z:0 poster */
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    pane.remove();
  });
});
