import type { 媒体定位结果, 媒体种类, 媒体资产分发表面 } from "../聊天共享/契约.js";
import {
  是否为协作分发JoinTicket失效错误,
  是否为协作分发运行时环境不支持错误,
  读取协作分发定位片段,
  type 协作分发会话事件,
  type 协作分发内容字节入口,
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
      mode: "swarm" | "legacy_anchor";
      attachmentId: string;
      kind: 媒体种类;
      src: string;
      thumbnailUrl: string | null;
      contentHash?: string | null;
      distribution?: 媒体资产分发表面 | null;
      formalByteSource?: 协作分发内容字节入口;
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
      reason:
        | "locator_unavailable"
        | "attachment_not_ready"
        | "anchor_unavailable"
        | "swarm_runtime_unsupported"
        | "connecting_to_peers"
        | "no_online_seed"
        | "media_deleted";
      hint:
        | "附件当前不可获取"
        | "当前环境不支持 WebTorrent 主链（请使用 HTTPS 或 localhost）"
        | "正在尝试连接群友"
        | "当前没有在线种子，等待群友上线"
        | "内容已删除";
    };

type 媒体播放位置 = {
  src: string;
  currentTime: number;
  updatedAt: number;
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
  }): Promise<
    {
      src: string;
      hint: "正在协作分发" | "正在补块" | null;
      locallyComplete?: boolean;
      formalByteSource?: 协作分发内容字节入口;
    } | null
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
  failureReason: "runtime_unsupported" | null;
};

const 协作分发运行时不支持提示 = "当前环境不支持 WebTorrent 主链（请使用 HTTPS 或 localhost）";
const 查看器强刷定位冷却毫秒 = 15_000;
/**
 * 连接群友窗口与重试节奏是跨端契约的固定基线：
 * 1. 单轮连接预算 8 秒（每 2 秒一次探测）；
 * 2. 预算耗尽后进入 no_online_seed，并按 15 秒节奏重开下一轮；
 * 3. 这些值后端也有同尺度配置，这里保留前端兜底避免旧 locator 直接跳过连接态。
 */
const 连接群友窗口毫秒 = 8_000;
const 无在线种子默认重试毫秒 = 15_000;

/**
 * 删除终态优先看稳定错误码，而不是 HTTP 文案：
 * 1. transport 层会把后端 `attachment_not_found` 收口成 `code`；
 * 2. 播放器只消费这条语义，不依赖具体 Error 子类；
 * 3. 这样 locator 直接失败时也能给出“内容已删除”而不是模糊不可用。
 */
const 是否为附件已删除错误 = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "attachment_not_found";

/**
 * 历史缓存或旧会话快照里，可能仍残留 HLS/DASH manifest 地址。
 * 即使这些地址后来被包进 `anchor` 播放结果，它们也不能再被当成正式视频源。
 */
