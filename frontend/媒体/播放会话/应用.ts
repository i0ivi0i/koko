import type {
  消息事件,
  媒体附件转发请求,
  媒体附件转发结果,
  媒体种类,
  媒体定位结果,
  附件分发线索,
  附件快照,
} from "../../聊天共享/契约.js";
import type { 媒体传输端口 } from "../../平台/传输.js";
import { 创建媒体运行时Actor } from "../运行时.js";
import {
  创建查看器会话协作,
  type 查看器会话协作端口,
} from "../壳层/查看器会话协作.js";
import { 创建自动播协作, type 自动播协作端口 } from "../壳层/自动播协作.js";
import { 创建媒体查看器应用 } from "../查看器/应用.js";
import { 创建媒体协作分发应用 } from "../协作分发/应用.js";
import {
  创建视频预览协作,
  type 视频预览协作端口,
} from "../壳层/视频预览协作.js";
import {
  创建协作补齐协作,
  type 协作补齐协作端口,
} from "../壳层/协作补齐协作.js";
import {
  创建媒体快照投影协作,
} from "../壳层/快照投影协作.js";
import { 创建窗口会话协作 } from "../壳层/窗口会话协作.js";
import {
  创建窗口附件协作,
  type 媒体附件条目,
} from "../壳层/窗口附件协作.js";
import {
  创建媒体定位器,
  创建内存媒体定位缓存仓库,
  type 媒体定位缓存仓库,
} from "../媒体定位.js";
import {
  创建媒体缓存,
  创建内存媒体缓存仓库,
  type 媒体缓存仓库,
} from "../媒体缓存.js";
import { 创建内存预览缓存, type 预览缓存端口 } from "../预览缓存.js";
import {
  创建媒体播放器,
  type 媒体播放结果,
  type 媒体播放位置,
} from "../媒体播放.js";
import {
  创建媒体会话,
  type 媒体会话信号,
  type 媒体会话端口,
} from "../媒体会话.js";
import { 创建媒体查看器, type 媒体查看器打开请求 } from "../媒体查看器.js";
import { 从媒体源抓取视频预览 } from "../视频预览.js";
import type { 协作分发会话事件 } from "../媒体协作分发.js";
import type { WebTorrentSessionLifecycleSnapshot } from "../资产协作分发运行时.js";
import type { 消息视频自动播候选 } from "../消息视频自动播编排.js";
import type { 媒体附件草稿 } from "../媒体草稿.js";
import {
  投影媒体播放会话快照,
  投影媒体播放会话预算,
  type 媒体播放会话快照,
  type 媒体播放会话预算快照,
} from "./会话投影.js";
import { 创建播放会话草稿发布, type 播放会话媒体发布器 } from "./草稿发布.js";
import { 创建播放会话运行时副作用 } from "./运行时副作用.js";
import { 同步自动播候选预热 } from "./自动播候选预热.js";
import { 释放查看器正式播放占用 } from "./查看器播放释放.js";

export type { 媒体播放会话快照, 媒体播放会话预算快照 } from "./会话投影.js";

type 程序滚动来源 = "media_viewer_open";

export type 媒体播放会话应用依赖 = {
  transport(): 媒体传输端口;
  读取会话编号(): string;
  读取当前房间标识?(): string | null;
  读取消息(): 消息事件[];
  读取草稿(): 媒体附件草稿[];
  写入媒体选择中过渡计数?(count: number): void;
  媒体缓存仓库?: 媒体缓存仓库;
  媒体定位仓库?: 媒体定位缓存仓库;
  预览缓存?: 预览缓存端口;
  写入草稿列表(next: 媒体附件草稿[]): void;
  请求重渲染(): void;
  回收媒体草稿预览地址(previewUrls: string[]): void;
  登记程序滚动来源(source: 程序滚动来源): void;
  清除程序滚动来源(source: 程序滚动来源): void;
  抓取视频预览?: typeof 从媒体源抓取视频预览;
  /** complete 成功后 fire-and-forget 预取 locator，让发送者视频秒播。 */
  预取媒体定位?(attachmentId: string): void;
};

export interface 媒体播放会话应用端口 {
  snapshot(): 媒体播放会话快照;
  读取预算(): 媒体播放会话预算快照;
  处理选择媒体文件(files: Iterable<File>): Promise<void>;
  转发媒体附件(kind: 媒体种类, input: 媒体附件转发请求): Promise<媒体附件转发结果>;
  移除媒体草稿(localId: string): void;
  继续上传媒体草稿(localId: string): Promise<void>;
  重新上传媒体草稿(localId: string): Promise<void>;
  清空草稿(): void;
  打开查看器(request: 媒体查看器打开请求): void;
  同步消息附件播放结果(): void;
  同步媒体窗口附件(attachmentIds: string[]): void;
  处理自动播候选(candidates: 消息视频自动播候选[]): void;
  更新媒体播放位置(input: {
    attachmentId: string;
    position: 媒体播放位置;
  }): void;
  释放消息流自动播Owner(): void;
  处理媒体会话信号(attachmentId: string, signal: 媒体会话信号): void;
  处理应用生命周期(input: {
    visibility: "visible" | "hidden";
    phase: "active" | "background" | "page_hidden" | "frozen" | "resumed";
    heavyWorkPolicy: "normal" | "reduced" | "suspended";
  }): void;
  处理平台在线状态变化(online: boolean): void;
  /** room_event 到达即触发：过滤掉 sender=self，为含 distribution_hint 的附件 fire-and-forget locator pre-fetch。 */
  预热权威消息媒体分发(events: 消息事件[], currentSessionId: string): void;
  清空(): void;
  销毁(): void;
}

