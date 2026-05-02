import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../../平台/存储";
import { createFakeStorage, 假传输, 创建房间快照 } from "../common/聊天测试支架";
import { 创建聊天应用内核 } from "../../总装/聊天应用内核";
import { 创建内核依赖, 读取媒体编排供测试 } from "../common/聊天应用内核支架";

describe("聊天应用内核 - 退出房间视图", () => {
  it("退出房间视图时，会清空当前消息流自动播 owner", async () => {
    vi.useFakeTimers();
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-inline-1",
            client_message_id: "c-video-inline-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-inline-1",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 1,
          },
        ],
      }),
    ];
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport,
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    const 释放附件播放资源 = vi.fn();
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "anchor",
        attachmentId: "att-video-inline-1",
        kind: "video",
        src: "http://media.local/original-att-video-inline-1",
        thumbnailUrl: "http://media.local/poster-att-video-inline-1",
        hint: null,
      }),
      释放附件播放资源,
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    await kernel.dispatch({
      type: "MEDIA_INLINE_AUTOPLAY_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-1",
          visibilityRatio: 0.82,
          distanceToViewportCenter: 12,
        },
      ],
    });
    try {
      await vi.advanceTimersByTimeAsync(121);

      expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBe(
        "att-video-inline-1"
      );

      await kernel.dispatch({ type: "LEAVE_ROOM_VIEW_REQUESTED" });

      expect(释放附件播放资源).toHaveBeenCalledWith({
        attachmentId: "att-video-inline-1",
        consumerId: "inline_autoplay:att-video-inline-1",
      });
      expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBeNull();
    } finally {
      kernel.dispose();
      vi.useRealTimers();
    }
  });
});
