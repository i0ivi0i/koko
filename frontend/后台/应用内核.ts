import type { 后台房间详情, 后台概览 } from "../聊天共享/契约.js";
import { 创建后台壳编排, type 后台壳编排端口 } from "./壳编排.js";
import { 创建后台会话编排, type 后台会话编排端口 } from "./会话编排.js";
import { 创建后台查询编排, type 后台查询编排端口 } from "./查询编排.js";
import {
  获取默认浏览器应用平台,
  type 浏览器应用平台,
} from "../平台/index.js";
import type { 后台会话传输端口, 后台查询传输端口 } from "../传输.js";

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
  overview: 后台概览 | null;
  roomIds: string[];
  selectedRoomId: string;
  detail: 后台房间详情 | null;
  roomFilter: string;
}

export interface 后台应用内核依赖 {
  platform?: 浏览器应用平台;
  后台查询传输?: 后台查询传输端口;
  后台会话传输?: 后台会话传输端口;
  onSnapshotChanged?(): void;
}

export interface 后台应用内核端口 {
  snapshot(): 后台应用快照;
  dispatch(command: 后台应用命令): Promise<void>;
  setTransportForTest(transport: 后台查询传输端口 & 后台会话传输端口): void;
}

/**
 * 后台应用内核必须常驻在 `frontend/后台/`：
 * 1. 它是管理员冷路径 owner，不是聊天壳“操作台”语义的一部分；
 * 2. `frontend/操作台/` 已经专指聊天输入区与附件入口，不能再回塞后台逻辑；
 * 3. 根目录 `后台*.ts` 现在只保留兼容门面，真实实现统一从这里继续收口。
 */
class 后台应用内核 implements 后台应用内核端口 {
  private readonly platform: 浏览器应用平台;
  private readonly 会话编排: 后台会话编排端口;
  private readonly 查询编排: 后台查询编排端口;
  private readonly 壳编排: 后台壳编排端口;
  private 后台查询传输: 后台查询传输端口;
  private 后台会话传输: 后台会话传输端口;
  private readonly onSnapshotChanged: () => void;

  constructor(deps: 后台应用内核依赖 = {}) {
    this.platform = deps.platform ?? 获取默认浏览器应用平台();
    this.后台查询传输 = deps.后台查询传输 ?? this.platform.transport.后台查询传输();
    this.后台会话传输 = deps.后台会话传输 ?? this.platform.transport.后台会话传输();
    this.onSnapshotChanged = deps.onSnapshotChanged ?? (() => {});
    this.会话编排 = 创建后台会话编排();
    this.查询编排 = 创建后台查询编排();
    this.壳编排 = 创建后台壳编排();
  }

  snapshot(): 后台应用快照 {
    const 会话快照 = this.会话编排.snapshot();
    const 查询快照 = this.查询编排.snapshot();
    const 壳快照 = this.壳编排.snapshot();
    return {
      username: 会话快照.username,
      password: 会话快照.password,
      token: 会话快照.token,
      // 内核对壳层只暴露结构化数据，展示字符串统一留给 presenter 派生。
      overview: 查询快照.overview,
      roomIds: this.壳编排.过滤后房间列表(查询快照.roomIds),
      selectedRoomId: 壳快照.selectedRoomId,
      detail: 查询快照.detail,
      roomFilter: 壳快照.roomFilter,
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
        this.壳编排.设置房间筛选词(command.value);
        this.通知快照变化();
        return;
      case "LOGIN_REQUESTED": {
        const out = await this.会话编排.登录(this.后台会话传输);
        await this.查询编排.加载概览(this.后台查询传输, out.token);
        await this.查询编排.加载房间列表(this.后台查询传输, out.token);
        this.通知快照变化();
        return;
      }
      case "RELOAD_ROOMS_REQUESTED": {
        const { token } = this.会话编排.snapshot();
        if (!token) {
          return;
        }
        await this.查询编排.加载房间列表(this.后台查询传输, token);
        this.通知快照变化();
        return;
      }
      case "ROOM_DETAIL_REQUESTED": {
        const { token } = this.会话编排.snapshot();
        if (!token) {
          return;
        }
        this.壳编排.选择房间(command.roomId);
        await this.查询编排.加载房间详情(this.后台查询传输, token, command.roomId);
        this.通知快照变化();
        return;
      }
    }
  }

  setTransportForTest(
    transport: 后台查询传输端口 & 后台会话传输端口
  ): void {
    this.后台查询传输 = transport;
    this.后台会话传输 = transport;
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
