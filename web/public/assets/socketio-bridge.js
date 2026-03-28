import { io } from "https://cdn.socket.io/4.8.3/socket.io.esm.min.js";

function normalizeBaseUrl(apiBase) {
  return String(apiBase ?? "").replace(/\/+$/, "");
}

function toErrorMessage(error) {
  if (!error) {
    return "未知连接错误";
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error.message === "string" && error.message.trim() !== "") {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function createRoomSocket(apiBase, sessionId, roomId, onEvent, onStatus, onError) {
  const socket = io(normalizeBaseUrl(apiBase), {
    autoConnect: false,
    path: "/socket.io",
    transports: ["websocket"],
    auth: {
      session_id: sessionId,
      room_id: roomId,
    },
  });

  onStatus("connecting");

  socket.on("connect", () => {
    onStatus("connected");
  });

  socket.on("disconnect", (reason) => {
    if (reason === "io client disconnect") {
      onStatus("closed");
      return;
    }

    if (reason === "io server disconnect") {
      onStatus("disconnected");
      return;
    }

    onStatus("reconnecting");
  });

  socket.on("connect_error", (error) => {
    onStatus(socket.active ? "reconnecting" : "disconnected");
    onError(toErrorMessage(error));
  });

  socket.io.on("reconnect_attempt", () => {
    onStatus("reconnecting");
  });

  socket.io.on("reconnect", () => {
    onStatus("connected");
  });

  socket.on("error", (payload) => {
    onError(toErrorMessage(payload));
  });

  socket.on("event", (payload) => {
    onEvent(JSON.stringify(payload));
  });

  socket.connect();
  return socket;
}

export function emitCommand(socket, commandJson) {
  socket.emit("command", JSON.parse(commandJson));
}

export function closeSocket(socket) {
  socket.disconnect();
}
