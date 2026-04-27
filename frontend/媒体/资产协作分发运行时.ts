import { assign, createActor, createMachine, type SnapshotFrom } from "xstate";
import type { 媒体定位结果, 媒体种类 } from "../契约.js";
import {
  获取或创建协作分发浏览器运行时,
  启动协作分发存活上报,
  停止协作分发存活上报,
  探测协作分发媒体源可读性,
  接入协作分发种子,
  清理协作分发底层会话,
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
  type WebTorrent文件,
  type WebTorrent种子,
} from "./媒体协作分发.js";

type 协作分发消费者模式 =
  | "viewer"
  | "inline_autoplay"
  | "backfill"
  | "session";

type 协作分发消费者绑定 = {
  consumerId: string;
  attachmentId: string;
  mode: 协作分发消费者模式;
  onSessionEvent: ((event: 协作分发会话事件) => void) | null;
};

type 协作分发定位片段 = NonNullable<ReturnType<typeof 读取协作分发定位片段>>;

type 协作分发JoinTicket刷新器 = (input: {
  attachmentId: string;
  swarmId: string;
  torrentInfoHash: string;
}) => Promise<媒体定位结果 | null>;

type 底层协作分发会话 = Omit<协作分发底层会话, "consumerBindings"> & {
  consumerBindings: Map<string, 协作分发消费者绑定>;
  previewPriorityApplied: boolean;
  /**
   * `eagerCompleting` 表示“这条会话具备继续补齐资格”，
   * 但真正是否允许继续占 whole-file 重补齐预算，要看这条开关。
   * 这样 zero-ref 会话就能保留 swarm 身份，同时把重下载链单独退掉。
   */
  wholeFileBackfillEnabled: boolean;
  wholeFileSelectApplied: boolean;
  joinTicketRef: 协作分发JoinTicketRef;
  joinTicketAttachmentId: string;
  joinTicketRefreshTimerId: ReturnType<typeof setTimeout> | null;
  joinTicketRefreshInFlight: boolean;
  refreshJoinTicket: 协作分发JoinTicket刷新器 | null;
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
  hint: 协作分发媒体源["hint"] | null;
};

