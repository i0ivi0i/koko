import { afterEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

type 会话快照 = {
  session_id: string;
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

      const a = await postJson<会话快照>(`${baseUrl}/api/session/bootstrap`, {
        display_name: "socket-a",
      });
      const b = await postJson<会话快照>(`${baseUrl}/api/session/bootstrap`, {
        display_name: "socket-b",
      });
      const room = await postJson<房间快照>(`${baseUrl}/api/rooms/join-or-create`, {
        session_id: a.session_id,
        room_code: "SOCKET01",
      });
      await postJson<房间快照>(`${baseUrl}/api/rooms/join-or-create`, {
        session_id: b.session_id,
        room_code: "SOCKET01",
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
