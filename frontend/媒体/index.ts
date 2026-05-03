/**
 * 媒体 published surface 只暴露跨 owner 真正共享的稳定类型与工厂。
 * 禁止再把整个媒体子域通过 `export *` 抬成第二入口；
 * 拿不到的能力就直连真实 owner 文件，而不是继续往这里堆。
 */
export {
  type 媒体附件草稿,
  type 媒体草稿状态补丁,
  写入媒体草稿,
  更新媒体草稿状态,
  移除媒体草稿,
} from "./媒体草稿.js";
export {
  type 媒体缓存仓库,
  type 媒体缓存快照,
  创建媒体缓存,
  创建内存媒体缓存仓库,
} from "./媒体缓存.js";
export {
  type 媒体会话信号,
  type 媒体会话快照,
  type 媒体会话端口,
  创建媒体会话,
} from "./媒体会话.js";
export {
  type 消息视频自动播候选,
  排序消息视频自动播候选,
  选择消息视频自动播Owner,
  选择消息视频自动播连续Owner候选,
} from "./消息视频自动播编排.js";
export { type 协作分发会话事件 } from "./媒体协作分发.js";
export { type WebTorrentSessionLifecycleSnapshot } from "./资产协作分发运行时.js";
export { 创建媒体发布器 } from "./媒体发布.js";
export {
  type 媒体定位缓存仓库,
  创建媒体定位器,
  创建内存媒体定位缓存仓库,
} from "./媒体定位.js";
export {
  type 媒体播放结果,
  type 媒体播放位置,
  创建媒体播放器,
  视频地址属于旧流媒体清单,
} from "./媒体播放.js";
export {
  type 媒体查看器打开请求,
  创建媒体查看器,
} from "./媒体查看器.js";
export {
  type 预览缓存记录,
  type 预览缓存端口,
  创建内存预览缓存,
} from "./预览缓存.js";
export {
  type 视频预览状态,
  从媒体源抓取视频预览,
} from "./视频预览.js";
