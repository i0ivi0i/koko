/**
 * 这个文件现在只保留“稳定测试入口”职责：
 * 1. 继续给旧 spec 提供不改 import 的兼容表面；
 * 2. 把真实 owner 下沉到按职责拆开的测试支架文件；
 * 3. 阻止新的假对象、DOM helper、编排场景再重新堆回单个超大文件。
 */
import "./测试原型补丁.js";

export * from "./测试文本测量.js";
export * from "./假存储.js";
export * from "./假实时.js";
export * from "./假传输.js";
export * from "./聊天壳DOM支架.js";
export * from "./恢复编排支架.js";
export * from "./实时编排支架.js";
export * from "./阅读推进支架.js";
