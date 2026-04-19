import type { 媒体定位结果, 媒体种类, 媒体资产分发表面 } from "../契约.js";
import {
  是否为协作分发JoinTicket失效错误,
  读取协作分发定位片段,
  type 协作分发会话事件,
} from "./媒体协作分发.js";

type 播放表面 = "viewer" | "inline_autoplay";

type 媒体播放输入 = {
  attachmentId: string;
  kind: 媒体种类;
  surface?: 播放表面;
  consumerId?: string;
  onSessionEvent?: (event: 协作分发会话事件) => void;
};

type 媒体播放结果 =
  | {
      mode: "swarm" | "anchor" | "manifest" | "blob";
      attachmentId: string;
      kind: 媒体种类;
      src: string;
      fallbackSrc?: string;
      viewerSrc?: string;
      thumbnailUrl: string | null;
      contentHash?: string | null;
      distribution?: 媒体资产分发表面 | null;
      streamingDistribution?: 媒体资产分发表面 | null;
      hint: "正在协作分发" | null;
    }
  | {
      mode: "expired";
      attachmentId: string;
      kind: 媒体种类;
      src: "";
      thumbnailUrl: string | null;
      hint: "内容已过期";
    }
  | {
      mode: "degraded";
      attachmentId: string;
      kind: 媒体种类;
      src: "";
      thumbnailUrl: string | null;
      reason: "locator_unavailable" | "attachment_not_ready" | "anchor_unavailable";
      hint: "附件当前不可获取";
    };

type 媒体播放器依赖 = {
  locate(attachmentId: string, options?: { forceRefresh?: boolean }): Promise<媒体定位结果>;
  resolveSwarmSource?(input: {
    attachmentId: string;
    kind: 媒体种类;
    locator: 媒体定位结果;
    consumerId?: string;
    onSessionEvent?: (event: 协作分发会话事件) => void;
    eagerCompleting?: boolean;
    reuseOnly?: boolean;
  }): Promise<
    { src: string; hint: "正在协作分发" | "正在补块" | null; locallyComplete?: boolean } | null
  >;
  releaseSwarmSource?(input: {
    attachmentId: string;
    consumerId?: string;
    丢弃未完成补齐?: boolean;
  }): void;
  probeAnchor?(url: string): Promise<void>;
};

type 协作分发尝试结果 = {
  playback: 媒体播放结果 | null;
  locator: 媒体定位结果;
};

const 过滤可播放媒体提示 = (
  hint: "正在协作分发" | "正在补块" | null
): "正在协作分发" | null => {
  // “正在补块”只说明协作分发还在后台补齐文件块；只要已有可播放 src，就不是用户可见故障。
  return hint === "正在补块" ? null : hint;
};

const 流媒体冷备窗口已退场 = (locator: 媒体定位结果): boolean => {
  const lifecycle = locator.streaming_asset?.lifecycle;
  if (!lifecycle) {
    return false;
  }
  /**
   * 流媒体冷备是否正式退场，以后端已经宣布的删除事实为准：
   * 1. 前端墙钟不能越位替后端裁“是不是到点了”；
   * 2. 这样不会因为缓存 locator、时钟漂移或测试固化时间把有效 HLS 误判成过期；
   * 3. 真正整体是否 expired，仍继续由 distribution.availability 这条权威裁决兜底。
   */
  return Boolean(lifecycle.streaming_deleted_at);
};

/**
 * “视频默认循环播放”属于前端播放器行为策略，而不是媒体来源真相的一部分。
 * 当前阶段只需要一条最薄的 owner 规则：
 * - 视频默认循环；
 * - 图片不参与这条策略；
 * - 不按 surface、source、mode 再长第二套分支。
 *
 * 这里先把它和媒体模块放在一起，是为了让消息流内联 `<video>` 与唯一正式播放器壳
 * 共享同一个原生 `HTMLMediaElement.loop` 语义，而不是在两个壳里各写一套布尔字面量。
 */
