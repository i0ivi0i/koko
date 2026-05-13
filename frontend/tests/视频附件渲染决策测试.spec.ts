import { describe, expect, it, vi } from "vitest";

vi.mock("../房间消息窗/视频附件表面渲染.js", () => ({
  渲染时间线视频表面卡片: vi.fn((params: Record<string, unknown>) => params),
}));
vi.mock("../媒体/视频可见槽位协议.js", () => ({
  判定播放连续性表面: vi.fn(() => ({
    kind: "hidden_handoff",
    visibleSurface: "placeholder",
  })),
}));
vi.mock("../房间消息窗/视频首帧桥接.js", () => ({
  标记当前预览视频已出首帧: vi.fn(),
}));

import { 渲染视频附件 } from "../房间消息窗/视频附件渲染.js";
import type { 视频附件渲染宿主, 时间线视频附件 } from "../房间消息窗/视频附件渲染.js";
import type { 媒体播放结果 } from "../媒体/媒体播放.js";

const swarmSrc = "/webtorrent/abc123/content-deadbeef.mp4";

function 创建基础视频附件(): 时间线视频附件 {
  return {
    attachmentId: "att-test-video",
    kind: "video",
    width: 1280,
    height: 720,
    layoutX: 0,
    layoutY: 0,
    displayWidth: 360,
    displayHeight: 640,
    posterSrc: "https://cdn.local/poster.jpg",
    durationSeconds: 60,
    fileSizeBytes: 10_000_000,
    contentHash: "deadbeef",
    magnetUri: null,
  } as 时间线视频附件;
}

function 创建swarm播放结果(attachmentId: string): 媒体播放结果 {
  return {
    mode: "swarm",
    attachmentId,
    kind: "video",
    src: swarmSrc,
    thumbnailUrl: null,
    hint: null,
    formalByteSource: "webtorrent_official_stream",
  } as 媒体播放结果;
}

function 创建宿主上下文(overrides: Partial<视频附件渲染宿主> = {}): 视频附件渲染宿主 {
  return {
    inlineAutoplayOwnerAttachmentId: "att-test-video",
    inlineAutoplayPositionByAttachmentId: {},
    最近退场Owner附件Id: null,
    时间线隐藏接管附件Id: null,
    读取时间线视频预览状态: () => ({ phase: "missing_source" as const, sourceVersion: 1 }),
    读取时间线视频运行时预览: () => null,
    读取时间线视频已知封面源: () => null,
    读取时间线视频封面地址: () => "https://cdn.local/poster.jpg",
    读取时间线视频首帧预览源: () => null,
    读取保存续帧是否允许承接时间线预览底板: () => false,
    读取时间线视频已就绪首帧预览源: () => null,
    读取时间线视频预算投影: () => ({
      tier: "heavy_playback" as const,
      reason: "inline_autoplay_owner" as const,
      formalByteSource: "webtorrent_official_stream" as const,
      allowInlineCanonical: true,
      canonicalVideoSrc: swarmSrc,
      previewVideoSrc: null,
    }),
    读取时间线唯一播放器是否可见接管就绪: () => false,
    读取时间线唯一播放器可见宿主是否已出帧: () => false,
    读取自动播恢复位置: () => null,
    读取时间线现有预览视频是否可继续显示: () => false,
    读取时间线现有预览帧证据: () => null,
    读取时间线自动播冻结帧: () => null,
    捕获时间线自动播冻结帧: () => {},
    读取时间线视频首帧是否就绪: () => false,
    归一化时间线视频播放源: (src) => src,
    读取时间线预览视频是否允许渲染: () => false,
    恢复时间线自动播播放位置: () => {},
    标记时间线视频首帧已就绪: () => {},
    标记视频封面加载失败: () => {},
    广播媒体会话信号: () => {},
    阻止时间线媒体预览原生菜单: () => {},
    打开媒体查看器: () => {},
    ...overrides,
  } as 视频附件渲染宿主;
}

describe("视频附件渲染决策", () => {
  it("preview missing_source 不应阻断 canonical 挂载——swarm 字节迟到不等于永远没有", () => {
    const attachment = 创建基础视频附件();
    const playback = 创建swarm播放结果(attachment.attachmentId);
    const context = 创建宿主上下文({
      读取时间线视频预览状态: () => ({ phase: "missing_source" as const, sourceVersion: 1 }),
    });

    const result = 渲染视频附件(context, {
      attachment,
      playback,
      attachmentCardStyle: "",
      可渲染真实预览视频附件: new Set([attachment.attachmentId]),
      渲染媒体提示: () => null,
    }) as Record<string, unknown>;

    expect(result.shouldRenderInlineVideo).toBe(true);
  });

  it("preview ready 时 canonical 正常挂载（基线对照）", () => {
    const attachment = 创建基础视频附件();
    const playback = 创建swarm播放结果(attachment.attachmentId);
    const context = 创建宿主上下文({
      读取时间线视频预览状态: () => ({
        phase: "ready" as const,
        src: "data:image/png;base64,AAAA",
        source: "rvfc" as const,
      }),
    });

    const result = 渲染视频附件(context, {
      attachment,
      playback,
      attachmentCardStyle: "",
      可渲染真实预览视频附件: new Set([attachment.attachmentId]),
      渲染媒体提示: () => null,
    }) as Record<string, unknown>;

    expect(result.shouldRenderInlineVideo).toBe(true);
  });
});
