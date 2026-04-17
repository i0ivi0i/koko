import type { 消息事件, 媒体种类 } from "./契约.js";
import type { 前端传输端口 } from "./传输.js";
import type { 聊天运行时预算状态 } from "./状态.js";
import {
  创建媒体运行时Actor,
  投影媒体运行时预算,
  type 媒体运行时事件,
} from "./媒体运行时.js";
import {
  创建媒体定位器,
  创建媒体缓存,
  创建内存媒体定位缓存仓库,
  创建内存媒体缓存仓库,
  创建媒体播放器,
  创建媒体发布器,
  创建媒体会话,
  创建媒体查看器,
  写入媒体草稿 as 写入媒体草稿状态,
  更新媒体草稿状态 as 更新媒体草稿状态值,
  移除媒体草稿 as 移除媒体草稿状态,
  创建资产协作分发运行时,
  type 消息视频自动播候选,
  type 媒体附件草稿,
  type 媒体缓存仓库,
  type 媒体定位缓存仓库,
  type 媒体草稿状态补丁,
  type 媒体查看器打开请求,
  type 媒体会话信号,
  type 媒体会话快照,
  type 媒体会话端口,
  type 媒体播放结果,
} from "./媒体/index.js";

type 程序滚动来源 = "media_viewer_open";

export type 附件内容地址快照 = {
  originalSrc: string;
  thumbnailSrc: string;
};

export type 聊天媒体快照 = {
  playbackByAttachmentId: Record<string, 媒体播放结果>;
  sessionByAttachmentId: Record<string, 媒体会话快照>;
  contentUrlByAttachmentId: Record<string, 附件内容地址快照>;
  inlineAutoplayOwnerAttachmentId: string | null;
  inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
};

type 聊天媒体预算快照 = Pick<
  聊天运行时预算状态,
  | "activeVideoCount"
  | "autoplayOwnerCount"
  | "activeSwarmCount"
  | "inflightLocatorCount"
  | "inflightManifestOrRangeCount"
  | "hiddenHeavyTaskCount"
  | "longTaskCount"
>;

type 聊天媒体编排依赖 = {
  transport(): 前端传输端口;
  读取会话编号(): string;
  读取消息(): 消息事件[];
  读取草稿(): 媒体附件草稿[];
  媒体缓存仓库?: 媒体缓存仓库;
  媒体定位仓库?: 媒体定位缓存仓库;
  写入草稿列表(next: 媒体附件草稿[]): void;
  请求重渲染(): void;
  回收媒体草稿预览地址(previewUrls: string[]): void;
  登记程序滚动来源(source: 程序滚动来源): void;
  清除程序滚动来源(source: 程序滚动来源): void;
};

export interface 聊天媒体编排端口 {
  snapshot(): 聊天媒体快照;
  读取预算(): 聊天媒体预算快照;
  处理选择媒体文件(files: Iterable<File>): Promise<void>;
  移除媒体草稿(localId: string): void;
  继续上传媒体草稿(localId: string): Promise<void>;
  重新上传媒体草稿(localId: string): Promise<void>;
  清空草稿(): void;
  打开查看器(request: 媒体查看器打开请求): void;
  同步消息附件播放结果(): void;
  处理自动播候选(candidates: 消息视频自动播候选[]): void;
  释放消息流自动播Owner(): void;
  处理媒体会话信号(attachmentId: string, signal: 媒体会话信号): void;
  处理应用生命周期(input: {
    visibility: "visible" | "hidden";
    phase: "active" | "background" | "page_hidden" | "frozen" | "resumed";
    heavyWorkPolicy: "normal" | "reduced" | "suspended";
  }): void;
  处理平台在线状态变化(online: boolean): void;
  清空(): void;
  销毁(): void;
  设置媒体播放器供测试(player: {
    解析播放结果(input: {
      attachmentId: string;
      kind: "image" | "video";
      surface?: "viewer" | "inline_autoplay";
      consumerId?: string;
    }): Promise<媒体播放结果>;
    激活协作补齐?(input: {
      attachmentId: string;
      kind: "image" | "video";
      consumerId?: string;
    }): Promise<void>;
    释放附件播放资源?(input: { attachmentId: string; consumerId?: string }): void;
  }): void;
  设置媒体查看器供测试(viewer: {
    打开(input: 媒体查看器打开请求): void;
    同步?(input: 媒体查看器打开请求): void;
    销毁(): void;
  }): void;
  设置媒体发布器供测试(publisher: {
    处理选择媒体文件(files: Iterable<File>): Promise<void>;
    移除草稿(localId: string): void;
    继续上传草稿(localId: string): Promise<void>;
    重新上传草稿(localId: string): Promise<void>;
    清空(): void;
    销毁(): void;
  }): void;
  写入媒体草稿列表供测试(drafts: 媒体附件草稿[]): void;
}

