import type { 媒体种类 } from "../聊天共享/契约.js";
import type { 媒体播放输入, 媒体播放结果 } from "./媒体播放.js";

const 连接群友重试毫秒 = 2_000;
const 无在线种子重试毫秒 = 15_000;

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
  | { type: "PLAYBACK_RELEASED" }
  | { type: "SWARM_ACTIVE" }
  | { type: "SWARM_NO_PEERS" }
  | { type: "SWARM_TICKET_INVALID" }
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
  let 解析代次 = 0;
  let 正在恢复 = false;
  let 缺少群友 = false;
  let 冷源不可用 = false;
  let 播放器恢复窗口已触发 = false;
  let 降级恢复重试定时器: ReturnType<typeof setTimeout> | null = null;
  const 会话ConsumerId = `session:${deps.attachmentId}`;

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

  const 清理降级恢复重试定时器 = (): void => {
    if (降级恢复重试定时器 === null) {
      return;
    }
    clearTimeout(降级恢复重试定时器);
    降级恢复重试定时器 = null;
  };

  const 读取降级重试间隔毫秒 = (playback: 媒体播放结果): number | null => {
    if (playback.mode !== "degraded") {
      return null;
    }
    if (playback.reason === "connecting_to_peers") {
      return 连接群友重试毫秒;
    }
    if (playback.reason === "no_online_seed") {
      return 无在线种子重试毫秒;
    }
    return null;
  };

  const 安排降级恢复重试 = (playback: 媒体播放结果): void => {
    清理降级恢复重试定时器();
    const retryMs = 读取降级重试间隔毫秒(playback);
    if (retryMs === null || 已销毁) {
      return;
    }
    /**
     * degraded=connecting/no_seed 不是终点，而是恢复节奏的一部分：
     * 1. connecting_to_peers: 2 秒短轮询，尽快发现 peer 恢复；
     * 2. no_online_seed: 15 秒慢轮询，避免空转风暴；
     * 3. 重试触发后统一走现有恢复解析，不额外长第二套重试状态机。
     */
    降级恢复重试定时器 = setTimeout(() => {
      降级恢复重试定时器 = null;
      if (已销毁) {
        return;
      }
      播放器恢复窗口已触发 = true;
      写入快照({
        status: "recovering",
      });
      触发恢复解析();
    }, retryMs);
  };

  const 标记等待恢复 = (): void => {
    if (!缺少群友 || !冷源不可用) {
      return;
    }
    写入快照({
      status: "waiting_for_peer_or_network",
    });
  };

  const 应忽略播放器恢复信号 = (): boolean =>
    播放器恢复窗口已触发 ||
    current.status === "recovering" ||
    current.status === "waiting_for_peer_or_network";

  const 当前存在可恢复播放源 = (): boolean =>
    Boolean(current.playback) &&
    current.playback?.mode !== "degraded" &&
    current.playback?.mode !== "expired";

  const 当前是协作分发视频播放 = (): boolean =>
    current.playback?.kind === "video" && current.playback?.mode === "swarm";

  const 读取播放源版本键 = (playback: 媒体播放结果 | null): string => {
    if (!playback) {
      return "none";
    }
    const viewerSrc = "viewerSrc" in playback ? playback.viewerSrc ?? "" : "";
    const contentHash = "contentHash" in playback ? playback.contentHash ?? "" : "";
    return [
      playback.mode,
      playback.kind,
      playback.attachmentId,
      playback.src,
      viewerSrc,
      contentHash,
    ].join("|");
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
    /**
     * `sourceVersion` 只表示“播放源真相发生变化”：
     * 1. 同一 src 的重复恢复不该触发新版本，否则会把 missing_source 预览重试放大成循环；
     * 2. mode/src/contentHash 任一变化时才递增，保证预览重试与真实来源变更对齐；
     * 3. 这样既保留恢复能力，也避免会话抖动造成的无意义重解析。
     */
    const 当前版本键 = 读取播放源版本键(current.playback);
    const 下一个版本键 = 读取播放源版本键(playback);
    写入快照({
      playback,
      status: 下一状态,
      sourceVersion:
        当前版本键 === 下一个版本键 ? current.sourceVersion : current.sourceVersion + 1,
    });
    安排降级恢复重试(playback);
  };

  const 触发恢复解析 = (): void => {
    清理降级恢复重试定时器();
    if (已销毁 || 正在恢复) {
      return;
    }
    正在恢复 = true;
    const 当前代次 = ++解析代次;

    void (async () => {
      const playback = await deps.解析播放结果({
        attachmentId: deps.attachmentId,
        kind: deps.kind,
        /**
         * 时间线媒体会话必须稳定占住自己的 consumer 身份：
         * - 恢复解析、后台补齐、正式查看器投影都围绕这一条会话真相运转；
         * - 不能和 inline_autoplay 共用一个“只有 attachmentId 的粗粒度占用”；
         * - 这样后面释放自动播时，才不会误伤时间线正在用的 swarm。
         */
        consumerId: 会话ConsumerId,
      });
      if (已销毁 || 当前代次 !== 解析代次) {
        return;
      }

      冷源不可用 = playback.mode === "degraded" || playback.mode === "expired";
      if (!冷源不可用) {
        缺少群友 = false;
      }
      应用播放结果(playback);
    })()
      .catch(() => {
        if (已销毁 || 当前代次 !== 解析代次) {
          return;
        }
        冷源不可用 = true;
        标记等待恢复();
      })
      .finally(() => {
        if (当前代次 === 解析代次) {
          正在恢复 = false;
        }
      });
  };

  return {
    async 启动(): Promise<void> {
      this.send({ type: "BOOTSTRAP_REQUESTED" });
      const 当前代次 = ++解析代次;
      const playback = await deps.解析播放结果({
        attachmentId: deps.attachmentId,
        kind: deps.kind,
        consumerId: 会话ConsumerId,
      });
      if (已销毁 || 当前代次 !== 解析代次) {
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
          播放器恢复窗口已触发 = false;
          写入快照({
            status: "bootstrapping",
          });
          return;
        case "PLAYBACK_RELEASED":
          清理降级恢复重试定时器();
          解析代次 += 1;
          正在恢复 = false;
          缺少群友 = false;
          冷源不可用 = false;
          播放器恢复窗口已触发 = false;
          if (!current.playback) {
            return;
          }
          /**
           * 关闭 viewer 只释放“前台正式播放源”，不等于附件业务退场：
           * 会话壳和 locallyComplete 仍可保留，但 playback 必须清空，
           * 否则时间线会把看过的视频继续渲染成真实 `<video>`。
           */
          写入快照({
            playback: null,
            status: current.locallyComplete ? "locally_complete" : "bootstrapping",
            sourceVersion: current.sourceVersion + 1,
          });
          return;
        case "PLAYER_PLAYING":
          if (
            !current.playback ||
            current.playback.mode === "degraded" ||
            current.playback.mode === "expired"
          ) {
            /**
             * 仅凭原生 `<video>` 事件不能反推业务层“播放源已恢复”：
             * 1. degraded/expired 阶段里，旧元素残留事件会误报 `playing`；
             * 2. 如果这里放行，会把恢复门禁提前打开，下一次 waiting 又触发新一轮重解析；
             * 3. 只有会话里已经持有可播放结果时，`PLAYER_PLAYING` 才能真正推进状态。
             */
            return;
          }
          播放器恢复窗口已触发 = false;
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
            /**
             * `SWARM_ACTIVE` 只在“确实在等群友恢复”的阶段才能重置恢复门禁：
             * 1. waiting_for_peer_or_network 说明当前会话还没拿回可用播放源，这时需要立刻重试；
             * 2. 稳定播放期会持续收到 wire 驱动的 SWARM_ACTIVE，若这里无条件清门禁会放大 PLAYER_ERROR；
             * 3. 因此非 waiting 态不再借 SWARM_ACTIVE 重置恢复窗口，避免 locator/torrent 重试风暴。
             */
            播放器恢复窗口已触发 = false;
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
        case "SWARM_TICKET_INVALID":
          /**
           * ticket 失效不是“peer 不够”，而是当前 swarm 凭证已经过期：
           * 1. 会话要尽快重跑 locator / swarm 裁决，拿新 ticket；
           * 2. 如果此刻还在首轮 bootstrapping，恢复动作交给当前那次解析自己完成，避免并发双解析打架；
           * 3. 一旦会话已经稳定下来，再收到这个信号就立即进入 recovering。
           */
          播放器恢复窗口已触发 = false;
          if (current.status === "bootstrapping") {
            发布快照();
            return;
          }
          写入快照({
            status: "recovering",
          });
          触发恢复解析();
          return;
        case "ORIGIN_AVAILABLE":
          冷源不可用 = false;
          播放器恢复窗口已触发 = false;
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
          播放器恢复窗口已触发 = true;
          写入快照({
            status: "recovering",
          });
          触发恢复解析();
          return;
        case "PLAYER_WAITING":
        case "PLAYER_STALLED":
        case "PLAYER_ERROR":
          /**
           * 播放器抖动信号只用于“从稳定态切进恢复态”：
           * 1. 会话已经在 bootstrapping/recovering/waiting 阶段时，再次 waiting 不提供新信息；
           * 2. 这里必须抑制重复恢复，避免 locator / swarm 重签在同一故障窗口被放大；
           * 3. degraded/expired 或尚未持有播放源时，waiting 只可能来自旧元素残留信号，不能拿来重试；
           * 4. 真正可恢复的转机仍由 SWARM_ACTIVE / ORIGIN_AVAILABLE / TICKET_INVALID 驱动。
           */
          /**
           * swarm 视频在补块阶段天然会反复触发 waiting/stalled：
           * 1. 这类信号是“正在补块”的正常过程，不代表 locator / ticket 已失效；
           * 2. 如果把它当恢复触发器，会把会话抖动放大成 locator 风暴；
           * 3. 对 swarm 主链只保留 PLAYER_ERROR 作为兜底恢复入口。
           */
          if (
            当前是协作分发视频播放() &&
            (signal.type === "PLAYER_WAITING" || signal.type === "PLAYER_STALLED")
          ) {
            return;
          }
          if (!当前存在可恢复播放源() || 应忽略播放器恢复信号()) {
            return;
          }
          播放器恢复窗口已触发 = true;
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
      清理降级恢复重试定时器();
      解析代次 += 1;
    },
  };
}

export type { 媒体会话依赖 };
