import { describe, expect, it, vi } from "vitest";
import { 创建媒体播放会话应用 } from "../../媒体/播放会话/应用";
import { 刷新异步队列 } from "../common/聊天媒体编排支架";
import type { 前端传输端口 } from "../../平台/传输";
import type { 消息事件 } from "../../聊天共享/契约";

/**
 * room_event 到达即触发 locator pre-fetch 测试：
 * 1. 他人的含 distribution_hint 的附件会立即触发 loadMediaLocator
 * 2. 发送者自身的消息不触发
 * 3. 不含 distribution_hint 的附件不触发
 */
describe("聊天媒体编排 - 权威事件到达即预热", () => {
  const MY_SESSION = "s-self";
  const OTHER_SESSION = "s-other";

  const 构造含分发线索的视频消息 = (
    attachmentId: string,
    senderSessionId: string
  ): 消息事件 =>
    ({
      message_id: `msg-${attachmentId}`,
      room_id: "room-1",
      client_message_id: `cmsg-${attachmentId}`,
      sender_session_id: senderSessionId,
      sender_display_alias: "测试用户",
      text: "",
      attachments: [
        {
          attachment_id: attachmentId,
          kind: "video",
          width: 1920,
          height: 1080,
          has_preview_asset: false,
          distribution_hint: {
            content_hash: `hash-${attachmentId}`,
            swarm_id: `swarm-${attachmentId}`,
            torrent_info_hash: `ih-${attachmentId}`,
            web_seed_until: 1715500000,
          },
        },
      ],
      event_position: 1,
    }) as unknown as 消息事件;

  const 构造无分发线索的视频消息 = (
    attachmentId: string,
    senderSessionId: string
  ): 消息事件 =>
    ({
      message_id: `msg-${attachmentId}`,
      room_id: "room-1",
      client_message_id: `cmsg-${attachmentId}`,
      sender_session_id: senderSessionId,
      sender_display_alias: "测试用户",
      text: "",
      attachments: [
        {
          attachment_id: attachmentId,
          kind: "video",
          width: 1920,
          height: 1080,
          has_preview_asset: false,
        },
      ],
      event_position: 2,
    }) as unknown as 消息事件;

  const 创建测试编排 = (loadMediaLocator: ReturnType<typeof vi.fn>) => {
    const transport: 前端传输端口 = {
      loadMediaLocator,
      buildAttachmentContentUrl: vi.fn(
        (id: string, sessionId: string) =>
          `http://test.local/api/attachments/${id}/content?session_id=${sessionId}`
      ),
      prepareMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
      abandonMediaUpload: vi.fn(async () => {}),
      completeMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
    } as unknown as 前端传输端口;

    return 创建媒体播放会话应用({
      transport: () => transport,
      读取会话编号: () => MY_SESSION,
      读取消息: () => [],
      读取草稿: () => [],
      写入草稿列表: () => {},
      请求重渲染: () => {},
      回收媒体草稿预览地址: () => {},
      登记程序滚动来源: () => {},
      清除程序滚动来源: () => {},
    });
  };

  it("他人的含 distribution_hint 视频附件会立即触发 loadMediaLocator", async () => {
    const loadMediaLocator = vi.fn(async () => {
      throw new Error("unused in prewarm");
    });
    const 编排 = 创建测试编排(loadMediaLocator);

    编排.预热权威消息媒体分发(
      [构造含分发线索的视频消息("att-other-1", OTHER_SESSION)],
      MY_SESSION
    );
    await 刷新异步队列();

    expect(loadMediaLocator).toHaveBeenCalledTimes(1);
    expect(loadMediaLocator).toHaveBeenCalledWith(MY_SESSION, "att-other-1", expect.anything());

    编排.销毁();
  });

  it("发送者自身的消息不触发预热", async () => {
    const loadMediaLocator = vi.fn(async () => {
      throw new Error("unused");
    });
    const 编排 = 创建测试编排(loadMediaLocator);

    编排.预热权威消息媒体分发(
      [构造含分发线索的视频消息("att-self-1", MY_SESSION)],
      MY_SESSION
    );
    await 刷新异步队列();

    expect(loadMediaLocator).not.toHaveBeenCalled();

    编排.销毁();
  });

  it("不含 distribution_hint 的附件不触发预热", async () => {
    const loadMediaLocator = vi.fn(async () => {
      throw new Error("unused");
    });
    const 编排 = 创建测试编排(loadMediaLocator);

    编排.预热权威消息媒体分发(
      [构造无分发线索的视频消息("att-no-hint-1", OTHER_SESSION)],
      MY_SESSION
    );
    await 刷新异步队列();

    expect(loadMediaLocator).not.toHaveBeenCalled();

    编排.销毁();
  });

  it("丰富hint直接预热：含join_ticket+announce_urls时跳过HTTP locator", async () => {
    const loadMediaLocator = vi.fn(async () => {
      throw new Error("should not be called for enriched hint");
    });
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const 编排 = 创建测试编排(loadMediaLocator);

    const enrichedEvent = {
      message_id: "msg-enriched",
      room_id: "room-1",
      client_message_id: "cmsg-enriched",
      sender_session_id: OTHER_SESSION,
      sender_display_alias: "他人",
      text: "",
      attachments: [
        {
          attachment_id: "att-enriched-1",
          kind: "video",
          width: 1920,
          height: 1080,
          has_preview_asset: false,
          distribution_hint: {
            content_hash: "sha256-enriched",
            swarm_id: "swarm-enriched",
            torrent_info_hash: "ih-enriched",
            web_seed_until: 9999999999,
            join_ticket: "eyJhbGciOiJIUzI1NiJ9.test-ticket",
            ticket_expires_at: "2099-01-01T00:00:00Z",
            announce_urls: ["wss://tracker.example.com/announce"],
            torrent_url: "/api/media/att-enriched-1/torrent?ticket=eyJhbGciOiJIUzI1NiJ9.test-ticket",
            web_seed_url: null,
            ice_servers: [],
          },
        },
      ],
      event_position: 10,
    } as unknown as 消息事件;

    编排.预热权威消息媒体分发([enrichedEvent], MY_SESSION);
    await 刷新异步队列();

    // 丰富 hint 路径不走 HTTP locator
    expect(loadMediaLocator).not.toHaveBeenCalled();
    // 应有直接预热日志
    const directPrefetchCalls = debugSpy.mock.calls.filter(
      (args) => args[0] === "[SWARM_DIRECT_PREFETCH]"
    );
    expect(directPrefetchCalls.length).toBe(1);
    expect(directPrefetchCalls[0]?.[1]).toBe("att-enriched-1");

    debugSpy.mockRestore();
    编排.销毁();
  });

  it("混合场景只预热他人的含 distribution_hint 附件", async () => {
    const loadMediaLocator = vi.fn(async () => {
      throw new Error("unused in prewarm");
    });
    const 编排 = 创建测试编排(loadMediaLocator);

    编排.预热权威消息媒体分发(
      [
        构造含分发线索的视频消息("att-other-2", OTHER_SESSION),
        构造含分发线索的视频消息("att-self-2", MY_SESSION),
        构造无分发线索的视频消息("att-no-hint-2", OTHER_SESSION),
      ],
      MY_SESSION
    );
    await 刷新异步队列();

    // 只有 att-other-2 应触发
    expect(loadMediaLocator).toHaveBeenCalledTimes(1);
    expect(loadMediaLocator).toHaveBeenCalledWith(MY_SESSION, "att-other-2", expect.anything());

    编排.销毁();
  });
});
