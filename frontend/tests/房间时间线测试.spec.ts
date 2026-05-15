import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { 创建乐观房间消息, 推进房间时间线 } from "../时间线/领域";
import { 提取可发送媒体附件元数据 } from "../媒体/媒体草稿";
import type { 消息事件 } from "../聊天共享/契约";

const 消息 = (patch: Partial<消息事件> & Pick<消息事件, "message_id" | "event_position">): 消息事件 => ({
  type: "message_created",
  room_id: "r-test",
  message_id: patch.message_id,
  client_message_id: patch.client_message_id ?? `client-${patch.message_id}`,
  sender_session_id: patch.sender_session_id ?? "s-other",
  sender_display_alias: patch.sender_display_alias ?? "冷静的水獭",
  text: patch.text ?? `消息 ${patch.event_position}`,
  attachments: patch.attachments ?? [],
  event_position: patch.event_position,
});

const 读取前端源码 = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

describe("房间时间线", () => {
  it("时间线领域 owner 直连生效，旧根入口已经删除", () => {
    const ownerSource = 读取前端源码("时间线/领域.ts");
    const runtimeSource = 读取前端源码("时间线/运行时.ts");

    expect(existsSync(fileURLToPath(new URL("../房间时间线.ts", import.meta.url)))).toBe(false);
    expect(ownerSource).toContain("export function 推进房间时间线(");
    expect(ownerSource).toContain("export function 创建乐观房间消息(");
    expect(runtimeSource).toContain('from "./领域.js"');
    expect(runtimeSource).not.toContain('from "./房间时间线.js"');
  });

  it("snapshot 与 realtime 送入同一条权威 message_id 时只保留一条", () => {
    const snapshot = 推进房间时间线([], {
      type: "SNAPSHOT",
      messages: [消息({ message_id: "m-1", client_message_id: "c-snapshot", event_position: 1 })],
    });
    const merged = 推进房间时间线(snapshot, {
      type: "REALTIME",
      events: [
        消息({ message_id: "m-1", client_message_id: "c-realtime", event_position: 1 }),
        消息({ message_id: "m-2", client_message_id: "c-2", event_position: 2 }),
      ],
    });

    expect(merged.map((message) => message.message_id)).toEqual(["m-1", "m-2"]);
  });

  it("本地乐观消息会被同 client_message_id 的权威消息替换", () => {
    const optimistic = 推进房间时间线([], {
      type: "OPTIMISTIC",
      message: 消息({
        message_id: "local-c-1",
        client_message_id: "c-1",
        sender_session_id: "s-test",
        event_position: 11,
        text: "本地乐观态",
      }),
    });
    const merged = 推进房间时间线(optimistic, {
      type: "REALTIME",
      events: [
        消息({
          message_id: "m-11",
          client_message_id: "c-1",
          sender_session_id: "s-test",
          event_position: 12,
          text: "权威消息",
        }),
      ],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      message_id: "m-11",
      client_message_id: "c-1",
      text: "权威消息",
      event_position: 12,
    });
  });

  it("历史前插、快照与实时追加按 event_position 输出同一条时间线", () => {
    const snapshot = 推进房间时间线([], {
      type: "SNAPSHOT",
      messages: [消息({ message_id: "m-3", event_position: 3 })],
    });
    const withHistory = 推进房间时间线(snapshot, {
      type: "HISTORY",
      messages: [
        消息({ message_id: "m-1", event_position: 1 }),
        消息({ message_id: "m-2", event_position: 2 }),
      ],
    });
    const merged = 推进房间时间线(withHistory, {
      type: "REALTIME",
      events: [消息({ message_id: "m-4", event_position: 4 })],
    });

    expect(merged.map((message) => message.event_position)).toEqual([1, 2, 3, 4]);
  });

  it("重连补事件重复进入时保持幂等", () => {
    const firstPass = 推进房间时间线([], {
      type: "REALTIME",
      events: [
        消息({ message_id: "m-1", client_message_id: "c-1", event_position: 1 }),
        消息({ message_id: "m-2", client_message_id: "c-2", event_position: 2 }),
      ],
    });
    const secondPass = 推进房间时间线(firstPass, {
      type: "REALTIME",
      events: [
        消息({ message_id: "m-1", client_message_id: "c-1", event_position: 1 }),
        消息({ message_id: "m-2", client_message_id: "c-2", event_position: 2 }),
      ],
    });

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
      attachments: [],
      event_position: 10,
    });
  });

  it("创建乐观消息可携带媒体附件元数据", () => {
    const optimistic = 创建乐观房间消息({
      roomId: "r-test",
      sessionId: "s-test",
      displayAlias: "暴躁的企鹅",
      clientMessageId: "client-media-1",
      text: "看这个视频",
      latestEventPosition: 5,
      attachments: [
        { kind: "video", attachment_id: "att-v1", width: 1920, height: 1080 },
        { kind: "image", attachment_id: "att-i1", width: 800, height: 600 },
      ],
    });

    expect(optimistic.attachments).toEqual([
      { kind: "video", attachment_id: "att-v1", width: 1920, height: 1080 },
      { kind: "image", attachment_id: "att-i1", width: 800, height: 600 },
    ]);
    expect(optimistic.message_id).toBe("local-client-media-1");
    expect(optimistic.event_position).toBe(6);
  });

  it("不传 attachments 时乐观消息附件为空数组", () => {
    const optimistic = 创建乐观房间消息({
      roomId: "r-test",
      sessionId: "s-test",
      displayAlias: "暴躁的企鹅",
      clientMessageId: "client-text-only",
      text: "纯文本",
      latestEventPosition: 3,
    });
    expect(optimistic.attachments).toEqual([]);
  });

  it("pending-first：transporting 有 attachmentId 时可发送，返回附件元数据含槽位状态", () => {
    const drafts = [
      {
        localId: "d1", kind: "video" as const, attachmentId: "att-v1",
        previewUrl: "", width: 1920, height: 1080,
        status: "ready" as const, fileName: "a.mp4", errorCode: "",
      },
      {
        localId: "d2", kind: "image" as const, attachmentId: "att-i1",
        previewUrl: "", width: 800, height: 600,
        status: "transporting" as const, fileName: "b.png", errorCode: "",
      },
    ];
    expect(提取可发送媒体附件元数据(drafts)).toEqual([
      { kind: "video", attachment_id: "att-v1", width: 1920, height: 1080, status: "ready" },
      { kind: "image", attachment_id: "att-i1", width: 800, height: 600, status: "uploading" },
    ]);
  });

  it("failed 草稿或无 attachmentId 草稿时返回 null", () => {
    const drafts = [
      {
        localId: "d1", kind: "video" as const, attachmentId: "att-v1",
        previewUrl: "", width: 1920, height: 1080,
        status: "ready" as const, fileName: "a.mp4", errorCode: "",
      },
      {
        localId: "d2", kind: "image" as const, attachmentId: "",
        previewUrl: "", width: 800, height: 600,
        status: "transporting" as const, fileName: "b.png", errorCode: "",
      },
    ];
    expect(提取可发送媒体附件元数据(drafts)).toBeNull();
  });

  it("全部 ready 时提取可发送媒体附件元数据返回最小渲染快照", () => {
    const drafts = [
      {
        localId: "d1", kind: "video" as const, attachmentId: "att-v1",
        previewUrl: "", width: 1920, height: 1080,
        status: "ready" as const, fileName: "a.mp4", errorCode: "",
      },
      {
        localId: "d2", kind: "image" as const, attachmentId: "att-i1",
        previewUrl: "", width: 800, height: 600,
        status: "ready" as const, fileName: "b.png", errorCode: "",
      },
    ];
    expect(提取可发送媒体附件元数据(drafts)).toEqual([
      { kind: "video", attachment_id: "att-v1", width: 1920, height: 1080, status: "ready" },
      { kind: "image", attachment_id: "att-i1", width: 800, height: 600, status: "ready" },
    ]);
  });

  it("空草稿列表时提取可发送媒体附件元数据返回空数组", () => {
    expect(提取可发送媒体附件元数据([])).toEqual([]);
  });

  // ── pending-first Phase 3：附件槽位升级 ──

  it("attachment_status_changed ready 时升级时间线中对应消息的附件槽位", () => {
    const timeline = 推进房间时间线([], {
      type: "REALTIME",
      events: [
        消息({
          message_id: "m-1",
          event_position: 1,
          attachments: [
            { kind: "video", attachment_id: "att-v1", width: 1920, height: 1080, status: "processing" },
          ],
        }),
      ],
    });
    expect(timeline[0]!.attachments![0]).toMatchObject({ status: "processing" });

    const upgraded = 推进房间时间线(timeline, {
      type: "ATTACHMENT_UPGRADE",
      messageId: "m-1",
      attachmentId: "att-v1",
      patch: {
        status: "ready",
        distribution_hint: {
          content_hash: "hash1",
          swarm_id: "swarm1",
          torrent_info_hash: "ih1",
          web_seed_until: 9999999,
        },
      },
    });

    expect(upgraded).toHaveLength(1);
    expect(upgraded[0]!.attachments![0]).toMatchObject({
      kind: "video",
      attachment_id: "att-v1",
      status: "ready",
      distribution_hint: { torrent_info_hash: "ih1" },
    });
  });

  it("attachment_status_changed failed 时更新状态但不覆盖宽高", () => {
    const timeline = 推进房间时间线([], {
      type: "REALTIME",
      events: [
        消息({
          message_id: "m-2",
          event_position: 2,
          attachments: [
            { kind: "image", attachment_id: "att-i1", width: 800, height: 600, status: "uploading" },
          ],
        }),
      ],
    });

    const upgraded = 推进房间时间线(timeline, {
      type: "ATTACHMENT_UPGRADE",
      messageId: "m-2",
      attachmentId: "att-i1",
      patch: { status: "failed" },
    });

    expect(upgraded[0]!.attachments![0]).toMatchObject({
      kind: "image",
      attachment_id: "att-i1",
      width: 800,
      height: 600,
      status: "failed",
    });
  });

  it("attachment_upgrade 对不存在的 message_id 是幂等空操作", () => {
    const timeline = 推进房间时间线([], {
      type: "REALTIME",
      events: [消息({ message_id: "m-1", event_position: 1 })],
    });
    const upgraded = 推进房间时间线(timeline, {
      type: "ATTACHMENT_UPGRADE",
      messageId: "m-nonexistent",
      attachmentId: "att-x",
      patch: { status: "ready" },
    });
    expect(upgraded).toEqual(timeline);
  });

  it("重复 ready 升级幂等：同一 patch 两次结果一致", () => {
    const timeline = 推进房间时间线([], {
      type: "REALTIME",
      events: [
        消息({
          message_id: "m-3",
          event_position: 3,
          attachments: [
            { kind: "video", attachment_id: "att-v2", width: 1280, height: 720, status: "processing" },
          ],
        }),
      ],
    });
    const patch = { status: "ready" as const };
    const first = 推进房间时间线(timeline, {
      type: "ATTACHMENT_UPGRADE",
      messageId: "m-3",
      attachmentId: "att-v2",
      patch,
    });
    const second = 推进房间时间线(first, {
      type: "ATTACHMENT_UPGRADE",
      messageId: "m-3",
      attachmentId: "att-v2",
      patch,
    });
    expect(second).toEqual(first);
  });

  it("恢复、实时、历史分页都只能把事实交给时间线 owner，不再各自手拼 messages 数组", () => {
    const recoverySource = 读取前端源码("恢复/壳层/房间恢复编排.ts");
    const recoverySnapshotSource = 读取前端源码("恢复/应用.ts");
    const realtimeSource = 读取前端源码("实时/应用.ts");
    const readingSource = 读取前端源码("房间/壳层/阅读推进.ts");

    expect(recoverySource).toContain('from "../应用.js"');
    expect(recoverySource).not.toContain("messages: 合并房间时间线消息(");
    expect(recoverySnapshotSource).toContain("接收时间线事实({");
    expect(recoverySnapshotSource).not.toContain("messages: 合并房间时间线消息(");
    expect(existsSync(fileURLToPath(new URL("../聊天恢复/壳层/房间快照恢复.ts", import.meta.url)))).toBe(false);

    expect(realtimeSource).toContain('type: "REALTIME_EVENTS_RECEIVED"');
    expect(realtimeSource).toContain('type: "OPTIMISTIC_MESSAGE_ADDED"');
    expect(realtimeSource).not.toContain("const merged = 合并房间时间线消息(");

    expect(readingSource).toContain('type: "HISTORY_PAGE_APPENDED"');
    expect(readingSource).not.toContain("messages: 合并房间时间线消息(");
  });
});