export const 媒体是否默认循环播放 = (kind: 媒体种类): boolean => kind === "video";

/**
 * 播放器编排只回答“当前这一条媒体该从哪里读”：
 * 1. 先看 locator 是否 ready；
 * 2. 如果有 swarm 能力就优先尝试；
 * 3. swarm 不足或当前没有 swarm 定位符时，退回锚点；
 * 4. 锚点失效时强制重签一次，再决定是否 degraded。
 *
 * 当前后端 locator 还没有暴露 magnet/infohash，所以默认 `resolveSwarmSource`
 * 会返回 `null`。这不是偷懒，而是不伪造不存在的 P2P 真相。
 */
export function 创建媒体播放器(deps: 媒体播放器依赖) {
  const resolveSwarmSource =
    deps.resolveSwarmSource ??
    (async () => {
      return null;
    });
  const releaseSwarmSource =
    deps.releaseSwarmSource ??
    (() => {
      return;
    });
  const probeAnchor =
    deps.probeAnchor ??
    (async () => {
      return;
    });

  const 释放协作分发占用 = (input: {
    attachmentId: string;
    consumerId?: string;
  }): void => {
    // 播放器 owner 只在“当前已经不再选择 swarm 主链”时释放 consumer lease，
    // 不把 release 判断散落回壳层或媒体会话里重复裁一次。
    releaseSwarmSource({
      attachmentId: input.attachmentId,
      ...(input.consumerId ? { consumerId: input.consumerId } : {}),
    });
  };

  /**
   * 过渡阶段优先读共享资产里的冷源描述：
   * 1. 它已经明确声明原始附件只是 cold_backup_only；
   * 2. 后续顶层 original_url 退场时，这里不用再回头大改播放入口；
   * 3. 仍保留旧字段兜底，保证第一批后端过渡面上线时不打爆旧 locator。
   */
  const 读取锚点地址 = (locator: 媒体定位结果): string =>
    locator.streaming_asset?.origin.original_url ?? locator.original_url;

  const 读取预览缩略图地址 = (locator: 媒体定位结果): string | null =>
    locator.preview_asset?.still_url ?? locator.thumbnail_url;

  /**
   * 视频一旦拿到正式 HLS manifest，就不应该继续把原始附件冷源当主播放链。
   * 当前阶段先统一优先消费 HLS：
   * 1. 它已经是标准流媒体入口，后续接播放器/provider 不用再倒回 file URL；
   * 2. DASH 先保留作契约冗余与后续多端适配，不在浏览器主链里同时搞双入口；
   * 3. 没有 manifest 时才继续走旧的 swarm/file 过渡路径。
   */
  const 读取流媒体主链地址 = (locator: 媒体定位结果): string | null => {
    if (locator.kind !== "video" || 流媒体冷备窗口已退场(locator)) {
      return null;
    }
    return locator.streaming_asset?.manifest.hls_master_url ?? null;
  };

  /**
   * 图片资产不再默认回到原始附件直链：
   * 1. 列表卡片优先吃 preview，降低首开成本；
   * 2. 查看器优先吃 full/original，避免继续把 preview 放大冒充原图；
   * 3. 只有 blob 资产根本不存在时，才退回旧冷源锚点。
   */
  const 读取图片Blob主链 = (locator: 媒体定位结果) => {
    if (locator.kind !== "image" || !locator.blob_asset) {
      return null;
    }
    const previewSrc =
      locator.blob_asset.preview?.url ??
      locator.blob_asset.full?.url ??
      locator.blob_asset.original?.url ??
      null;
    const viewerSrc =
      locator.blob_asset.full?.url ??
      locator.blob_asset.original?.url ??
      previewSrc;
    if (!previewSrc || !viewerSrc) {
      return null;
    }
    return {
      src: previewSrc,
      viewerSrc,
      thumbnailUrl: locator.blob_asset.preview?.url ?? 读取预览缩略图地址(locator),
    };
  };

  const 是否值得为查看器视频强制刷新定位 = (
    input: 媒体播放输入,
    locator: 媒体定位结果
  ): boolean => {
    if (input.kind !== "video" || (input.surface ?? "viewer") !== "viewer") {
      return false;
    }
    if (读取流媒体主链地址(locator)) {
      return false;
    }
    /**
     * 只有已经进入流媒体/协作过渡面的 video，才值得在首开前多问一次 locator。
     * 纯旧式冷源附件继续直接走 anchor，避免给不相关的视频平白增加一次请求。
     */
    return Boolean(locator.streaming_asset || locator.distribution);
  };

  const 刷新查看器视频定位 = async (
    input: 媒体播放输入,
    locator: 媒体定位结果
  ): Promise<媒体定位结果> => {
    if (!是否值得为查看器视频强制刷新定位(input, locator)) {
      return locator;
    }
    try {
      const refreshedLocator = await deps.locate(input.attachmentId, { forceRefresh: true });
      return refreshedLocator.status === "ready" ? refreshedLocator : locator;
    } catch {
      return locator;
    }
  };

  const 创建降级结果 = (
    input: 媒体播放输入,
    locator: 媒体定位结果 | null,
    reason: "locator_unavailable" | "attachment_not_ready" | "anchor_unavailable"
  ): 媒体播放结果 => ({
    mode: "degraded",
    attachmentId: input.attachmentId,
    kind: input.kind,
    src: "",
    thumbnailUrl: locator ? 读取预览缩略图地址(locator) : null,
    reason,
    hint: "附件当前不可获取",
  });

  const 应坚持协作分发唯一主链 = (locator: 媒体定位结果): boolean =>
    locator.distribution?.survival_mode === "peer_only_after_expiry" &&
    locator.distribution?.availability === "available";

  const 尝试锚点 = async (
    input: 媒体播放输入,
    locator: 媒体定位结果,
    allowRefresh: boolean
  ): Promise<媒体播放结果> => {
    释放协作分发占用(input);
    const anchorUrl = 读取锚点地址(locator);
    try {
      await probeAnchor(anchorUrl);
      return {
        mode: "anchor",
        attachmentId: input.attachmentId,
        kind: input.kind,
        src: anchorUrl,
        thumbnailUrl: 读取预览缩略图地址(locator),
        hint: null,
      };
    } catch {
      if (!allowRefresh) {
        return 创建降级结果(input, locator, "anchor_unavailable");
      }
      const refreshedLocator = await deps.locate(input.attachmentId, { forceRefresh: true });
      if (refreshedLocator.status !== "ready") {
        return 创建降级结果(input, refreshedLocator, "attachment_not_ready");
      }
      const refreshedAnchorUrl = 读取锚点地址(refreshedLocator);
      try {
        await probeAnchor(refreshedAnchorUrl);
        return {
          mode: "anchor",
          attachmentId: input.attachmentId,
          kind: input.kind,
          src: refreshedAnchorUrl,
          thumbnailUrl: 读取预览缩略图地址(refreshedLocator),
          hint: null,
        };
      } catch {
        return 创建降级结果(input, refreshedLocator, "anchor_unavailable");
      }
    }
  };

  const 尝试协作分发主链 = async (
    input: 媒体播放输入,
    locator: 媒体定位结果,
    options: {
      eagerCompleting?: boolean;
      reuseOnly?: boolean;
      requireLocallyComplete?: boolean;
      allowTicketRefresh?: boolean;
    } = {}
  ): Promise<协作分发尝试结果> => {
    const distribution = 读取协作分发定位片段(locator);
    if (distribution?.availability === "expired") {
      释放协作分发占用(input);
      return {
        locator,
        playback: {
          mode: "expired",
          attachmentId: input.attachmentId,
          kind: input.kind,
          src: "",
          thumbnailUrl: 读取预览缩略图地址(locator),
          hint: "内容已过期",
        },
      };
    }
    if (!distribution) {
      return {
        locator,
        playback: null,
      };
    }
    try {
      const swarmSource = await resolveSwarmSource({
        attachmentId: input.attachmentId,
        kind: input.kind,
        locator,
        ...(input.consumerId ? { consumerId: input.consumerId } : {}),
        ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
        ...(options.eagerCompleting ? { eagerCompleting: true } : {}),
        ...(options.reuseOnly ? { reuseOnly: true } : {}),
      });
      if (!swarmSource) {
        return {
          locator,
          playback: null,
        };
      }
      /**
       * 消息流自动播的 `<video>` 只应该吃“已经完整落到本机”的 whole-file 资源：
       * 1. `file.streamURL` 只保证当前可读，不保证整文件已经补齐；
       * 2. 半成品 whole-file 丢给原生 `<video>` 时，浏览器可能出现局部黑块/残帧；
       * 3. 这里一旦发现只是未补齐会话，立刻释放这次自动播占用，回到稳定锚点冷源。
       */
      if (options.requireLocallyComplete && swarmSource.locallyComplete !== true) {
        释放协作分发占用(input);
        return {
          locator,
          playback: null,
        };
      }
      /**
       * swarm/web seed 是正式分发平面的同一份事实：
       * 1. viewer 和 inline_autoplay 都应该复用同一个 resolver；
       * 2. surface 只决定“什么时候尝试”，不决定“另造一套来源”；
       * 3. hint 继续在这里统一过滤，避免壳层各自理解“正在补块”。
       */
      return {
        locator,
        playback: {
          mode: "swarm",
          attachmentId: input.attachmentId,
          kind: input.kind,
          src: swarmSource.src,
          thumbnailUrl: 读取预览缩略图地址(locator),
          hint: 过滤可播放媒体提示(swarmSource.hint),
        },
      };
    } catch (error) {
      if (options.allowTicketRefresh !== false && 是否为协作分发JoinTicket失效错误(error)) {
        try {
          const refreshedLocator = await deps.locate(input.attachmentId, { forceRefresh: true });
          if (refreshedLocator.status === "ready") {
            return 尝试协作分发主链(input, refreshedLocator, {
              ...options,
              allowTicketRefresh: false,
            });
          }
        } catch {
          // forceRefresh 失败时继续按旧 locator 走后续主链降级，不把恢复动作放大成新故障。
        }
      }
      // swarm 只是热分发层；失败后必须回到锚点，不允许把热路径波动升级成业务失败。
      return {
        locator,
        playback: null,
      };
    }
  };

  /**
   * 图片查看器一旦进入 backfilling，就要把 blob 资产绑定的协作分发平面真正激活起来：
   * 1. 是否值得进入 swarm，仍然先看 blob_asset 这个共享资产真相；
   * 2. 真正启动 WebTorrent 仍复用现有 resolveSwarmSource/runtime，不新造图片专用实现；
   * 3. 失败保持静默，因为这里是“后台尽快补齐”的增强路径，不是首屏主链。
   *
   * 当前 Web 阶段里，blob_asset.distribution 负责宣告“这张图应该进入分发平面”，
   * 顶层 distribution 继续承载 torrent_url / info_hash / presence_url 这类浏览器运行时所需字段。
   * 等后端把两层契约进一步收口后，这里只需要缩短兼容读取，不用反向污染调用方。
   */
  const 激活协作补齐 = async (input: 媒体播放输入): Promise<void> => {
    let locator: 媒体定位结果;
    try {
      locator = await deps.locate(input.attachmentId);
    } catch {
      return;
    }
    if (locator.status !== "ready") {
      return;
    }
    /**
     * HLS 已经赢下本次会话时，后台补齐只能升级“已经预热过的同一条 swarm 会话”，
     * 不能再冷启动第二条 raw whole-file 主链：
     * 1. 正式播放继续留在 HLS，不引入中途切源；
     * 2. 已存在的 swarm 会话可以进入 eagerCompleting，继续补齐完整资产；
     * 3. 如果前面根本没预热 swarm，这里就保持静默，不为了补齐再新开重链路。
     */
    if (locator.kind === "video" && 读取流媒体主链地址(locator)) {
      try {
        await resolveSwarmSource({
          attachmentId: input.attachmentId,
          kind: input.kind,
          locator,
          eagerCompleting: true,
          reuseOnly: true,
          ...(input.consumerId ? { consumerId: input.consumerId } : {}),
          ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
        });
      } catch {
        return;
      }
      return;
    }
    const distribution = 读取协作分发定位片段(locator);
    if (!distribution) {
      return;
    }
    if (locator.kind === "image" && (!读取图片Blob主链(locator) || !locator.blob_asset?.distribution)) {
      return;
    }
    if (!distribution || distribution.availability === "expired") {
      return;
    }
    try {
      await resolveSwarmSource({
        attachmentId: input.attachmentId,
        kind: input.kind,
        locator,
        eagerCompleting: true,
        ...(input.consumerId ? { consumerId: input.consumerId } : {}),
        ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
      });
    } catch {
      return;
    }
  };

  const 解析播放结果 = async (input: 媒体播放输入): Promise<媒体播放结果> => {
    let locator: 媒体定位结果;
    try {
      locator = await deps.locate(input.attachmentId);
    } catch {
      释放协作分发占用(input);
      return 创建降级结果(input, null, "locator_unavailable");
    }
    if (locator.status !== "ready") {
      释放协作分发占用(input);
      return 创建降级结果(input, locator, "attachment_not_ready");
    }
    const blobSource = 读取图片Blob主链(locator);
    if (blobSource) {
      释放协作分发占用(input);
      return {
        mode: "blob",
        attachmentId: input.attachmentId,
        kind: input.kind,
        src: blobSource.src,
        viewerSrc: blobSource.viewerSrc,
        thumbnailUrl: blobSource.thumbnailUrl,
        // 图片查看器后续要靠 contentHash 把“真的拿到完整资产”落进 MediaCacheOwner，
        // 这里必须把共享资产真相一路带下去，不能再让壳层去猜。
        contentHash: locator.blob_asset?.content_hash ?? null,
        distribution: locator.blob_asset?.distribution ?? null,
        hint: null,
      };
    }
    locator = await 刷新查看器视频定位(input, locator);
    /**
     * viewer 与 inline_autoplay 必须共用同一条来源裁决真相：
     * 1. 先尝试 WebTorrent / WebSeed 协作分发；
     * 2. server-assisted 阶段要求本地完整，避免半成品 whole-file 导致播放异常；
     * 3. 命不中协作分发时统一回退锚点，不再为某个 surface 维护独立 manifest 分支。
     */
    const requireLocallyComplete = locator.distribution?.survival_mode !== "peer_only_after_expiry";
    const swarmAttempt = await 尝试协作分发主链(input, locator, {
      ...(requireLocallyComplete ? { requireLocallyComplete: true } : {}),
    });
    locator = swarmAttempt.locator;
    if (swarmAttempt.playback) {
      return swarmAttempt.playback;
    }
    /**
     * `peer_only_after_expiry` 是“协作分发主链唯一真相”语义：
     * - swarm 暂时不可用时，不允许再悄悄回到冷源锚点；
     * - 这样自动播/查看器都只走同一条链路，便于定位真实故障归属；
     * - 会话恢复继续依赖 runtime 的 noPeers / ticket 刷新事件驱动。
     */
    if (应坚持协作分发唯一主链(locator)) {
      释放协作分发占用(input);
      return 创建降级结果(input, locator, "anchor_unavailable");
    }
    return 尝试锚点(input, locator, true);
  };

  return {
    解析播放结果,
    激活协作补齐,
    释放附件播放资源: 释放协作分发占用,
  };
}

export type { 媒体播放输入, 媒体播放结果 };
