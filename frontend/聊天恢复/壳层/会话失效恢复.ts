import type { 聊天状态 } from "../../应用根/聊天状态.js";

type 恢复状态 = Pick<聊天状态, "deviceAnonymousToken" | "roomId">;

type 匿名身份引导结果 = {
  display_alias: string;
  session_id: string;
};

export interface 会话失效恢复协作依赖 {
  读取恢复状态(): 恢复状态;
  读取或创建设备匿名凭证(): string;
  bootstrapAnonymousIdentity(deviceAnonymousToken: string): Promise<匿名身份引导结果>;
  disconnectRealtime(): void;
  应用引导身份(
    deviceAnonymousToken: string,
    identity: 匿名身份引导结果
  ): void;
  广播会话已刷新(identity: 匿名身份引导结果): void;
  ensureRealtimeSocket(sessionId: string): void | Promise<void>;
  从房间快照恢复(roomId: string): Promise<void>;
  处理恢复失败(error: unknown, keepRoomVisible: boolean): void;
  读取恢复失败代码(error: unknown): string | undefined;
  上报引导失败(code: string): void;
}

export interface 会话失效恢复协作 {
  刷新会话(): Promise<string>;
  处理会话失效Transport异常(roomId: string, keepRoomVisible: boolean): Promise<void>;
}

export function 创建会话失效恢复协作(
  deps: 会话失效恢复协作依赖
): 会话失效恢复协作 {
  let invalidSessionRecoveryTask: Promise<void> | null = null;

  /**
   * session refresh 只负责重建当前权威会话并重连 realtime；
   * 后续是否需要重拉房间，由外层恢复链继续决定。
   */
  async function 刷新会话(): Promise<string> {
    const deviceAnonymousToken =
      deps.读取恢复状态().deviceAnonymousToken || deps.读取或创建设备匿名凭证();
    const identity = await deps.bootstrapAnonymousIdentity(deviceAnonymousToken);
    deps.disconnectRealtime();
    deps.应用引导身份(deviceAnonymousToken, identity);
    deps.广播会话已刷新(identity);
    await deps.ensureRealtimeSocket(identity.session_id);
    return identity.session_id;
  }

  /**
   * invalid_session 不区分来自握手阶段还是控制面阶段；
   * 恢复门闩只允许同一时刻跑一轮 bootstrap -> room restore。
   */
  async function 处理会话失效Transport异常(
    roomId: string,
    keepRoomVisible: boolean
  ): Promise<void> {
    if (invalidSessionRecoveryTask) {
      await invalidSessionRecoveryTask;
      return;
    }
    const targetRoomId = roomId.trim();
    invalidSessionRecoveryTask = (async () => {
      try {
        await 刷新会话();
        if (targetRoomId) {
          await deps.从房间快照恢复(targetRoomId);
        }
      } catch (recoveryError) {
        if (keepRoomVisible) {
          deps.处理恢复失败(recoveryError, true);
        } else {
          deps.上报引导失败(deps.读取恢复失败代码(recoveryError) ?? "system_error");
        }
      } finally {
        invalidSessionRecoveryTask = null;
      }
    })();
    await invalidSessionRecoveryTask;
  }

  return {
    刷新会话,
    处理会话失效Transport异常,
  };
}
