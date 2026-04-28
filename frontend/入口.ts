import "@uppy/core/css/style.min.css";
import "photoswipe/style.css";
import { 获取默认浏览器应用平台 } from "./平台/index.js";
import "./聊天壳.js";

const 平台 = 获取默认浏览器应用平台();
void 平台.启动();

// 首页默认只加载聊天壳；后台壳按需懒加载，减少首屏无关脚本体积。
if (document.querySelector("koko-admin-shell")) {
  void import("./后台壳.js");
}
