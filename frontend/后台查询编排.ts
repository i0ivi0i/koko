import type { 后台房间详情, 后台概览 } from "./契约.js";
import type { 前端传输端口 } from "./传输.js";

export interface 后台查询快照 {
  overview: 后台概览 | null;
  roomIds: string[];
  roomFilter: string;
  selectedRoomId: string;
  detail: 后台房间详情 | null;
}

export interface 后台查询编排端口 {
  snapshot(): 后台查询快照;
  设置房间筛选词(value: string): void;
  过滤后房间列表(): string[];
  加载概览(transport: 前端传输端口, token: string): Promise<void>;
  加载房间列表(transport: 前端传输端口, token: string): Promise<void>;
  加载房间详情(
    transport: 前端传输端口,
    token: string,
    roomId: string
  ): Promise<void>;
}

/**
 * 后台查询编排只负责后台读模型：
 * 1. 概览、房间列表、详情都属于后台查询真相；
 * 2. 筛选词属于后台壳本地体验态，也一起并在这里，避免壳层再保存第二份；
 * 3. 它只拿 token 去查询，不自己发明登录状态。
 */
export function 创建后台查询编排(
  initial: Partial<后台查询快照> = {}
): 后台查询编排端口 {
  const state: 后台查询快照 = {
    overview: initial.overview ?? null,
    roomIds: initial.roomIds ?? [],
    roomFilter: initial.roomFilter ?? "",
    selectedRoomId: initial.selectedRoomId ?? "",
    detail: initial.detail ?? null,
  };

  return {
    snapshot(): 后台查询快照 {
      return {
        overview: state.overview ? { ...state.overview } : null,
        roomIds: [...state.roomIds],
        roomFilter: state.roomFilter,
        selectedRoomId: state.selectedRoomId,
        detail: state.detail ? { ...state.detail } : null,
      };
    },

    设置房间筛选词(value: string): void {
      state.roomFilter = value;
    },

    过滤后房间列表(): string[] {
      const keyword = state.roomFilter.trim();
      if (!keyword) {
        return [...state.roomIds];
      }
      return state.roomIds.filter((roomId) => roomId.includes(keyword));
    },

    async 加载概览(transport: 前端传输端口, token: string): Promise<void> {
      state.overview = await transport.loadAdminOverview(token);
    },

    async 加载房间列表(transport: 前端传输端口, token: string): Promise<void> {
      const rooms = await transport.adminRooms(token);
      state.roomIds = [...rooms.rooms];
    },

    async 加载房间详情(
      transport: 前端传输端口,
      token: string,
      roomId: string
    ): Promise<void> {
      state.selectedRoomId = roomId;
      state.detail = await transport.adminRoomDetail(token, roomId);
    },
  };
}
