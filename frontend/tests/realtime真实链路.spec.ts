import { afterEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

type 匿名身份引导响应 = {
  session_id: string;
  anonymous_identity_id?: string;
  display_alias?: string;
};

type 房间快照 = {
  room_id: string;
};

type 房间事件 = {
  message_id: string;
  client_message_id: string;
  event_position: number;
  body: string;
};

const repoRoot = resolve(process.cwd(), "..");
const backendChildren: ChildProcess[] = [];

afterEach(() => {
  for (const child of backendChildren.splice(0)) {
    child.kill();
  }
});

describe("realtime真实链路", () => {
  it(
    "同一设备 token 会恢复同一个匿名身份与花名，并可进入不同房间",
    async () => {
      const port = await allocatePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const child = startBackend(port);
      backendChildren.push(child);
      await waitForServer(baseUrl);

      const first = await postJson<匿名身份引导响应>(`${baseUrl}/api/session/bootstrap`, {
        device_anonymous_token: "device-stable-001",
      });
      const second = await postJson<匿名身份引导响应>(`${baseUrl}/api/session/bootstrap`, {
        device_anonymous_token: "device-stable-001",
      });

      expect(first.anonymous_identity_id).toBeTruthy();
      expect(first.anonymous_identity_id).toBe(second.anonymous_identity_id);
      expect(first.display_alias).toBeTruthy();
      expect(first.display_alias).toBe(second.display_alias);
      expect(first.session_id).toBe(second.session_id);

      const room1 = await postJson<房间快照>(`${baseUrl}/api/rooms/join-or-create`, {
        session_id: first.session_id,
        room_code: uniqueRoomCode("TOKN"),
      });
      const room2 = await postJson<房间快照>(`${baseUrl}/api/rooms/join-or-create`, {
        session_id: second.session_id,
        room_code: uniqueRoomCode("TOKN"),
      });

      expect(room1.room_id).not.toBe(room2.room_id);
    },
    60000
  );

  it(
    "缺少合法session时connect_error，合法双客户端同房收到同一room_event",
    async () => {
      const port = await allocatePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const child = startBackend(port);
      backendChildren.push(child);
      await waitForServer(baseUrl);

      const noSessionSocket = io(baseUrl, {
        transports: ["websocket"],
        auth: {},
        reconnection: false,
      });
      const connectError = await once<Error>(noSessionSocket, "connect_error");
      expect(connectError.message).toContain("invalid_session");
      noSessionSocket.disconnect();

      const a = await postJson<匿名身份引导响应>(`${baseUrl}/api/session/bootstrap`, {
        device_anonymous_token: "socket-a",
      });
      const b = await postJson<匿名身份引导响应>(`${baseUrl}/api/session/bootstrap`, {
        device_anonymous_token: "socket-b",
      });
      const roomCode = uniqueRoomCode("SOCKET");
      const room = await postJson<房间快照>(`${baseUrl}/api/rooms/join-or-create`, {
        session_id: a.session_id,
        room_code: roomCode,
      });
      await postJson<房间快照>(`${baseUrl}/api/rooms/join-or-create`, {
        session_id: b.session_id,
        room_code: roomCode,
      });

      const socketA = io(baseUrl, {
        transports: ["websocket"],
        auth: { session_id: a.session_id },
        reconnection: false,
      });
      const socketB = io(baseUrl, {
        transports: ["websocket"],
        auth: { session_id: b.session_id },
        reconnection: false,
      });

      await Promise.all([once(socketA, "connect"), once(socketB, "connect")]);

      const subA = once<{ kind: string }>(socketA, "control_result");
      const subB = once<{ kind: string }>(socketB, "control_result");
      socketA.emit("subscribe_room_stream", { room_id: room.room_id, from: 0 });
      socketB.emit("subscribe_room_stream", { room_id: room.room_id, from: 0 });
      expect((await subA).kind).toBe("subscribed");
      expect((await subB).kind).toBe("subscribed");

      const eventA = once<房间事件>(socketA, "room_event");
      const eventB = once<房间事件>(socketB, "room_event");
      socketA.emit("send_text_message", {
        room_id: room.room_id,
        client_message_id: "c-real-1",
        text: "hello realtime",
      });

      const [roomEventA, roomEventB] = await Promise.all([eventA, eventB]);
      expect(roomEventA.client_message_id).toBe("c-real-1");
      expect(roomEventB.client_message_id).toBe("c-real-1");
      expect(roomEventA.message_id).toBe(roomEventB.message_id);
      expect(roomEventA.event_position).toBe(roomEventB.event_position);
      expect(roomEventA.body).toBe("hello realtime");

      socketA.disconnect();
      socketB.disconnect();
    },
    60000
  );

  it(
    "跨房间广播严格隔离，断线重连后只补发缺失事件",
    async () => {
      const port = await allocatePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const child = startBackend(port);
      backendChildren.push(child);
      await waitForServer(baseUrl);

      const a = await postJson<匿名身份引导响应>(`${baseUrl}/api/session/bootstrap`, {
        device_anonymous_token: "resume-a",
      });
      const b = await postJson<匿名身份引导响应>(`${baseUrl}/api/session/bootstrap`, {
        device_anonymous_token: "resume-b",
      });
      const c = await postJson<匿名身份引导响应>(`${baseUrl}/api/session/bootstrap`, {
        device_anonymous_token: "room2-c",
      });
      const roomCode1 = uniqueRoomCode("SOCKET");
      const roomCode2 = uniqueRoomCode("SOCKET");
      const room1 = await postJson<房间快照>(`${baseUrl}/api/rooms/join-or-create`, {
        session_id: a.session_id,
        room_code: roomCode1,
      });
      await postJson<房间快照>(`${baseUrl}/api/rooms/join-or-create`, {
        session_id: b.session_id,
        room_code: roomCode1,
      });
      const room2 = await postJson<房间快照>(`${baseUrl}/api/rooms/join-or-create`, {
        session_id: c.session_id,
        room_code: roomCode2,
      });

      const socketA = io(baseUrl, {
        transports: ["websocket"],
        auth: { session_id: a.session_id },
        reconnection: false,
      });
      const socketB = io(baseUrl, {
        transports: ["websocket"],
        auth: { session_id: b.session_id },
        reconnection: false,
      });
      const socketC = io(baseUrl, {
        transports: ["websocket"],
        auth: { session_id: c.session_id },
        reconnection: false,
      });
      await Promise.all([once(socketA, "connect"), once(socketB, "connect"), once(socketC, "connect")]);

      const subA = once<{ kind: string }>(socketA, "control_result");
      const subB = once<{ kind: string }>(socketB, "control_result");
      const subC = once<{ kind: string }>(socketC, "control_result");
      socketA.emit("subscribe_room_stream", { room_id: room1.room_id, from: 0 });
      socketB.emit("subscribe_room_stream", { room_id: room1.room_id, from: 0 });
      socketC.emit("subscribe_room_stream", { room_id: room2.room_id, from: 0 });
      await Promise.all([subA, subB, subC]);

      const firstA = once<房间事件>(socketA, "room_event");
      const firstB = once<房间事件>(socketB, "room_event");
      socketA.emit("send_text_message", {
        room_id: room1.room_id,
        client_message_id: "c-resume-1",
        text: "first message",
      });
      const [eventA1, eventB1] = await Promise.all([firstA, firstB]);
      await expectNoEvent(socketC, "room_event");

      socketB.disconnect();

      const secondA = once<房间事件>(socketA, "room_event");
      socketA.emit("send_text_message", {
        room_id: room1.room_id,
        client_message_id: "c-resume-2",
        text: "second message",
      });
      const eventA2 = await secondA;
      await expectNoEvent(socketC, "room_event");

      const socketB2 = io(baseUrl, {
        transports: ["websocket"],
        auth: { session_id: b.session_id },
        reconnection: false,
      });
      await once(socketB2, "connect");

      const resumed = once<{ kind: string }>(socketB2, "control_result");
      const replay = once<{
        room_id: string;
        latest_event_position: number;
        events: 房间事件[];
      }>(socketB2, "room_events");
      socketB2.emit("subscribe_room_stream", {
        room_id: room1.room_id,
        from: eventB1.event_position,
      });
      expect((await resumed).kind).toBe("subscribed");
      const replayed = await replay;

      expect(replayed.room_id).toBe(room1.room_id);
      expect(replayed.latest_event_position).toBe(eventA2.event_position);
      expect(replayed.events).toHaveLength(1);
      expect(replayed.events[0]?.client_message_id).toBe("c-resume-2");

      socketA.disconnect();
      socketB2.disconnect();
      socketC.disconnect();
    },
    60000
  );

  it(
    "订阅锚点超前时返回 need_snapshot_reload，而不是假装可以继续补洞",
    async () => {
      const port = await allocatePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const child = startBackend(port);
      backendChildren.push(child);
      await waitForServer(baseUrl);

      const session = await postJson<匿名身份引导响应>(`${baseUrl}/api/session/bootstrap`, {
        device_anonymous_token: "future-from",
      });
      const room = await postJson<房间快照>(`${baseUrl}/api/rooms/join-or-create`, {
        session_id: session.session_id,
        room_code: uniqueRoomCode("SOCKET"),
      });

      const socket = io(baseUrl, {
        transports: ["websocket"],
        auth: { session_id: session.session_id },
        reconnection: false,
      });
      await once(socket, "connect");

      const control = once<{
        kind: string;
        room_id: string;
        expected_position: number;
      }>(socket, "control_result");
      socket.emit("subscribe_room_stream", {
        room_id: room.room_id,
        from: 99,
      });

      const result = await control;
      expect(result.kind).toBe("need_snapshot_reload");
      expect(result.room_id).toBe(room.room_id);
      expect(result.expected_position).toBe(99);
      await expectNoEvent(socket, "room_events");

      socket.disconnect();
    },
    60000
  );

  it(
    "非成员订阅房间事件流时被拒绝，不能偷偷建立实时流",
    async () => {
      const port = await allocatePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const child = startBackend(port);
      backendChildren.push(child);
      await waitForServer(baseUrl);

      const owner = await postJson<匿名身份引导响应>(`${baseUrl}/api/session/bootstrap`, {
        device_anonymous_token: "room-owner",
      });
      const stranger = await postJson<匿名身份引导响应>(`${baseUrl}/api/session/bootstrap`, {
        device_anonymous_token: "room-stranger",
      });
      const room = await postJson<房间快照>(`${baseUrl}/api/rooms/join-or-create`, {
        session_id: owner.session_id,
        room_code: uniqueRoomCode("SOCKET"),
      });

      const socket = io(baseUrl, {
        transports: ["websocket"],
        auth: { session_id: stranger.session_id },
        reconnection: false,
      });
      await once(socket, "connect");

      const control = once<{ kind: string; code: string }>(socket, "control_result");
      socket.emit("subscribe_room_stream", {
        room_id: room.room_id,
        from: 0,
      });

      const result = await control;
      expect(result.kind).toBe("rejected");
      expect(result.code).toBe("membership_required");
      await expectNoEvent(socket, "room_events");

      socket.disconnect();
    },
    60000
  );

  it(
    "负数 from 会被视为非法参数，而不是默默当成从头补发",
    async () => {
      const port = await allocatePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const child = startBackend(port);
      backendChildren.push(child);
      await waitForServer(baseUrl);

      const session = await postJson<匿名身份引导响应>(`${baseUrl}/api/session/bootstrap`, {
        device_anonymous_token: "negative-from",
      });
      const room = await postJson<房间快照>(`${baseUrl}/api/rooms/join-or-create`, {
        session_id: session.session_id,
        room_code: uniqueRoomCode("SOCKET"),
      });

      const socket = io(baseUrl, {
        transports: ["websocket"],
        auth: { session_id: session.session_id },
        reconnection: false,
      });
      await once(socket, "connect");

      const control = once<{ kind: string; code: string }>(socket, "control_result");
      socket.emit("subscribe_room_stream", {
        room_id: room.room_id,
        from: -1,
      });

      const result = await control;
      expect(result.kind).toBe("rejected");
      expect(result.code).toBe("invalid_argument");
      await expectNoEvent(socket, "room_events");

      socket.disconnect();
    },
    60000
  );
});

function startBackend(port: number): ChildProcess {
  const child = spawn("cargo", ["run", "--quiet"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      APP_PORT: String(port),
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "admin",
      RUST_LOG: process.env.RUST_LOG ?? "warn",
    },
    stdio: "inherit",
  });
  return child;
}

async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("无法分配测试端口"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitForServer(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`服务未按时启动: ${baseUrl}`);
}

async function postJson<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${url} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`等待事件超时: ${event}`));
    }, 10000);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function expectNoEvent(socket: Socket, event: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve();
    }, 800);
    const onEvent = () => {
      clearTimeout(timer);
      socket.off(event, onEvent);
      reject(new Error(`不应收到事件: ${event}`));
    };
    socket.on(event, onEvent);
  });
}

function uniqueRoomCode(prefix: string): string {
  const normalizedPrefix = prefix.slice(0, 4).toUpperCase();
  return `${normalizedPrefix}${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0")}`;
}