type 媒体播放释放请求 = { attachmentId: string; consumerId?: string; 丢弃未完成补齐?: boolean };
type 可替换媒体播放器 = { 解析播放结果(input: { attachmentId: string; kind: "image" | "video"; surface?: "viewer" | "inline_autoplay"; consumerId?: string }): Promise<媒体播放结果>; 激活协作补齐?(input: { attachmentId: string; kind: "image" | "video"; consumerId?: string; onSessionEvent?: (event: 协作分发会话事件) => void }): Promise<void>; 释放附件播放资源?(input: 媒体播放释放请求): void; };
type 可替换媒体查看器 = { 打开(input: 媒体查看器打开请求): void; 同步?(input: 媒体查看器打开请求): void; 销毁(): void; };
type 可替换媒体发布器 = { 处理选择媒体文件(files: Iterable<File>): Promise<void>; 移除草稿(localId: string): void; 继续上传草稿(localId: string): Promise<void>; 重新上传草稿(localId: string): Promise<void>; 清空(): void; 销毁(): void; };
type 媒体播放会话内部桥 = { 替换媒体播放器(player: 可替换媒体播放器): void; 替换媒体查看器(viewer: 可替换媒体查看器): void; 关闭媒体查看器(): void; 替换媒体发布器(publisher: 可替换媒体发布器): void; 替换媒体草稿列表(drafts: 媒体附件草稿[]): void; };

/** 从广播路径丰富 hint 构造最小 locator 结果，供直接缓存和 prefetch 使用。
 *  web_seed_url 在广播路径下为 null（含 per-session 鉴权无法共享），
 *  prefetch (deselect=true) 只加入 swarm 不下载数据，不需要 web_seed。 */
function 从丰富hint构造最小定位结果(
  attachment: 附件快照 & { distribution_hint: 附件分发线索 },
): 媒体定位结果 {
  const hint = attachment.distribution_hint;
  return {
    attachment_id: attachment.attachment_id,
    kind: attachment.kind,
    status: "ready",
    thumbnail_url: null,
    distribution: {
      content_id: hint.content_hash,
      content_hash: hint.content_hash,
      swarm_id: hint.swarm_id,
      web_seed_until: String(hint.web_seed_until),
      torrent_url: hint.torrent_url ?? null,
      torrent_info_hash: hint.torrent_info_hash,
      announce_urls: hint.announce_urls ?? [],
      web_seed_url: hint.web_seed_url ?? null,
      join_ticket: hint.join_ticket ?? null,
      ticket_expires_at: hint.ticket_expires_at ?? null,
      media_state: { code: "MEDIA_READY", retry_after_ms: null },
      survival_mode: "server_assisted",
      ice_servers: hint.ice_servers as { urls: string; username?: string; credential?: string }[],
    },
  };
}

const 构造媒体会话ConsumerId = (attachmentId: string): string => `session:${attachmentId}`; const 构造自动播ConsumerId = (attachmentId: string): string => `inline_autoplay:${attachmentId}`;
const 构造预览ConsumerId = (attachmentId: string): string => `preview:${attachmentId}`; const 构造协作补齐ConsumerId = (attachmentId: string): string => `backfill:${attachmentId}`;

/**
 * 聊天媒体编排只拥有“浏览器端媒体体验真相”：
 * - 上传草稿属于本地体验态；
 * - 播放结果属于浏览器端解析态；
 * - 查看器开关和视口占用属于前端交互编排。
 *
 * 它不拥有聊天时间线真相，也不直接暴露 transport。
 */
