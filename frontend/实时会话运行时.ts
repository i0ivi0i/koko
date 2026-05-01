/**
 * 根文件只保留兼容门面。
 * 真实实时会话运行时 owner 已收进 `frontend/实时/会话运行时.ts`，
 * 避免实时连接状态机继续散落在 frontend 根目录。
 */
export * from "./实时/会话运行时.js";
