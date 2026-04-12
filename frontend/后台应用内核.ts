import { 创建后台会话编排, type 后台会话编排端口 } from "./后台会话编排.js";
import { 创建后台查询编排, type 后台查询编排端口 } from "./后台查询编排.js";
import {
  获取默认浏览器应用平台,
  type 浏览器应用平台,
} from "./平台/index.js";
import type { 前端传输端口 } from "./传输.js";
import { 格式化后台概览 } from "./视图.js";

export type 后台应用命令 =
  | { type: "USERNAME_CHANGED"; value: string }
  | { type: "PASSWORD_CHANGED"; value: string }
  | { type: "LOGIN_REQUESTED" }
  | { type: "ROOM_FILTER_CHANGED"; value: string }
  | { type: "RELOAD_ROOMS_REQUESTED" }
  | { type: "ROOM_DETAIL_REQUESTED"; roomId: string };

export interface 后台应用快照 {
  username: string;
  password: string;
  token: string;
  overviewText: string;
  roomIds: string[];
  detailText: string;
  roomFilter: string;
}

export interface 后台应用内核依赖 {
  platform?: 浏览器应用平台;
  transport?: 前端传输端口;
  onSnapshotChanged?(): void;
}

export interface 后台应用内核端口 {
  snapshot(): 后台应用快照;
  dispatch(command: 后台应用命令): Promise<void>;
  setTransportForTest(transport: 前端传输端口): void;
}

class 后台应用内核 implements 后台应用内核端口 {
  private readonly platform: 浏览器应用平台;
  private readonly 会话编排: 后台会话编排端口;
  private readonly 查询编排: 后台查询编排端口;
  private transport: 前端传输端口;
  private readonly onSnapshotChanged: () => void;

  constructor(deps: 后台应用内核依赖 = {}) {
    this.platform = deps.platform ?? 获取默认浏览器应用平台();
    this.transport = deps.transport ?? this.platform.transport.transport();
    this.onSnapshotChanged = deps.onSnapshotChanged ?? (() => {});
    this.会话编排 = 创建后台会话编排();
    this.查询编排 = 创建后台查询编排();
  }

  snapshot(): 后台应用快照 {
    const 会话快照 = this.会话编排.snapshot();
    const 查询快照 = this.查询编排.snapshot();
    return {
      username: 会话快照.username,
      password: 会话快照.password,
      token: 会话快照.token,
      overviewText: 查询快照.overview
        ? 格式化后台概览(
            查询快照.overview.room_count,
            查询快照.overview.message_count
          )
        : "-",
      roomIds: this.查询编排.过滤后房间列表(),
      detailText: 查询快照.detail
        ? `房间 ${查询快照.detail.room_id}，位置 ${查询快照.detail.latest_event_position}，消息 ${查询快照.detail.message_count}`
        : "-",
      roomFilter: 查询快照.roomFilter,
    };
  }

  async dispatch(command: 后台应用命令): Promise<void> {
    switch (command.type) {
      case "USERNAME_CHANGED":
        this.会话编排.设置用户名(command.value);
        this.通知快照变化();
        return;
      case "PASSWORD_CHANGED":
        this.会话编排.设置密码(command.value);
        this.通知快照变化();
        return;
      case "ROOM_FILTER_CHANGED":
        this.查询编排.设置房间筛选词(command.value);
        this.通知快照变化();
        return;
      case "LOGIN_REQUESTED": {
        const out = await this.会话编排.登录(this.transport);
        await this.查询编排.加载概览(this.transport, out.token);
        await this.查询编排.加载房间列表(this.transport, out.token);
        this.通知快照变化();
        return;
      }
      case "RELOAD_ROOMS_REQUESTED": {
        const { token } = this.会话编排.snapshot();
        if (!token) {
          return;
        }
        await this.查询编排.加载房间列表(this.transport, token);
        this.通知快照变化();
        return;
      }
      case "ROOM_DETAIL_REQUESTED": {
        const { token } = this.会话编排.snapshot();
        if (!token) {
          return;
        }
        await this.查询编排.加载房间详情(this.transport, token, command.roomId);
        this.通知快照变化();
        return;
      }
    }
  }

  setTransportForTest(transport: 前端传输端口): void {
    this.transport = transport;
  }

  private 通知快照变化(): void {
    this.onSnapshotChanged();
  }
}

export function 创建后台应用内核(
  deps: 后台应用内核依赖 = {}
): 后台应用内核端口 {
  return new 后台应用内核(deps);
}
