// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  读取默认全局唯一播放器,
  type 全局唯一播放器时间线输入,
} from "../../媒体/全局唯一播放器";
import { 时间线播放器宿主Owner } from "../../房间消息窗/时间线播放器宿主";

const 创建宿主 = (input: {
  attachmentId: string;
  className: string;
  src: string;
  kind?: string;
  width?: string;
  height?: string;
  poster?: string;
}): HTMLElement => {
  const host = document.createElement("div");
  host.className = input.className;
  host.dataset.attachmentId = input.attachmentId;
  host.dataset.videoSrc = input.src;
  host.dataset.videoKind = input.kind ?? "file";
  host.dataset.videoWidth = input.width ?? "640";
  host.dataset.videoHeight = input.height ?? "360";
  if (input.poster) {
    host.dataset.videoPoster = input.poster;
  }
  return host;
};

const 创建Owner = (root: ParentNode) => {
  const deps = {
    恢复播放位置: vi.fn(),
    标记首帧已就绪: vi.fn(),
    标记可见接管已就绪: vi.fn(),
    广播播放位置: vi.fn(),
    广播媒体会话信号: vi.fn(),
  };
  const owner = new 时间线播放器宿主Owner({
    读取宿主根: () => root,
    ...deps,
  });
  return { owner, deps };
};

describe("时间线播放器宿主Owner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    读取默认全局唯一播放器().销毁();
    document.body.innerHTML = "";
  });

  it("优先把唯一播放器挂到可见 canonical 宿主，并把回调翻回附件维度", () => {
    const root = document.createElement("div");
    const stageHost = 创建宿主({
      attachmentId: "video-1",
      className: "message-video-canonical-stage-host",
      src: "/media/stage.mp4",
    });
    const visibleHost = 创建宿主({
      attachmentId: "video-1",
      className: "message-video-canonical-host",
      src: "/media/visible.mp4",
      poster: "/media/poster.webp",
    });
    root.append(stageHost, visibleHost);
    document.body.append(root);
    const { owner, deps } = 创建Owner(root);
    const 同步时间线自动播Spy = vi
      .spyOn(读取默认全局唯一播放器(), "同步时间线自动播")
      .mockImplementation(() => undefined);

    owner.同步("video-1");

    const input = 同步时间线自动播Spy.mock.calls.at(-1)?.[0] as 全局唯一播放器时间线输入;
    expect(input.mountTarget).toBe(visibleHost);
    expect(input.source).toMatchObject({
      kind: "file",
      src: "/media/visible.mp4",
      posterSrc: "/media/poster.webp",
      width: 640,
      height: 360,
    });

    const video = document.createElement("video");
    input.回调.恢复播放位置(video);
    input.回调.标记首帧已就绪("/media/visible.mp4");
    input.回调.标记可见接管已就绪?.(video);
    input.回调.广播播放位置(video, true, true);
    input.回调.广播媒体会话信号({ type: "PLAYER_WAITING" });

    expect(deps.恢复播放位置).toHaveBeenCalledWith("video-1", video);
    expect(deps.标记首帧已就绪).toHaveBeenCalledWith("video-1", "/media/visible.mp4");
    expect(deps.标记可见接管已就绪).toHaveBeenCalledWith("video-1", video);
    expect(deps.广播播放位置).toHaveBeenCalledWith("video-1", video, true, true);
    expect(deps.广播媒体会话信号).toHaveBeenCalledWith("video-1", {
      type: "PLAYER_WAITING",
    });
  });

  it("owner 还在但虚拟宿主缺席时只暂停当前时间线播放", () => {
    const { owner } = 创建Owner(document.createElement("div"));
    const 全局唯一播放器 = 读取默认全局唯一播放器();
    const 暂停Spy = vi
      .spyOn(全局唯一播放器, "暂停当前时间线播放")
      .mockImplementation(() => undefined);
    const 同步Spy = vi
      .spyOn(全局唯一播放器, "同步时间线自动播")
      .mockImplementation(() => undefined);

    owner.同步("video-1");

    expect(暂停Spy).toHaveBeenCalledOnce();
    expect(同步Spy).not.toHaveBeenCalled();
  });

  it("旧流媒体清单源不得进入唯一播放器时间线链路", () => {
    const root = document.createElement("div");
    root.append(
      创建宿主({
        attachmentId: "video-1",
        className: "message-video-canonical-host",
        src: "/media/video.m3u8",
      })
    );
    document.body.append(root);
    const { owner } = 创建Owner(root);
    const 同步时间线自动播Spy = vi
      .spyOn(读取默认全局唯一播放器(), "同步时间线自动播")
      .mockImplementation(() => undefined);

    owner.同步("video-1");

    expect(同步时间线自动播Spy).toHaveBeenCalledWith(null);
  });
});
