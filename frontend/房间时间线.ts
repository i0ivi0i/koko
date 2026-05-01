/**
 * 根文件只保留兼容门面。
 * 真实房间时间线 owner 已收进 `frontend/时间线/领域.ts`，
 * 避免消息合流实现继续散落在 frontend 根目录。
 */
export * from "./时间线/领域.js";
