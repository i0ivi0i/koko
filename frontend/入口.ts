import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import "./聊天壳.js";

// 首页默认只加载聊天壳；后台壳按需懒加载，减少首屏无关脚本体积。
if (document.querySelector("koko-admin-shell")) {
  void import("./后台壳.js");
}
