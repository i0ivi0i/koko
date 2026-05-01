export interface 后台壳快照 {
  roomFilter: string;
  selectedRoomId: string;
}

export interface 后台壳编排端口 {
  snapshot(): 后台壳快照;
  设置房间筛选词(value: string): void;
  选择房间(roomId: string): void;
  过滤后房间列表(roomIds: string[]): string[];
}

/**
 * 后台壳编排只拥有页面本地体验态：
 * 1. 筛选词和选中项不会泄回后台查询真相；
 * 2. 它只在渲染前做本地投影；
 * 3. 这样查询 owner 和壳层体验态就不会再次缠在一起。
 */
export function 创建后台壳编排(
  initial: Partial<后台壳快照> = {}
): 后台壳编排端口 {
  const state: 后台壳快照 = {
    roomFilter: initial.roomFilter ?? "",
    selectedRoomId: initial.selectedRoomId ?? "",
  };

  return {
    snapshot(): 后台壳快照 {
      return { ...state };
    },

    设置房间筛选词(value: string): void {
      state.roomFilter = value;
    },

    选择房间(roomId: string): void {
      state.selectedRoomId = roomId;
    },

    过滤后房间列表(roomIds: string[]): string[] {
      const keyword = state.roomFilter.trim();
      if (!keyword) {
        return [...roomIds];
      }
      return roomIds.filter((roomId) => roomId.includes(keyword));
    },
  };
}
