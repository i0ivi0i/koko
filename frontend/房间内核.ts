/**
 * 根文件只保留兼容门面。
 * 真实房间运行时 owner 已收进 `frontend/房间/运行时.ts`，
 * 避免房间状态机继续散落在 frontend 根目录。
 */
export * from "./房间/运行时.js";
