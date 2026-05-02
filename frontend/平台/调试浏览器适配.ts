// @ts-expect-error debug 官方 browser 入口没有单独的 d.ts；这里把类型缺口锁在平台适配 owner 内。
import debugFactory from "../node_modules/debug/src/browser.js";

/**
 * 第三方浏览器 P2P 轮子内部仍有 `import { debug } from "debug"` 这一类 CJS/ESM 互操作口。
 * 平台层统一兜住这条浏览器适配边界，避免根目录再次长回真实实现。
 */
export const debug = debugFactory;
export default debugFactory;