export const 视频地址属于旧流媒体清单 = (src: string | null | undefined): boolean => {
  const normalized = src?.trim();
  if (!normalized) {
    return false;
  }
  return (
    /\/stream\/(?:hls|dash)\//i.test(normalized) ||
    /\.(?:m3u8|mpd)(?:$|[?#])/i.test(normalized)
  );
};

const 过滤可播放媒体提示 = (
  hint: "正在协作分发" | "正在补块" | null
): "正在协作分发" | null => {
  // “正在补块”只说明协作分发还在后台补齐文件块；只要已有可播放 src，就不是用户可见故障。
  return hint === "正在补块" ? null : hint;
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
  const 查看器强刷定位时间戳 = new Map<string, number>();
  /**
   * 当后端已经给出 `MEDIA_NO_ONLINE_SEED` 时，前端仍要按契约跑“连接群友窗口”：
   * 1. 首次进入 no-seed 会先回到 connecting_to_peers；
   * 2. 窗口预算耗尽才显示 no_online_seed；
   * 3. 到 retry_after_ms 后再开启下一轮连接窗口，避免长期卡死在单一终态。
   */
  const 无在线种子连接窗口表 = new Map<
    string,
    {
      startedAtMs: number;
      lastNoSeedAtMs: number | null;
      retryAfterMs: number;
    }
  >();

  const 清理无在线种子连接窗口 = (attachmentId: string): void => {
    无在线种子连接窗口表.delete(attachmentId);
  };

  const 读取无在线种子重试间隔毫秒 = (
    distribution: NonNullable<媒体定位结果["distribution"]>
  ): number => {
    const retryAfterMs = distribution.media_state?.retry_after_ms;
    if (typeof retryAfterMs !== "number" || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) {
      return 无在线种子默认重试毫秒;
    }
    return Math.floor(retryAfterMs);
  };

  const 读取或重置无在线种子连接窗口 = (
    attachmentId: string,
    nowMs: number,
    retryAfterMs: number
  ): { startedAtMs: number; lastNoSeedAtMs: number | null; retryAfterMs: number } => {
    const current = 无在线种子连接窗口表.get(attachmentId);
    if (!current) {
      const initial = {
        startedAtMs: nowMs,
        lastNoSeedAtMs: null,
        retryAfterMs,
      };
      无在线种子连接窗口表.set(attachmentId, initial);
      return initial;
    }
    current.retryAfterMs = retryAfterMs;
    if (current.lastNoSeedAtMs !== null && nowMs - current.lastNoSeedAtMs >= retryAfterMs) {
      current.startedAtMs = nowMs;
      current.lastNoSeedAtMs = null;
    }
    无在线种子连接窗口表.set(attachmentId, current);
    return current;
  };

  const 标记进入无在线种子终态 = (attachmentId: string, nowMs: number): void => {
    const current = 无在线种子连接窗口表.get(attachmentId);
    if (!current) {
      无在线种子连接窗口表.set(attachmentId, {
        startedAtMs: nowMs - 连接群友窗口毫秒,
        lastNoSeedAtMs: nowMs,
        retryAfterMs: 无在线种子默认重试毫秒,
      });
      return;
    }
    // no-seed 终态时间只在“本轮第一次落终态”时写入；
    // 否则频繁渲染/重复解析会把 15 秒重试窗口不断后推，导致永远重不开连接探测。
    if (current.lastNoSeedAtMs === null) {
      current.lastNoSeedAtMs = nowMs;
    }
    无在线种子连接窗口表.set(attachmentId, current);
  };

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
   * 播放锚点只认 nested asset 自己声明的冷源 / canonical：
   * 1. file_video 优先 canonical，再退到 origin；
   * 2. blob_image 只读 canonical，不再回到顶层 original_url 旧别名；
   * 3. 正式读取面只允许来自当前共享契约明示的 asset 字段。
   */
  const 读取锚点地址 = (locator: 媒体定位结果): string | null =>
    locator.file_asset?.variants.canonical?.url ??
    locator.file_asset?.origin.original_url ??
    locator.blob_asset?.variants?.canonical?.url ??
    null;

  const 读取播放内容哈希 = (locator: 媒体定位结果): string | null =>
    locator.file_asset?.content_hash ??
    locator.blob_asset?.content_hash ??
    null;

  /**
   * 顶层 `thumbnail_url` 只继续服务视频静态封面：
   * 1. 图片 canonical 主链已经收口，不再让旧缩略图地址重新混进来；
   * 2. 图片如果真有额外 preview，只能来自显式 `preview_asset`；
   * 3. 视频仍可继续复用既有 thumbnail 路由作为 poster。
   */
  const 读取预览缩略图地址 = (locator: 媒体定位结果): string | null =>
    locator.preview_asset?.still_url ?? (locator.kind === "video" ? locator.thumbnail_url : null);

  const 读取媒体状态码 = (locator: 媒体定位结果): string | null =>
    读取协作分发定位片段(locator)?.media_state?.code ?? null;

  /**
   * 新代际附件删除后，前端必须优先消费稳定删除真相：
   * 1. 后端可能返回 `status=deleted`，也可能继续带着 `MEDIA_DELETED`；
   * 2. 这里只认“附件已删”这条业务语义，不把它混回 not_ready；
   * 3. 这样 fresh parse 和旧会话重裁决都能统一落到删除终态。
   */
  const 是否为已删除定位结果 = (locator: 媒体定位结果): boolean =>
    locator.status === "deleted" || 读取媒体状态码(locator) === "MEDIA_DELETED";

  const 是否值得为前台视频强制刷新定位 = (
    input: 媒体播放输入,
    locator: 媒体定位结果
  ): boolean => {
    if (input.kind !== "video") {
      return false;
    }
    /**
     * 前台视频首开前值不值得强刷，只看“正式 WebTorrent 相关事实是否已经存在”：
     * 1. distribution / file_asset.distribution 说明这条视频已经有唯一主链线索；
     * 2. 真正的强刷节流继续由下面的冷却窗口兜住。
     */
    return Boolean(locator.distribution || locator.file_asset?.distribution);
  };

  const 刷新查看器视频定位 = async (
    input: 媒体播放输入,
    locator: 媒体定位结果
  ): Promise<媒体定位结果> => {
    if (!是否值得为前台视频强制刷新定位(input, locator)) {
      return locator;
    }
    const now = Date.now();
    const lastRefreshAt = 查看器强刷定位时间戳.get(input.attachmentId) ?? 0;
    /**
     * 前台视频进入恢复窗口时会频繁触发解析：
     * 1. ticket 失效/锚点失败等“真故障恢复”仍走各自专用 forceRefresh 分支；
     * 2. 这里只抑制“同附件短时间重复首开”的冗余强刷，避免 locator/torrent 被放大成风暴；
     * 3. 冷却期间继续复用当前 locator，让会话 owner 维持单一恢复节奏。
     */
    if (now - lastRefreshAt < 查看器强刷定位冷却毫秒) {
      return locator;
    }
    查看器强刷定位时间戳.set(input.attachmentId, now);
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
    reason:
      | "locator_unavailable"
      | "attachment_not_ready"
      | "anchor_unavailable"
      | "swarm_runtime_unsupported"
      | "connecting_to_peers"
      | "no_online_seed"
      | "media_deleted",
    hint:
      | "附件当前不可获取"
      | "当前环境不支持 WebTorrent 主链（请使用 HTTPS 或 localhost）"
      | "正在尝试连接群友"
      | "当前没有在线种子，等待群友上线"
      | "内容已删除" = "附件当前不可获取"
  ): 媒体播放结果 => ({
    mode: "degraded",
    attachmentId: input.attachmentId,
    kind: input.kind,
    src: "",
    thumbnailUrl: locator ? 读取预览缩略图地址(locator) : null,
    reason,
    hint,
  });

  const 应坚持协作分发唯一主链 = (locator: 媒体定位结果): boolean =>
    locator.distribution?.survival_mode === "peer_only_after_expiry" &&
    (() => {
      const mediaStateCode = 读取媒体状态码(locator);
      return mediaStateCode !== "MEDIA_DELETED" && mediaStateCode !== "MEDIA_NO_ONLINE_SEED";
    })();

  /**
   * 新附件图片只要已经声明进入协作分发表面，就不能再回到 blob canonical HTTP 锚点：
   * 1. `distribution / blob_asset.distribution` 说明它已经属于正式 WebTorrent 平面；
   * 2. swarm 暂不可得时，前端应展示稳定不可用/占位，而不是把受控 blob 地址抬回正式主链；
   * 3. 没有协作分发表面的历史图片，仍允许继续走 legacy 冷源锚点。
   */
  const 图片应等待协作分发主链 = (locator: 媒体定位结果): boolean =>
    locator.kind === "image" &&
    Boolean(locator.distribution || locator.blob_asset?.distribution);

  const 尝试锚点 = async (
    input: 媒体播放输入,
    locator: 媒体定位结果,
    allowRefresh: boolean
  ): Promise<媒体播放结果> => {
    释放协作分发占用(input);
    const anchorUrl = 读取锚点地址(locator);
    if (!anchorUrl) {
      if (!allowRefresh) {
        return 创建降级结果(input, locator, "anchor_unavailable");
      }
      const refreshedLocator = await deps.locate(input.attachmentId, { forceRefresh: true });
      if (refreshedLocator.status !== "ready") {
        return 创建降级结果(input, refreshedLocator, "attachment_not_ready");
      }
      const refreshedAnchorUrl = 读取锚点地址(refreshedLocator);
      if (!refreshedAnchorUrl) {
        return 创建降级结果(input, refreshedLocator, "anchor_unavailable");
      }
      try {
        await probeAnchor(refreshedAnchorUrl);
        const contentHash = 读取播放内容哈希(refreshedLocator);
        const distribution =
          refreshedLocator.file_asset?.distribution ?? refreshedLocator.blob_asset?.distribution ?? null;
        return {
          mode: "legacy_anchor",
          attachmentId: input.attachmentId,
          kind: input.kind,
          src: refreshedAnchorUrl,
          thumbnailUrl: 读取预览缩略图地址(refreshedLocator),
          ...(contentHash ? { contentHash } : {}),
          ...(distribution ? { distribution } : {}),
          hint: null,
        };
      } catch {
        return 创建降级结果(input, refreshedLocator, "anchor_unavailable");
      }
    }
    try {
      await probeAnchor(anchorUrl);
      const contentHash = 读取播放内容哈希(locator);
      const distribution = locator.file_asset?.distribution ?? locator.blob_asset?.distribution ?? null;
      return {
        mode: "legacy_anchor",
        attachmentId: input.attachmentId,
        kind: input.kind,
        src: anchorUrl,
        thumbnailUrl: 读取预览缩略图地址(locator),
        ...(contentHash ? { contentHash } : {}),
        ...(distribution ? { distribution } : {}),
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
      if (!refreshedAnchorUrl) {
        return 创建降级结果(input, refreshedLocator, "anchor_unavailable");
      }
      try {
        await probeAnchor(refreshedAnchorUrl);
        const contentHash = 读取播放内容哈希(refreshedLocator);
        const distribution =
          refreshedLocator.file_asset?.distribution ?? refreshedLocator.blob_asset?.distribution ?? null;
        return {
          mode: "legacy_anchor",
          attachmentId: input.attachmentId,
          kind: input.kind,
          src: refreshedAnchorUrl,
          thumbnailUrl: 读取预览缩略图地址(refreshedLocator),
          ...(contentHash ? { contentHash } : {}),
          ...(distribution ? { distribution } : {}),
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
      allowTicketRefresh?: boolean;
    } = {}
  ): Promise<协作分发尝试结果> => {
    const distribution = 读取协作分发定位片段(locator);
    const mediaStateCode = distribution?.media_state?.code ?? null;
    if (mediaStateCode === "MEDIA_DELETED") {
      清理无在线种子连接窗口(input.attachmentId);
      释放协作分发占用(input);
      return {
        locator,
        playback: 创建降级结果(input, locator, "media_deleted", "内容已删除"),
        failureReason: null,
      };
    }
    if (mediaStateCode === "MEDIA_NO_ONLINE_SEED") {
      if (!distribution) {
        清理无在线种子连接窗口(input.attachmentId);
        释放协作分发占用(input);
        return {
          locator,
          playback: 创建降级结果(
            input,
            locator,
            "no_online_seed",
            "当前没有在线种子，等待群友上线"
          ),
          failureReason: null,
        };
      }
      const nowMs = Date.now();
      const retryAfterMs = 读取无在线种子重试间隔毫秒(distribution);
      const currentWindow = 读取或重置无在线种子连接窗口(
        input.attachmentId,
        nowMs,
        retryAfterMs
      );
      释放协作分发占用(input);
      if (nowMs - currentWindow.startedAtMs < 连接群友窗口毫秒) {
        return {
          locator,
          playback: 创建降级结果(
            input,
            locator,
            "connecting_to_peers",
            "正在尝试连接群友"
          ),
          failureReason: null,
        };
      }
      标记进入无在线种子终态(input.attachmentId, nowMs);
      return {
        locator,
        playback: 创建降级结果(
          input,
          locator,
          "no_online_seed",
          "当前没有在线种子，等待群友上线"
        ),
        failureReason: null,
      };
    }
    if (mediaStateCode !== "MEDIA_CONNECTING_TO_PEERS") {
      清理无在线种子连接窗口(input.attachmentId);
    }
    if (!distribution) {
      清理无在线种子连接窗口(input.attachmentId);
      return {
        locator,
        playback: null,
        failureReason: null,
      };
    }
    const 处于连接群友态 = mediaStateCode === "MEDIA_CONNECTING_TO_PEERS";
    try {
      const swarmSource = await resolveSwarmSource({
        attachmentId: input.attachmentId,
        kind: input.kind,
        locator,
        ...(input.consumerId ? { consumerId: input.consumerId } : {}),
        ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
        ...(options.eagerCompleting ? { eagerCompleting: true } : {}),
      });
      if (!swarmSource) {
        if (处于连接群友态) {
          释放协作分发占用(input);
          return {
            locator,
            playback: 创建降级结果(
              input,
              locator,
              "connecting_to_peers",
              "正在尝试连接群友"
            ),
            failureReason: null,
          };
        }
        return {
          locator,
          playback: null,
          failureReason: null,
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
          ...(读取播放内容哈希(locator) ? { contentHash: 读取播放内容哈希(locator) } : {}),
          formalByteSource: swarmSource.formalByteSource ?? "webtorrent_official_stream",
          ...(locator.file_asset?.distribution || locator.blob_asset?.distribution
            ? { distribution: locator.file_asset?.distribution ?? locator.blob_asset?.distribution ?? null }
            : {}),
          hint: 过滤可播放媒体提示(swarmSource.hint),
        },
        failureReason: null,
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
      if (是否为协作分发运行时环境不支持错误(error)) {
        return {
          locator,
          playback: null,
          failureReason: "runtime_unsupported",
        };
      }
      if (处于连接群友态) {
        释放协作分发占用(input);
        return {
          locator,
          playback: 创建降级结果(
            input,
            locator,
            "connecting_to_peers",
            "正在尝试连接群友"
          ),
          failureReason: null,
        };
      }
      // swarm 只是热分发层；失败后必须回到锚点，不允许把热路径波动升级成业务失败。
      return {
        locator,
        playback: null,
        failureReason: null,
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
   * 等后端把两层契约进一步收口后，这里只需要缩短旧字段读取，不用反向污染调用方。
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
     * 视频补齐现在默认允许冷启动同一条 swarm 主链：
     * 1. PLAYER_PLAYING 代表“我已经看了这条视频，尽量把自己养成帮助者”；
     * 2. 后台补齐都继续只走 resolveSwarmSource；
     * 3. 这里去掉的是旧保守门槛，不是重新引入第二条 raw/HLS 正式主链。
     */
    if (locator.kind === "video") {
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
      return;
    }
    const distribution = 读取协作分发定位片段(locator);
    if (!distribution) {
      return;
    }
    /**
     * 这里必须只看“图片有没有进入协作分发表面”，不能再偷看 legacy canonical：
     * 1. `variants.canonical` 现在只是历史兼容壳，不再代表新图片正式字节入口；
     * 2. 新图片把 canonical 彻底收成 null 以后，如果这里还卡 legacy canonical，
     *    sender / viewer 就永远不会真正启动 swarm 补齐；
     * 3. 因此图片能不能进入补齐，只认 `blob_asset.distribution` 是否存在。
     */
    if (locator.kind === "image" && !locator.blob_asset?.distribution) {
      return;
    }
    const mediaStateCode = distribution?.media_state?.code ?? null;
    if (
      !distribution ||
      mediaStateCode === "MEDIA_DELETED" ||
      mediaStateCode === "MEDIA_NO_ONLINE_SEED"
    ) {
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
    } catch (error) {
      释放协作分发占用(input);
      return 是否为附件已删除错误(error)
        ? 创建降级结果(input, null, "media_deleted", "内容已删除")
        : 创建降级结果(input, null, "locator_unavailable");
    }
    if (是否为已删除定位结果(locator)) {
      清理无在线种子连接窗口(input.attachmentId);
      释放协作分发占用(input);
      return 创建降级结果(input, locator, "media_deleted", "内容已删除");
    }
    if (locator.status !== "ready") {
      释放协作分发占用(input);
      return 创建降级结果(input, locator, "attachment_not_ready");
    }
    locator = await 刷新查看器视频定位(input, locator);
    /**
     * viewer 与 inline_autoplay 必须共用同一条来源裁决真相：
     * 1. 先尝试 WebTorrent / WebSeed 协作分发；
     * 2. 只要 swarm 已可读就保持主链，不再因为“是否本地完整”回退冷源；
     * 3. 命不中协作分发时统一回退锚点，不再为某个 surface 维护独立 manifest 分支。
     */
    const swarmAttempt = await 尝试协作分发主链(input, locator);
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
    if (swarmAttempt.failureReason === "runtime_unsupported") {
      释放协作分发占用(input);
      return 创建降级结果(
        input,
        locator,
        "swarm_runtime_unsupported",
        协作分发运行时不支持提示
      );
    }
    /**
     * 单文件主链裁决：视频播放不再回退到原始锚点冷源。
     * 只要协作分发链路当前不可得，就保持不可用态并等待 swarm 会话恢复，
     * 避免任何“自动播/全屏偷偷改走 original”的第二真相。
     */
    if (input.kind === "video") {
      释放协作分发占用(input);
      return 创建降级结果(input, locator, "anchor_unavailable");
    }
    if (图片应等待协作分发主链(locator)) {
      释放协作分发占用(input);
      return 创建降级结果(input, locator, "anchor_unavailable");
    }
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

export type { 媒体播放输入, 媒体播放结果, 媒体播放位置 };
