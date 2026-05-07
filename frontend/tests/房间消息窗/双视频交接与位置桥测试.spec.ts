// @vitest-environment happy-dom

import { describe,expect,it,vi } from "vitest";
import { 读取默认全局唯一播放器 } from "../../媒体/全局唯一播放器";
import type { 媒体播放位置,媒体播放结果 } from "../../媒体/媒体播放";
import {
创建媒体消息窗,
创建媒体消息项,
驱动时间线Canonical就绪
} from "../common/房间消息窗媒体支架";

describe("房间消息窗媒体查看器 / 双视频交接与位置桥", () => {

  it("canonical 历史接管缓存不能跳过当前 DOM 的 cover 门禁", async () => {
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
    ).not.toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();
    expect(restoredVideo?.dataset.canonicalPlayer).toBe("true");
    expect(
      pane.querySelector('.message-video-canonical-stage-host[data-attachment-id="att-video-1"]')
    ).toBeNull();

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
     * 同一条视频因滚动离屏释放 owner 后再回到 owner 时：
     * 1. canonical 直接回到可见宿主下面；
     * 2. 用户可见面仍由暂停预览帧承接；
     * 3. 真正露出 live video 仍要等可见宿主自己出帧，不能靠历史 reveal 直接裸切。
     */
    expect(reacquireVisibleHost).not.toBeNull();
    expect(reacquireVisibleHost?.dataset.videoSrc).toBe(playback.src);
    expect(reacquireStageHost).toBeNull();
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
});