interface 资产协作分发上下文 {
  heavyWorkPolicy: "normal" | "reduced" | "suspended";
  sessions: Record<string, 资产协作分发会话快照>;
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
    }
  | {
      type: "BACKFILL_REQUESTED";
      swarmId: string;
    }
  | {
      type: "SWARM_ACTIVE";
      swarmId: string;
      hint: 协作分发媒体源["hint"];
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
      type: "SESSION_DROPPED";
      swarmId: string;
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
    locallyComplete: boolean;
    hint: 协作分发媒体源["hint"];
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

const 初始资产协作分发上下文: 资产协作分发上下文 = {
  heavyWorkPolicy: "normal",
  sessions: {},
};

const 复制会话表 = (
  sessions: Record<string, 资产协作分发会话快照>
): Record<string, 资产协作分发会话快照> => ({ ...sessions });

/**
 * 壳层可以读取 actor 快照，但不能拿到可回写的内部 sessions 引用。
 * 这里保留原快照原型与字段形状，只把最容易被误改的 sessions 投影成副本，
 * 避免调用侧把“读模型”写成“第二套真相”。
 */
const 投影公开资产协作分发快照 = (
  snapshot: 资产协作分发快照
): 资产协作分发快照 =>
  Object.create(Object.getPrototypeOf(snapshot), {
    ...Object.getOwnPropertyDescriptors(snapshot),
    context: {
      value: {
        ...snapshot.context,
        sessions: 复制会话表(snapshot.context.sessions),
      },
      enumerable: true,
      configurable: true,
      writable: true,
    },
  }) as 资产协作分发快照;

const 推导主附件标识 = (consumerAttachmentIds: Record<string, string>): string =>
  Object.values(consumerAttachmentIds)[0] ?? "";

const 是否为零消费者冷协作分发会话 = (session: 底层协作分发会话): boolean =>
  session.consumerBindings.size === 0 &&
  !session.eagerCompleting &&
  !session.locallyComplete;

/**
 * AssetDistributionActor 只回答 swarm 会话是否存活、被谁占用、是否已经完整。
 * 浏览器里的 WebTorrent / stream server / 可读性探测仍由 adapter 负责，
 * 这里不复制第二套底层基础设施。
 */
const 资产协作分发机 = createMachine(
  {
    types: {} as {
      context: 资产协作分发上下文;
      events: 资产协作分发事件;
    },
    id: "资产协作分发机",
    initial: "活跃",
    context: 初始资产协作分发上下文,
    states: {
      活跃: {
        on: {
          ACQUIRE_REQUESTED: {
            actions: "登记消费者占用",
          },
          BACKFILL_REQUESTED: {
            actions: "标记整附件补齐",
          },
          SWARM_ACTIVE: {
            actions: "标记协作分发活跃",
          },
          SWARM_NO_PEERS: {
            actions: "标记当前缺少群友",
          },
          TORRENT_DONE: {
            actions: "标记本地已完整",
          },
          CONSUMER_RELEASED: {
            actions: "释放消费者占用",
          },
          SESSION_DROPPED: {
            actions: "删除失效会话",
          },
          LIFECYCLE_POLICY_CHANGED: {
            actions: "同步生命周期策略",
          },
          RESET: {
            actions: "重置全部会话",
          },
        },
      },
    },
  },
  {
    actions: {
      登记消费者占用: assign(({ context, event }) => {
        if (event.type !== "ACQUIRE_REQUESTED") {
          return {};
        }
        const nextSessions = 复制会话表(context.sessions);
        const current = nextSessions[event.swarmId];
        const consumerAttachmentIds = {
          ...(current?.consumerAttachmentIds ?? {}),
          [event.consumerId]: event.attachmentId,
        };
        const consumerModes = {
          ...(current?.consumerModes ?? {}),
          [event.consumerId]: event.mode,
        };
        nextSessions[event.swarmId] = {
          attachmentId: 推导主附件标识(consumerAttachmentIds) || event.attachmentId,
          swarmId: event.swarmId,
          torrentInfoHash: event.torrentInfoHash,
          contentHash: event.contentHash,
          consumers: Object.keys(consumerModes),
          consumerAttachmentIds,
          consumerModes,
          eagerCompleting:
            (current?.eagerCompleting ?? false) || event.mode === "backfill",
          locallyComplete: current?.locallyComplete ?? false,
          hint: current?.hint ?? null,
        };
        return {
          sessions: nextSessions,
        };
      }),
      标记整附件补齐: assign(({ context, event }) => {
        if (event.type !== "BACKFILL_REQUESTED") {
          return {};
        }
        const current = context.sessions[event.swarmId];
        if (!current) {
          return {};
        }
        return {
          sessions: {
            ...context.sessions,
            [event.swarmId]: {
              ...current,
              eagerCompleting: true,
              hint: current.hint ?? "正在补块",
            },
          },
        };
      }),
      标记协作分发活跃: assign(({ context, event }) => {
        if (event.type !== "SWARM_ACTIVE") {
          return {};
        }
        const current = context.sessions[event.swarmId];
        if (!current) {
          return {};
        }
        return {
          sessions: {
            ...context.sessions,
            [event.swarmId]: {
              ...current,
              hint: event.hint,
            },
          },
        };
      }),
      标记当前缺少群友: assign(({ context, event }) => {
        if (event.type !== "SWARM_NO_PEERS") {
          return {};
        }
        const current = context.sessions[event.swarmId];
        if (!current) {
          return {};
        }
        return {
          sessions: {
            ...context.sessions,
            [event.swarmId]: {
              ...current,
              hint: "正在补块",
            },
          },
        };
      }),
      标记本地已完整: assign(({ context, event }) => {
        if (event.type !== "TORRENT_DONE") {
          return {};
        }
        const current = context.sessions[event.swarmId];
        if (!current) {
          return {};
        }
        return {
          sessions: {
            ...context.sessions,
            [event.swarmId]: {
              ...current,
              contentHash: event.contentHash,
              eagerCompleting: false,
              locallyComplete: true,
              hint: event.hint,
            },
          },
        };
      }),
      释放消费者占用: assign(({ context, event }) => {
        if (event.type !== "CONSUMER_RELEASED") {
          return {};
        }
        const current = context.sessions[event.swarmId];
        if (!current) {
          return {};
        }
        const consumerAttachmentIds = { ...current.consumerAttachmentIds };
        const consumerModes = { ...current.consumerModes };
        delete consumerAttachmentIds[event.consumerId];
        delete consumerModes[event.consumerId];
        const nextConsumers = Object.keys(consumerModes);
        if (
          nextConsumers.length === 0 &&
          !current.eagerCompleting &&
          !current.locallyComplete
        ) {
          const nextSessions = 复制会话表(context.sessions);
          delete nextSessions[event.swarmId];
          return {
            sessions: nextSessions,
          };
        }
        return {
          sessions: {
            ...context.sessions,
            [event.swarmId]: {
              ...current,
              attachmentId:
                推导主附件标识(consumerAttachmentIds) || current.attachmentId,
              consumers: nextConsumers,
              consumerAttachmentIds,
              consumerModes,
            },
          },
        };
      }),
      删除失效会话: assign(({ context, event }) => {
        if (event.type !== "SESSION_DROPPED") {
          return {};
        }
        const nextSessions = 复制会话表(context.sessions);
        delete nextSessions[event.swarmId];
        return {
          sessions: nextSessions,
        };
      }),
      同步生命周期策略: assign(({ event }) => {
        if (event.type !== "LIFECYCLE_POLICY_CHANGED") {
          return {};
        }
        return {
          heavyWorkPolicy: event.heavyWorkPolicy,
        };
      }),
      重置全部会话: assign(() => 初始资产协作分发上下文),
    },
  }
);

export type 资产协作分发快照 = SnapshotFrom<typeof 资产协作分发机>;

const 创建资产协作分发Actor = () => createActor(资产协作分发机).start();

type 资产协作分发Actor = ReturnType<typeof 创建资产协作分发Actor>;

type 资产协作分发运行时内部 = {
  actor: 资产协作分发Actor;
  底层会话表: Map<string, 底层协作分发会话>;
  已销毁: boolean;
};

let 活跃资产协作分发运行时实例数 = 0;

const JOIN_TICKET_REFRESH_SAFETY_MS = 5_000;
const JOIN_TICKET_REFRESH_RETRY_MS = 5_000;
const JOIN_TICKET_REFRESH_MIN_DELAY_MS = 1_000;

const 推导协作分发提示 = (session: 底层协作分发会话): 协作分发媒体源["hint"] => {
  if (session.hint) {
    return session.hint;
  }
  /**
   * 默认轻会话在没有真实群友证据前必须保持静默：
   * 1. 可读只说明当前有源，不说明已进入 swarm；
   * 2. 否则 UI 会把“webSeed/冷源兜底”误说成“正在协作分发”；
   * 3. 只有显式补块或真实 peer 建立后，提示文案才允许抬起来。
   */
  return session.eagerCompleting ? "正在补块" : null;
};

const 推导消费者模式 = (input: {
  consumerId?: string;
  eagerCompleting?: boolean;
}): 协作分发消费者模式 => {
  if (input.eagerCompleting) {
    return "backfill";
  }
  if (input.consumerId?.startsWith("inline_autoplay:")) {
    return "inline_autoplay";
  }
  if (input.consumerId?.startsWith("viewer:")) {
    return "viewer";
  }
  return "session";
};

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

const 删除底层协作分发会话 = (
  runtime: 资产协作分发运行时内部,
  swarmId: string,
  session: 底层协作分发会话
): void => {
  清除协作分发会话票据续租(session);
  停止协作分发存活上报(session);
  runtime.底层会话表.delete(swarmId);
  清理协作分发底层会话(session);
};

const 退掉整附件重补齐 = (session: 底层协作分发会话): void => {
  /**
   * zero-ref 轻帮助态的关键点不是“把会话删掉”，而是把 whole-file 重补齐退掉：
   * 1. swarm 身份、join ticket 续租、presence 仍可保留，群体协作收益不丢；
   * 2. 但整附件 file.select 这条重下载链必须立即撤掉，避免后台继续拉整文件；
   * 3. 后续如果用户重新进入 owner / viewer，再由显式 consumer 重新开启重补齐。
   */
  session.wholeFileBackfillEnabled = false;
  if (!session.wholeFileSelectApplied) {
    return;
  }
  session.wholeFileSelectApplied = false;
  session.file?.deselect?.();
};

const 让零引用会话降到轻帮助态 = (session: 底层协作分发会话): void => {
  if (!协作分发会话可在零引用后保留(session)) {
    return;
  }
  退掉整附件重补齐(session);
};

const 按生命周期策略清理协作分发会话 = (
  runtime: 资产协作分发运行时内部,
  heavyWorkPolicy: 资产协作分发上下文["heavyWorkPolicy"]
): void => {
  if (heavyWorkPolicy === "normal") {
    return;
  }
  for (const [swarmId, session] of runtime.底层会话表) {
    if (session.consumerBindings.size === 0) {
      让零引用会话降到轻帮助态(session);
    }
    if (!是否为零消费者冷协作分发会话(session)) {
      continue;
    }
    删除底层协作分发会话(runtime, swarmId, session);
    if (!runtime.已销毁) {
      runtime.actor.send({
        type: "SESSION_DROPPED",
        swarmId,
      });
    }
  }
};

function 绑定协作分发会话事件(
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话,
  torrent: WebTorrent种子,
  distribution: NonNullable<ReturnType<typeof 读取协作分发定位片段>>,
  browserRuntime: Awaited<ReturnType<typeof 获取或创建协作分发浏览器运行时>>
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
    session.hint = null;
    发布协作分发会话事件(session, "SWARM_TICKET_INVALID");
    删除底层协作分发会话(runtime, session.swarmId, session);
    if (!runtime.已销毁) {
      runtime.actor.send({
        type: "SESSION_DROPPED",
        swarmId: session.swarmId,
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
      session.hint = "正在补块";
      恢复整附件补齐(session);
      return;
    }
    session.曾连上真实群友 = true;
    session.hint = "正在协作分发";
    启动协作分发存活上报(
      session,
      distribution,
      session.locallyComplete ? "complete_peer" : "partial_peer"
    );
    恢复整附件补齐(session);
    发送事件(runtime, {
      type: "SWARM_ACTIVE",
      swarmId: session.swarmId,
      hint: session.hint,
    });
    发布协作分发会话事件(session, "SWARM_ACTIVE");
  });
  torrent.on("noPeers", () => {
    session.hint = "正在补块";
    发送事件(runtime, {
      type: "SWARM_NO_PEERS",
      swarmId: session.swarmId,
    });
    发布协作分发会话事件(session, "SWARM_NO_PEERS");
  });
  torrent.on("done", () => {
    session.eagerCompleting = false;
    session.locallyComplete = true;
    退掉整附件重补齐(session);
    /**
     * `done` 只证明“本地完整”：
     * 1. 如果此前已经连上真实群友，这里才允许升级成 complete_peer；
     * 2. 如果从头到尾只靠 webSeed / 冷源补齐，就必须保持静默，禁止吹成协作分发成功；
     * 3. 这样 `ASSET_COMPLETE` 继续只代表本地完整，不反向污染 swarm 真相。
     */
    session.hint = session.曾连上真实群友 ? "正在协作分发" : null;
    if (session.曾连上真实群友) {
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

function 激活整附件补齐(
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话
): void {
  const 首次进入整附件补齐 = !session.eagerCompleting;
  session.wholeFileBackfillEnabled = true;
  if (首次进入整附件补齐) {
    session.eagerCompleting = true;
    发送事件(runtime, {
      type: "BACKFILL_REQUESTED",
      swarmId: session.swarmId,
    });
  }
  /**
   * 这条链的权威语义现在是：
   * 1. 只要 owner 已经明确要求 eager completing，就立刻进入“整附件继续补齐”；
   * 2. preview 优先级仍先抬起，保证首眼/首播关键字节不被 whole-file 抢掉；
   * 3. 但不能再等到 `wire` 事件才 select 整文件，否则用户已经开始看了，后台补齐却还没真正启动。
   *
   * 换句话说：`wire` 只负责更新 swarm 活跃提示，不再拥有“要不要开始整附件补齐”的真相。
   */
  激活预览关键字节优先(session);
  恢复整附件补齐(session);
}

function 激活预览关键字节优先(session: 底层协作分发会话): void {
  if (session.previewPriorityApplied) {
    return;
  }
  /**
   * preview-first 只负责把最早一小段关键字节提到最高优先级：
   * 1. 先让浏览器尽快拿到可出预览的头部 / 关键片段；
   * 2. 正式 whole-file backfill 会在 eager owner 成立后马上接上，而不是继续等 `wire`；
   * 3. 这里仍先用非常克制的起始 piece 范围，避免在没有 byte planner 前重新炸整文件。
   */
  session.previewPriorityApplied = true;
  session.torrent?.critical?.(0, 4);
  session.torrent?.select?.(0, 4, 0);
}

function 恢复整附件补齐(session: 底层协作分发会话): void {
  if (!session.wholeFileBackfillEnabled || session.wholeFileSelectApplied || !session.file) {
    return;
  }
  session.wholeFileSelectApplied = true;
  session.file.select(1);
}

function 协作分发会话可在零引用后保留(session: 底层协作分发会话): boolean {
  return session.eagerCompleting || session.locallyComplete;
}

const 是否应强制丢弃未完成补齐 = (
  input: Parameters<资产协作分发运行时端口["释放协作分发消费者"]>[0],
  session: 底层协作分发会话
): boolean =>
  typeof input !== "string" &&
  input.丢弃未完成补齐 === true &&
  !session.locallyComplete;

function 清除协作分发会话票据续租(session: 底层协作分发会话): void {
  if (!session.joinTicketRefreshTimerId) {
    return;
  }
  clearTimeout(session.joinTicketRefreshTimerId);
  session.joinTicketRefreshTimerId = null;
}

function 读取JoinTicket过期时间(
  distribution: 协作分发定位片段
): number | null {
  if (!distribution.join_ticket || !distribution.ticket_expires_at) {
    return null;
  }
  const expiresAt = Date.parse(distribution.ticket_expires_at);
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

function 安排协作分发会话票据续租重试(
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话
): void {
  清除协作分发会话票据续租(session);
  if (runtime.已销毁 || runtime.底层会话表.get(session.swarmId) !== session) {
    return;
  }
  session.joinTicketRefreshTimerId = setTimeout(() => {
    session.joinTicketRefreshTimerId = null;
    void 执行协作分发会话票据续租(runtime, session);
  }, JOIN_TICKET_REFRESH_RETRY_MS);
}

function 安排协作分发会话票据续租(
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话,
  distribution: 协作分发定位片段
): void {
  清除协作分发会话票据续租(session);
  if (!session.refreshJoinTicket) {
    return;
  }
  const expiresAt = 读取JoinTicket过期时间(distribution);
  if (!expiresAt) {
    return;
  }
  /**
   * 续租计时器属于 WebTorrent 会话 owner：
   * 1. 它只更新 tracker 门禁票据，不改变媒体资产身份；
   * 2. 定位请求仍经上层注入的 locator owner，运行态不直接碰 transport；
   * 3. 提前少量时间刷新，避免长生命周期会话等到 tracker 报 expired 才恢复。
   */
  const refreshDelayMs = Math.max(
    JOIN_TICKET_REFRESH_MIN_DELAY_MS,
    expiresAt - Date.now() - JOIN_TICKET_REFRESH_SAFETY_MS
  );
  session.joinTicketRefreshTimerId = setTimeout(() => {
    session.joinTicketRefreshTimerId = null;
    void 执行协作分发会话票据续租(runtime, session);
  }, refreshDelayMs);
}

function 刷新协作分发会话票据(
  session: 底层协作分发会话,
  distribution: 协作分发定位片段
): void {
  // join_ticket 只属于 tracker 入群门禁续租；刷新它不改变媒体身份、业务附件或 swarm 归属。
  session.joinTicketRef.value = distribution.join_ticket ?? null;
}

async function 执行协作分发会话票据续租(
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话
): Promise<void> {
  if (
    runtime.已销毁 ||
    session.joinTicketRefreshInFlight ||
    runtime.底层会话表.get(session.swarmId) !== session
  ) {
    return;
  }
  const refreshJoinTicket = session.refreshJoinTicket;
  if (!refreshJoinTicket) {
    return;
  }
  session.joinTicketRefreshInFlight = true;
  try {
    const locator = await refreshJoinTicket({
      attachmentId: session.joinTicketAttachmentId,
      swarmId: session.swarmId,
      torrentInfoHash: session.torrentInfoHash,
    });
    if (runtime.已销毁 || runtime.底层会话表.get(session.swarmId) !== session) {
      return;
    }
    const distribution = locator ? 读取可用协作分发片段(locator) : null;
    if (
      !distribution ||
      distribution.swarm_id !== session.swarmId ||
      distribution.torrent_info_hash !== session.torrentInfoHash
    ) {
      /**
       * 续租只允许更新同一 swarm 的门禁票据。
       * 如果 locator 已不可用或身份不一致，不能在这里偷换媒体身份，只做低频重试等待上层恢复。
       */
      安排协作分发会话票据续租重试(runtime, session);
      return;
    }
    刷新协作分发会话票据(session, distribution);
    安排协作分发会话票据续租(runtime, session, distribution);
  } catch {
    if (!runtime.已销毁 && runtime.底层会话表.get(session.swarmId) === session) {
      安排协作分发会话票据续租重试(runtime, session);
    }
  } finally {
    session.joinTicketRefreshInFlight = false;
  }
}

function 更新协作分发会话票据刷新器(
  session: 底层协作分发会话,
  refreshJoinTicket?: 协作分发JoinTicket刷新器
): void {
  if (refreshJoinTicket) {
    session.refreshJoinTicket = refreshJoinTicket;
  }
}

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
    (consumerBinding.mode === "viewer" ||
      consumerBinding.mode === "inline_autoplay" ||
      consumerBinding.mode === "backfill");
  let session = runtime.底层会话表.get(input.distribution.swarm_id);
  if (session) {
    更新协作分发会话票据刷新器(session, input.refreshJoinTicket);
    // 续租锚点必须跟随最新取得 locator 的业务附件；旧附件删除后不能拖垮同一 canonical 资产的新引用。
    session.joinTicketAttachmentId = input.attachmentId;
    刷新协作分发会话票据(session, input.distribution);
    安排协作分发会话票据续租(runtime, session, input.distribution);
    session.consumerBindings.set(consumerBinding.consumerId, consumerBinding);
    发送事件(runtime, {
      type: "ACQUIRE_REQUESTED",
      attachmentId: consumerBinding.attachmentId,
      swarmId: session.swarmId,
      torrentInfoHash: session.torrentInfoHash,
      contentHash: session.contentHash,
      consumerId: consumerBinding.consumerId,
      mode: consumerBinding.mode,
    });
    if (应默认进入整附件补齐 && !session.locallyComplete) {
      激活整附件补齐(runtime, session);
    }
    更新协作分发会话主附件(session);
    if (session.locallyComplete && session.曾连上真实群友) {
      启动协作分发存活上报(session, input.distribution, "complete_peer");
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
    presencePeerKind: null,
    presenceIntervalId: null,
    torrent: null,
    file: null,
    terminalError: null,
    cleanupStarted: false,
    曾连上真实群友: false,
    consumerBindings: new Map([[consumerBinding.consumerId, consumerBinding]]),
    joinTicketRef: { value: input.distribution.join_ticket ?? null },
    joinTicketAttachmentId: input.attachmentId,
    joinTicketRefreshTimerId: null,
    joinTicketRefreshInFlight: false,
    refreshJoinTicket: input.refreshJoinTicket ?? null,
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
  });
  if (session.eagerCompleting) {
    发送事件(runtime, {
      type: "BACKFILL_REQUESTED",
      swarmId: session.swarmId,
    });
  }
  void 请求协作分发持久化存储();

  session.sourcePromise = (async () => {
    const browserRuntime = await 获取或创建协作分发浏览器运行时();
    const torrent = await 接入协作分发种子(browserRuntime, input.distribution, {
      joinTicketRef: session.joinTicketRef,
    });
    session.torrent = torrent;
    if (runtime.底层会话表.get(session.swarmId) !== session) {
      清理协作分发底层会话(session, browserRuntime);
      return null;
    }
    绑定协作分发会话事件(runtime, session, torrent, input.distribution, browserRuntime);
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
    await 探测协作分发媒体源可读性(file.streamURL, {
      读取终止错误: () => session.terminalError,
    });
    if (runtime.底层会话表.get(session.swarmId) !== session) {
      清理协作分发底层会话(session, browserRuntime);
      return null;
    }
    return {
      src: file.streamURL,
    };
  })().catch((error) => {
    停止协作分发存活上报(session);
    if (runtime.底层会话表.get(input.distribution.swarm_id) === session) {
      runtime.底层会话表.delete(input.distribution.swarm_id);
      if (!runtime.已销毁) {
        runtime.actor.send({
          type: "SESSION_DROPPED",
          swarmId: input.distribution.swarm_id,
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
    locallyComplete: session.locallyComplete,
    hint: session.hint ?? (session.eagerCompleting ? "正在补块" : null),
  };
};

const 读取资产协作分发预算 = (
  runtime: 资产协作分发运行时内部,
  snapshot: 资产协作分发快照 = runtime.actor.getSnapshot()
) => {
  const sessions = Object.values(snapshot.context.sessions);
  let wholeFileHeavySessionCount = 0;
  let zeroRefHeavySessionCount = 0;
  let zeroRefLightHelpSessionCount = 0;

  for (const session of sessions) {
    const isZeroRef = session.consumers.length === 0;
    const internalSession = runtime.底层会话表.get(session.swarmId);
    const wholeFileHeavyActive = internalSession?.wholeFileBackfillEnabled === true;
    const canStayAsLightHelp =
      isZeroRef && (session.eagerCompleting || session.locallyComplete);
    /**
     * 预算投影现在显式区分“会话还活着”和“它还剩多重”：
     * 1. 零引用但仍有协作价值的会话，可以继续算作 light help；
     * 2. 是否仍算 whole-file heavy，必须看底层 whole-file backfill 开关是否还开着；
     * 3. 这样预算不会再被 `eagerCompleting` 这个“可保留资格”字段误导成“仍在重下载”。
     */
    if (wholeFileHeavyActive) {
      wholeFileHeavySessionCount += 1;
      if (isZeroRef) {
        zeroRefHeavySessionCount += 1;
      }
    }
    if (canStayAsLightHelp && !wholeFileHeavyActive) {
      zeroRefLightHelpSessionCount += 1;
    }
  }
  return {
    activeSwarmCount: sessions.length,
    hiddenHeavyTaskCount:
      snapshot.context.heavyWorkPolicy === "normal" ? 0 : wholeFileHeavySessionCount,
    wholeFileHeavySessionCount,
    zeroRefHeavySessionCount,
    zeroRefLightHelpSessionCount,
    /**
     * 当前 whole-file reader 仍由底层 WebTorrent runtime 管；预算阶段先把“后台零引用不再算重 reader”
     * 写成显式真相。现在这里直接看底层 file.select 是否仍处于激活态，不再只靠猜测。
     */
    zeroRefWholeFileReaderCount: sessions.reduce((count, session) => {
      if (session.consumers.length !== 0) {
        return count;
      }
      const internalSession = runtime.底层会话表.get(session.swarmId);
      return internalSession?.wholeFileSelectApplied ? count + 1 : count;
    }, 0),
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
        return null;
      }
      return {
        src: source.src,
        hint: 推导协作分发提示(session),
        locallyComplete: session.locallyComplete,
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
        让零引用会话降到轻帮助态(session);
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
