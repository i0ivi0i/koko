/**
 * 根文件只保留兼容门面。
 * 真实时间线运行时 owner 已收进 `frontend/时间线/运行时.ts`，
 * 避免时间线状态机继续散落在 frontend 根目录。
 */
export * from "./时间线/运行时.js";
