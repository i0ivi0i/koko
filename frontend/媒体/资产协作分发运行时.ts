import type { 媒体定位结果, 媒体种类 } from "../聊天共享/契约.js";
import {
  获取或创建协作分发浏览器运行时,
  启动协作分发存活上报,
  停止协作分发存活上报,
  探测协作分发媒体源可读性,
  接入协作分发种子,
  清理协作分发底层会话,
  标记WebTorrent官方媒体源,
  读取协作分发定位片段,
  读取可用协作分发片段,
  读取首个可播放文件,
  请求协作分发持久化存储,
  重置协作分发浏览器运行时,
  是否为协作分发JoinTicket失效错误,
  type 协作分发底层会话,
  type 协作分发会话事件,
  type 协作分发JoinTicketRef,
  type 协作分发媒体源,
  type WebTorrent种子,
} from "./媒体协作分发.js";
import {
  创建资产协作分发Actor,
  协作分发消费者持有前台播放Reader,
  投影公开资产协作分发快照,
  读取协作分发会话生命周期,
  type 资产协作分发Actor,
  type 资产协作分发快照,
} from "./资产协作分发状态机.js";
import {
  删除底层协作分发会话,
  协作分发会话可在零引用后保留,
  同步协作分发会话生命周期,
  按生命周期策略清理协作分发会话,
  推导协作分发会话当前生命周期,
  清除零引用补齐保活计时器,
  设置协作分发会话生命周期,
  让零引用会话降到轻帮助态,
  淘汰超限零引用完成会话,
  退掉整附件重补齐,
} from "./资产协作分发生命周期.js";
import {
  刷新协作分发会话票据,
  安排协作分发会话票据续租,
  安排协作分发会话票据续租重试,
  更新协作分发会话票据刷新器,
} from "./资产协作分发票据续租.js";
import {
  恢复整附件补齐,
  激活整附件补齐,
} from "./资产协作分发选片策略.js";
import { 读取资产协作分发预算 } from "./资产协作分发预算.js";

export type { 资产协作分发快照 } from "./资产协作分发状态机.js";

export type 协作分发消费者模式 =
  | "viewer"
  | "inline_autoplay"
  | "backfill"
  | "preview"
  | "prefetch"
  | "session";

export type 协作分发消费者绑定 = {
  consumerId: string;
  attachmentId: string;
  mode: 协作分发消费者模式;
  onSessionEvent: ((event: 协作分发会话事件) => void) | null;
};

export type 协作分发定位片段 = NonNullable<ReturnType<typeof 读取协作分发定位片段>>;

export type 协作分发JoinTicket刷新器 = (input: {
  attachmentId: string;
  swarmId: string;
  torrentInfoHash: string;
}) => Promise<媒体定位结果 | null>;

export type WebTorrentSessionLifecycleState =
  | "cold"
  | "locating"
  | "joining"
  | "swarm_active"
  | "source_ready"
  | "heavy_playback"
  | "light_help"
  | "locally_complete"
  | "draining"
  | "dropped";

export type WebTorrentSessionTerminalReason =
  | "ticket_invalid"
  | "no_peers"
  | "source_unreadable"
  | "unsupported_runtime"
  | "deleted"
  | "destroyed"
  | "stale_generation";

export interface WebTorrentSessionLifecycleSnapshot {
  state: WebTorrentSessionLifecycleState;
  generation: number;
  reason?: WebTorrentSessionTerminalReason;
  activeReaderCount: number;
  hasPresenceHeartbeat: boolean;
  hasJoinTicketRefresh: boolean;
}

export type 底层协作分发会话 = Omit<协作分发底层会话, "consumerBindings"> & {
  consumerBindings: Map<string, 协作分发消费者绑定>;
  previewPriorityApplied: boolean;
  /**
   * `eagerCompleting` 表示“这条会话具备继续补齐资格”，
   * 但真正是否允许继续占 whole-file 重补齐预算，要看这条开关。
   * 这样 zero-ref 会话就能保留 swarm 身份，同时把重下载链单独退掉。
   */
  wholeFileBackfillEnabled: boolean;
  wholeFileSelectApplied: boolean;
  /**
   * 零引用但仍在尝试补齐的会话只能短时保活：
   * 1. 给 owner/viewer 交接留出一小段连续性窗口；
   * 2. 避免刚连上群友就因为壳切换立刻掐断整附件补齐；
   * 3. 窗口到点后如果还没完成，必须降回轻帮助态，不能无限伪装 partial_peer。
   */
  zeroRefCompletionGraceTimerId: ReturnType<typeof setTimeout> | null;
  joinTicketRef: 协作分发JoinTicketRef;
  joinTicketAttachmentId: string;
  joinTicketRefreshTimerId: ReturnType<typeof setTimeout> | null;
  joinTicketRefreshInFlight: boolean;
  refreshJoinTicket: 协作分发JoinTicket刷新器 | null;
  /**
   * 生命周期账本只属于唯一协作分发 owner：
   * 1. generation 防止旧 source / listener / timer 在退场后写回新会话；
   * 2. lifecycleState 只描述浏览器运行时重量，不覆盖后端 media_state；
   * 3. terminalReason 记录退场根因，避免日志和 UI 只能猜“为什么消失”。
   */
  lifecycleState: WebTorrentSessionLifecycleState;
  generation: number;
  terminalReason?: WebTorrentSessionTerminalReason;
  /**
   * `sourcePromise` 只覆盖首次挂载；播放源交给查看器后，WebTorrent stream route 仍可能被底层退掉。
   * 后续复用必须重新确认，不能把已经 404 的本地地址继续交给播放器制造错误风暴。
   */
  播放源已交付过: boolean;
  播放源复用探测Promise: Promise<void> | null;
  已接入WebSeedUrls: Set<string>;
};