type 媒体附件条目 = {
  attachmentId: string;
  kind: 媒体种类;
};

const 构造媒体会话ConsumerId = (attachmentId: string): string => `session:${attachmentId}`;
const 构造自动播ConsumerId = (attachmentId: string): string => `inline_autoplay:${attachmentId}`;
const 自动播候选稳定等待毫秒 = 120;

/**
 * 聊天媒体编排只拥有“浏览器端媒体体验真相”：
 * - 上传草稿属于本地体验态；
 * - 播放结果属于浏览器端解析态；
 * - 查看器开关和视口占用属于前端交互编排。
 *
 * 它不拥有聊天时间线真相，也不直接暴露 transport。
 */
export function 创建聊天媒体编排(deps: 聊天媒体编排依赖): 聊天媒体编排端口 {
  const 媒体运行时 = 创建媒体运行时Actor();
  const 协作分发运行时 = 创建资产协作分发运行时();
  const 读取媒体运行时上下文 = () => 媒体运行时.getSnapshot().context;
  const 媒体定位器 = 创建媒体定位器({
    getSessionId: () => deps.读取会话编号(),
    loadMediaLocator: (sessionId, attachmentId) =>
      deps.transport().loadMediaLocator(sessionId, attachmentId),
    repo: deps.媒体定位仓库 ?? 创建内存媒体定位缓存仓库(),
  });

  let 媒体播放器 = 创建媒体播放器({
    locate: (attachmentId, options) => 媒体定位器.获取定位(attachmentId, options),
    resolveSwarmSource: (input) => 协作分发运行时.解析协作分发源(input),
    releaseSwarmSource: (input) => 协作分发运行时.释放协作分发消费者(input),
  });
  let 待重裁决的本地完整视频附件标识: string | null = null;
  let inlineAutoplay启动定时器: ReturnType<typeof setTimeout> | null = null;
  let inlineAutoplay解析代次 = 0;
  const 投影查看器请求到当前播放真相 = (
    request: 媒体查看器打开请求
  ): 媒体查看器打开请求 => {
    // 查看器一旦打开，就不能继续抱着旧 request.items 里的静态 src。
    // 这里把会话 owner 当前裁决出的播放源重新投影回查看器，让 overlay 和时间线预览共用同一条恢复真相。
    return {
      startAttachmentId: request.startAttachmentId,
      items: request.items.map((item) => {
        const playback = 媒体会话表.get(item.attachmentId)?.snapshot().playback;
        if (
          playback?.mode === "blob" ||
          playback?.mode === "swarm" ||
          playback?.mode === "anchor" ||
          playback?.mode === "manifest"
        ) {
          if (item.kind === "video") {
            return {
              ...item,
              src: playback.src,
              posterSrc: playback.thumbnailUrl ?? item.posterSrc,
              ...(playback.mode === "manifest" && playback.streamingDistribution
                ? {
                    streamingDistribution: playback.streamingDistribution,
                  }
                : {}),
            };
          }
          return {
            ...item,
            src: playback.mode === "blob" ? playback.viewerSrc ?? playback.src : playback.src,
          };
        }
        return item;
      }),
    };
  };
  const 是否应等待本地完整视频会话真相 = (
    request: 媒体查看器打开请求
  ): boolean => {
    const startItem = request.items.find(
      (item) => item.attachmentId === request.startAttachmentId
    );
    if (!startItem || startItem.kind !== "video") {
      待重裁决的本地完整视频附件标识 = null;
      return false;
    }
    const session = 媒体会话表.get(startItem.attachmentId);
    const sessionSnapshot = session?.snapshot();
    if (!sessionSnapshot?.playback) {
      return true;
    }
    if (!sessionSnapshot.locallyComplete) {
      if (待重裁决的本地完整视频附件标识 === startItem.attachmentId) {
        待重裁决的本地完整视频附件标识 = null;
      }
      return false;
    }
    /**
     * 刷新后，MediaCacheOwner 可能先把“本地已完整”恢复出来，
     * 但时间线会话的 playback 还没来得及 hydrate，或者只拿到一条
     * 为了首屏预算先保底的 manifest 主链。
     * 这时如果直接拿 request 里的静态 HLS / original src 去打开正式查看器，
     * 浏览器就会先发一轮冷源请求，随后才被会话真相纠正，用户就会误以为“缓存没复用”。
     *
     * 所以这里只拦截两种非常窄的窗口：
     * - 目标是视频；
     * - 本地完整度已经确定；
     * - 会话当前还没有可投影的 playback 真相，或只拿到一次预算内保底的 manifest。
     *
     * manifest 只重裁一次：如果重裁后仍然只能回到 manifest，就直接打开，
     * 避免为了追求 P2P 复用把查看器卡进无限等待。
     */
    if (sessionSnapshot.playback.mode !== "manifest") {
      待重裁决的本地完整视频附件标识 = null;
      return false;
    }
    if (待重裁决的本地完整视频附件标识 !== startItem.attachmentId) {
      待重裁决的本地完整视频附件标识 = startItem.attachmentId;
      session?.send({
        type: "PLAYER_WAITING",
      });
      return true;
    }
    if (sessionSnapshot.status === "recovering") {
      return true;
    }
    待重裁决的本地完整视频附件标识 = null;
    return false;
  };
  const 正式打开查看器 = (request: 媒体查看器打开请求): void => {
    deps.登记程序滚动来源("media_viewer_open");
    媒体查看器.打开(request);
    接收媒体运行时事实({ type: "VIEWER_OPEN_CONFIRMED" });
  };
  const 起始视频会话当前不可打开 = (request: 媒体查看器打开请求): boolean => {
    const startItem = request.items.find(
      (item) => item.attachmentId === request.startAttachmentId
    );
    if (!startItem || startItem.kind !== "video") {
      return false;
    }
    const playback = 媒体会话表.get(startItem.attachmentId)?.snapshot().playback;
    return playback?.mode === "expired" || playback?.mode === "degraded";
  };
  const 起始视频请求可直接用正式流媒体主链打开 = (
    request: 媒体查看器打开请求
  ): boolean => {
    const startItem = request.items.find(
      (item) => item.attachmentId === request.startAttachmentId
    );
    if (
      !startItem ||
      startItem.kind !== "video" ||
      !/\.m3u8(?:$|\?)/.test(startItem.src)
    ) {
      return false;
    }
    const sessionSnapshot = 媒体会话表.get(startItem.attachmentId)?.snapshot();
    /**
     * request 本身已经携带正式 HLS 主链时，不要再为了等待第一次会话 hydrate 把查看器卡住。
     * 这里只放行“还没有更强 playback 真相，且本地完整度也没宣布成立”的极窄窗口；
     * 一旦会话已经有权威 playback 或 locally_complete，就继续走 owner 重裁决路径。
     */
    return !sessionSnapshot?.playback && !sessionSnapshot?.locallyComplete;
  };
  const 接收媒体运行时事实 = (event: 媒体运行时事件): void => {
    const before = 媒体运行时.getSnapshot();
    媒体运行时.send(event);
    void 同步媒体运行时快照并执行副作用(before);
  };
  const 同步当前查看器请求 = (): void => {
    const 当前查看器请求 = 读取媒体运行时上下文().currentViewerRequest;
    if (!当前查看器请求) {
      return;
    }
    const nextRequest = 投影查看器请求到当前播放真相(当前查看器请求);
    if (JSON.stringify(nextRequest) !== JSON.stringify(当前查看器请求)) {
      接收媒体运行时事实({
        type: "VIEWER_REQUEST_SYNCED",
        request: nextRequest,
      });
      return;
    }
    if (!读取媒体运行时上下文().viewerOpen) {
      if (起始视频会话当前不可打开(nextRequest)) {
        return;
      }
      if (起始视频请求可直接用正式流媒体主链打开(nextRequest)) {
        正式打开查看器(nextRequest);
        return;
      }
      if (是否应等待本地完整视频会话真相(nextRequest)) {
        return;
      }
      正式打开查看器(nextRequest);
      return;
    }
    媒体查看器.同步?.(nextRequest);
  };
  const 同步媒体运行时快照并执行副作用 = async (
    before = 媒体运行时.getSnapshot()
  ): Promise<void> => {
    const after = 媒体运行时.getSnapshot();
    const beforeContext = before.context;
    const afterContext = after.context;

    if (
      beforeContext.inlineAutoplayPendingAttachmentId !==
      afterContext.inlineAutoplayPendingAttachmentId
    ) {
      if (inlineAutoplay启动定时器 !== null) {
        clearTimeout(inlineAutoplay启动定时器);
        inlineAutoplay启动定时器 = null;
      }
      if (afterContext.inlineAutoplayPendingAttachmentId) {
        调度自动播播放结果解析(afterContext.inlineAutoplayPendingAttachmentId);
      }
    }

    if (
      beforeContext.inlineAutoplayOwnerAttachmentId !==
      afterContext.inlineAutoplayOwnerAttachmentId
    ) {
      if (beforeContext.inlineAutoplayOwnerAttachmentId) {
        释放当前自动播Owner(beforeContext.inlineAutoplayOwnerAttachmentId);
      } else {
        清空自动播播放结果();
      }
      if (afterContext.inlineAutoplayOwnerAttachmentId) {
        解析自动播播放结果(afterContext.inlineAutoplayOwnerAttachmentId);
      }
    }

    if (beforeContext.currentViewerRequest && !afterContext.currentViewerRequest) {
      待重裁决的本地完整视频附件标识 = null;
      deps.清除程序滚动来源("media_viewer_open");
    }

    if (afterContext.currentViewerRequest) {
      同步当前查看器请求();
    }
  };
  const 转发媒体查看器会话信号 = (attachmentId: string, signal: 媒体会话信号): void => {
    媒体会话表.get(attachmentId)?.send(signal);
  };
  let 媒体查看器 = 创建媒体查看器({
    onViewportCaptureEnd: () => {
      接收媒体运行时事实({ type: "VIEWER_CLOSED" });
    },
    onMediaSessionSignal: 转发媒体查看器会话信号,
  });

  const 媒体会话表 = new Map<string, 媒体会话端口>();
  const 媒体缓存 = 创建媒体缓存({
    repo: deps.媒体缓存仓库 ?? 创建内存媒体缓存仓库(),
  });

  const 写入草稿列表 = (
    nextDrafts: 媒体附件草稿[],
    previewUrlsToRevoke: string[] = []
  ): void => {
    deps.写入草稿列表(nextDrafts);
    deps.回收媒体草稿预览地址(previewUrlsToRevoke);
  };

  const 写入媒体草稿 = (draft: 媒体附件草稿): void => {
    const result = 写入媒体草稿状态(deps.读取草稿(), draft);
    写入草稿列表(result.草稿列表, result.需要回收的预览地址);
  };

  const 更新媒体草稿状态 = (localId: string, patch: 媒体草稿状态补丁): void => {
    const result = 更新媒体草稿状态值(deps.读取草稿(), localId, patch);
    写入草稿列表(result.草稿列表, result.需要回收的预览地址);
  };

  const 移除媒体草稿 = (localId: string): void => {
    const result = 移除媒体草稿状态(deps.读取草稿(), localId);
    写入草稿列表(result.草稿列表, result.需要回收的预览地址);
  };

  const 清空媒体草稿 = (): void => {
    const previewUrls = deps.读取草稿().map((draft) => draft.previewUrl);
    写入草稿列表([], previewUrls);
  };

  let 媒体发布器 = 创建媒体发布器({
    getSessionId: () => deps.读取会话编号(),
    prepareMediaUpload: (kind, sessionId, file) =>
      deps.transport().prepareMediaUpload(kind, sessionId, file),
    abandonMediaUpload: (sessionId, attachmentId) =>
      deps.transport().abandonMediaUpload(sessionId, attachmentId),
    completeMediaUpload: (sessionId, attachmentId) =>
      deps.transport().completeMediaUpload(sessionId, attachmentId),
    readDrafts: () => deps.读取草稿(),
    writeDraft: 写入媒体草稿,
    updateDraft: 更新媒体草稿状态,
    removeDraft: 移除媒体草稿,
    clearDrafts: 清空媒体草稿,
  });

  const 读取当前房间媒体附件 = (): 媒体附件条目[] => {
    const seen = new Set<string>();
    const attachments: 媒体附件条目[] = [];
    for (const message of deps.读取消息()) {
      for (const attachment of message.attachments ?? []) {
        if (seen.has(attachment.attachment_id)) {
          continue;
        }
        seen.add(attachment.attachment_id);
        attachments.push({
          attachmentId: attachment.attachment_id,
          kind: attachment.kind,
        });
      }
    }
    return attachments;
  };

  const 读取附件条目 = (attachmentId: string): 媒体附件条目 | null =>
    读取当前房间媒体附件().find((attachment) => attachment.attachmentId === attachmentId) ?? null;

  /**
   * 附件内容地址属于“当前会话下可访问的媒体资源定位结果”。
   * 这里按当前时间线里的附件集合现算现给，目的有两个：
   * 1. 壳层 presenter 只消费 snapshot 里的纯数据，不再回调内核 helper；
   * 2. URL 仍然只从 transport 能力构建，避免视图层自己猜 session 参数。
   */
  const 读取附件内容地址表 = (): Record<string, 附件内容地址快照> => {
    const sessionId = deps.读取会话编号();
    const urlsByAttachmentId: Record<string, 附件内容地址快照> = {};
    for (const attachment of 读取当前房间媒体附件()) {
      urlsByAttachmentId[attachment.attachmentId] = {
        originalSrc: deps.transport().buildAttachmentContentUrl(
          attachment.attachmentId,
          sessionId,
          "original"
        ),
        thumbnailSrc: deps.transport().buildAttachmentContentUrl(
          attachment.attachmentId,
          sessionId,
          "thumbnail"
        ),
      };
    }
    return urlsByAttachmentId;
  };

  /**
   * 播放结果表不再自己持久保存一份可变真相，而是从媒体会话快照现算现给。
   * 这样“播放源”“恢复态”“本地完整度”都收口在单个 owner，不会继续回到一张大 Map 到处 patch。
   */
  const 读取媒体会话快照表 = (): Record<string, 媒体会话快照> => {
    const snapshots: Record<string, 媒体会话快照> = {};
    for (const [attachmentId, session] of 媒体会话表) {
      snapshots[attachmentId] = session.snapshot();
    }
    return snapshots;
  };

  const 读取媒体播放结果表 = (): Record<string, 媒体播放结果> => {
    const playbackByAttachmentId: Record<string, 媒体播放结果> = {};
    for (const [attachmentId, session] of 媒体会话表) {
      const playback = session.snapshot().playback;
      if (playback) {
        playbackByAttachmentId[attachmentId] = playback;
      }
    }
    return playbackByAttachmentId;
  };

  const 应用缓存完整度到会话 = (
    attachmentId: string,
    sessionOverride?: 媒体会话端口
  ): void => {
    if (媒体缓存.snapshot()[attachmentId]?.complete) {
      // 新建会话时，条目可能还没挂进 Map；
      // 这里允许直接命中刚创建出的会话实例，避免“缓存里明明是完整资产，但重开后第一拍仍丢失 locally_complete”。
      (sessionOverride ?? 媒体会话表.get(attachmentId))?.send({
        type: "ASSET_COMPLETE",
      });
    }
  };

  const 读取附件缓存元数据 = (
    attachmentId: string
  ): { kind?: 媒体种类 | null; contentHash?: string | null } => {
    const playback = 媒体会话表.get(attachmentId)?.snapshot().playback;
    if (playback?.mode === "blob") {
      return {
        kind: playback.kind,
        contentHash: playback.contentHash ?? null,
      };
    }
    const currentViewerItem = 读取媒体运行时上下文().currentViewerRequest?.items.find(
      (item) => item.attachmentId === attachmentId && item.kind === "image"
    );
    if (currentViewerItem?.kind === "image") {
      return {
        kind: "image",
        contentHash: currentViewerItem.contentHash ?? null,
      };
    }
    return {
      kind:
        读取当前房间媒体附件().find((item) => item.attachmentId === attachmentId)?.kind ??
        null,
      contentHash: null,
    };
  };

  const 标记附件完整并持久化 = (
    attachmentId: string,
    input: { kind?: 媒体种类 | null; contentHash?: string | null }
  ): void => {
    媒体会话表.get(attachmentId)?.send({ type: "ASSET_COMPLETE" });
    void 媒体缓存.标记完整(attachmentId, input).then(() => {
      deps.请求重渲染();
    });
  };

  const 处理协作分发事件 = (
    attachment: { attachmentId: string; kind: 媒体种类 },
    event:
      | { type: "SWARM_ACTIVE"; attachmentId: string; swarmId: string }
      | { type: "SWARM_NO_PEERS"; attachmentId: string; swarmId: string }
      | { type: "ASSET_COMPLETE"; attachmentId: string; swarmId: string; contentHash: string }
  ): void => {
    if (event.type === "SWARM_ACTIVE") {
      媒体会话表.get(attachment.attachmentId)?.send({ type: "SWARM_ACTIVE" });
      return;
    }
    if (event.type === "SWARM_NO_PEERS") {
      媒体会话表.get(attachment.attachmentId)?.send({ type: "SWARM_NO_PEERS" });
      return;
    }
    标记附件完整并持久化(attachment.attachmentId, {
      kind: attachment.kind,
      contentHash: event.contentHash,
    });
  };

  const 激活附件协作补齐 = (attachmentId: string): void => {
    const metadata = 读取附件缓存元数据(attachmentId);
    if (!metadata.kind) {
      return;
    }
    // 编排层只负责把“当前这张图值得后台补齐”的业务信号转交给播放器；
    // 真正 locate、读取 locator 兼容字段、接入 WebTorrent runtime 的细节仍留在播放器 owner。
    void 媒体播放器.激活协作补齐?.({
      attachmentId,
      kind: metadata.kind,
      consumerId: 构造媒体会话ConsumerId(attachmentId),
      onSessionEvent: (event) =>
        处理协作分发事件(
          { attachmentId, kind: metadata.kind! },
          event
        ),
    }).catch(() => undefined);
  };

  const 释放附件播放资源 = (input: {
    attachmentId: string;
    consumerId?: string;
  }): void => {
    // 编排层只在附件会话退场时通知播放器释放底层占用；
    // 真正“该不该持有 swarm lease”的判断仍在播放器/runtime 自己收口。
    媒体播放器.释放附件播放资源?.(input);
  };

  const 读取自动播播放结果表 = (): Record<string, 媒体播放结果> => {
    const 媒体运行时上下文 = 读取媒体运行时上下文();
    const ownerAttachmentId = 媒体运行时上下文.inlineAutoplayOwnerAttachmentId;
    const playback = 媒体运行时上下文.inlineAutoplayPlayback;
    if (!ownerAttachmentId || playback === null) {
      return {};
    }
    return {
      [ownerAttachmentId]: playback,
    };
  };

  const 清空自动播播放结果 = (
    ownerAttachmentId = 读取媒体运行时上下文().inlineAutoplayOwnerAttachmentId
  ): void => {
    const 媒体运行时上下文 = 读取媒体运行时上下文();
    if (
      !ownerAttachmentId &&
      媒体运行时上下文.inlineAutoplayOwnerAttachmentId === null &&
      媒体运行时上下文.inlineAutoplayPendingAttachmentId === null &&
      inlineAutoplay启动定时器 === null &&
      媒体运行时上下文.inlineAutoplayPlayback === null
    ) {
      return;
    }
    if (inlineAutoplay启动定时器 !== null) {
      clearTimeout(inlineAutoplay启动定时器);
      inlineAutoplay启动定时器 = null;
    }
    inlineAutoplay解析代次 += 1;
    if (ownerAttachmentId) {
      接收媒体运行时事实({
        type: "INLINE_AUTOPLAY_PLAYBACK_FAILED",
        attachmentId: ownerAttachmentId,
      });
    } else {
      deps.请求重渲染();
    }
  };

  const 释放当前自动播Owner = (
    ownerAttachmentId = 读取媒体运行时上下文().inlineAutoplayOwnerAttachmentId
  ): void => {
    const 当前Owner = ownerAttachmentId;
    if (!当前Owner) {
      清空自动播播放结果();
      return;
    }
    释放附件播放资源({
      attachmentId: 当前Owner,
      consumerId: 构造自动播ConsumerId(当前Owner),
    });
    清空自动播播放结果(当前Owner);
  };

  const 解析自动播播放结果 = (attachmentId: string): void => {
    const attachment = 读取附件条目(attachmentId);
    if (!attachment || attachment.kind !== "video") {
      清空自动播播放结果();
      return;
    }
    const 当前代次 = ++inlineAutoplay解析代次;
    接收媒体运行时事实({
      type: "INLINE_AUTOPLAY_PLAYBACK_FAILED",
      attachmentId,
    });
    void 媒体播放器
      .解析播放结果({
        attachmentId,
        kind: attachment.kind,
        surface: "inline_autoplay",
        consumerId: 构造自动播ConsumerId(attachmentId),
      })
      .then((playback) => {
        if (
          读取媒体运行时上下文().inlineAutoplayOwnerAttachmentId !== attachmentId ||
          当前代次 !== inlineAutoplay解析代次
        ) {
          return;
        }
        接收媒体运行时事实({
          type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED",
          attachmentId,
          playback,
        });
      })
      .catch(() => {
        if (
          读取媒体运行时上下文().inlineAutoplayOwnerAttachmentId !== attachmentId ||
          当前代次 !== inlineAutoplay解析代次
        ) {
          return;
        }
        接收媒体运行时事实({
          type: "INLINE_AUTOPLAY_PLAYBACK_FAILED",
          attachmentId,
        });
      });
  };

  const 调度自动播播放结果解析 = (attachmentId: string): void => {
    if (inlineAutoplay启动定时器 !== null) {
      clearTimeout(inlineAutoplay启动定时器);
      inlineAutoplay启动定时器 = null;
    }
    inlineAutoplay启动定时器 = setTimeout(() => {
      inlineAutoplay启动定时器 = null;
      if (
        读取媒体运行时上下文().inlineAutoplayPendingAttachmentId !== attachmentId
      ) {
        return;
      }
      接收媒体运行时事实({
        type: "INLINE_AUTOPLAY_SETTLE_ELAPSED",
      });
    }, 自动播候选稳定等待毫秒);
  };

  const 创建媒体会话条目 = (attachment: 媒体附件条目): 媒体会话端口 => {
    let session: 媒体会话端口;
    session = 创建媒体会话({
      attachmentId: attachment.attachmentId,
      kind: attachment.kind,
      解析播放结果: (input) =>
        媒体播放器.解析播放结果({
          ...input,
          onSessionEvent: (event) => 处理协作分发事件(attachment, event),
        }),
      onSnapshotChange: () => {
        deps.请求重渲染();
        同步当前查看器请求();
      },
    });
    应用缓存完整度到会话(attachment.attachmentId, session);
    return session;
  };

  const 读取或创建媒体会话 = (attachment: 媒体附件条目): 媒体会话端口 => {
    const current = 媒体会话表.get(attachment.attachmentId);
    if (current) {
      return current;
    }
    const session = 创建媒体会话条目(attachment);
    媒体会话表.set(attachment.attachmentId, session);
    deps.请求重渲染();
    return session;
  };

  const 启动查看器起始附件会话 = (request: 媒体查看器打开请求): void => {
    const startAttachment = 读取附件条目(request.startAttachmentId);
    if (!startAttachment || startAttachment.kind !== "video") {
      return;
    }
    const session = 读取或创建媒体会话(startAttachment);
    if (!session.snapshot().playback) {
      void session.启动();
    }
  };

  const 清空播放状态 = (): void => {
    for (const [attachmentId, session] of 媒体会话表) {
      释放附件播放资源({
        attachmentId,
        consumerId: 构造媒体会话ConsumerId(attachmentId),
      });
      session.销毁();
    }
    媒体会话表.clear();
    媒体定位器.清空();
  };

  void 媒体缓存.启动().then(() => {
    for (const attachmentId of 媒体会话表.keys()) {
      应用缓存完整度到会话(attachmentId);
    }
    deps.请求重渲染();
  });

  return {
    snapshot(): 聊天媒体快照 {
      return {
        playbackByAttachmentId: 读取媒体播放结果表(),
        sessionByAttachmentId: 读取媒体会话快照表(),
        contentUrlByAttachmentId: 读取附件内容地址表(),
        inlineAutoplayOwnerAttachmentId:
          读取媒体运行时上下文().inlineAutoplayOwnerAttachmentId,
        inlineAutoplayPlaybackByAttachmentId: 读取自动播播放结果表(),
      };
    },

    读取预算(): 聊天媒体预算快照 {
      return {
        ...投影媒体运行时预算(媒体运行时.getSnapshot()),
        ...协作分发运行时.读取预算(),
      };
    },

    async 处理选择媒体文件(files: Iterable<File>): Promise<void> {
      await 媒体发布器.处理选择媒体文件(files);
    },

    移除媒体草稿(localId: string): void {
      媒体发布器.移除草稿(localId);
    },

    async 继续上传媒体草稿(localId: string): Promise<void> {
      await 媒体发布器.继续上传草稿(localId);
    },

    async 重新上传媒体草稿(localId: string): Promise<void> {
      await 媒体发布器.重新上传草稿(localId);
    },

    清空草稿(): void {
      媒体发布器.清空();
    },

    打开查看器(request: 媒体查看器打开请求): void {
      const nextRequest = 投影查看器请求到当前播放真相({
        startAttachmentId: request.startAttachmentId,
        items: request.items.map((item) => ({ ...item })),
      });
      启动查看器起始附件会话(nextRequest);
      接收媒体运行时事实({
        type: "VIEWER_OPEN_REQUESTED",
        request: nextRequest,
      });
    },

    处理自动播候选(candidates: 消息视频自动播候选[]): void {
      接收媒体运行时事实({
        type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
        candidates,
      });
    },

    释放消息流自动播Owner(): void {
      /**
       * 自动播只是消息流壳层的轻量体验态，不是正式播放会话。
       * 页面退到后台时，这里必须立即释放 owner 和底层资源，
       * 避免后台继续占着 `<video>`、解码器和协作分发占用。
       */
      接收媒体运行时事实({
        type: "INLINE_AUTOPLAY_RELEASE_REQUESTED",
      });
    },

    /**
     * 播放结果只从“当前时间线里的附件集合”推导：
     * - 新出现的附件进入解析；
     * - 已经不在时间线里的附件立即退场；
     * - 壳层只读这个结果表，不再自己记一份播放缓存。
     */
    同步消息附件播放结果(): void {
      const attachments = 读取当前房间媒体附件();
      const activeAttachmentIds = new Set(attachments.map((item) => item.attachmentId));
      let hasSessionSetChanged = false;

      for (const [attachmentId, session] of 媒体会话表) {
        if (activeAttachmentIds.has(attachmentId)) {
          continue;
        }
        释放附件播放资源({
          attachmentId,
          consumerId: 构造媒体会话ConsumerId(attachmentId),
        });
        session.销毁();
        媒体会话表.delete(attachmentId);
        hasSessionSetChanged = true;
      }

      if (hasSessionSetChanged) {
        deps.请求重渲染();
      }
      接收媒体运行时事实({
        type: "MESSAGE_ATTACHMENTS_SYNCED",
        attachmentIds: Array.from(activeAttachmentIds),
      });

      for (const attachment of attachments) {
        if (媒体会话表.has(attachment.attachmentId)) {
          continue;
        }
        hasSessionSetChanged = true;
        const session = 创建媒体会话条目(attachment);
        媒体会话表.set(attachment.attachmentId, session);
        if (attachment.kind === "image") {
          void session.启动();
        }
      }

      if (hasSessionSetChanged) {
        deps.请求重渲染();
      }
    },

    处理媒体会话信号(attachmentId: string, signal: 媒体会话信号): void {
      if (signal.type === "ASSET_COMPLETE") {
        // 图片查看器只负责把“完整图已经拿到”回抛成会话信号；
        // 真正落盘到 MediaCacheOwner 的动作仍然只能由编排层统一收口。
        标记附件完整并持久化(attachmentId, 读取附件缓存元数据(attachmentId));
        return;
      }
      if (signal.type === "ASSET_BACKFILLING") {
        激活附件协作补齐(attachmentId);
      }
      if (
        signal.type === "PLAYER_PLAYING" &&
        读取媒体运行时上下文().currentViewerRequest?.startAttachmentId ===
          attachmentId &&
        读取附件条目(attachmentId)?.kind === "video"
      ) {
        激活附件协作补齐(attachmentId);
      }
      接收媒体运行时事实({
        type: "MEDIA_SESSION_SIGNALLED",
        attachmentId,
        signal,
      });
      转发媒体查看器会话信号(attachmentId, signal);
    },

    处理应用生命周期(input): void {
      接收媒体运行时事实({
        type: "LIFECYCLE_POLICY_CHANGED",
        heavyWorkPolicy: input.heavyWorkPolicy,
      });
      协作分发运行时.send({
        type: "LIFECYCLE_POLICY_CHANGED",
        heavyWorkPolicy: input.heavyWorkPolicy,
      });
    },

    处理平台在线状态变化(online: boolean): void {
      for (const session of 媒体会话表.values()) {
        session.send({ type: online ? "ORIGIN_AVAILABLE" : "ORIGIN_UNAVAILABLE" });
      }
    },

    清空(): void {
      const before = 媒体运行时.getSnapshot();
      媒体运行时.send({ type: "VIEWER_CLOSED" });
      媒体运行时.send({ type: "INLINE_AUTOPLAY_RELEASE_REQUESTED" });
      媒体查看器.销毁();
      媒体发布器.清空();
      清空播放状态();
      协作分发运行时.重置();
      void 同步媒体运行时快照并执行副作用(before);
      deps.请求重渲染();
    },

    销毁(): void {
      const before = 媒体运行时.getSnapshot();
      媒体运行时.send({ type: "VIEWER_CLOSED" });
      媒体运行时.send({ type: "INLINE_AUTOPLAY_RELEASE_REQUESTED" });
      媒体查看器.销毁();
      媒体发布器.销毁();
      清空播放状态();
      协作分发运行时.销毁();
      void 同步媒体运行时快照并执行副作用(before);
      媒体运行时.stop();
      deps.请求重渲染();
    },

    设置媒体播放器供测试(player): void {
      清空播放状态();
      媒体播放器 = {
        解析播放结果: player.解析播放结果,
        激活协作补齐: player.激活协作补齐 ?? (async () => undefined),
        释放附件播放资源: player.释放附件播放资源 ?? (() => undefined),
      };
      deps.请求重渲染();
    },

    设置媒体查看器供测试(viewer): void {
      媒体查看器.销毁();
      let 测试查看器已打开 = false;
      // 测试替身允许只关心“打开/销毁”两件事；
      // 这里把它适配成正式查看器契约，避免生产代码为了测试而放宽 owner 边界。
      媒体查看器 = {
        打开: (input) => {
          测试查看器已打开 = true;
          viewer.打开(input);
        },
        同步:
          viewer.同步 ??
          ((input) => {
            if (测试查看器已打开) {
              return;
            }
            测试查看器已打开 = true;
            viewer.打开(input);
          }),
        销毁: () => {
          测试查看器已打开 = false;
          viewer.销毁();
        },
      };
    },

    设置媒体发布器供测试(publisher): void {
      媒体发布器.销毁();
      媒体发布器 = publisher;
    },

    写入媒体草稿列表供测试(drafts): void {
      const 旧草稿预览地址 = deps.读取草稿().map((draft) => draft.previewUrl);
      const 保留中的预览地址 = new Set(drafts.map((draft) => draft.previewUrl));
      const 需要回收的预览地址 = 旧草稿预览地址.filter(
        (previewUrl) => !保留中的预览地址.has(previewUrl)
      );
      写入草稿列表([...drafts], 需要回收的预览地址);
    },
  };
}
