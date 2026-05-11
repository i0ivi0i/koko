import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { 创建窗口会话协作 } from "../../媒体/壳层/窗口会话协作.js";

describe("prefetch 信号路径", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * 窗口同步时，新进入活跃区域的视频应在 500ms 防抖后触发 prefetch 回调。
   * 验证：
   * 1. 新视频进入 → 500ms 后 `触发视频prefetch预热` 被调用
   * 2. 调用参数包含 attachmentId
   */
  it("新视频进入活跃窗口 500ms 后触发 prefetch 回调", () => {
    const 触发视频prefetch预热 = vi.fn();
    const 媒体会话表 = new Map();
    const 协作 = 创建窗口会话协作({
      读取当前房间媒体附件: () => [
        { attachmentId: "att-v1", kind: "video" },
      ],
      读取当前活跃媒体窗口附件: (a) => a,
      读取当前房间帮助附件候选: () => [],
      读取媒体会话表: () => 媒体会话表,
      创建媒体会话条目: (att) => {
        const port = {
          启动: vi.fn(),
          snapshot: () => ({ playback: null }),
        } as any;
        媒体会话表.set(att.attachmentId, port);
        return port;
      },
      释放媒体附件会话: () => true,
      读取附件条目: () => null,
      触发视频预览收敛: vi.fn(),
      应保留帮助任务: () => false,
      同步当前帮助窗口附件: vi.fn(),
      恢复当前房间缓存帮助任务: vi.fn(),
      接收消息附件同步: vi.fn(),
      请求重渲染: vi.fn(),
      触发视频prefetch预热,
    });

    协作.按当前窗口重同步消息附件播放结果();

    // 500ms 前不应触发
    expect(触发视频prefetch预热).not.toHaveBeenCalled();

    // 500ms 后触发
    vi.advanceTimersByTime(500);
    expect(触发视频prefetch预热).toHaveBeenCalledWith("att-v1");
  });

  /**
   * 视频离开活跃窗口后，pending 的 prefetch 定时器应被取消。
   */
  it("视频离开活跃窗口后取消 pending prefetch 定时器", () => {
    const 触发视频prefetch预热 = vi.fn();
    const 媒体会话表 = new Map();
    let activeAttachments: { attachmentId: string; kind: "video" }[] = [
      { attachmentId: "att-v2", kind: "video" },
    ];
    const 协作 = 创建窗口会话协作({
      读取当前房间媒体附件: () => activeAttachments,
      读取当前活跃媒体窗口附件: (a) => a,
      读取当前房间帮助附件候选: () => [],
      读取媒体会话表: () => 媒体会话表,
      创建媒体会话条目: (att) => {
        const port = {
          启动: vi.fn(),
          snapshot: () => ({ playback: null }),
        } as any;
        媒体会话表.set(att.attachmentId, port);
        return port;
      },
      释放媒体附件会话: (_id) => {
        媒体会话表.delete(_id);
        return true;
      },
      读取附件条目: () => null,
      触发视频预览收敛: vi.fn(),
      应保留帮助任务: () => false,
      同步当前帮助窗口附件: vi.fn(),
      恢复当前房间缓存帮助任务: vi.fn(),
      接收消息附件同步: vi.fn(),
      请求重渲染: vi.fn(),
      触发视频prefetch预热,
    });

    // 第一次同步：视频进入
    协作.按当前窗口重同步消息附件播放结果();

    // 200ms 后视频离开活跃区域
    vi.advanceTimersByTime(200);
    activeAttachments = [];
    协作.按当前窗口重同步消息附件播放结果();

    // 再过 400ms（总共 600ms）——不应触发
    vi.advanceTimersByTime(400);
    expect(触发视频prefetch预热).not.toHaveBeenCalled();
  });
});