export type 资产协作分发会话快照 = {
  attachmentId: string;
  swarmId: string;
  torrentInfoHash: string;
  contentHash: string;
  consumers: string[];
  consumerAttachmentIds: Record<string, string>;
  consumerModes: Record<string, 协作分发消费者模式>;
  eagerCompleting: boolean;
  locallyComplete: boolean;
  hint: 协作分发媒体源["hint"];
  lifecycle: WebTorrentSessionLifecycleSnapshot;
};

export interface 资产协作分发上下文 {
  heavyWorkPolicy: "normal" | "reduced" | "suspended";
  sessions: Record<string, 资产协作分发会话快照>;
  lastDroppedReason: WebTorrentSessionTerminalReason | null;
}

export type 资产协作分发事件 =
  | {
      type: "ACQUIRE_REQUESTED";
      attachmentId: string;
      swarmId: string;
      torrentInfoHash: string;
      contentHash: string;
      consumerId: string;
      mode: 协作分发消费者模式;
      lifecycle: WebTorrentSessionLifecycleSnapshot;
    }
  | {
      type: "BACKFILL_REQUESTED";
      swarmId: string;
    }
  | {
      type: "SWARM_ACTIVE";
      swarmId: string;
      hint: NonNullable<协作分发媒体源["hint"]>;
    }
  | {
      type: "SWARM_NO_PEERS";
      swarmId: string;
    }
  | {
      type: "TORRENT_DONE";
      swarmId: string;
      contentHash: string;
      hint: 协作分发媒体源["hint"];
    }
  | {
      type: "CONSUMER_RELEASED";
      swarmId: string;
      attachmentId: string;
      consumerId: string;
    }
  | {
      type: "SESSION_LIFECYCLE_CHANGED";
      swarmId: string;
      lifecycle: WebTorrentSessionLifecycleSnapshot;
    }
  | {
      type: "SESSION_DROPPED";
      swarmId: string;
      reason?: WebTorrentSessionTerminalReason;
    }
  | {
      type: "LIFECYCLE_POLICY_CHANGED";
      heavyWorkPolicy: "normal" | "reduced" | "suspended";
    }
  | {
      type: "RESET";
    };

export interface 资产协作分发运行时端口 {
  send(event: 资产协作分发事件): void;
  snapshot(): 资产协作分发快照;
  读取会话状态(swarmId: string): {
    attachmentId: string;
    swarmId: string;
    refs: number;
    consumers: string[];
    eagerCompleting: boolean;
    已获得帮助资格: boolean;
    locallyComplete: boolean;
    hint: 协作分发媒体源["hint"];
    lifecycle: WebTorrentSessionLifecycleSnapshot;
  } | null;
  读取预算(
    snapshot?: 资产协作分发快照
  ): {
    activeSwarmCount: number;
    hiddenHeavyTaskCount: number;
    wholeFileHeavySessionCount: number;
    zeroRefHeavySessionCount: number;
    zeroRefLightHelpSessionCount: number;
    zeroRefWholeFileReaderCount: number;
  };
  解析协作分发源(input: {
    attachmentId: string;
    kind: 媒体种类;
    locator: 媒体定位结果;
    consumerId?: string;
    onSessionEvent?: (event: 协作分发会话事件) => void;
    eagerCompleting?: boolean;
    refreshJoinTicket?: 协作分发JoinTicket刷新器;
  }): Promise<协作分发媒体源 | null>;
  释放协作分发消费者(
    input:
      | string
      | {
          attachmentId: string;
          consumerId?: string;
          丢弃未完成补齐?: boolean;
        }
  ): void;
  重置(): void;
  销毁(): void;
}

