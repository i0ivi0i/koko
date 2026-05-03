// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { 媒体播放位置 } from "../../媒体/媒体播放";
import { 创建媒体查看器 } from "../../媒体/媒体查看器";
import { 创建全局唯一播放器 } from "../../媒体/全局唯一播放器";
import {
  安装全屏DOM模拟,
  等待查询查看器关闭按钮,
  创建测试VideoJs播放器壳,
  等待查看器任务完成,
  清理媒体查看器测试环境,
} from "../common/媒体查看器支架";

describe("媒体查看器适配器 - 全局播放器归位与时间线交接", () => {
  afterEach(清理媒体查看器测试环境);

  it("当前自动播视频退出真全屏后，会沿用 viewer 关闭瞬间的最新时间回到消息流", async () => {
    安装全屏DOM模拟();
    const inlineMount = document.createElement("div");
    document.body.append(inlineMount);
    let 最新位置: 媒体播放位置 = {
      src: "blob:http://media.local/viewer-return-inline-1",
      currentTime: 32.866,
      updatedAt: 1_000,
    };
    const 记录播放位置 = vi.fn((video: HTMLVideoElement) => {
      最新位置 = {
        src: video.currentSrc || video.src,
        currentTime: video.currentTime,
        updatedAt: 最新位置.updatedAt + 1,
      };
    });
    const globalVideoPlayer = 创建全局唯一播放器({
      createVideoJsPlayerShell: vi.fn(() => 创建测试VideoJs播放器壳()),
    });

    globalVideoPlayer.同步时间线自动播({
      attachmentId: "att-video-viewer-return-inline-1",
      mountTarget: inlineMount,
      source: {
        kind: "file",
        src: "blob:http://media.local/viewer-return-inline-1",
        posterSrc: "http://media.local/poster-viewer-return-inline-1",
        width: 1280,
        height: 720,
      },
      回调: {
        恢复播放位置: (video) => {
          video.currentTime = 最新位置.currentTime;
        },
        广播播放位置: (video) => {
          记录播放位置(video);
        },
        标记首帧已就绪: () => undefined,
        广播媒体会话信号: () => undefined,
      },
    });
    await 等待查看器任务完成(6);
    const 初始InlineVideo = inlineMount.querySelector<HTMLVideoElement>("video");
    const 初始InlineContainer = globalVideoPlayer.读取容器元素();
    expect(初始InlineVideo).not.toBeNull();
    expect(初始InlineContainer).not.toBeNull();

    const viewer = 创建媒体查看器({
      globalVideoPlayer,
      onPlaybackPositionChanged: (_attachmentId, position) => {
        最新位置 = position;
      },
    });

    viewer.打开({
      startAttachmentId: "att-video-viewer-return-inline-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-viewer-return-inline-1",
          src: "blob:http://media.local/viewer-return-inline-1",
          posterSrc: "http://media.local/poster-viewer-return-inline-1",
          width: 1280,
          height: 720,
        },
      ],
    });
    await 等待查看器任务完成(6);

    const closeButton = await 等待查询查看器关闭按钮();
    const viewerVideo = document.body.querySelector<HTMLVideoElement>("video");
    expect(closeButton).not.toBeNull();
    expect(viewerVideo).not.toBeNull();

    viewerVideo!.currentTime = 36.854;
    closeButton?.click();
    await 等待查看器任务完成(6);

    const returnedVideo = inlineMount.querySelector<HTMLVideoElement>("video");
    expect(returnedVideo).not.toBeNull();
    expect(最新位置.currentTime).toBeCloseTo(36.854, 2);
    expect(returnedVideo!.currentTime).toBeCloseTo(36.854, 2);
    /**
     * spec 这里要求的不是“时间点看起来对了就行”，而是同一颗 canonical player 真正迁回消息流：
     * 1. 如果 viewer 关闭后 destroy 再重建，时间虽然能靠快照续上，但对象身份已经断了；
     * 2. 断对象就意味着 owner 真相没有全程迁移，后面仍可能长出换壳、掉帧或生命周期缝隙；
     * 3. 所以这里必须把 video/container 身份锁死，避免实现偷偷退化成“旧时间点 + 新壳”。
     */
    expect(returnedVideo).toBe(初始InlineVideo);
    expect(globalVideoPlayer.读取容器元素()).toBe(初始InlineContainer);

    viewer.销毁();
    globalVideoPlayer.销毁();
  });

  it("viewer 关闭时即便时间线 owner 暂时为空，也会等待归位窗口并复用同一颗 canonical 壳", async () => {
    vi.useFakeTimers();
    const inlineMount = document.createElement("div");
    const viewerMount = document.createElement("div");
    document.body.append(inlineMount, viewerMount);
    let 最新位置: 媒体播放位置 = {
      src: "blob:http://media.local/bridge-return-inline-1",
      currentTime: 12.345,
      updatedAt: 1_000,
    };
    const 记录播放位置 = vi.fn((video: HTMLVideoElement) => {
      最新位置 = {
        src: video.currentSrc || video.src,
        currentTime: video.currentTime,
        updatedAt: 最新位置.updatedAt + 1,
      };
    });
    const globalVideoPlayer = 创建全局唯一播放器({
      createVideoJsPlayerShell: vi.fn(() => 创建测试VideoJs播放器壳()),
    });
    const 时间线输入 = {
      attachmentId: "att-bridge-return-inline-1",
      mountTarget: inlineMount,
      source: {
        kind: "file" as const,
        src: "blob:http://media.local/bridge-return-inline-1",
        posterSrc: "http://media.local/poster-bridge-return-inline-1",
        width: 1280,
        height: 720,
      },
      回调: {
        恢复播放位置: (video: HTMLVideoElement) => {
          video.currentTime = 最新位置.currentTime;
        },
        广播播放位置: (video: HTMLVideoElement) => {
          记录播放位置(video);
        },
        标记首帧已就绪: () => undefined,
        广播媒体会话信号: () => undefined,
      },
    };

    try {
      globalVideoPlayer.同步时间线自动播(时间线输入);
      await 等待查看器任务完成(6);

      const 初始视频 = inlineMount.querySelector<HTMLVideoElement>("video");
      const 初始容器 = globalVideoPlayer.读取容器元素();
      expect(初始视频).not.toBeNull();
      expect(初始容器).not.toBeNull();

      const 查看器会话 = await globalVideoPlayer.接管查看器({
        attachmentId: "att-bridge-return-inline-1",
        mountTarget: viewerMount,
        source: 时间线输入.source,
        回调: {
          广播播放位置: (video: HTMLVideoElement) => {
            记录播放位置(video);
          },
          广播媒体会话信号: () => undefined,
        },
      });
      await 等待查看器任务完成(6);

      /**
       * 这里故意按真实链路重放那条会把对象弄断的顺序：
       * 1. viewer 打开后，runtime 会先把 inline owner 清空；
       * 2. viewer 随后关闭，inline owner 会在下一轮重算里回来；
       * 3. 如果唯一播放器在这个短窗口里立刻 destroy，就会退化成“旧壳销毁 + 新壳重建”。
       */
      globalVideoPlayer.同步时间线自动播(null);
      查看器会话.关闭();
      await Promise.resolve();

      expect(globalVideoPlayer.读取视频元素()).toBe(初始视频);
      expect(globalVideoPlayer.读取容器元素()).toBe(初始容器);

      globalVideoPlayer.同步时间线自动播(时间线输入);
      await 等待查看器任务完成(6);

      expect(inlineMount.querySelector("video")).toBe(初始视频);
      expect(globalVideoPlayer.读取视频元素()).toBe(初始视频);
      expect(globalVideoPlayer.读取容器元素()).toBe(初始容器);
      expect(最新位置.currentTime).toBeCloseTo(12.345, 2);
    } finally {
      globalVideoPlayer.销毁();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("viewer 关闭前重复收到空的时间线 sync 时，不会把待归位桥错误清掉", async () => {
    vi.useFakeTimers();
    const inlineMount = document.createElement("div");
    const viewerMount = document.createElement("div");
    document.body.append(inlineMount, viewerMount);
    let 最新位置: 媒体播放位置 = {
      src: "blob:http://media.local/bridge-return-inline-repeat-null-1",
      currentTime: 18.765,
      updatedAt: 1_000,
    };
    const globalVideoPlayer = 创建全局唯一播放器({
      createVideoJsPlayerShell: vi.fn(() => 创建测试VideoJs播放器壳()),
    });
    const 时间线输入 = {
      attachmentId: "att-bridge-return-inline-repeat-null-1",
      mountTarget: inlineMount,
      source: {
        kind: "file" as const,
        src: "blob:http://media.local/bridge-return-inline-repeat-null-1",
        posterSrc: "http://media.local/poster-bridge-return-inline-repeat-null-1",
        width: 1080,
        height: 1920,
      },
      回调: {
        恢复播放位置: (video: HTMLVideoElement) => {
          video.currentTime = 最新位置.currentTime;
        },
        广播播放位置: (video: HTMLVideoElement) => {
          最新位置 = {
            src: video.currentSrc || video.src,
            currentTime: video.currentTime,
            updatedAt: 最新位置.updatedAt + 1,
          };
        },
        标记首帧已就绪: () => undefined,
        广播媒体会话信号: () => undefined,
      },
    };

    try {
      globalVideoPlayer.同步时间线自动播(时间线输入);
      await 等待查看器任务完成(6);
      const 初始视频 = inlineMount.querySelector<HTMLVideoElement>("video");
      const 初始容器 = globalVideoPlayer.读取容器元素();
      expect(初始视频).not.toBeNull();
      expect(初始容器).not.toBeNull();

      const 查看器会话 = await globalVideoPlayer.接管查看器({
        attachmentId: "att-bridge-return-inline-repeat-null-1",
        mountTarget: viewerMount,
        source: 时间线输入.source,
        回调: {
          广播播放位置: (video: HTMLVideoElement) => {
            最新位置 = {
              src: video.currentSrc || video.src,
              currentTime: video.currentTime,
              updatedAt: 最新位置.updatedAt + 1,
            };
          },
          广播媒体会话信号: () => undefined,
        },
      });
      await 等待查看器任务完成(6);

      globalVideoPlayer.同步时间线自动播(null);
      globalVideoPlayer.同步时间线自动播(null);
      查看器会话.关闭();
      await Promise.resolve();

      globalVideoPlayer.同步时间线自动播(时间线输入);
      await 等待查看器任务完成(6);

      expect(inlineMount.querySelector("video")).toBe(初始视频);
      expect(globalVideoPlayer.读取视频元素()).toBe(初始视频);
      expect(globalVideoPlayer.读取容器元素()).toBe(初始容器);
      expect(最新位置.currentTime).toBeCloseTo(18.765, 2);
    } finally {
      globalVideoPlayer.销毁();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("viewer 已关闭但消息流宿主晚一拍归来时，后续空 sync 不会把同一颗壳提前销毁", async () => {
    vi.useFakeTimers();
    const inlineMount = document.createElement("div");
    const viewerMount = document.createElement("div");
    document.body.append(inlineMount, viewerMount);
    const globalVideoPlayer = 创建全局唯一播放器({
      createVideoJsPlayerShell: vi.fn(() => 创建测试VideoJs播放器壳()),
    });
    const 时间线输入 = {
      attachmentId: "att-bridge-return-inline-post-close-null-1",
      mountTarget: inlineMount,
      source: {
        kind: "file" as const,
        src: "blob:http://media.local/bridge-return-inline-post-close-null-1",
        posterSrc: "http://media.local/poster-bridge-return-inline-post-close-null-1",
        width: 1280,
        height: 720,
      },
      回调: {
        恢复播放位置: (video: HTMLVideoElement) => {
          video.currentTime = 21.5;
        },
        广播播放位置: () => undefined,
        标记首帧已就绪: () => undefined,
        广播媒体会话信号: () => undefined,
      },
    };

    try {
      globalVideoPlayer.同步时间线自动播(时间线输入);
      await 等待查看器任务完成(6);
      const 初始视频 = inlineMount.querySelector<HTMLVideoElement>("video");
      const 初始容器 = globalVideoPlayer.读取容器元素();
      expect(初始视频).not.toBeNull();
      expect(初始容器).not.toBeNull();

      const 查看器会话 = await globalVideoPlayer.接管查看器({
        attachmentId: "att-bridge-return-inline-post-close-null-1",
        mountTarget: viewerMount,
        source: 时间线输入.source,
        回调: {
          广播播放位置: () => undefined,
          广播媒体会话信号: () => undefined,
        },
      });
      await 等待查看器任务完成(6);

      globalVideoPlayer.同步时间线自动播(null);
      查看器会话.关闭();
      globalVideoPlayer.同步时间线自动播(null);
      await Promise.resolve();

      globalVideoPlayer.同步时间线自动播(时间线输入);
      await 等待查看器任务完成(6);

      expect(inlineMount.querySelector("video")).toBe(初始视频);
      expect(globalVideoPlayer.读取视频元素()).toBe(初始视频);
      expect(globalVideoPlayer.读取容器元素()).toBe(初始容器);
    } finally {
      globalVideoPlayer.销毁();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("时间线 owner 从旧卡片切到新卡片时，即便中间收到一次空 sync，也会直接迁移同一颗 canonical 壳", async () => {
    const firstMount = document.createElement("div");
    const secondMount = document.createElement("div");
    document.body.append(firstMount, secondMount);
    const destroySpy = vi.fn();
    const globalVideoPlayer = 创建全局唯一播放器({
      createVideoJsPlayerShell: vi.fn((source, deps = {}) =>
        创建测试VideoJs播放器壳({
          初始源: source,
          mountTarget: deps.mountTarget ?? undefined,
          destroy: destroySpy,
        })
      ),
    });
    const firstInput = {
      attachmentId: "att-inline-owner-1",
      mountTarget: firstMount,
      source: {
        kind: "file" as const,
        src: "blob:http://media.local/inline-owner-1",
        posterSrc: "http://media.local/poster-inline-owner-1",
        width: 1280,
        height: 720,
      },
      回调: {
        恢复播放位置: () => undefined,
        广播播放位置: () => undefined,
        标记首帧已就绪: () => undefined,
        广播媒体会话信号: () => undefined,
      },
    };
    const secondInput = {
      attachmentId: "att-inline-owner-2",
      mountTarget: secondMount,
      source: {
        kind: "file" as const,
        src: "blob:http://media.local/inline-owner-2",
        posterSrc: "http://media.local/poster-inline-owner-2",
        width: 1280,
        height: 720,
      },
      回调: {
        恢复播放位置: () => undefined,
        广播播放位置: () => undefined,
        标记首帧已就绪: () => undefined,
        广播媒体会话信号: () => undefined,
      },
    };

    try {
      globalVideoPlayer.同步时间线自动播(firstInput);
      await 等待查看器任务完成(6);

      const 初始视频 = firstMount.querySelector<HTMLVideoElement>("video");
      const 初始容器 = globalVideoPlayer.读取容器元素();
      expect(初始视频).not.toBeNull();
      expect(初始容器).not.toBeNull();

      /**
       * 这条链模拟的就是滚动交接时那一帧空窗：
       * 1. 旧 host 先退场，上层先上抛一次 `null`；
       * 2. 新 host 紧跟着可用；
       * 3. 正确行为应该是同一颗壳直接迁到新宿主，而不是先 destroy 再新建。
       */
      globalVideoPlayer.同步时间线自动播(null);
      globalVideoPlayer.同步时间线自动播(secondInput);
      await 等待查看器任务完成(6);

      const 迁移后视频 = secondMount.querySelector<HTMLVideoElement>("video");
      expect(迁移后视频).toBe(初始视频);
      expect(globalVideoPlayer.读取容器元素()).toBe(初始容器);
      expect(globalVideoPlayer.读取视频元素()).toBe(初始视频);
      expect(迁移后视频?.currentSrc || 迁移后视频?.src).toContain("inline-owner-2");
      expect(destroySpy).not.toHaveBeenCalled();
    } finally {
      globalVideoPlayer.销毁();
    }
  });

  it("时间线 owner 切到新卡片时，会先在隐藏预热宿主切源，等就绪后再迁到可见宿主", async () => {
    const firstMount = document.createElement("div");
    const hiddenStageMount = document.createElement("div");
    const secondVisibleMount = document.createElement("div");
    hiddenStageMount.className = "message-video-canonical-stage-host";
    hiddenStageMount.dataset.stageHost = "true";
    hiddenStageMount.dataset.attachmentId = "att-inline-owner-stage-2";
    document.body.append(firstMount, hiddenStageMount, secondVisibleMount);

    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    const video = document.createElement("video");
    Object.assign(video, { play, pause });
    const readySpy = vi.fn();
    const globalVideoPlayer = 创建全局唯一播放器({
      createVideoJsPlayerShell: vi.fn((source, deps = {}) =>
        创建测试VideoJs播放器壳({
          初始源: source,
          mountTarget: deps.mountTarget ?? undefined,
          video,
        })
      ),
    });

    const firstInput = {
      attachmentId: "att-inline-owner-stage-1",
      mountTarget: firstMount,
      source: {
        kind: "file" as const,
        src: "blob:http://media.local/inline-owner-stage-1",
        posterSrc: "http://media.local/poster-inline-owner-stage-1",
        width: 1280,
        height: 720,
      },
      回调: {
        恢复播放位置: () => undefined,
        广播播放位置: () => undefined,
        标记首帧已就绪: () => undefined,
        广播媒体会话信号: () => undefined,
      },
    };
    const secondInputBase = {
      attachmentId: "att-inline-owner-stage-2",
      source: {
        kind: "file" as const,
        src: "blob:http://media.local/inline-owner-stage-2",
        posterSrc: "http://media.local/poster-inline-owner-stage-2",
        width: 1280,
        height: 720,
      },
      回调: {
        恢复播放位置: (currentVideo: HTMLVideoElement) => {
          currentVideo.currentTime = 18.5;
        },
        广播播放位置: () => undefined,
        标记首帧已就绪: () => undefined,
        标记可见接管已就绪: () => {
          readySpy();
        },
        广播媒体会话信号: () => undefined,
      },
    };

    try {
      globalVideoPlayer.同步时间线自动播(firstInput);
      await 等待查看器任务完成(6);

      const 初始视频 = firstMount.querySelector<HTMLVideoElement>("video");
      expect(初始视频).toBe(video);
      play.mockClear();

      globalVideoPlayer.同步时间线自动播({
        ...secondInputBase,
        mountTarget: hiddenStageMount,
      });
      await 等待查看器任务完成(6);

      const 预热中视频 = hiddenStageMount.querySelector<HTMLVideoElement>("video");
      expect(预热中视频).toBe(初始视频);
      expect(预热中视频?.currentSrc || 预热中视频?.src).toContain("inline-owner-stage-2");
      expect(预热中视频?.autoplay).toBe(false);
      expect(play).not.toHaveBeenCalled();

      预热中视频!.dispatchEvent(new Event("loadedmetadata"));
      预热中视频!.dispatchEvent(new Event("seeked"));
      await 等待查看器任务完成(6);
      expect(readySpy).toHaveBeenCalled();

      globalVideoPlayer.同步时间线自动播({
        ...secondInputBase,
        mountTarget: secondVisibleMount,
      });
      await 等待查看器任务完成(6);

      const 揭帘后视频 = secondVisibleMount.querySelector<HTMLVideoElement>("video");
      expect(揭帘后视频).toBe(初始视频);
      expect(揭帘后视频?.autoplay).toBe(true);
      expect(揭帘后视频?.currentTime).toBeCloseTo(18.5, 2);
      expect(play).toHaveBeenCalledTimes(1);
    } finally {
      globalVideoPlayer.销毁();
    }
  });

  it("时间线 owner 切到同源附件且 hidden stage 不会再触发媒体事件时，也会立即打开可见接管就绪", async () => {
    const firstMount = document.createElement("div");
    const hiddenStageMount = document.createElement("div");
    hiddenStageMount.className = "message-video-canonical-stage-host";
    hiddenStageMount.dataset.stageHost = "true";
    hiddenStageMount.dataset.attachmentId = "att-inline-owner-same-src-2";
    document.body.append(firstMount, hiddenStageMount);

    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    const video = document.createElement("video");
    Object.assign(video, { play, pause });
    const readySpy = vi.fn();
    const sharedSource = {
      kind: "file" as const,
      src: "blob:http://media.local/shared-inline-owner-same-src",
      posterSrc: "http://media.local/poster-inline-owner-same-src",
      width: 1280,
      height: 720,
    };
    const globalVideoPlayer = 创建全局唯一播放器({
      createVideoJsPlayerShell: vi.fn((source, deps = {}) =>
        创建测试VideoJs播放器壳({
          初始源: source,
          mountTarget: deps.mountTarget ?? undefined,
          video,
        })
      ),
    });

    try {
      globalVideoPlayer.同步时间线自动播({
        attachmentId: "att-inline-owner-same-src-1",
        mountTarget: firstMount,
        source: sharedSource,
        回调: {
          恢复播放位置: () => undefined,
          广播播放位置: () => undefined,
          标记首帧已就绪: () => undefined,
          广播媒体会话信号: () => undefined,
        },
      });
      await 等待查看器任务完成(6);

      play.mockClear();
      pause.mockClear();
      readySpy.mockClear();

      globalVideoPlayer.同步时间线自动播({
        attachmentId: "att-inline-owner-same-src-2",
        mountTarget: hiddenStageMount,
        source: sharedSource,
        回调: {
          恢复播放位置: () => undefined,
          广播播放位置: () => undefined,
          标记首帧已就绪: () => undefined,
          标记可见接管已就绪: () => {
            readySpy();
          },
          广播媒体会话信号: () => undefined,
        },
      });
      await 等待查看器任务完成(6);

      /**
       * 真实房间里很多高竖视频附件其实共享同一个 swarm/file 播放源。
       * 这种情况下 hidden stage 不一定再触发 `loadeddata/canplay/seeked`，
       * 如果不主动补一次 ready 判定，reveal gate 就会永远卡住，用户只能看到暂停预览帧。
       */
      expect(readySpy).toHaveBeenCalledTimes(1);
      expect(pause).toHaveBeenCalledTimes(1);
      expect(play).not.toHaveBeenCalled();
    } finally {
      globalVideoPlayer.销毁();
    }
  });
});
