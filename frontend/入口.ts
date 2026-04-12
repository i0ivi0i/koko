import "@uppy/core/css/style.min.css";
import "photoswipe/style.css";
import "vidstack/styles/defaults.css";
import "vidstack/styles/community-skin/video.css";
import "./聊天壳.js";

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/app-sw.js", { scope: "/" }).catch(() => undefined);
  void navigator.serviceWorker.register("/media-sw.js", { scope: "/" }).catch(() => undefined);
}

if ("storage" in navigator && "persist" in navigator.storage) {
  void navigator.storage.persist().catch(() => undefined);
}

// 首页默认只加载聊天壳；后台壳按需懒加载，减少首屏无关脚本体积。
if (document.querySelector("koko-admin-shell")) {
  void import("./后台壳.js");
}
