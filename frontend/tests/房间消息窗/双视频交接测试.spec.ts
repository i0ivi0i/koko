// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { 媒体播放结果, 媒体播放位置 } from "../../媒体/媒体播放";
import type { 房间消息窗 } from "../../房间消息窗/壳";
import { 读取默认全局唯一播放器 } from "../../媒体/全局唯一播放器";
import {
  创建单视频消息项,
  创建媒体消息窗,
  创建媒体消息项,
  等待时间线唯一播放器挂载,
  驱动时间线Canonical就绪,
} from "../common/房间消息窗媒体支架";

describe("房间消息窗媒体查看器 - 双视频交接", () => {
  it("canonical 历史接管缓存不能让未 ready 的当前 DOM 直接可见", async () => {
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
    (
      pane as unknown as {
        时间线唯一播放器可见接管就绪源: Map<string, string>;
      }
    ).时间线唯一播放器可见接管就绪源.set("att-video-1", playback.src);

    document.body.appendChild(pane);
    await pane.updateComplete;

    const restoredVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-1"]')
    ).toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).toBeNull();
    expect(restoredVideo?.getAttribute("poster")).toBe("http://media.local/poster-video-1");

    pane.remove();
  });

  it("双视频 owner 交接时，旧 owner 退场后不会留下第二颗真实 preview video", async () => {
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
            originalSrc: "http://media.local/original-video-1",
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
            originalSrc: "http://media.local/original-video-2",
            posterSrc: "http://media.local/poster-video-2",
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback1,
      "att-video-2": playback2,
    };
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback1,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: playback1.src,
        currentTime: 31.25,
        updatedAt: 100,
      },
      "att-video-2": {
        src: playback2.src,
        currentTime: 12.5,
        updatedAt: 100,
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const oldOwnerPreview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );
    expect(oldOwnerPreview).toBeNull();
    await 驱动时间线Canonical就绪(pane, "att-video-1");

    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-2": playback2,
    };
    await pane.updateComplete;

    const releasedPreview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );

    /**
     * 这条回归直接锁真实 root cause：
     * 1. 旧 owner 退场时不能重建 preview `<video>` 节点；
     * 2. runtime snapshot 晚一拍时，只能靠位置桥和冻结帧承接；
     * 3. 否则用户看到的就是双视频表面互相抢像素。
     */
    expect(releasedPreview).toBeNull();
    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-1"]')
    ).toBeNull();

    pane.remove();
  });

  it("双视频 owner 交接时，会先向唯一播放器拿到最后一拍 flush，再对齐旧 owner 的 preview 底板", async () => {
    const pane = 创建媒体消息窗();
    const 全局唯一播放器 = 读取默认全局唯一播放器();
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
            originalSrc: "http://media.local/original-video-1",
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
            originalSrc: "http://media.local/original-video-2",
            posterSrc: "http://media.local/poster-video-2",
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback1,
      "att-video-2": playback2,
    };
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback1,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: playback1.src,
        currentTime: 31.25,
        updatedAt: 100,
      },
      "att-video-2": {
        src: playback2.src,
        currentTime: 12.5,
        updatedAt: 100,
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const oldOwnerPreview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );
    expect(oldOwnerPreview).toBeNull();
    await 驱动时间线Canonical就绪(pane, "att-video-1");

    const pane内部探针 = pane as any as {
      自动播位置上报记录: Map<
        string,
        { src: string; currentTime: number; reportedAt: number }
      >;
    };
    const 冲刷时间线位置Spy = vi
      .spyOn(全局唯一播放器, "冲刷当前时间线播放位置")
      .mockImplementation(() => {
        pane内部探针.自动播位置上报记录.set("att-video-1", {
          src: playback1.src,
          currentTime: 36.5,
          reportedAt: 200,
        });
      });

    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-2": playback2,
    };
    await pane.updateComplete;

    const releasedPreview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );

    /**
     * 这条测试直接锁 sequencing root cause：
     * 1. 如果不先 flush，旧 owner 的位置桥会慢一拍；
     * 2. 退场后不能再靠 preview video 补救；
     * 3. 正确顺序必须是：先 flush -> 捕获冻结帧/位置 -> 再撤可见 canonical host。
     */
    expect(冲刷时间线位置Spy).toHaveBeenCalledTimes(1);
    expect(releasedPreview).toBeNull();

    冲刷时间线位置Spy.mockRestore();
    pane.remove();
  });

  it("读取自动播恢复位置时，同源本地位置桥会压过慢一拍的外层 snapshot", async () => {
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
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: playback.src,
        currentTime: 31.25,
        updatedAt: 100,
      },
    };

    const pane内部探针 = pane as any as {
      自动播位置上报记录: Map<
        string,
        { src: string; currentTime: number; reportedAt: number }
      >;
      读取自动播恢复位置(attachmentId: string, src: string | null): 媒体播放位置 | null;
    };
    pane内部探针.自动播位置上报记录.set("att-video-1", {
      src: playback.src,
      currentTime: 36.5,
      reportedAt: 200,
    });

    /**
     * 这条测试只锁位置桥裁决本身，不和 owner 交接副作用绑在一起：
     * - 外层 snapshot 慢一拍时；
     * - 本地刚 flush 的同源位置更近；
     * - 读取恢复位置必须优先拿本地那条。
     */
    expect(
      pane内部探针.读取自动播恢复位置("att-video-1", playback.src)?.currentTime
    ).toBeCloseTo(36.5, 2);
  });

  it("有 poster 的视频保存位置为 currentSrc 绝对地址时，也能匹配相对 swarm 源显示保存帧", async () => {
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
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: new URL(playback.src, window.location.href).href,
        currentTime: 19.75,
        updatedAt: Date.now(),
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const preview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(preview).not.toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).toBeNull();
    expect(preview?.getAttribute("poster")).toBe("http://media.local/poster-video-1");
    expect(preview?.autoplay).toBe(false);

    preview!.dispatchEvent(new Event("loadedmetadata"));
    expect(preview!.currentTime).toBeCloseTo(19.75, 2);
    Object.defineProperty(preview!, "readyState", {
      configurable: true,
      value: 4,
    });
    preview!.dispatchEvent(new Event("loadeddata"));
    await pane.updateComplete;
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).toBeNull();

    pane.remove();
  });

  it("有保存位置时，自动播 owner 切换前后仍保持同一条 canonical swarm src，不在绝对/相对地址之间抖动", async () => {
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
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback,
    };
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: new URL(playback.src, window.location.href).href,
        currentTime: 19.75,
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
    expect(ownerVideo?.getAttribute("src")).toBe(playback.src);

    pane.inlineAutoplayOwnerAttachmentId = null;
    await pane.updateComplete;

    const releasedVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(releasedVideo).toBeNull();

    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    await pane.updateComplete;

    const reacquireStageHost = pane.querySelector<HTMLElement>(
      '.message-video-canonical-stage-host[data-attachment-id="att-video-1"]'
    );
    const reacquireVisibleHost = pane.querySelector<HTMLElement>(
      '.message-video-canonical-host[data-attachment-id="att-video-1"]'
    );
    const reacquirePreviewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );
    /**
     * 同一条视频因滚动离屏释放 owner 后再回到 owner，也必须先走隐藏预热：
     * 1. 用户可见面继续由暂停预览帧承接；
     * 2. 唯一播放器在隐藏宿主里恢复 source/time；
     * 3. 等 canonical 真正 canplay 后才揭帘，不能在可见卡片上现场 load/seek/play。
     */
    expect(reacquireVisibleHost).toBeNull();
    expect(reacquireStageHost).not.toBeNull();
    expect(reacquireStageHost?.dataset.stageHost).toBe("true");
    expect(reacquireStageHost?.dataset.videoSrc).toBe(playback.src);
    expect(reacquirePreviewVideo).toBeNull();

    const reacquiredVideo = await 驱动时间线Canonical就绪(pane, "att-video-1");
    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-1"]')
    ).not.toBeNull();
    expect(
      pane.querySelector('.message-video-canonical-stage-host[data-attachment-id="att-video-1"]')
    ).toBeNull();
    expect(reacquiredVideo?.dataset.canonicalPlayer).toBe("true");
    expect(reacquiredVideo?.autoplay).toBe(true);
    expect(reacquiredVideo?.getAttribute("src")).toBe(playback.src);

    pane.remove();
  });

  it("初次自动播 owner 的 canonical 未就绪时，稳定 poster 必须盖住黑壳且不新增第二颗 video", async () => {
    const pane = 创建媒体消息窗();
    const playback = {
      mode: "swarm",
      attachmentId: "att-video-initial-hidden",
      kind: "video",
      src: "/webtorrent/demo-infohash-initial/content-demo-initial.mp4",
      thumbnailUrl: "http://media.local/poster-initial-hidden",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [创建单视频消息项("att-video-initial-hidden", 1)];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-initial-hidden": playback,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-initial-hidden";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-initial-hidden": playback,
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const visibleHost = pane.querySelector<HTMLElement>(
      '.message-video-canonical-host[data-attachment-id="att-video-initial-hidden"]'
    );
    const poster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-initial-hidden"]'
    );
    const extraPreviewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-initial-hidden"]:not([data-canonical-player="true"])'
    );

    expect(visibleHost).not.toBeNull();
    expect(extraPreviewVideo).toBeNull();
    expect(poster?.getAttribute("src")).toBe(playback.thumbnailUrl);
    expect(poster?.classList.contains("message-video-poster--canonical-cover")).toBe(true);

    const readyVideo = await 驱动时间线Canonical就绪(pane, "att-video-initial-hidden");
    expect(readyVideo?.dataset.canonicalPlayer).toBe("true");
    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-initial-hidden"]')
    ).not.toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-initial-hidden"]')
    ).toBeNull();

    pane.remove();
  });

  it("双视频自动播 owner 交接时，两边都保持 canonical swarm src，不在绝对/相对地址之间互相抖动", async () => {
    const pane = 创建媒体消息窗();
    const playback1 = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "/webtorrent/demo-infohash-1/content-demo-1.mp4",
      thumbnailUrl: "http://media.local/poster-video-1",
      hint: null,
    } satisfies 媒体播放结果;
    const playback2 = {
      mode: "swarm",
      attachmentId: "att-video-2",
      kind: "video",
      src: "/webtorrent/demo-infohash-2/content-demo-2.mp4",
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
            displayWidth: 320,
            displayHeight: 180,
            originalSrc: "http://media.local/original-video-1",
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
            displayWidth: 320,
            displayHeight: 180,
            originalSrc: "http://media.local/original-video-2",
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
      "att-video-1": {
        src: new URL(playback1.src, window.location.href).href,
        currentTime: 11.25,
        updatedAt: Date.now(),
      },
      "att-video-2": {
        src: new URL(playback2.src, window.location.href).href,
        currentTime: 22.5,
        updatedAt: Date.now(),
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const firstOwnerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    const secondPreviewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"]'
    );
    await 驱动时间线Canonical就绪(pane, "att-video-1");
    expect(
      pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-1"][data-canonical-player="true"]'
      )?.autoplay
    ).toBe(true);
    expect(firstOwnerVideo?.getAttribute("src")).toBe(playback1.src);
    expect(secondPreviewVideo?.autoplay).toBe(false);
    expect(secondPreviewVideo?.getAttribute("src")).toBe(playback2.src);

    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-2": playback2,
    };
    await pane.updateComplete;
    await 驱动时间线Canonical就绪(pane, "att-video-2");

    const firstReleasedVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    const secondOwnerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"][data-canonical-player="true"]'
    );
    expect(firstReleasedVideo).toBeNull();
    /**
     * 新 owner 这侧允许继续复用原来的预览节点，把 canonical 标记和 autoplay 直接提升上去；
     * 只要 swarm src 没抖、且最终只有一颗 canonical player，就比“先删预览再插入新节点”更丝滑。
     */
    expect(secondOwnerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(secondOwnerVideo?.autoplay).toBe(true);
    expect(secondOwnerVideo?.getAttribute("src")).toBe(playback2.src);

    pane.remove();
  });

  it("双视频自动播 owner 交接时，即便新 owner 的 autoplay playback 晚一拍回灌，也不会先删除目标卡片自己的预览帧", async () => {
    const pane = 创建媒体消息窗();
    const 全局唯一播放器 = 读取默认全局唯一播放器();
    const 同步时间线自动播Spy = vi.spyOn(全局唯一播放器, "同步时间线自动播");
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
            displayWidth: 320,
            displayHeight: 180,
            originalSrc: "http://media.local/original-video-1",
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
            displayWidth: 320,
            displayHeight: 180,
            originalSrc: "http://media.local/original-video-2",
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

    const 切换前预览视频 = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"]'
    );
    expect(切换前预览视频).not.toBeNull();
    切换前预览视频!.dispatchEvent(new Event("loadedmetadata"));
    expect(切换前预览视频?.currentTime).toBeCloseTo(22.5, 2);

    同步时间线自动播Spy.mockClear();
    /**
     * 真实闪烁链就是这里：
     * 1. 旧 owner 已经退场；
     * 2. 新 owner 的 autoplay playback 结果还没回灌；
     * 3. 但它其实已经有同文件 swarm 预览源，不该先把唯一播放器打成 null。
     */
    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    await pane.updateComplete;

    const 交接调用序列 = 同步时间线自动播Spy.mock.calls.map(([input]) =>
      input ? input.attachmentId : null
    );
    const 新Owner可见宿主 = pane.querySelector<HTMLElement>(
      '.message-video-canonical-host[data-attachment-id="att-video-2"]'
    );
    const 新Owner隐藏预热宿主 = pane.querySelector<HTMLElement>(
      '.message-video-canonical-stage-host[data-attachment-id="att-video-2"]'
    );
    const 新Owner预览视频 = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"]:not([data-canonical-player="true"])'
    );
    const 新Owner播放指示器 = pane.querySelector(
      '.message-video-card[data-attachment-id="att-video-2"] .message-video-play-indicator'
    );

    expect(交接调用序列).not.toContain(null);
    expect(交接调用序列.at(-1)).toBe("att-video-2");
    expect(新Owner可见宿主).toBeNull();
    expect(新Owner隐藏预热宿主).not.toBeNull();
    expect(新Owner隐藏预热宿主?.dataset.videoSrc).toBe(playback2.src);
    expect(新Owner隐藏预热宿主?.dataset.stageHost).toBe("true");
    expect(新Owner预览视频).toBe(切换前预览视频);
    expect(新Owner预览视频?.autoplay).toBe(false);
    expect(新Owner预览视频?.getAttribute("src")).toBe(playback2.src);
    expect(新Owner预览视频?.currentTime).toBeCloseTo(22.5, 2);
    expect(新Owner播放指示器).toBeNull();

    pane.remove();
  });

  it("自动播 owner 仍存在但当前虚拟窗口没有宿主时，不会把唯一播放器同步成 null", async () => {
    const pane = 创建媒体消息窗();
    const 全局唯一播放器 = 读取默认全局唯一播放器();
    const 同步时间线自动播Spy = vi.spyOn(全局唯一播放器, "同步时间线自动播");
    const 冲刷当前时间线播放位置Spy = vi.spyOn(
      全局唯一播放器,
      "冲刷当前时间线播放位置"
    );
    const 暂停当前时间线播放Spy = vi.spyOn(全局唯一播放器, "暂停当前时间线播放");
    同步时间线自动播Spy.mockClear();
    冲刷当前时间线播放位置Spy.mockClear();
    暂停当前时间线播放Spy.mockClear();
    const playback = {
      mode: "swarm",
      attachmentId: "att-video-owner-offscreen",
      kind: "video",
      src: "http://media.local/swarm-video-owner-offscreen",
      thumbnailUrl: "http://media.local/poster-video-owner-offscreen",
      hint: null,
    } satisfies 媒体播放结果;
    pane.items = [
      {
        ...创建媒体消息项(),
        id: "message-owner-offscreen",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-owner-offscreen",
            width: 1280,
            height: 720,
            displayWidth: 320,
            displayHeight: 180,
            originalSrc: "http://media.local/original-owner-offscreen",
            posterSrc: "http://media.local/poster-owner-offscreen",
          },
        ],
      },
      {
        ...创建媒体消息项(),
        id: "message-visible-other",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-visible-other",
            width: 1280,
            height: 720,
            displayWidth: 320,
            displayHeight: 180,
            originalSrc: "http://media.local/original-visible-other",
            posterSrc: "http://media.local/poster-visible-other",
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-owner-offscreen": playback,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-owner-offscreen";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-owner-offscreen": playback,
    };

    type 测试虚拟项 = { key: string; index: number; start: number };
    const 内部虚拟器 = (
      pane as unknown as {
        读取消息虚拟器(): { getVirtualItems(): 测试虚拟项[] };
      }
    ).读取消息虚拟器();
    vi.spyOn(内部虚拟器, "getVirtualItems").mockReturnValue([
      { key: "message-visible-other", index: 1, start: 240 },
    ]);

    document.body.appendChild(pane);
    await pane.updateComplete;

    const 同步调用序列 = 同步时间线自动播Spy.mock.calls.map(([input]) =>
      input ? input.attachmentId : null
    );
    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-owner-offscreen"]')
    ).toBeNull();
    expect(同步调用序列).not.toContain(null);
    expect(冲刷当前时间线播放位置Spy).not.toHaveBeenCalled();
    expect(暂停当前时间线播放Spy).toHaveBeenCalled();

    pane.remove();
  });

  it("双视频自动播 owner 交接时，如果目标卡片的预览真相仍是 missing_source，就禁止拿冷 playback video 当隐藏接管 cover", async () => {
    const pane = 创建媒体消息窗();
    const playback1 = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;
    const playback2 = {
      mode: "swarm",
      attachmentId: "att-video-2",
      kind: "video",
      src: "http://media.local/swarm-video-2",
      thumbnailUrl: null,
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
            displayWidth: 320,
            displayHeight: 180,
            originalSrc: "http://media.local/original-video-1",
            posterSrc: null,
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
            displayWidth: 320,
            displayHeight: 180,
            originalSrc: "http://media.local/original-video-2",
            posterSrc: null,
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback1,
      "att-video-2": playback2,
    };
    (
      pane as 房间消息窗 & {
        mediaPreviewByAttachmentId: Record<string, { phase: "missing_source" }>;
      }
    ).mediaPreviewByAttachmentId = {
      "att-video-2": { phase: "missing_source" },
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback1,
    };

    document.body.appendChild(pane);
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    await pane.updateComplete;

    expect(
      pane.querySelector('.message-video-canonical-stage-host[data-attachment-id="att-video-2"]')
    ).toBeNull();
    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-2"]')
    ).not.toBeNull();
    expect(
      pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-2"]:not([data-canonical-player="true"])'
      )
    ).toBeNull();

    pane.remove();
  });

  it("missing_source 卡片即使保留了历史续播位置，也禁止把它泄漏成通用 preview 底板", async () => {
    const pane = 创建媒体消息窗();
    const playback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: null,
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
            displayWidth: 320,
            displayHeight: 180,
            originalSrc: "http://media.local/original-video-1",
            posterSrc: null,
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback,
    };
    (
      pane as 房间消息窗 & {
        mediaPreviewByAttachmentId: Record<string, { phase: "missing_source" }>;
      }
    ).mediaPreviewByAttachmentId = {
      "att-video-1": { phase: "missing_source" },
    };
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: playback.src,
        currentTime: 18.6,
        updatedAt: 1_715_000_000_000,
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    expect(
      pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
      )
    ).toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    pane.remove();
  });
});