export type 资产协作分发运行时内部 = {
  actor: 资产协作分发Actor;
  底层会话表: Map<string, 底层协作分发会话>;
  已销毁: boolean;
};

let 活跃资产协作分发运行时实例数 = 0;


const 推导协作分发提示 = (session: 底层协作分发会话): 协作分发媒体源["hint"] => {
  if (session.hint) {
    return session.hint;
  }
  /**
   * 默认提示也要服从“正式帮助资格”：
   * 1. 只有已经进入帮助链的会话，才允许把“当前正在补块”抬成对外可见提示；
   * 2. 纯 `preview / session` 轻会话即便正在为自己取源，也不能被 UI 误解成“我已经开始协作分发”；
   * 3. 这样 hint 真相就和帮助资格真相保持同一条 owner 链。
   */
  return session.已获得帮助资格 && session.eagerCompleting ? "正在补块" : null;
};

const 推导消费者模式 = (input: {
  consumerId?: string;
  eagerCompleting?: boolean;
}): 协作分发消费者模式 => {
  if (input.eagerCompleting) {
    return "backfill";
  }
  if (input.consumerId?.startsWith("preview:")) {
    return "preview";
  }
  if (input.consumerId?.startsWith("inline_autoplay:")) {
    return "inline_autoplay";
  }
  if (input.consumerId?.startsWith("viewer:")) {
    return "viewer";
  }
  // prefetch: 提前 join swarm 但不下载任何 piece，为后续播放预热 peer 连接
  if (input.consumerId?.startsWith("prefetch:")) {
    return "prefetch";
  }
  return "session";
};

const 消费者拥有正式帮助资格 = (mode: 协作分发消费者模式): boolean =>
  mode === "viewer" || mode === "inline_autoplay" || mode === "backfill";

const 会话允许对外上报帮助真相 = (session: 底层协作分发会话): boolean =>
  session.已获得帮助资格 &&
  session.曾收到真实群友字节 &&
  (session.locallyComplete ||
    session.consumerBindings.size > 0 ||
    session.wholeFileBackfillEnabled);

function 归一化协作分发消费者(input: {
  attachmentId: string;
  consumerId?: string;
  onSessionEvent?: (event: 协作分发会话事件) => void;
  eagerCompleting?: boolean;
}): 协作分发消费者绑定 {
  return {
    consumerId: input.consumerId ?? input.attachmentId,
    attachmentId: input.attachmentId,
    mode: 推导消费者模式(input),
    onSessionEvent: input.onSessionEvent ?? null,
  };
}

function 更新协作分发会话主附件(session: 底层协作分发会话): void {
  const nextBinding = session.consumerBindings.values().next().value;
  if (nextBinding && typeof nextBinding.attachmentId === "string") {
    session.attachmentId = nextBinding.attachmentId;
  }
}

function 发布协作分发会话事件(
  session: 底层协作分发会话,
  type: 协作分发会话事件["type"]
) {
  for (const binding of session.consumerBindings.values()) {
    if (!binding.onSessionEvent) {
      continue;
    }
    const event: 协作分发会话事件 =
      type === "ASSET_COMPLETE"
        ? {
            type,
            attachmentId: binding.attachmentId,
            swarmId: session.swarmId,
            contentHash: session.contentHash,
          }
        : {
            type,
            attachmentId: binding.attachmentId,
            swarmId: session.swarmId,
          };
    binding.onSessionEvent(event);
  }
}

const 发送事件 = (
  runtime: 资产协作分发运行时内部,
  event: 资产协作分发事件
): void => {
  if (runtime.已销毁) {
    return;
  }
  runtime.actor.send(event);
  if (event.type === "LIFECYCLE_POLICY_CHANGED") {
    按生命周期策略清理协作分发会话(runtime, event.heavyWorkPolicy);
  }
};

const 确认协作分发会话播放源仍可读 = (
  session: 底层协作分发会话,
  streamUrl: string
): Promise<void> => {
  if (session.播放源复用探测Promise) {
    return session.播放源复用探测Promise;
  }
  const probePromise = 探测协作分发媒体源可读性(streamUrl, {
    读取终止错误: () => session.terminalError,
  }).finally(() => {
    if (session.播放源复用探测Promise === probePromise) {
      session.播放源复用探测Promise = null;
    }
  });
  session.播放源复用探测Promise = probePromise;
  return probePromise;
};

const 接入当前定位WebSeed = (
  session: 底层协作分发会话,
  distribution: 协作分发定位片段
): void => {
  const webSeedUrl = distribution.web_seed_url?.trim();
  if (!webSeedUrl || !session.torrent || session.已接入WebSeedUrls.has(webSeedUrl)) {
    return;
  }
  session.已接入WebSeedUrls.add(webSeedUrl);
  session.torrent?.addWebSeed?.(webSeedUrl);
};

