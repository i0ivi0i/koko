window.kokoSocketBridge = window.kokoSocketBridge || {
  connect(options = {}) {
    if (typeof window.io !== "function") {
      throw new Error("socket.io-client global `io` is required");
    }

    return window.io(options.url ?? "/", {
      auth: options.auth ?? {},
      autoConnect: options.autoConnect ?? true,
    });
  },
};
