import type { 媒体播放会话应用端口 } from "../媒体/播放会话/应用.js";
import {
  处理历史房间进房请求,
  处理房间号输入变更,
  处理进房请求,
} from "../房间/应用.js";
import { 处理发送消息请求, 处理消息输入变更 } from "../输入框/应用.js";
import type { 聊天输入状态 } from "./聊天状态.js";
import type { 聊天应用命令 } from "./聊天应用内核.js";
import type { 平台桥接命令 } from "./聊天内核平台运行时.js";

type 聊天应用命令编排器 = {
  bootstrap(): Promise<void>;
  joinRoom(): Promise<void>;
  sendMessage(): Promise<void>;
  请求跳到最新(): Promise<void>;
};

type 房间滚动命令端口 = {
  处理滚动事件(): void;
};

type 房间视口命令端口 = {
  send(
    event:
      | { type: "JUMP_TO_LATEST_REQUESTED" }
      | { type: "PROGRAMMATIC_SCROLL_STARTED"; reason: "compensate_history" }
  ): void;
};

export interface 聊天应用命令路由依赖 {
  编排协调器: 聊天应用命令编排器;
  媒体编排: 媒体播放会话应用端口;
  roomScroller: 房间滚动命令端口;
  roomViewport: 房间视口命令端口;
  读取媒体草稿(): 聊天输入状态["composerMediaDrafts"];
  读取媒体选择中过渡计数(): 聊天输入状态["mediaSelectionPendingCount"];
  写入房间号输入(value: string): void;
  写入消息输入(value: string): void;
  标记用户滚动意图(): void;
  同步房间视口快照(): void;
  处理平台桥接命令(command: 平台桥接命令): Promise<void>;
  leaveCurrentRoomView(): void;
}

/**
 * 命令路由只做“命令 -> owner”的分发。
 * 业务裁决、状态写入、媒体会话与平台副作用都已经各归自己的 helper / actor / 编排 owner，
 * 因此这里不再自己长出第二套状态机。
 */
export async function 处理聊天应用命令(
  command: 聊天应用命令,
  deps: 聊天应用命令路由依赖
): Promise<void> {
  switch (command.type) {
    case "BOOTSTRAP_REQUESTED":
      await deps.编排协调器.bootstrap();
      return;
    case "ROOM_CODE_INPUT_CHANGED":
      处理房间号输入变更({
        value: command.value,
        写入房间号输入: (value) => {
          deps.写入房间号输入(value);
        },
      });
      return;
    case "MESSAGE_INPUT_CHANGED":
      处理消息输入变更({
        value: command.value,
        写入消息输入: (value) => {
          deps.写入消息输入(value);
        },
      });
      return;
    case "JOIN_ROOM_REQUESTED":
      await 处理进房请求({
        roomCode: command.roomCode,
        写入房间号输入: (value) => {
          deps.写入房间号输入(value);
        },
        触发进房: () => deps.编排协调器.joinRoom(),
      });
      return;
    case "JOIN_HISTORY_ROOM_REQUESTED":
      await 处理历史房间进房请求({
        roomCode: command.roomCode,
        写入房间号输入: (value) => {
          deps.写入房间号输入(value);
        },
        触发进房: () => deps.编排协调器.joinRoom(),
      });
      return;
    case "LEAVE_ROOM_VIEW_REQUESTED":
      deps.leaveCurrentRoomView();
      return;
    case "SEND_MESSAGE_REQUESTED":
      await 处理发送消息请求({
        读取媒体草稿: () => deps.读取媒体草稿(),
        读取媒体选择中数量: () => deps.读取媒体选择中过渡计数(),
        触发发送: () => deps.编排协调器.sendMessage(),
        清空媒体草稿: () => deps.媒体编排.清空草稿(),
      });
      return;
    case "ROOM_SCROLL_INTENT":
      deps.标记用户滚动意图();
      return;
    case "ROOM_SCROLL_OBSERVED":
      deps.roomScroller.处理滚动事件();
      return;
    case "ROOM_MEDIA_WINDOW_OBSERVED":
      deps.媒体编排.同步媒体窗口附件(command.attachmentIds);
      return;
    case "MEDIA_INLINE_AUTOPLAY_OBSERVED":
      deps.媒体编排.处理自动播候选(command.candidates);
      return;
    case "MEDIA_INLINE_AUTOPLAY_POSITION_CHANGED":
      deps.媒体编排.更新媒体播放位置({
        attachmentId: command.attachmentId,
        position: command.position,
      });
      return;
    case "ROOM_JUMP_TO_LATEST_REQUESTED":
      deps.roomViewport.send({ type: "JUMP_TO_LATEST_REQUESTED" });
      deps.同步房间视口快照();
      await deps.编排协调器.请求跳到最新();
      return;
    case "MEDIA_OPEN_REQUESTED":
      deps.媒体编排.打开查看器(command.request);
      return;
    case "MEDIA_SESSION_SIGNALLED":
      deps.媒体编排.处理媒体会话信号(command.attachmentId, command.signal);
      return;
    case "MEDIA_FILES_SELECTED":
      await deps.媒体编排.处理选择媒体文件(command.files);
      return;
    case "MEDIA_DRAFT_REMOVE_REQUESTED":
      deps.媒体编排.移除媒体草稿(command.localId);
      return;
    case "MEDIA_DRAFT_RESUME_REQUESTED":
      await deps.媒体编排.继续上传媒体草稿(command.localId);
      return;
    case "MEDIA_DRAFT_RESTART_REQUESTED":
      await deps.媒体编排.重新上传媒体草稿(command.localId);
      return;
    case "PLATFORM_LIFECYCLE_CHANGED":
    case "PLATFORM_SERVICE_WORKER_UPDATE_READY":
    case "PLATFORM_SERVICE_WORKER_CONTROLLER_READY":
    case "PLATFORM_CACHE_UPDATE_CHANGED":
    case "PLATFORM_BACKGROUND_DRAIN_REQUESTED":
    case "PLATFORM_OFFLINE_STATUS_CHANGED":
      await deps.处理平台桥接命令(command);
      return;
  }
}