function 绑定协作分发会话事件(
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话,
  torrent: WebTorrent种子,
  distribution: NonNullable<ReturnType<typeof 读取协作分发定位片段>>
) {
  const 处理JoinTicket失效 = (
    error: unknown,
    options: { 来自warning?: boolean } = {}
  ) => {
    if (!是否为协作分发JoinTicket失效错误(error)) {
      return;
    }
    if (options.来自warning && session.曾连上真实群友) {
      /**
       * warning 语义是“可恢复噪声”，不是“会话必死”：
       * 1. 会话一旦已经连上真实群友，单条 warning 不该立刻触发全链路 teardown；
       * 2. 直接销毁会话会把前端推入 locator/torrent 高频重建风暴；
       * 3. 真正不可恢复时仍由 error 或后续探测失败兜底收敛成终态。
       */
      return;
    }
    if (options.来自warning) {
      /**
       * 会话尚未就绪时，warning 只作为“探测链应尽快终止”的软信号：
       * 1. 这里不立刻 teardown，也不广播 SWARM_TICKET_INVALID；
       * 2. `探测协作分发媒体源可读性` 会读取 terminalError 并把失败收敛成一次可控拒绝；
       * 3. 播放器随后按既有 forceRefresh / degraded 节奏重试，避免同步风暴。
       */
      session.terminalError = error;
      return;
    }
    /**
     * join ticket 失效属于“这条 swarm 会话已经不可信”：
     * 1. 旧会话必须立刻退场，避免旧 runtime 继续命中脏 ticket；
     * 2. 这里只发布稳定的 ticket invalid 语义，不把 tracker 私有报错直接扩散给壳层；
     * 3. 真正怎么刷新 locator、怎么恢复播放，继续交回播放器/媒体会话 owner。
     */
    if (runtime.底层会话表.get(session.swarmId) !== session) {
      return;
    }
    停止协作分发存活上报(session);
    session.terminalError = error;
    session.terminalReason = "ticket_invalid";
    session.generation += 1;
    session.lifecycleState = "dropped";
    session.hint = null;
    发布协作分发会话事件(session, "SWARM_TICKET_INVALID");
    删除底层协作分发会话(runtime, session.swarmId, session);
    if (!runtime.已销毁) {
      runtime.actor.send({
        type: "SESSION_DROPPED",
        swarmId: session.swarmId,
        reason: "ticket_invalid",
      });
    }
  };

  torrent.on("wire", (wire) => {
    if (wire.type === "webSeed") {
      /**
       * webSeed 只能证明“当前还能从冷源补到字节”：
       * 1. 它不代表真实 peer 已建立；
       * 2. 因此不能触发 SWARM_ACTIVE，也不能上报 partial/complete_peer；
       * 3. 这里最多把提示降成“正在补块”，提醒当前仍在靠冷源兜底。
       */
      session.hint = session.已获得帮助资格 ? "正在补块" : null;
      恢复整附件补齐(session);
      return;
    }
    session.曾连上真实群友 = true;
    session.hint = session.已获得帮助资格 ? "正在补块" : null;
    设置协作分发会话生命周期(runtime, session, 推导协作分发会话当前生命周期(session));
    恢复整附件补齐(session);
  });
  torrent.on("download", (bytes) => {
    /**
     * `wire` 只说明 peer socket 建起来了；真正能算 `partial_peer`，
     * 必须等到浏览器确认收到了来自真实群友的字节。
     */
    if (bytes <= 0 || !session.曾连上真实群友 || session.曾收到真实群友字节) {
      return;
    }
    session.曾收到真实群友字节 = true;
    session.hint = session.已获得帮助资格 ? "正在协作分发" : null;
    设置协作分发会话生命周期(runtime, session, 推导协作分发会话当前生命周期(session));
    if (会话允许对外上报帮助真相(session)) {
      启动协作分发存活上报(
        session,
        distribution,
        session.locallyComplete ? "complete_peer" : "partial_peer"
      );
    }
    if (session.已获得帮助资格) {
      发送事件(runtime, {
        type: "SWARM_ACTIVE",
        swarmId: session.swarmId,
        hint: session.hint ?? "正在协作分发",
      });
      发布协作分发会话事件(session, "SWARM_ACTIVE");
    }
  });
  torrent.on("noPeers", () => {
    session.hint = session.已获得帮助资格 ? "正在补块" : null;
    设置协作分发会话生命周期(runtime, session, 推导协作分发会话当前生命周期(session));
    if (session.已获得帮助资格) {
      发送事件(runtime, {
        type: "SWARM_NO_PEERS",
        swarmId: session.swarmId,
      });
      发布协作分发会话事件(session, "SWARM_NO_PEERS");
    }
  });
  torrent.on("done", () => {
    清除零引用补齐保活计时器(session);
    session.eagerCompleting = false;
    session.locallyComplete = true;
    退掉整附件重补齐(session);
    设置协作分发会话生命周期(runtime, session, 推导协作分发会话当前生命周期(session));
    /**
     * `done` 只证明“本地完整”：
     * 1. 如果此前已经连上真实群友，这里才允许升级成 complete_peer；
     * 2. 如果从头到尾只靠 webSeed / 冷源补齐，就必须保持静默，禁止吹成协作分发成功；
     * 3. 这样 `ASSET_COMPLETE` 继续只代表本地完整，不反向污染 swarm 真相。
     */
    session.hint = 会话允许对外上报帮助真相(session) ? "正在协作分发" : null;
    if (会话允许对外上报帮助真相(session)) {
      启动协作分发存活上报(session, distribution, "complete_peer");
    } else {
      停止协作分发存活上报(session);
    }
    发送事件(runtime, {
      type: "TORRENT_DONE",
      swarmId: session.swarmId,
      contentHash: session.contentHash,
      hint: session.hint,
    });
    发布协作分发会话事件(session, "ASSET_COMPLETE");
  });
  torrent.on("error", (error) => {
    处理JoinTicket失效(error);
  });
  torrent.on("warning", (warning) => {
    处理JoinTicket失效(warning, { 来自warning: true });
  });
}

