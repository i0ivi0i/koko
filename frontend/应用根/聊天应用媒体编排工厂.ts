import type { 媒体播放会话应用端口 } from "../媒体/播放会话/应用.js";
import type { 聊天时间线状态, 聊天输入状态 } from "./聊天状态.js";
import type { 聊天内核平台端口 } from "./聊天应用编排桥接.js";
import { 创建媒体播放会话应用 } from "../媒体/播放会话/应用.js";

type 聊天媒体平台扩展 = {
  媒体资产仓库?: 聊天内核平台端口["媒体资产仓库"];
  媒体定位仓库?: 聊天内核平台端口["媒体定位仓库"];
  视频预览仓库?: 聊天内核平台端口["视频预览仓库"];
};

export interface 聊天应用媒体编排工厂输入 {
  读取媒体传输(): ReturnType<聊天内核平台端口["媒体传输"]>;
  读取会话编号(): string;
  读取当前房间标识(): string | null;
  读取消息(): 聊天时间线状态["messages"];
  读取草稿(): 聊天输入状态["composerMediaDrafts"];
  写入媒体选择中过渡计数(count: 聊天输入状态["mediaSelectionPendingCount"]): void;
  平台扩展: 聊天媒体平台扩展;
  写入草稿列表(nextDrafts: 聊天输入状态["composerMediaDrafts"]): void;
  请求重渲染(): void;
  回收媒体草稿预览地址(previewUrls: string[]): void;
  登记程序滚动来源(source: "media_viewer_open"): void;
  清除程序滚动来源(source: "media_viewer_open"): void;
}

/**
 * 媒体播放会话应用的装配留在独立工厂里，
 * 避免聊天应用内核构造函数同时兼任平台缓存探测、媒体依赖注入和草稿副作用拼装器。
 */
export function 创建聊天应用媒体编排(
  input: 聊天应用媒体编排工厂输入
): 媒体播放会话应用端口 {
  return 创建媒体播放会话应用({
    transport: () => input.读取媒体传输(),
    读取会话编号: () => input.读取会话编号(),
    读取当前房间标识: () => input.读取当前房间标识(),
    读取消息: () => input.读取消息(),
    读取草稿: () => input.读取草稿(),
    写入媒体选择中过渡计数: (count) => input.写入媒体选择中过渡计数(count),
    ...(input.平台扩展.媒体资产仓库
      ? { 媒体缓存仓库: input.平台扩展.媒体资产仓库() }
      : {}),
    ...(input.平台扩展.媒体定位仓库
      ? { 媒体定位仓库: input.平台扩展.媒体定位仓库() }
      : {}),
    ...(input.平台扩展.视频预览仓库
      ? { 预览缓存: input.平台扩展.视频预览仓库() }
      : {}),
    写入草稿列表: (nextDrafts) => input.写入草稿列表(nextDrafts),
    请求重渲染: () => input.请求重渲染(),
    回收媒体草稿预览地址: (previewUrls) => input.回收媒体草稿预览地址(previewUrls),
    登记程序滚动来源: (source) => input.登记程序滚动来源(source),
    清除程序滚动来源: (source) => input.清除程序滚动来源(source),
  });
}
