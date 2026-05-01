export interface 房间号输入变更请求 {
  value: string;
  写入房间号输入(value: string): void;
}

export interface 进房请求 {
  roomCode: string | undefined;
  写入房间号输入(value: string): void;
  触发进房(): Promise<void>;
}

export interface 历史房间进房请求 {
  roomCode: string;
  写入房间号输入(value: string): void;
  触发进房(): Promise<void>;
}

function 规范化房间短码(roomCode: string): string {
  return roomCode.trim();
}

/**
 * 房间号输入应用只拥有输入框本地体验态：
 * 1. 它可以决定写入哪个值；
 * 2. 它不能越层直接碰恢复链、实时链或房间事实；
 * 3. join 是否真正成立仍由恢复编排和后端契约裁决。
 */
export function 处理房间号输入变更({
  value,
  写入房间号输入,
}: 房间号输入变更请求): void {
  写入房间号输入(value);
}

/**
 * 进房请求的前置裁剪必须收在房间应用里：
 * - 聊天应用内核只负责派发命令；
 * - 房间短码清洗和空白拒绝不再散落在 dispatch 分支里；
 * - 真正进房仍然只通过恢复编排入口进入同一条主链。
 */
export async function 处理进房请求({
  roomCode,
  写入房间号输入,
  触发进房,
}: 进房请求): Promise<void> {
  if (typeof roomCode === "string") {
    const trimmedRoomCode = 规范化房间短码(roomCode);
    if (!trimmedRoomCode) {
      return;
    }
    写入房间号输入(trimmedRoomCode);
  }
  await 触发进房();
}

/**
 * 历史房间入口必须比普通 join 更严格：
 * - 历史记录可能混入旧缓存或空白值；
 * - 因此空白短码直接拦截，不把脏输入继续推给恢复编排。
 */
export async function 处理历史房间进房请求({
  roomCode,
  写入房间号输入,
  触发进房,
}: 历史房间进房请求): Promise<void> {
  const trimmedRoomCode = 规范化房间短码(roomCode);
  if (!trimmedRoomCode) {
    return;
  }
  写入房间号输入(trimmedRoomCode);
  await 触发进房();
}