const 是否应强制丢弃未完成补齐 = (
  input: Parameters<资产协作分发运行时端口["释放协作分发消费者"]>[0],
  session: 底层协作分发会话
): boolean =>
  typeof input !== "string" &&
  input.丢弃未完成补齐 === true &&
  !session.locallyComplete;

async function 确保协作分发会话(
  runtime: 资产协作分发运行时内部,
  input: {
    attachmentId: string;
    kind: 媒体种类;
    distribution: 协作分发定位片段;
    consumerId?: string;
    onSessionEvent?: (event: 协作分发会话事件) => void;
    eagerCompleting?: boolean;
    refreshJoinTicket?: 协作分发JoinTicket刷新器;
  }
): Promise<底层协作分发会话 | null> {
  if (runtime.已销毁) {
    return null;
  }
  /**
   * whole-file 重补齐的默认准入必须按 consumer 身份裁决：
   * 1. `viewer / inline_autoplay / backfill` 默认允许进入重态，它们代表当前前台价值或显式帮助意图；
   * 2. 普通 `session / preview` 只建立轻会话，不再一看到 swarm 就顺手补整文件；
   * 3. 如果上层显式传了 `eagerCompleting`，仍以那条明确意图为准。
   */
  const consumerBinding = 归一化协作分发消费者(input);
  const 应默认进入整附件补齐 =
    input.eagerCompleting ??
    消费者拥有正式帮助资格(consumerBinding.mode);
  let session = runtime.底层会话表.get(input.distribution.swarm_id);
  if (session) {
    更新协作分发会话票据刷新器(session, input.refreshJoinTicket);
    清除零引用补齐保活计时器(session);
    // 续租锚点必须跟随最新取得 locator 的业务附件；旧附件删除后不能拖垮同一 canonical 资产的新引用。
    session.joinTicketAttachmentId = input.attachmentId;
    if (刷新协作分发会话票据(session, input.distribution)) {
      安排协作分发会话票据续租(runtime, session, input.distribution);
    } else {
      安排协作分发会话票据续租重试(runtime, session);
    }
    session.consumerBindings.set(consumerBinding.consumerId, consumerBinding);
    const 刚获得帮助资格 = 应默认进入整附件补齐 && !session.已获得帮助资格;
    if (应默认进入整附件补齐) {
      session.已获得帮助资格 = true;
    }
    session.lifecycleState = 推导协作分发会话当前生命周期(session);
    发送事件(runtime, {
      type: "ACQUIRE_REQUESTED",
      attachmentId: consumerBinding.attachmentId,
      swarmId: session.swarmId,
      torrentInfoHash: session.torrentInfoHash,
      contentHash: session.contentHash,
      consumerId: consumerBinding.consumerId,
      mode: consumerBinding.mode,
      lifecycle: 读取协作分发会话生命周期(session),
    });
    if (应默认进入整附件补齐 && !session.locallyComplete) {
      激活整附件补齐(runtime, session);
    }
    更新协作分发会话主附件(session);
    if (session.locallyComplete && 会话允许对外上报帮助真相(session)) {
      session.hint = "正在协作分发";
      启动协作分发存活上报(session, input.distribution, "complete_peer");
    } else if (刚获得帮助资格 && 会话允许对外上报帮助真相(session)) {
      session.hint = "正在协作分发";
      启动协作分发存活上报(
        session,
        input.distribution,
        session.locallyComplete ? "complete_peer" : "partial_peer"
      );
      if (!session.locallyComplete) {
        发送事件(runtime, {
          type: "SWARM_ACTIVE",
          swarmId: session.swarmId,
          hint: "正在协作分发",
        });
        发布协作分发会话事件(session, "SWARM_ACTIVE");
      }
    }
    return session;
  }

  session = {
    attachmentId: input.attachmentId,
    swarmId: input.distribution.swarm_id,
    torrentInfoHash: input.distribution.torrent_info_hash!,
    contentHash: input.distribution.content_hash,
    sourcePromise: Promise.resolve(null),
    eagerCompleting: 应默认进入整附件补齐,
    previewPriorityApplied: false,
    wholeFileBackfillEnabled: 应默认进入整附件补齐,
    wholeFileSelectApplied: false,
    locallyComplete: false,
    hint: null,
    已获得帮助资格: 应默认进入整附件补齐,
    presencePeerKind: null,
    presenceIntervalId: null,
    torrent: null,
    file: null,
    terminalError: null,
    cleanupStarted: false,
    曾连上真实群友: false,
    曾收到真实群友字节: false,
    consumerBindings: new Map([[consumerBinding.consumerId, consumerBinding]]),
    zeroRefCompletionGraceTimerId: null,
    joinTicketRef: { value: input.distribution.join_ticket ?? null },
    joinTicketAttachmentId: input.attachmentId,
    joinTicketRefreshTimerId: null,
    joinTicketRefreshInFlight: false,
    refreshJoinTicket: input.refreshJoinTicket ?? null,
    lifecycleState: 协作分发消费者持有前台播放Reader(consumerBinding.mode)
      ? "heavy_playback"
      : "locating",
    generation: 0,
    播放源已交付过: false,
    播放源复用探测Promise: null,
    已接入WebSeedUrls: new Set(
      input.distribution.web_seed_url?.trim()
        ? [input.distribution.web_seed_url.trim()]
        : []
    ),
  };
  runtime.底层会话表.set(input.distribution.swarm_id, session);
  安排协作分发会话票据续租(runtime, session, input.distribution);
  发送事件(runtime, {
    type: "ACQUIRE_REQUESTED",
    attachmentId: consumerBinding.attachmentId,
    swarmId: session.swarmId,
    torrentInfoHash: session.torrentInfoHash,
    contentHash: session.contentHash,
    consumerId: consumerBinding.consumerId,
    mode: consumerBinding.mode,
    lifecycle: 读取协作分发会话生命周期(session),
  });
  if (session.eagerCompleting) {
    发送事件(runtime, {
      type: "BACKFILL_REQUESTED",
      swarmId: session.swarmId,
    });
  }
  void 请求协作分发持久化存储();

  session.sourcePromise = (async () => {
    设置协作分发会话生命周期(runtime, session, "locating");
    const browserRuntime = await 获取或创建协作分发浏览器运行时();
    设置协作分发会话生命周期(runtime, session, "joining");
    const torrent = await 接入协作分发种子(browserRuntime, input.distribution, {
      joinTicketRef: session.joinTicketRef,
      // prefetch 模式：join swarm 但不选择任何 piece 下载
      deselect: consumerBinding.mode === "prefetch",
    });
    session.torrent = torrent;
    设置协作分发会话生命周期(runtime, session, "swarm_active");
    if (runtime.底层会话表.get(session.swarmId) !== session) {
      session.generation += 1;
      session.terminalReason = "stale_generation";
      清理协作分发底层会话(session, browserRuntime);
      return null;
    }
    绑定协作分发会话事件(runtime, session, torrent, input.distribution);
    const file = 读取首个可播放文件(torrent, input.attachmentId, input.kind);
    session.file = file;
    if (session.eagerCompleting) {
      /**
       * 新建会话如果一上来就是 eager completing，file 一旦就绪就必须立刻走统一入口：
       * 1. 不能只抬 preview 优先级，否则 whole-file backfill 仍然不会真正开始；
       * 2. 统一复用 `激活整附件补齐`，让“抬 preview + 补整附件”始终是一条真相链；
       * 3. 这样复用会自然保持幂等，不会额外重复发 BACKFILL_REQUESTED。
       */
      激活整附件补齐(runtime, session);
    }
    if (consumerBinding.mode === "prefetch") {
      设置协作分发会话生命周期(runtime, session, 推导协作分发会话当前生命周期(session));
      return null;
    }
    await 探测协作分发媒体源可读性(file.streamURL, {
      读取终止错误: () => session.terminalError,
    });
    if (runtime.底层会话表.get(session.swarmId) !== session) {
      session.generation += 1;
      session.terminalReason = "stale_generation";
      清理协作分发底层会话(session, browserRuntime);
      return null;
    }
    设置协作分发会话生命周期(runtime, session, 推导协作分发会话当前生命周期(session));
    return 标记WebTorrent官方媒体源({
      src: file.streamURL,
    });
  })().catch((error) => {
    const reason: WebTorrentSessionTerminalReason =
      是否为协作分发JoinTicket失效错误(error)
        ? "ticket_invalid"
        : "source_unreadable";
    session.generation += 1;
    session.terminalReason = reason;
    session.lifecycleState = "dropped";
    停止协作分发存活上报(session);
    if (runtime.底层会话表.get(input.distribution.swarm_id) === session) {
      runtime.底层会话表.delete(input.distribution.swarm_id);
      if (!runtime.已销毁) {
        runtime.actor.send({
          type: "SESSION_DROPPED",
          swarmId: input.distribution.swarm_id,
          reason,
        });
      }
    }
    清理协作分发底层会话(session);
    throw error;
  });

  return session;
}