export function 创建媒体播放会话应用(
  deps: 媒体播放会话应用依赖
): 媒体播放会话应用端口 {
  const 媒体运行时 = 创建媒体运行时Actor();
  let 媒体选择中过渡计数 = 0;
  let 媒体缓存已启动 = false;
  const 读取媒体运行时上下文 = () => 媒体运行时.getSnapshot().context;
  const 变更媒体选择中过渡计数 = (delta: number): void => {
    媒体选择中过渡计数 = Math.max(0, 媒体选择中过渡计数 + delta);
    deps.写入媒体选择中过渡计数?.(媒体选择中过渡计数);
  };
  const 媒体定位器 = 创建媒体定位器({
    getSessionId: () => deps.读取会话编号(),
    loadMediaLocator: (sessionId, attachmentId, signal) =>
      deps.transport().loadMediaLocator(sessionId, attachmentId, signal),
    repo: deps.媒体定位仓库 ?? 创建内存媒体定位缓存仓库(),
  });
  const 协作分发应用 = 创建媒体协作分发应用({
    refreshJoinTicket: (input) =>
      /**
       * join ticket 续租必须回到定位 owner：
       * 1. 当前附件是谁，只能由 locator 主链重签；
       * 2. 编排层不再自己拼第二条 refresh seam；
       * 3. 这样 swarm/infohash 校验始终由 runtime + locator 同一口径收口。
       */
      媒体定位器.获取定位(input.attachmentId, { forceRefresh: true }),
  });

  let 媒体播放器 = 创建媒体播放器({
    locate: (attachmentId, options) => 媒体定位器.获取定位(attachmentId, options),
    resolveSwarmSource: (input) => 协作分发应用.解析协作分发源(input),
    releaseSwarmSource: (input) => 协作分发应用.释放协作分发消费者(input),
  });
  const 媒体会话表 = new Map<string, 媒体会话端口>();
  const 当前媒体窗口附件Id集合 = new Set<string>();
  const 当前自动播候选附件Id集合 = new Set<string>();
  const 媒体缓存 = 创建媒体缓存({
    repo: deps.媒体缓存仓库 ?? 创建内存媒体缓存仓库(),
  });
  const 抓取视频预览 = deps.抓取视频预览 ?? 从媒体源抓取视频预览;
  /**
   * 预览缓存默认只退回内存仓库：
   * - 生产环境由平台存储运行时显式注入浏览器仓库；
   * - 这里不允许再直接猜 `localStorage`，避免 owner 越层双活；
   * - 测试未注入时，内存仓库也足够覆盖编排行为。
   */
  const 预览缓存 = deps.预览缓存 ?? 创建内存预览缓存();
  let 查看器会话协作!: 查看器会话协作端口;
  let 自动播协作!: 自动播协作端口;
  let 视频预览协作!: 视频预览协作端口;
  let 协作补齐协作!: 协作补齐协作端口;
  const 跳过查看器同步的播放释放附件 = new Set<string>();
  const 释放附件播放资源 = (input: 媒体播放释放请求): void => {
    // 编排层只在附件会话退场时通知播放器释放底层占用；
    // 真正“该不该持有 swarm lease”的判断仍在播放器/runtime 自己收口。
    媒体播放器.释放附件播放资源?.(input);
  };
  const 释放媒体附件会话 = (
    attachmentId: string,
    input: {
      丢弃未完成播放补齐?: boolean;
      丢弃未完成预览补齐?: boolean;
      清理协作补齐?: boolean;
      清理视频预览?: boolean;
      立即请求重渲染?: boolean;
    } = {}
  ): boolean => {
    const session = 媒体会话表.get(attachmentId);
    if (!session) {
      return false;
    }
    释放附件播放资源({
      attachmentId,
      consumerId: 构造媒体会话ConsumerId(attachmentId),
      ...(input.丢弃未完成播放补齐 ? { 丢弃未完成补齐: true } : {}),
    });
    协作分发应用.释放协作分发消费者({
      attachmentId,
      consumerId: 构造预览ConsumerId(attachmentId),
      ...(input.丢弃未完成预览补齐 ? { 丢弃未完成补齐: true } : {}),
    });
    /**
     * 附件会话退场后，旧 locator 请求必须立刻失效：
     * 1. 当前窗口真相已经否定了这条附件的活跃身份；
     * 2. 不能让它继续在后台返回后回写 cache / preview / swarm 事实；
     * 3. 这里只中止未完成请求，不清掉当前 session 的已命中缓存，方便附件再次回到窗口时复用。
     */
    媒体定位器.放弃未完成定位(attachmentId);
    session.销毁();
    媒体会话表.delete(attachmentId);
    if (input.清理协作补齐) {
      协作补齐协作.清理附件(attachmentId);
    }
    if (input.清理视频预览) {
      视频预览协作.删除视频预览状态(attachmentId);
    }
    if (input.立即请求重渲染) {
      deps.请求重渲染();
    }
    return true;
  };
  const 运行时副作用 = 创建播放会话运行时副作用({
    读取运行时快照: () => 媒体运行时.getSnapshot(),
    发送运行时事件: (event) => {
      媒体运行时.send(event);
    },
    自动播协作: () => 自动播协作,
    查看器会话协作: () => 查看器会话协作,
    释放查看器正式播放占用: (attachmentId) =>
      释放查看器正式播放占用({
        attachmentId,
        媒体会话表,
        读取当前查看器请求: () => 读取媒体运行时上下文().currentViewerRequest,
        释放附件播放资源,
        构造媒体会话ConsumerId,
        跳过查看器同步的播放释放附件,
      }),
    触发视频预览收敛: (attachmentId) => {
      触发视频预览收敛(attachmentId);
    },
    请求重渲染: deps.请求重渲染,
  });
  const 接收媒体运行时事实 = 运行时副作用.接收媒体运行时事实;
  const 转发媒体查看器会话信号 = (attachmentId: string, signal: 媒体会话信号): void => {
    媒体会话表.get(attachmentId)?.send(signal);
  };
  let 媒体查看器 = 创建媒体查看器({
    onViewportCaptureEnd: () => {
      接收媒体运行时事实({ type: "VIEWER_CLOSED" });
    },
    onMediaSessionSignal: 转发媒体查看器会话信号,
    onPlaybackPositionChanged: (attachmentId, position) => {
      接收媒体运行时事实({
        type: "PLAYBACK_POSITION_CHANGED",
        attachmentId,
        position,
      });
    },
  });

  const 草稿发布 = 创建播放会话草稿发布({
    ...deps,
    // complete 成功后 fire-and-forget 预取 locator，让发送者视频秒播。
    // 利用 inflight 去重：发送后自动播触发 获取定位() 时 piggyback 此请求。
    预取媒体定位: (attachmentId) => {
      void 媒体定位器.获取定位(attachmentId).catch(() => {});
    },
  });
  let 媒体发布器: 播放会话媒体发布器 = 草稿发布.创建媒体发布器();

  const 窗口附件协作 = 创建窗口附件协作({
    读取消息: deps.读取消息,
    读取当前房间标识: () => deps.读取当前房间标识?.() ?? null,
    读取媒体缓存快照: () => 媒体缓存.snapshot(),
    读取当前媒体窗口附件标识: () => 当前媒体窗口附件Id集合,
    读取当前自动播候选附件标识: () => 当前自动播候选附件Id集合,
    读取窗口外显式保活上下文: () => {
      const 当前媒体上下文 = 读取媒体运行时上下文();
      return {
        viewerAttachmentId: 当前媒体上下文.currentViewerRequest?.startAttachmentId ?? null,
        autoplayOwnerAttachmentId: 当前媒体上下文.inlineAutoplayOwnerAttachmentId ?? null,
      };
    },
  });

  const 读取会话播放源版本 = (attachmentId: string): number =>
    媒体会话表.get(attachmentId)?.snapshot().sourceVersion ?? 0;

  const 读取视频预览候选播放源 = (
    attachmentId: string
  ): { src: string; contentHash: string | null } | null => {
    const 会话播放 = 媒体会话表.get(attachmentId)?.snapshot().playback ?? null;
    const 运行时自动播播放 =
      读取媒体运行时上下文().inlineAutoplayOwnerAttachmentId === attachmentId
        ? 读取媒体运行时上下文().inlineAutoplayPlayback
        : null;
    const playback = 会话播放 ?? 运行时自动播播放;
    /**
     * 视频预览只允许复用当前已经成立的 swarm 主链：
     * 1. 优先复用正式媒体会话的 playback；
     * 2. 如果正式会话还没热起来，但 runtime 的 autoplay owner 已经握住 swarm 真相，也允许直接复用；
     * 3. `anchor/degraded/expired` 仍属于冷源或降级面，不能再反向喂回预览 owner。
     */
    if (!playback || playback.kind !== "video" || playback.mode !== "swarm") {
      return null;
    }
    return {
      src: playback.src,
      contentHash: playback.contentHash ?? null,
    };
  };

  const 读取播放结果协作分发生命周期 = (
    playback: 媒体播放结果 | null
  ): WebTorrentSessionLifecycleSnapshot | null => {
    const swarmId = playback?.mode === "swarm" ? playback.distribution?.swarm_id : null;
    if (!swarmId) {
      return null;
    }
  /**
   * 聊天媒体编排只读取生命周期投影，不直接改 WebTorrent runtime：
   * 1. swarm_id 仍来自后端 locator / playback distribution，不从 URL 文本反推；
   * 2. budget 只消费 runtime owner 已裁决的轻重状态；
   * 3. 这样消息窗不会继续用旧 preview src 自己猜“还能不能渲染真实 video”。
   */
    return 协作分发应用.读取会话状态(swarmId)?.lifecycle ?? null;
  };

  const 媒体快照投影协作 = 创建媒体快照投影协作({
    构建附件内容地址: (attachmentId, variant) =>
      deps.transport().buildAttachmentContentUrl(
        attachmentId,
        deps.读取会话编号(),
        variant
      ),
    读取当前房间媒体附件: 窗口附件协作.读取当前房间媒体附件,
    读取媒体会话表: () => 媒体会话表,
    读取视频预览候选播放源,
    读取媒体运行时上下文,
    当前在媒体窗口内: (attachmentId) => 当前媒体窗口附件Id集合.has(attachmentId),
    当前是自动播候选: (attachmentId) => 当前自动播候选附件Id集合.has(attachmentId),
    读取附件缓存是否完整: (attachmentId) => 媒体缓存.snapshot()[attachmentId]?.complete === true,
    读取播放结果协作分发生命周期,
  });

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
    const cached = 媒体缓存.snapshot()[attachmentId];
    const playback = 媒体会话表.get(attachmentId)?.snapshot().playback;
    if (
      playback &&
      playback.mode === "swarm" &&
      "contentHash" in playback &&
      playback.contentHash
    ) {
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
        窗口附件协作.读取当前房间媒体附件().find((item) => item.attachmentId === attachmentId)
          ?.kind ??
        cached?.kind ??
        null,
      contentHash: cached?.contentHash ?? null,
    };
  };

  const 标记附件完整并持久化 = (
    attachmentId: string,
    input: { kind?: 媒体种类 | null; contentHash?: string | null }
  ): void => {
    媒体会话表.get(attachmentId)?.send({ type: "ASSET_COMPLETE" });
    void 媒体缓存
      .标记完整(attachmentId, {
        roomId: deps.读取当前房间标识?.() ?? null,
        ...input,
      })
      .then(() => {
        deps.请求重渲染();
      });
  };

  查看器会话协作 = 创建查看器会话协作({
    读取当前查看器请求: () => 读取媒体运行时上下文().currentViewerRequest,
    读取查看器是否已打开: () => 读取媒体运行时上下文().viewerOpen,
    读取媒体会话快照: (attachmentId) => 媒体会话表.get(attachmentId)?.snapshot() ?? null,
    读取媒体会话: (attachmentId) => 媒体会话表.get(attachmentId) ?? null,
    读取自动播播放结果: (attachmentId) => {
      const context = 读取媒体运行时上下文();
      const playback = context.inlineAutoplayPlayback;
      if (context.inlineAutoplayOwnerAttachmentId !== attachmentId) {
        return null;
      }
      return playback?.attachmentId === attachmentId ? playback : null;
    },
    读取视频预览状态: (attachmentId) => 视频预览协作.读取视频预览状态(attachmentId),
    更新当前查看器请求: (request) => {
      接收媒体运行时事实({
        type: "VIEWER_REQUEST_SYNCED",
        request,
      });
    },
    确认查看器已打开: () => {
      接收媒体运行时事实({ type: "VIEWER_OPEN_CONFIRMED" });
    },
    打开查看器: (request) => {
      媒体查看器.打开(request);
    },
    同步查看器: (request) => {
      媒体查看器.同步?.(request);
    },
    登记程序滚动来源: deps.登记程序滚动来源,
    清除程序滚动来源: deps.清除程序滚动来源,
  });

  自动播协作 = 创建自动播协作({
    读取媒体运行时上下文,
    读取附件条目: 窗口附件协作.读取附件条目,
    读取媒体会话快照: (attachmentId) => 媒体会话表.get(attachmentId)?.snapshot() ?? null,
    接收媒体运行时事实,
    解析播放结果: (input) => 媒体播放器.解析播放结果(input),
    释放附件播放资源,
    构造自动播ConsumerId,
    标记自动播进入帮助链: (attachmentId) => {
      const attachment = 窗口附件协作.读取附件条目(attachmentId);
      if (!attachment || attachment.kind !== "video") {
        return;
      }
      // 自动播放一旦真实吃到 swarm 视频字节，就已经是“看过”的用户；
      // 这里把它晋升到后台补齐帮助链，避免 owner 离屏后整文件补齐被降掉。
      协作补齐协作.处理媒体会话信号({
        attachmentId,
        signal: { type: "ASSET_BACKFILLING" },
      });
    },
    请求重渲染: deps.请求重渲染,
  });

  视频预览协作 = 创建视频预览协作({
    读取附件条目: 窗口附件协作.读取附件条目,
    读取会话播放源版本,
    读取当前视频预览播放源: 读取视频预览候选播放源,
    获取媒体定位: (attachmentId, options) => 媒体定位器.获取定位(attachmentId, options),
    解析协作分发预览源: ({ attachmentId, locator, consumerId }) =>
      协作分发应用.解析协作分发源({
        attachmentId,
        kind: "video",
        locator,
        consumerId,
      }),
    释放协作分发消费者: (input) => {
      协作分发应用.释放协作分发消费者(input);
    },
    预览缓存,
    抓取视频预览,
    接收媒体运行时事实,
    请求重渲染: deps.请求重渲染,
    同步当前查看器请求: () => {
      查看器会话协作.同步当前查看器请求();
    },
    构造预览ConsumerId,
  });

  协作补齐协作 = 创建协作补齐协作({
    读取媒体会话: (attachmentId) => 媒体会话表.get(attachmentId) ?? null,
    读取附件缓存元数据,
    读取附件缓存是否完整: (attachmentId) =>
      媒体缓存.snapshot()[attachmentId]?.complete === true,
    读取媒体缓存已启动: () => 媒体缓存已启动,
    激活协作补齐: (input) => 媒体播放器.激活协作补齐?.(input) ?? Promise.resolve(),
    释放协作补齐: (input) => {
      媒体播放器.释放附件播放资源?.(input);
    },
    应用缓存完整度到会话: (attachmentId) => {
      应用缓存完整度到会话(attachmentId);
    },
    标记媒体定位过期: (attachmentId) => {
      媒体定位器.标记过期(attachmentId);
    },
    标记附件完整并持久化,
    读取当前房间媒体附件: 窗口附件协作.读取当前房间媒体附件,
    读取附件条目: 窗口附件协作.读取附件条目,
    读取当前查看器起始附件标识: () =>
      读取媒体运行时上下文().currentViewerRequest?.startAttachmentId ?? null,
    构造协作补齐ConsumerId,
  });

  const 创建媒体会话条目 = (attachment: 媒体附件条目): 媒体会话端口 => {
    let session: 媒体会话端口;
    session = 创建媒体会话({
      attachmentId: attachment.attachmentId,
      kind: attachment.kind,
      解析播放结果: (input) =>
        媒体播放器.解析播放结果({
          ...input,
          onSessionEvent: 协作补齐协作.创建协作分发事件转发器(attachment),
        }),
      onSnapshotChange: () => {
        deps.请求重渲染();
        if (跳过查看器同步的播放释放附件.delete(attachment.attachmentId)) {
          return;
        }
        查看器会话协作.同步当前查看器请求();
        触发视频预览收敛(attachment.attachmentId);
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

  const 触发视频预览收敛 = (
    attachmentId: string,
    input: { trigger?: "default" | "visible_candidate" } = {}
  ): void => {
    /**
     * “该不该重试 preview” 的门禁必须只保留在视频预览协作里：
     * 1. 编排层只表达 trigger，不复制 `loading / missing_source / stronger src` 的细节判断；
     * 2. 否则一旦外层 if 和协作内层 if 漂移，就会把“已有更强 swarm src 的 loading 抢占”这类关键修复挡死；
     * 3. 因此这里宁可把重复调用交给协作层短路，也不在外层再长一份简化版真相。
     */
    视频预览协作.解析视频预览(attachmentId, input);
  };
  const 媒体查看器应用 = 创建媒体查看器应用({
    读取附件条目: 窗口附件协作.读取附件条目,
    读取或创建媒体会话,
    读取媒体运行时上下文,
    投影查看器请求到当前播放真相: (request) =>
      查看器会话协作.投影查看器请求到当前播放真相(request),
    触发视频预览收敛: (attachmentId) => {
      触发视频预览收敛(attachmentId);
    },
    接收媒体运行时事实,
  });

  const 窗口会话协作 = 创建窗口会话协作({
    读取当前房间媒体附件: 窗口附件协作.读取当前房间媒体附件,
    读取当前活跃媒体窗口附件: 窗口附件协作.读取当前活跃媒体窗口附件,
    读取当前房间帮助附件候选: 窗口附件协作.读取当前房间帮助附件候选,
    读取媒体会话表: () => 媒体会话表,
    创建媒体会话条目,
    释放媒体附件会话,
    读取附件条目: 窗口附件协作.读取附件条目,
    触发视频预览收敛: (attachmentId) => {
      触发视频预览收敛(attachmentId);
    },
    应保留帮助任务: (input) => 协作补齐协作.应保留帮助任务(input),
    同步当前帮助窗口附件: (attachments) => {
      协作补齐协作.同步当前帮助窗口附件(attachments);
    },
    恢复当前房间缓存帮助任务: (attachments) => {
      协作补齐协作.恢复当前房间缓存帮助任务(attachments);
    },
    接收消息附件同步: (input) => {
      接收媒体运行时事实({
        type: "MESSAGE_ATTACHMENTS_SYNCED",
        attachmentIds: input.attachmentIds,
        positionRetentionAttachmentIds: input.positionRetentionAttachmentIds,
      });
      // Phase 3: 含 distribution_hint 的视频附件 → eager pre-fetch locator
      // 利用 inflight 去重：自动播后续调 获取定位() 时 piggyback 此请求
      if (input.eagerPrefetchAttachmentIds) {
        for (const attachmentId of input.eagerPrefetchAttachmentIds) {
          void 媒体定位器.获取定位(attachmentId).catch(() => {});
        }
      }
    },
    请求重渲染: deps.请求重渲染,
  });

  const 清空播放状态 = (): void => {
    当前媒体窗口附件Id集合.clear();
    当前自动播候选附件Id集合.clear();
    for (const attachmentId of Array.from(媒体会话表.keys())) {
      释放媒体附件会话(attachmentId, {
        丢弃未完成预览补齐: true,
      });
    }
    协作补齐协作.清空();
    视频预览协作.清空();
    查看器会话协作.重置();
    媒体定位器.清空();
  };

  const 执行媒体编排关停 = (input: {
    发布器动作: "clear" | "destroy";
    协作分发动作: "reset" | "destroy";
    停止媒体运行时?: boolean;
  }): void => {
    const before = 媒体运行时.getSnapshot();
    媒体运行时.send({ type: "VIEWER_CLOSED" });
    媒体运行时.send({ type: "INLINE_AUTOPLAY_RELEASE_REQUESTED" });
    媒体查看器.销毁();
    媒体选择中过渡计数 = 0;
    deps.写入媒体选择中过渡计数?.(0);
    if (input.发布器动作 === "clear") {
      媒体发布器.清空();
    } else {
      媒体发布器.销毁();
    }
    清空播放状态();
    if (input.协作分发动作 === "reset") {
      协作分发应用.重置();
    } else {
      协作分发应用.销毁();
    }
    void 运行时副作用.同步媒体运行时快照并执行副作用(before);
    if (input.停止媒体运行时) {
      媒体运行时.stop();
    }
    自动播协作.销毁();
    deps.请求重渲染();
  };

  void 媒体缓存.启动().then(() => {
    媒体缓存已启动 = true;
    const helpWindowAttachmentIds = 窗口附件协作.读取当前帮助窗口附件标识([]);
    if (helpWindowAttachmentIds.size > 0) {
      const helpWindowAttachments = 窗口附件协作
        .读取当前房间媒体附件()
        .filter((attachment) => helpWindowAttachmentIds.has(attachment.attachmentId));
      const helpAttachments = 窗口附件协作.读取当前房间帮助附件候选(
        helpWindowAttachments
      );
      协作补齐协作.同步当前帮助窗口附件(helpAttachments);
      协作补齐协作.恢复当前房间缓存帮助任务(helpAttachments);
    }
    deps.请求重渲染();
  });

  const 内部桥: 媒体播放会话内部桥 = {
    替换媒体播放器(player): void {
      清空播放状态();
      媒体播放器 = {
        解析播放结果: player.解析播放结果,
        激活协作补齐: player.激活协作补齐 ?? (async () => undefined),
        释放附件播放资源: player.释放附件播放资源 ?? (() => undefined),
      };
      deps.请求重渲染();
    },

    替换媒体查看器(viewer): void {
      媒体查看器.销毁();
      let 测试查看器已打开 = false;
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

    关闭媒体查看器(): void {
      const before = 媒体运行时.getSnapshot();
      媒体运行时.send({ type: "VIEWER_CLOSED" });
      媒体查看器.销毁();
      void 运行时副作用.同步媒体运行时快照并执行副作用(before);
    },

    替换媒体发布器(publisher): void {
      媒体发布器.销毁();
      媒体发布器 = publisher;
    },

    替换媒体草稿列表(drafts): void {
      草稿发布.替换媒体草稿列表(drafts);
    },
  };

  const 应用端口: 媒体播放会话应用端口 & { 内部桥: 媒体播放会话内部桥 } = {
    snapshot(): 媒体播放会话快照 {
      return 投影媒体播放会话快照({
        媒体快照投影协作,
        视频预览状态表: 视频预览协作.读取视频预览状态表(),
        自动播协作,
        运行时上下文: 读取媒体运行时上下文(),
      });
    },

    读取预算(): 媒体播放会话预算快照 {
      return 投影媒体播放会话预算({
        媒体会话表,
        媒体运行时快照: 媒体运行时.getSnapshot(),
        协作分发应用,
        媒体快照投影协作,
      });
    },

    async 处理选择媒体文件(files: Iterable<File>): Promise<void> {
      const selectedFiles = Array.from(files);
      if (selectedFiles.length === 0) {
        return;
      }
      /**
       * 文件 picker 返回到真正草稿出现之间存在一个短暂但真实的异步窗口：
       * - source-hash 预检、图片规范化、视频预制都会先 await；
       * - 这时草稿列表可能还是空，但“附件已被选中”已经成立；
       * - 所以必须先把这段过渡态写进输入 slice，封死纯文本先发的抢跑窗口。
       */
      变更媒体选择中过渡计数(selectedFiles.length);
      try {
        await 媒体发布器.处理选择媒体文件(selectedFiles);
      } finally {
        变更媒体选择中过渡计数(-selectedFiles.length);
      }
    },

    async 转发媒体附件(
      kind: 媒体种类,
      input: 媒体附件转发请求
    ): Promise<媒体附件转发结果> {
      // 编排层只暴露“转发意图”的窄口，授权和资产复用仍由后端用例层裁决。
      return deps.transport().forwardMediaAttachment(kind, input);
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
      媒体查看器应用.打开查看器(request);
    },

    同步媒体窗口附件(attachmentIds: string[]): void {
      if (!窗口附件协作.同步附件标识集合(当前媒体窗口附件Id集合, attachmentIds)) {
        return;
      }
      窗口会话协作.按当前窗口重同步消息附件播放结果();
    },

    处理自动播候选(candidates: 消息视频自动播候选[]): void {
      const 当前自动播上下文 = 读取媒体运行时上下文();
      const { 自动播候选已变化 } = 同步自动播候选预热({
        candidates,
        currentOwnerOrPendingAttachmentId:
          当前自动播上下文.inlineAutoplayPendingAttachmentId ??
          当前自动播上下文.inlineAutoplayOwnerAttachmentId,
        当前自动播候选附件Id集合,
        同步附件标识集合: 窗口附件协作.同步附件标识集合,
        读取附件条目: 窗口附件协作.读取附件条目,
        触发视频预览收敛,
      });
      if (自动播候选已变化) {
        窗口会话协作.按当前窗口重同步消息附件播放结果();
      }
      接收媒体运行时事实({
        type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
        candidates,
      });
    },

    更新媒体播放位置(input): void {
      接收媒体运行时事实({
        type: "PLAYBACK_POSITION_CHANGED",
        attachmentId: input.attachmentId,
        position: input.position,
      });
    },

    释放消息流自动播Owner(): void {
      // 自动播只是消息流轻量体验态；后台必须释放 owner、video、解码器和协作分发占用。
      接收媒体运行时事实({
        type: "INLINE_AUTOPLAY_RELEASE_REQUESTED",
      });
    },

    /**
     * 播放结果仍以当前时间线附件集合为主输入；
     * 但已进入帮助链的附件不能因为暂时退出当前消息集合就被立刻释放。
     */
    同步消息附件播放结果(): void {
      窗口会话协作.按当前窗口重同步消息附件播放结果();
    },

    处理媒体会话信号(attachmentId: string, signal: 媒体会话信号): void {
      if (
        !协作补齐协作.处理媒体会话信号({
          attachmentId,
          signal,
        })
      ) {
        return;
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
      协作分发应用.send({
        type: "LIFECYCLE_POLICY_CHANGED",
        heavyWorkPolicy: input.heavyWorkPolicy,
      });
    },

    处理平台在线状态变化(online: boolean): void {
      for (const session of 媒体会话表.values()) {
        session.send({ type: online ? "ORIGIN_AVAILABLE" : "ORIGIN_UNAVAILABLE" });
      }
    },

    预热权威消息媒体分发(events, currentSessionId): void {
      // room_event 到达时立即触发，比 viewport sync → eagerPrefetch 早 50-200ms。
      // 只预热他人消息：发送者自身不需要重复预热。
      // fire-and-forget：利用 inflight 去重，后续 viewport/autoplay 会 piggyback 同一请求。
      for (const event of events) {
        if (event.sender_session_id === currentSessionId) {
          continue;
        }
        for (const attachment of event.attachments ?? []) {
          if (!attachment.distribution_hint) {
            continue;
          }
          const aid = attachment.attachment_id;
          const hint = attachment.distribution_hint;
          console.debug("[MEDIA_HINT_INGESTED]", aid, hint.torrent_info_hash);
          performance.mark?.(`media_hint_ingested:${aid}`);

          // 丰富 hint 路径：广播携带 join_ticket + announce_urls，
          // 直接写入 locator 缓存，消除后续 viewport/autoplay 触发的 HTTP locator 往返（80-200ms）。
          // WebTorrent 会话在 viewport sync 时自然创建，无需提前启动。
          if (hint.join_ticket && hint.announce_urls?.length) {
            console.debug("[SWARM_DIRECT_PREFETCH]", aid);
            performance.mark?.(`swarm_direct_prefetch:${aid}`);
            const locator = 从丰富hint构造最小定位结果(attachment as 附件快照 & { distribution_hint: 附件分发线索 });
            媒体定位器.写入定位缓存(aid, locator);
            continue;
          }

          // 降级：hint 无运行态字段（历史/重播路径），走旧的 locator HTTP prefetch
          console.debug("[SWARM_PREWARM_TICKET_FETCHING]", aid);
          performance.mark?.(`swarm_prewarm_ticket_fetching:${aid}`);
          void 媒体定位器.获取定位(aid).then(() => {
            console.debug("[LOCATOR_REFRESH_RESOLVED]", aid);
            performance.mark?.(`locator_refresh_resolved:${aid}`);
          }).catch(() => {});
        }
      }
    },

    清空(): void {
      执行媒体编排关停({
        发布器动作: "clear",
        协作分发动作: "reset",
      });
    },

    销毁(): void {
      执行媒体编排关停({
        发布器动作: "destroy",
        协作分发动作: "destroy",
        停止媒体运行时: true,
      });
    },
    内部桥,
  };

  return 应用端口;
}
