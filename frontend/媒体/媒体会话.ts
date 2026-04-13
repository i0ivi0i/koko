import type { 媒体种类 } from "../契约.js";
import type { 媒体播放输入, 媒体播放结果 } from "./媒体播放.js";

export type 媒体会话状态 =
  | "bootstrapping"
  | "playing"
  | "backfilling"
  | "recovering"
  | "waiting_for_peer_or_network"
  | "locally_complete"
  | "seeding"
  | "degraded";

export type 媒体会话信号 =
  | { type: "BOOTSTRAP_REQUESTED" }
  | { type: "PLAYER_PLAYING" }
  | { type: "PLAYER_WAITING" }
  | { type: "PLAYER_STALLED" }
  | { type: "PLAYER_ERROR" }
  | { type: "ENTER_RECOVERING" }
  | { type: "SWARM_ACTIVE" }
  | { type: "SWARM_NO_PEERS" }
  | { type: "ORIGIN_AVAILABLE" }
  | { type: "ORIGIN_UNAVAILABLE" }
  | { type: "ASSET_BACKFILLING" }
  | { type: "ASSET_COMPLETE" }
  | { type: "SEEDING_STARTED" };

export type 媒体会话快照 = {
  attachmentId: string;
  kind: 媒体种类;
  status: 媒体会话状态;
  playback: 媒体播放结果 | null;
  locallyComplete: boolean;
  sourceVersion: number;
  lastSignal: 媒体会话信号["type"] | null;
};

type 媒体会话依赖 = {
  attachmentId: string;
  kind: 媒体种类;
  解析播放结果(input: 媒体播放输入): Promise<媒体播放结果>;
  onSnapshotChange?(snapshot: 媒体会话快照): void;
};

export interface 媒体会话端口 {
  启动(): Promise<void>;
  send(signal: 媒体会话信号): void;
  snapshot(): 媒体会话快照;
  销毁(): void;
}

/**
 * 媒体会话只拥有“这一条附件当前如何播放、如何恢复”的浏览器端运行时真相。
 *
 * 这里故意不去解释房间时间线、消息成立或权限语义，只做三件事：
 * 1. 冷启动时解析一次当前可用播放源；
 * 2. 收浏览器/协作分发信号，把会话推进到 recover / waiting / complete；
 * 3. 在源失效时重新尝试解析，而不是让壳层继续死拿旧 src。
 */
export function 创建媒体会话(deps: 媒体会话依赖): 媒体会话端口 {
  let 已销毁 = false;
  let 恢复代次 = 0;
  let 正在恢复 = false;
  let 缺少群友 = false;
  let 冷源不可用 = false;

  let current: 媒体会话快照 = {
    attachmentId: deps.attachmentId,
    kind: deps.kind,
    status: "bootstrapping",
    playback: null,
    locallyComplete: false,
    sourceVersion: 0,
    lastSignal: null,
  };

  const 发布快照 = (): void => {
    deps.onSnapshotChange?.({ ...current });
  };

  const 写入快照 = (patch: Partial<媒体会话快照>): void => {
    current = {
      ...current,
      ...patch,
    };
    发布快照();
  };

  const 标记等待恢复 = (): void => {
    if (!缺少群友 || !冷源不可用) {
      return;
    }
    写入快照({
      status: "waiting_for_peer_or_network",
    });
  };

  const 应用播放结果 = (playback: 媒体播放结果): void => {
    const 下一状态: 媒体会话状态 =
      playback.mode === "degraded" || playback.mode === "expired"
        ? "degraded"
        : playback.mode === "swarm"
          ? "backfilling"
          : current.locallyComplete
            ? "locally_complete"
            : "bootstrapping";
    写入快照({
      playback,
      status: 下一状态,
      sourceVersion: current.sourceVersion + 1,
    });
  };

  const 触发恢复解析 = (): void => {
    if (已销毁 || 正在恢复) {
      return;
    }
    正在恢复 = true;
    const 当前代次 = ++恢复代次;

    void (async () => {
      const playback = await deps.解析播放结果({
        attachmentId: deps.attachmentId,
        kind: deps.kind,
      });
      if (已销毁 || 当前代次 !== 恢复代次) {
        return;
      }

      冷源不可用 = playback.mode === "degraded" || playback.mode === "expired";
      if (!冷源不可用) {
        缺少群友 = false;
      }
      应用播放结果(playback);
    })()
      .catch(() => {
        if (已销毁 || 当前代次 !== 恢复代次) {
          return;
        }
        冷源不可用 = true;
        标记等待恢复();
      })
      .finally(() => {
        if (当前代次 === 恢复代次) {
          正在恢复 = false;
        }
      });
  };

  return {
    async 启动(): Promise<void> {
      this.send({ type: "BOOTSTRAP_REQUESTED" });
      const playback = await deps.解析播放结果({
        attachmentId: deps.attachmentId,
        kind: deps.kind,
      });
      if (已销毁) {
        return;
      }
      冷源不可用 = playback.mode === "degraded" || playback.mode === "expired";
      应用播放结果(playback);
    },

    send(signal: 媒体会话信号): void {
      if (已销毁) {
        return;
      }

      current = {
        ...current,
        lastSignal: signal.type,
      };

      switch (signal.type) {
        case "BOOTSTRAP_REQUESTED":
          缺少群友 = false;
          冷源不可用 = false;
          写入快照({
            status: "bootstrapping",
          });
          return;
        case "PLAYER_PLAYING":
          写入快照({
            status: current.locallyComplete ? "locally_complete" : "playing",
          });
          return;
        case "ASSET_BACKFILLING":
          if (!current.locallyComplete) {
            写入快照({
              status: "backfilling",
            });
          }
          return;
        case "ASSET_COMPLETE":
          写入快照({
            status: "locally_complete",
            locallyComplete: true,
          });
          return;
        case "SEEDING_STARTED":
          if (current.locallyComplete) {
            写入快照({
              status: "seeding",
            });
          }
          return;
        case "SWARM_ACTIVE":
          缺少群友 = false;
          if (current.status === "waiting_for_peer_or_network") {
            写入快照({
              status: current.locallyComplete ? "locally_complete" : "recovering",
            });
            触发恢复解析();
          }
          return;
        case "SWARM_NO_PEERS":
          缺少群友 = true;
          标记等待恢复();
          return;
        case "ORIGIN_AVAILABLE":
          冷源不可用 = false;
          if (current.status === "waiting_for_peer_or_network") {
            写入快照({
              status: "recovering",
            });
            触发恢复解析();
          }
          return;
        case "ORIGIN_UNAVAILABLE":
          冷源不可用 = true;
          标记等待恢复();
          return;
        case "ENTER_RECOVERING":
        case "PLAYER_WAITING":
        case "PLAYER_STALLED":
        case "PLAYER_ERROR":
          写入快照({
            status: "recovering",
          });
          触发恢复解析();
          return;
      }
    },

    snapshot(): 媒体会话快照 {
      return { ...current };
    },

    销毁(): void {
      已销毁 = true;
      恢复代次 += 1;
    },
  };
}

export type { 媒体会话依赖 };
