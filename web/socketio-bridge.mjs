export function connectRoomSocket(baseUrl, auth, onEvent, onStatus) {
  if (typeof globalThis.io !== "function") {
    throw new Error("Socket.IO 浏览器脚本未加载");
  }

  const socket = globalThis.io(baseUrl, {
    path: "/socket.io",
    transports: ["websocket"],
    auth,
    autoConnect: false,
  });

  socket.on("connect", () => {
    onStatus({ type: "connected" });
  });

  socket.on("event", (payload) => {
    onEvent(payload);
  });

  socket.on("connect_error", (error) => {
    onStatus({
      type: "error",
      message: error?.message ?? "Socket.IO 连接失败",
    });
  });

  socket.on("error", (error) => {
    onStatus({
      type: "error",
      message:
        typeof error === "string"
          ? error
          : (error?.message ?? "Socket.IO 事件错误"),
    });
  });

  socket.on("disconnect", (reason) => {
    onStatus({
      type: "disconnected",
      message: reason || "Socket.IO 连接已断开",
    });
  });

  socket.connect();

  return {
    emitCommand(payload) {
      if (!socket.connected) {
        throw new Error("Socket.IO 连接不可用");
      }
      socket.emit("command", payload);
    },
    emitQuery(payload) {
      if (!socket.connected) {
        throw new Error("Socket.IO 连接不可用");
      }
      socket.emit("query", payload);
    },
    disconnect() {
      socket.disconnect();
    },
  };
}
