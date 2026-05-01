/**
 * 过渡期门面：
 * 真正的 realtime owner 已搬到 `frontend/实时/应用.ts`。
 * 这里保留旧文件名，只为了让当前 import 面和测试工厂不需要一次性推倒重接。
 * 新的 realtime 真相禁止继续回流到这份文件。
 */
export {
  创建实时应用 as 创建房间实时编排,
  type 实时应用依赖 as 房间实时编排依赖,
  type 实时应用端口 as 房间实时编排端口,
} from "./实时/应用.js";
