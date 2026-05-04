import { describe, expect, it, vi } from "vitest";
import { 创建媒体播放会话应用 } from "../../媒体/播放会话/应用";
import { 创建内存媒体缓存仓库 } from "../../媒体";
import {
  生成图片消息,
  刷新异步队列,
  适配媒体编排供测试,
} from "../common/聊天媒体编排支架";
import type { 前端传输端口 } from "../../平台/传输";
import type { 消息事件 } from "../../聊天共享/契约";

describe("聊天媒体编排 - 协作补齐缓存窗口", () => {
  it("缓存启动后只恢复当前帮助窗口里的本房间完整附件，不会把隐藏历史和别房间扫进来", async () => {
    const 激活协作补齐 = vi.fn(async () => {});
    const transport: 前端传输端口 = {
      loadMediaLocator: vi.fn(async () => {
        throw new Error("unused");
      }),
      buildAttachmentContentUrl: vi.fn(
        (id: string, sessionId: string, variant: "original" | "thumbnail" = "original") =>
          `http://test.local/api/attachments/${id}/content?session_id=${sessionId}&variant=${variant}`
      ),
      prepareMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
      abandonMediaUpload: vi.fn(async () => {}),
      completeMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
    } as unknown as 前端传输端口;

    const 编排 = 创建媒体播放会话应用({
      transport: () => transport,
      读取会话编号: () => "s-test",
      读取当前房间标识: () => "r-current",
      读取消息: () => [生成图片消息("att-image-current-room-1")],
      媒体缓存仓库: 创建内存媒体缓存仓库({
        "att-image-current-room-1": {
          attachmentId: "att-image-current-room-1",
          roomId: "r-current",
          complete: true,
          kind: "image",
          contentHash: "hash-image-current-room-1",
          retainedAt: 1,
          lastAccessAt: 1,
        },
        "att-image-current-room-hidden-2": {
          attachmentId: "att-image-current-room-hidden-2",
          roomId: "r-current",
          complete: true,
          kind: "image",
          contentHash: "hash-image-current-room-hidden-2",
          retainedAt: 1,
          lastAccessAt: 1,
        },
        "att-image-other-room-1": {
          attachmentId: "att-image-other-room-1",
          roomId: "r-other",
          complete: true,
          kind: "image",
          contentHash: "hash-image-other-room-1",
          retainedAt: 1,
          lastAccessAt: 1,
        },
      }),
      读取草稿: () => [],
      写入草稿列表: () => {},
      请求重渲染: () => {},
      回收媒体草稿预览地址: () => {},
      登记程序滚动来源: () => {},
      清除程序滚动来源: () => {},
    });

    适配媒体编排供测试(编排).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "anchor",
        attachmentId: "att-image-current-room-1",
        kind: "image",
        src: "http://media.local/blob/att-image-current-room-1/full.webp",
        thumbnailUrl: "http://media.local/blob/att-image-current-room-1/preview.webp",
        contentHash: "hash-image-current-room-1",
        distribution: null,
        hint: null,
      }),
      激活协作补齐,
    });

    编排.同步媒体窗口附件(["att-image-current-room-1"]);
    await 刷新异步队列();

    expect(激活协作补齐).toHaveBeenCalledTimes(1);
    expect(激活协作补齐).toHaveBeenCalledWith({
      attachmentId: "att-image-current-room-1",
      consumerId: "backfill:att-image-current-room-1",
      kind: "image",
      onSessionEvent: expect.any(Function),
    });

    编排.销毁();
  });

  it("附件离开当前帮助窗口后，不能只因曾进入帮助链就继续长期占着活会话", async () => {
    vi.resetModules();
    const 释放协作分发消费者 = vi.fn();
    vi.doMock("../../媒体/资产协作分发运行时.js", () => ({
      创建资产协作分发运行时: () => ({
        解析协作分发源: vi.fn(async () => null),
        释放协作分发消费者,
        读取预算: () => ({}),
        读取会话状态: () => null,
        send: () => undefined,
        重置: () => undefined,
        销毁: () => undefined,
      }),
    }));

    const { 创建媒体播放会话应用: 创建媒体播放会话应用带协作分发桩 } = await import("../../媒体/播放会话/应用");
    const 激活协作补齐 = vi.fn(async () => {});
    const 释放附件播放资源 = vi.fn();
    const 当前消息 = {
      value: [生成图片消息("att-image-help-chain-1")] as 消息事件[],
    };

    const transport: 前端传输端口 = {
      loadMediaLocator: vi.fn(async () => {
        throw new Error("unused");
      }),
      buildAttachmentContentUrl: vi.fn(
        (id: string, sessionId: string, variant: "original" | "thumbnail" = "original") =>
          `http://test.local/api/attachments/${id}/content?session_id=${sessionId}&variant=${variant}`
      ),
      prepareMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
      abandonMediaUpload: vi.fn(async () => {}),
      completeMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
    } as unknown as 前端传输端口;

    const 编排 = 创建媒体播放会话应用带协作分发桩({
      transport: () => transport,
      读取会话编号: () => "s-test",
      读取消息: () => 当前消息.value,
      媒体缓存仓库: 创建内存媒体缓存仓库({
        "att-image-help-chain-1": {
          attachmentId: "att-image-help-chain-1",
          complete: true,
          kind: "image",
          contentHash: "hash-image-help-chain-1",
          retainedAt: 1,
          lastAccessAt: 1,
        },
      }),
      读取草稿: () => [],
      写入草稿列表: () => {},
      请求重渲染: () => {},
      回收媒体草稿预览地址: () => {},
      登记程序滚动来源: () => {},
      清除程序滚动来源: () => {},
    });

    适配媒体编排供测试(编排).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "anchor",
        attachmentId: "att-image-help-chain-1",
        kind: "image",
        src: "http://media.local/blob/att-image-help-chain-1/full.webp",
        thumbnailUrl: "http://media.local/blob/att-image-help-chain-1/preview.webp",
        contentHash: "hash-image-help-chain-1",
        distribution: null,
        hint: null,
      }),
      激活协作补齐,
      释放附件播放资源,
    });

    编排.同步媒体窗口附件(["att-image-help-chain-1"]);
    await 刷新异步队列();

    expect(激活协作补齐).toHaveBeenCalledTimes(1);
    expect(Object.keys(编排.snapshot().sessionByAttachmentId)).toContain("att-image-help-chain-1");

    当前消息.value = [生成图片消息("att-image-current-only-2")];
    编排.同步媒体窗口附件(["att-image-current-only-2"]);
    await 刷新异步队列();

    expect(释放附件播放资源).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentId: "att-image-help-chain-1" })
    );
    expect(Object.keys(编排.snapshot().sessionByAttachmentId)).not.toContain(
      "att-image-help-chain-1"
    );

    编排.销毁();
    vi.doUnmock("../../媒体/资产协作分发运行时.js");
    vi.resetModules();
  });
});
