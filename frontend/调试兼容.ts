/**
 * 根目录 `调试兼容.ts` 只保留兼容门面：
 * 1. 现有调用方暂时还能继续从根目录拿 `debug` 兼容出口；
 * 2. 真实浏览器兼容 owner 已经收进 `frontend/平台/调试兼容.ts`；
 * 3. 后续内部引用应优先改向平台 owner，避免根目录继续承担实现。
 */
export * from "./平台/调试兼容.js";
export { default } from "./平台/调试兼容.js";