const 读取会话状态 = (
  runtime: 资产协作分发运行时内部,
  swarmId: string
) => {
  const session = runtime.底层会话表.get(swarmId);
  if (!session) {
    return null;
  }
  return {
    attachmentId: session.attachmentId,
    swarmId: session.swarmId,
    refs: session.consumerBindings.size,
    consumers: Array.from(session.consumerBindings.keys()),
    eagerCompleting: session.eagerCompleting,
    已获得帮助资格: session.已获得帮助资格,
    locallyComplete: session.locallyComplete,
    hint: session.hint ?? (session.eagerCompleting ? "正在补块" : null),
    lifecycle: 读取协作分发会话生命周期(session),
  };
};

const 重置运行时 = (runtime: 资产协作分发运行时内部): void => {
  for (const [swarmId, session] of runtime.底层会话表) {
    删除底层协作分发会话(runtime, swarmId, session);
  }
  runtime.actor.send({ type: "RESET" });
};

/**
 * 协作分发运行时现在是可装配实例：
 * - 每个聊天内核/测试都显式持有自己的端口；
 * - 生命周期降载、预算投影、会话清理都沿着这条装配链走；
 * - 不再靠模块级 singleton 把浏览器真相泄漏到别的上下文。
 */
export function 创建资产协作分发运行时(): 资产协作分发运行时端口 {
  活跃资产协作分发运行时实例数 += 1;
  const runtime: 资产协作分发运行时内部 = {
    actor: 创建资产协作分发Actor(),
    底层会话表: new Map<string, 底层协作分发会话>(),
    已销毁: false,
  };

  return {
    send(event): void {
      发送事件(runtime, event);
    },

    snapshot(): 资产协作分发快照 {
      return 投影公开资产协作分发快照(runtime.actor.getSnapshot());
    },

    读取会话状态(swarmId: string) {
      return 读取会话状态(runtime, swarmId);
    },

    读取预算(snapshot = 投影公开资产协作分发快照(runtime.actor.getSnapshot())) {
      return 读取资产协作分发预算(runtime, snapshot);
    },

    async 解析协作分发源(input) {
      const distribution = 读取可用协作分发片段(input.locator);
      if (!distribution) {
        return null;
      }
      const consumerBinding = 归一化协作分发消费者(input);
      const existingSession = runtime.底层会话表.get(distribution.swarm_id);
      const 复用前为零引用会话 =
        existingSession?.播放源已交付过 === true &&
        existingSession.consumerBindings.size === 0;
      const 复用前为同消费者旧播放源 =
        existingSession?.播放源已交付过 === true &&
        existingSession.consumerBindings.has(consumerBinding.consumerId);
      const session = await 确保协作分发会话(runtime, {
        attachmentId: input.attachmentId,
        kind: input.kind,
        distribution,
        ...(input.consumerId ? { consumerId: input.consumerId } : {}),
        ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
        ...(input.eagerCompleting ? { eagerCompleting: true } : {}),
        ...(input.refreshJoinTicket ? { refreshJoinTicket: input.refreshJoinTicket } : {}),
      });
      if (!session) {
        return null;
      }
      const source = await session.sourcePromise;
      if (!source) {
        if (consumerBinding.mode !== "prefetch" && session.file) {
          接入当前定位WebSeed(session, distribution);
          await 探测协作分发媒体源可读性(session.file.streamURL, {
            读取终止错误: () => session.terminalError,
          });
          session.播放源已交付过 = true;
          session.lifecycleState = 推导协作分发会话当前生命周期(session);
          同步协作分发会话生命周期(runtime, session);
          return {
            src: 标记WebTorrent官方媒体源({ src: session.file.streamURL }).src,
            hint: 推导协作分发提示(session),
            locallyComplete: session.locallyComplete,
            formalByteSource: "webtorrent_official_stream",
          };
        }
        return null;
      }
      接入当前定位WebSeed(session, distribution);
      if (复用前为零引用会话 || 复用前为同消费者旧播放源) {
        try {
          await 确认协作分发会话播放源仍可读(session, source.src);
        } catch (error) {
          const reason: WebTorrentSessionTerminalReason =
            是否为协作分发JoinTicket失效错误(error)
              ? "ticket_invalid"
              : "source_unreadable";
          session.generation += 1;
          session.terminalReason = reason;
          session.lifecycleState = "dropped";
          删除底层协作分发会话(runtime, session.swarmId, session);
          if (!runtime.已销毁) {
            runtime.actor.send({
              type: "SESSION_DROPPED",
              swarmId: session.swarmId,
              reason,
            });
          }
          throw error;
        }
      } else if (session.播放源复用探测Promise) {
        await session.播放源复用探测Promise;
      }
      session.播放源已交付过 = true;
      session.lifecycleState = 推导协作分发会话当前生命周期(session);
      同步协作分发会话生命周期(runtime, session);
      return {
        src: source.src,
        hint: 推导协作分发提示(session),
        locallyComplete: session.locallyComplete,
        formalByteSource: source.formalByteSource,
      };
    },

    释放协作分发消费者(input): void {
      if (runtime.已销毁) {
        return;
      }
      const consumerBinding =
        typeof input === "string"
          ? 归一化协作分发消费者({ attachmentId: input })
          : 归一化协作分发消费者(input);
      for (const [swarmId, session] of runtime.底层会话表) {
        const binding = session.consumerBindings.get(consumerBinding.consumerId);
        if (!binding || binding.attachmentId !== consumerBinding.attachmentId) {
          continue;
        }
        session.consumerBindings.delete(consumerBinding.consumerId);
        发送事件(runtime, {
          type: "CONSUMER_RELEASED",
          swarmId,
          attachmentId: binding.attachmentId,
          consumerId: consumerBinding.consumerId,
        });
        if (session.attachmentId === binding.attachmentId) {
          更新协作分发会话主附件(session);
        }
        if (session.joinTicketAttachmentId === binding.attachmentId) {
          // 被释放的附件不能继续充当续租授权锚点；有剩余消费者时退回当前主附件。
          session.joinTicketAttachmentId = session.attachmentId;
        }
        if (session.consumerBindings.size > 0) {
          continue;
        }
        让零引用会话降到轻帮助态(runtime, session, {
          allowCompletionGrace: true,
        });
        session.lifecycleState = 推导协作分发会话当前生命周期(session);
        同步协作分发会话生命周期(runtime, session);
        // 只要会话仍被产品层保留，presence 也要跟着保留：
        // 1. locallyComplete 继续报 complete_peer；
        // 2. eagerCompleting 且已接入 swarm 的会话继续报 partial_peer；
        // 3. 只有真正删除会话时，才统一 stop heartbeat。
        if (!协作分发会话可在零引用后保留(session)) {
          停止协作分发存活上报(session);
        }
        if (是否应强制丢弃未完成补齐(input, session)) {
          删除底层协作分发会话(runtime, swarmId, session);
          if (!runtime.已销毁) {
            runtime.actor.send({
              type: "SESSION_DROPPED",
              swarmId,
            });
          }
          continue;
        }
        if (协作分发会话可在零引用后保留(session)) {
          continue;
        }
        删除底层协作分发会话(runtime, swarmId, session);
      }
      淘汰超限零引用完成会话(runtime);
    },

    重置(): void {
      if (runtime.已销毁) {
        return;
      }
      重置运行时(runtime);
    },

    销毁(): void {
      if (runtime.已销毁) {
        return;
      }
      重置运行时(runtime);
      runtime.已销毁 = true;
      runtime.actor.stop();
      活跃资产协作分发运行时实例数 = Math.max(
        0,
        活跃资产协作分发运行时实例数 - 1
      );
      /**
       * 协作分发浏览器 adapter 仍然是全局共享基础设施。
       * 当最后一个资产运行时实例退场时，一并把它回收掉，
       * 避免测试和多轮会话之间残留旧的 WebTorrent client / stream server。
       */
      if (活跃资产协作分发运行时实例数 === 0) {
        重置协作分发浏览器运行时();
      }
    },
  };
}
