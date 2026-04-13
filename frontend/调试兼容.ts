// @ts-expect-error debug 官方 browser 入口没有单独的 d.ts；这里是受控兼容桥，显式接受这层类型缺口。
import debugFactory from "./node_modules/debug/src/browser.js";

/**
 * 第三方浏览器 P2P 轮子内部仍有 `import { debug } from "debug"` 这一类 CJS/ESM 互操作口。
 * 这里不改第三方源码，也不包第二套日志层，只做一层最薄的 named export 兼容桥。
 */
export const debug = debugFactory;
export default debugFactory;
