import { describe, expect, it } from "vitest";
import { 创建乐观房间消息, 合并房间时间线消息 } from "../房间时间线";
import type { 消息事件 } from "../契约";

const 消息 = (patch: Partial<消息事件> & Pick<消息事件, "message_id" | "event_position">): 消息事件 => ({
  type: "message_created",
  room_id: "r-test",
  message_id: patch.message_id,
  client_message_id: patch.client_message_id ?? `client-${patch.message_id}`,
  sender_session_id: patch.sender_session_id ?? "s-other",
  sender_display_alias: patch.sender_display_alias ?? "冷静的水獭",
  text: patch.text ?? patch.body ?? `消息 ${patch.event_position}`,
  body: patch.body ?? patch.text ?? `消息 ${patch.event_position}`,
  attachments: patch.attachments ?? [],
  event_position: patch.event_position,
});

describe("房间时间线", () => {
  it("snapshot 与 realtime 送入同一条权威 message_id 时只保留一条", () => {
    const merged = 合并房间时间线消息([
      消息({ message_id: "m-1", client_message_id: "c-snapshot", event_position: 1 }),
      消息({ message_id: "m-1", client_message_id: "c-realtime", event_position: 1 }),
      消息({ message_id: "m-2", client_message_id: "c-2", event_position: 2 }),
    ]);

    expect(merged.map((message) => message.message_id)).toEqual(["m-1", "m-2"]);
  });

  it("本地乐观消息会被同 client_message_id 的权威消息替换", () => {
    const merged = 合并房间时间线消息([
      消息({
        message_id: "local-c-1",
        client_message_id: "c-1",
        sender_session_id: "s-test",
        event_position: 11,
        body: "本地乐观态",
      }),
      消息({
        message_id: "m-11",
        client_message_id: "c-1",
        sender_session_id: "s-test",
        event_position: 12,
        body: "权威消息",
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      message_id: "m-11",
      client_message_id: "c-1",
      body: "权威消息",
      event_position: 12,
    });
  });

  it("历史前插、快照与实时追加按 event_position 输出同一条时间线", () => {
    const merged = 合并房间时间线消息([
      消息({ message_id: "m-3", event_position: 3 }),
      消息({ message_id: "m-1", event_position: 1 }),
      消息({ message_id: "m-4", event_position: 4 }),
      消息({ message_id: "m-2", event_position: 2 }),
    ]);

    expect(merged.map((message) => message.event_position)).toEqual([1, 2, 3, 4]);
  });

  it("重连补事件重复进入时保持幂等", () => {
    const firstPass = 合并房间时间线消息([
      消息({ message_id: "m-1", client_message_id: "c-1", event_position: 1 }),
      消息({ message_id: "m-2", client_message_id: "c-2", event_position: 2 }),
    ]);
    const secondPass = 合并房间时间线消息([
      ...firstPass,
      消息({ message_id: "m-1", client_message_id: "c-1", event_position: 1 }),
      消息({ message_id: "m-2", client_message_id: "c-2", event_position: 2 }),
    ]);

    expect(secondPass).toEqual(firstPass);
  });

  it("创建乐观文本消息只生成本地占位事实，不伪造权威 message_id", () => {
    const optimistic = 创建乐观房间消息({
      roomId: "r-test",
      sessionId: "s-test",
      displayAlias: "暴躁的企鹅",
      clientMessageId: "client-optimistic-1",
      text: "hello",
      latestEventPosition: 9,
    });

    expect(optimistic).toMatchObject({
      type: "message_created",
      room_id: "r-test",
      message_id: "local-client-optimistic-1",
      client_message_id: "client-optimistic-1",
      sender_session_id: "s-test",
      sender_display_alias: "暴躁的企鹅",
      text: "hello",
      body: "hello",
      attachments: [],
      event_position: 10,
    });
  });
});
