import { io } from "socket.io-client";

export function connectRoomSocket(baseUrl, auth, onEvent) {
  const socket = io(baseUrl, {
    path: "/socket.io",
    transports: ["websocket"],
    auth,
  });

  socket.on("event", (payload) => {
    onEvent(payload);
  });

  socket.on("connect_error", (error) => {
    console.error("socket.io connect_error", error);
  });

  socket.on("error", (error) => {
    console.error("socket.io error", error);
  });

  return {
    emitCommand(payload) {
      socket.emit("command", payload);
    },
    emitQuery(payload) {
      socket.emit("query", payload);
    },
    disconnect() {
      socket.disconnect();
    },
  };
}
