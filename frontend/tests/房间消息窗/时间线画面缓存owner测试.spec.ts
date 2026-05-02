// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { 媒体播放位置 } from "../../媒体/媒体播放";
import { 时间线画面缓存Owner } from "../../房间消息窗/时间线画面缓存";

const 创建Owner = () => {
  const 请求刷新 = vi.fn();
  const owner = new 时间线画面缓存Owner({
    读取视频当前播放源: (video) => video.currentSrc || video.getAttribute("src"),
    归一化时间线视频播放源: (src) =>
      src ? new URL(src, "http://media.local/room/").href : null,
    读取预览状态: () => null,
    请求刷新,
  });
  return { owner, 请求刷新 };
};

describe("时间线画面缓存Owner", () => {
  it("首帧 ready 只按附件和归一化同源 src 命中", () => {
    const { owner, 请求刷新 } = 创建Owner();

    owner.标记首帧已就绪("att-1", "/swarm/video.mp4");

    expect(owner.读取首帧是否就绪("att-1", "http://media.local/swarm/video.mp4")).toBe(
      true
    );
    expect(owner.读取首帧是否就绪("att-1", "/swarm/other.mp4")).toBe(false);
    expect(owner.读取已就绪首帧预览源("att-1")).toBe(
      "http://media.local/swarm/video.mp4"
    );
    expect(请求刷新).toHaveBeenCalledOnce();
  });

  it("同源同位置冻结帧才能承接时间线预览", () => {
    const { owner } = 创建Owner();
    const position: 媒体播放位置 = {
      src: "http://media.local/swarm/video.mp4",
      currentTime: 12,
      updatedAt: 1,
    };

    (
      owner as unknown as {
        时间线自动播冻结帧: Map<
          string,
          { src: string; currentTime: number; dataUrl: string; updatedAt: number }
        >;
      }
    ).时间线自动播冻结帧.set("att-1", {
      src: "/swarm/video.mp4",
      currentTime: 12.2,
      dataUrl: "data:image/webp;base64,freeze",
      updatedAt: 2,
    });

    expect(
      owner.读取自动播冻结帧("att-1", "/swarm/video.mp4", position)?.dataUrl
    ).toBe("data:image/webp;base64,freeze");
    expect(owner.读取自动播冻结帧("att-1", "/swarm/video.mp4", {
      ...position,
      currentTime: 20,
    })).toBeNull();
    expect(owner.读取自动播冻结帧("att-1", "/swarm/other.mp4", position)).toBeNull();
  });
});
