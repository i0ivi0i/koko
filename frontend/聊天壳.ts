import { css, html, LitElement } from "lit";
import type { 应用运行时端口 } from "./应用运行时.js";
import type { 聊天应用快照 } from "./聊天应用内核.js";
import "./房间消息窗.js";
import type { 聊天运行时预算状态 } from "./状态.js";
import {
  创建操作台附件入口编排,
  默认统一媒体文件选择配置,
} from "./操作台/index.js";
import {
  type 媒体会话信号,
  type 媒体播放位置,
  type 媒体查看器打开请求,
} from "./媒体/index.js";
import type { 前端传输端口 } from "./传输.js";
import { 默认文本布局器 } from "./房间消息窗/文本布局.js";
import { 创建聊天壳应用装配 } from "./总装/应用装配.js";
import {
  默认消息文本布局环境,
  派生壳主舞台模式,
  派生控制台模式,
  派生壳级操作台状态,
  派生聊天列表展示项,
  派生首页会话展示项,
  派生房间壳提示文案,
  派生消息窗口提示文案,
  派生跳到最新入口文案,
  type 消息文本布局环境,
} from "./视图.js";

function 派生媒体草稿失败文案(errorCode: string): string {
  switch (errorCode) {
    case "attachment_too_large":
      return "失败：附件超过大小上限";
    case "attachment_upload_stalled":
      return "失败：上传超时，请重试";
    case "attachment_upload_network_error":
      return "失败：网络中断或浏览器拦截了上传";
    case "attachment_type_not_allowed":
      return "失败：不支持的媒体类型";
    case "invalid_session":
      return "失败：会话已失效，请刷新后重试";
    case "invalid_argument":
      return "失败：上传请求无效，请重试";
    case "system_error":
      return "失败：服务器处理失败，请稍后重试";
    case "attachment_upload_failed":
      return "失败：上传失败，请重试";
    default:
      return `失败：${errorCode || "attachment_upload_failed"}`;
  }
}

function 按房间宽度派生消息文本布局环境(roomWidth: number): 消息文本布局环境 {
  const 宿主宽度 = Math.max(1, roomWidth || globalThis.innerWidth || 1024);
  const 气泡外框附加宽度 =
    默认消息文本布局环境.bubbleHorizontalPadding +
    默认消息文本布局环境.bubbleHorizontalBorderWidth;
  const bubbleMaxWidth =
    宿主宽度 <= 640
      ? Math.min(宿主宽度 * 0.96, 780)
      : 宿主宽度 >= 768
        ? Math.min(宿主宽度 * 0.9, 920)
        : Math.min(宿主宽度 * 0.93, 840);
  const 多行正文上限 = Math.max(120, bubbleMaxWidth - 气泡外框附加宽度);
  const 单行正文直通上限 = Math.max(
    多行正文上限,
    Math.min(
      多行正文上限 + 56,
      Math.max(120, 宿主宽度 - 气泡外框附加宽度 - 8),
      420
    )
  );

  return {
    ...默认消息文本布局环境,
    maxContentWidth: 多行正文上限,
    singleLineMaxContentWidth: 单行正文直通上限,
  };
}

function 附件内容地址表相同(
  left: 聊天应用快照["media"]["contentUrlByAttachmentId"],
  right: 聊天应用快照["media"]["contentUrlByAttachmentId"]
): boolean {
  if (left === right) {
    return true;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => {
    const leftEntry = left[key];
    const rightEntry = right[key];
    return (
      leftEntry !== undefined &&
      rightEntry !== undefined &&
      leftEntry.originalSrc === rightEntry.originalSrc &&
      leftEntry.thumbnailSrc === rightEntry.thumbnailSrc
    );
  });
}

declare global {
  var __kokoBudgetSnapshot: (() => 聊天运行时预算状态) | undefined;
}

export class 聊天壳 extends LitElement {
  /**
   * 文本几何已经改由 Pretext 主导后，宿主尺寸变化就不能再指望浏览器自然流偷偷兜底。
   * render 路径禁止再同步读几何；这里只把 resize 信号翻译成一次缓存同步。
   */
  private readonly handleViewportResize = (): void => {
    this.同步消息文本布局环境();
  };

  private 房间宽度观察目标: HTMLElement | null = null;
  private 房间宽度观察器: ResizeObserver | null = null;
  private 操作台输入组观察目标: HTMLElement | null = null;
  private 操作台输入组观察器: ResizeObserver | null = null;
  private 操作台输入组宽度缓存 = Math.min(globalThis.innerWidth || 390, 560);
  private 消息文本布局宽度缓存 = Math.max(1, globalThis.innerWidth || 1024);
  private 消息文本布局环境缓存 = 按房间宽度派生消息文本布局环境(
    this.消息文本布局宽度缓存
  );
  private 聊天列表展示项缓存: {
    messages: 聊天应用快照["messages"];
    sessionId: 聊天应用快照["sessionId"];
    firstUnreadEventPosition: 聊天应用快照["firstUnreadEventPosition"];
    layoutEnv: 消息文本布局环境;
    contentUrlByAttachmentId: 聊天应用快照["media"]["contentUrlByAttachmentId"];
    items: ReturnType<typeof 派生聊天列表展示项>;
  } | null = null;

  static override styles = css`
    :host {
      --surface-canvas: #040506;
      --surface-panel: #0d0f12;
      --surface-elevated: #15181d;
      --surface-soft: #20252e;
      --surface-overlay: rgba(13, 15, 18, 0.92);
      --surface-input: rgba(11, 13, 17, 0.96);
      --surface-nav: rgba(15, 18, 23, 0.92);
      --surface-scroll: rgba(5, 6, 8, 0.36);
      --surface-panel-top: rgba(20, 24, 29, 0.94);
      --surface-panel-bottom: rgba(11, 13, 17, 0.98);
      --surface-elevated-bottom: rgba(16, 19, 24, 0.98);
      --bubble-other-top: rgba(24, 28, 34, 0.98);
      --bubble-other-bottom: rgba(14, 17, 22, 0.98);
      --bubble-mine-top: rgba(255, 106, 0, 0.18);
      --bubble-mine-bottom: rgba(18, 16, 14, 0.96);
      --text-primary: #f5f7fb;
      --text-secondary: #d2d7df;
      --text-muted: #97a0ad;
      --text-on-accent: #fff8f2;
      --accent-core: #ff6a00;
      --accent-pressed: #d95a00;
      --accent-hover: #ff8a1f;
      --accent-glow: rgba(255, 106, 0, 0.18);
      --line-soft: rgba(255, 255, 255, 0.08);
      --line-strong: rgba(255, 255, 255, 0.16);
      --line-accent-soft: rgba(255, 138, 31, 0.22);
      --line-on-accent: rgba(255, 255, 255, 0.08);
      --line-on-bubble: rgba(255, 255, 255, 0.05);
      --status-warn-bg: rgba(18, 21, 27, 0.94);
      --status-warn-text: #e3e7ee;
      --status-warn-strong: #ffb066;
      --status-divider: rgba(255, 106, 0, 0.3);
      --shadow-warm:
        rgba(0, 0, 0, 0.24) 0px 0px 0px 1px,
        rgba(0, 0, 0, 0.3) 0px 14px 32px,
        rgba(0, 0, 0, 0.42) 0px 24px 54px;
      display: block;
      height: 100%;
      min-height: 100dvh;
      overflow: hidden;
      background:
        radial-gradient(circle at 18% 0%, rgba(255, 106, 0, 0.14), transparent 26%),
        radial-gradient(circle at 88% 14%, rgba(255, 207, 64, 0.06), transparent 18%),
        linear-gradient(180deg, #040506 0%, #080a0d 54%, #030405 100%);
      font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
      color: var(--text-primary);
    }

    * {
      box-sizing: border-box;
    }

    button,
    input,
    textarea {
      font: inherit;
    }

    button {
      border: 0;
      cursor: pointer;
      transition:
        transform 140ms ease,
        opacity 140ms ease,
        background-color 140ms ease;
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.58;
    }

    .shell-screen {
      height: 100%;
      min-height: 100dvh;
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      gap: 8px;
      padding: 12px 14px;
      padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    }

    .home-screen {
      height: 100%;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px 2px 0;
    }

    /* bootstrap 未完成时只展示一层中性壳，避免刷新恢复房间时先闪出空态首页。 */
    .boot-screen {
      height: 100%;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }

    .boot-card {
      width: min(100%, 460px);
      padding: 24px;
      border: 1px solid var(--line-soft);
      border-radius: 28px;
      background:
        linear-gradient(180deg, var(--surface-panel-top), var(--surface-panel-bottom)),
        var(--surface-panel);
      box-shadow: var(--shadow-warm);
    }

    .boot-title {
      margin: 0;
      font-size: clamp(20px, 3vw, 26px);
      font-weight: 700;
      letter-spacing: -0.18px;
      color: var(--text-primary);
    }

    .boot-subtitle {
      margin: 10px 0 0;
      color: var(--text-secondary);
      line-height: 1.6;
    }

    .home-card {
      width: min(100%, 560px);
      padding: 24px;
      border: 1px solid var(--line-soft);
      border-radius: 28px;
      background:
        linear-gradient(180deg, var(--surface-panel-top), var(--surface-panel-bottom)),
        var(--surface-panel);
      box-shadow: var(--shadow-warm);
      backdrop-filter: blur(18px);
    }

    .join-title {
      margin: 0;
      font-size: clamp(24px, 4vw, 34px);
      font-weight: 700;
      line-height: 1.15;
      letter-spacing: -0.24px;
      color: var(--text-primary);
    }

    .join-subtitle {
      margin: 10px 0 0;
      color: var(--text-secondary);
      line-height: 1.6;
    }

    .join-meta {
      margin-top: 18px;
      color: var(--text-muted);
    }

    .hint {
      margin-top: 14px;
      padding: 12px 14px;
      border-radius: 18px;
      border: 1px solid var(--line-accent-soft);
      background: var(--status-warn-bg);
      color: var(--status-warn-text);
    }

    .home-room-list {
      margin-top: 16px;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 10px;
    }

    .home-room-item {
      display: grid;
      gap: 4px;
      width: 100%;
      padding: 12px 14px;
      border-radius: 18px;
      border: 1px solid var(--line-soft);
      background: rgba(255, 255, 255, 0.03);
      text-align: left;
    }

    .home-room-code {
      font-weight: 700;
      color: var(--text-primary);
    }

    .home-room-meta {
      font-size: 12px;
      color: var(--text-muted);
    }

    .text-input {
      display: block;
      width: 100%;
      min-width: 0;
      padding: 12px 16px;
      border: 1px solid var(--line-soft);
      border-radius: 18px;
      background: var(--surface-input);
      color: var(--text-primary);
      line-height: 22px;
      outline: none;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.18);
    }

    textarea.text-input {
      resize: none;
      overflow: hidden;
    }

    .text-input:focus {
      border-color: rgba(255, 106, 0, 0.4);
      box-shadow:
        0 0 0 3px var(--accent-glow),
        inset 0 1px 2px rgba(0, 0, 0, 0.18);
    }

    .primary-button {
      padding: 12px 18px;
      border-radius: 18px;
      background: linear-gradient(135deg, var(--accent-core) 0%, var(--accent-pressed) 100%);
      color: var(--text-on-accent);
      box-shadow:
        0 0 0 1px var(--line-on-accent),
        0 12px 24px rgba(255, 106, 0, 0.22);
    }

    .primary-button:not(:disabled):hover {
      transform: translateY(-1px);
      background: linear-gradient(135deg, var(--accent-hover) 0%, var(--accent-core) 100%);
    }

    /* 房间页按单屏聊天应用组织：头部、消息流、输入区共用一张屏幕，不再漂浮成网页卡片。 */
    .room-screen {
      height: 100%;
      min-height: 0;
      position: relative;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 6px;
      padding: 0;
    }

    .room-header {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 4px;
      padding: env(safe-area-inset-top, 0px) 0 1px;
    }

    .back-button {
      min-width: 32px;
      min-height: 32px;
      padding: 0 4px;
      border-radius: 10px;
      background: transparent;
      color: var(--accent-core);
      box-shadow: none;
      font-size: 28px;
      line-height: 1;
    }

    .room-heading {
      min-width: 0;
      display: grid;
      gap: 0;
      text-align: left;
    }

    .room-title {
      overflow: hidden;
      font-size: clamp(17px, 2.1vw, 20px);
      font-weight: 700;
      line-height: 1.2;
      letter-spacing: -0.18px;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-primary);
    }

    .room-subtitle {
      margin-top: 0;
      font-size: 11px;
      line-height: 1.3;
      color: var(--text-muted);
    }

    /* 消息窗宿主现在接管 room-screen 里的 1fr 那一格。
       如果宿主自己不声明最小尺寸和内部网格，真正的 message-scroll 就会失去“可缩可滚”的布局前提。 */
    koko-room-message-pane {
      position: relative;
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      min-height: 0;
    }

    /* 输入区单独放在底部壳层栏位里，避免消息很多时把输入框重新挤回顶部。 */
    .message-scroll {
      position: relative;
      z-index: 0;
      isolation: isolate;
      contain: paint;
      min-height: 0;
      height: 100%;
      overflow-y: auto;
      padding: 0;
      border-radius: 18px;
      /* 聊天窗口是内层滚动容器，触顶/触底时不应把浏览器页面回弹和外层滚动链带进来。 */
      overscroll-behavior-y: contain;
      /* 历史前插后由壳层自己做锚点恢复与兜底补偿，不能再让浏览器默认滚动锚点重复干预。 */
      overflow-anchor: none;
      scrollbar-gutter: stable;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.008)),
        var(--surface-scroll);
    }

    .message-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 100%;
      padding: 2px 0 0;
      margin: 0;
      list-style: none;
    }

    /* 历史提示只属于消息窗口局部体验。
       它出现在消息区内部，不再把房间头部和底部壳层一起拖着重排。 */
    .message-history-hint {
      margin: 8px 8px 0;
      padding: 0 12px;
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-muted);
      text-align: center;
    }

    .message-row {
      display: flex;
      width: 100%;
    }

    .message-row.mine {
      justify-content: flex-end;
    }

    .message-row.other {
      justify-content: flex-start;
    }

    /*
     * 昵称必须脱离气泡宽度约束，否则长昵称会随着窄气泡一起被折得支离破碎。
     * 这里让消息栈吃满整行，再把气泡本体单独对齐，就能保住昵称完整阅读性。
     */
    .message-stack {
      display: grid;
      width: 100%;
      min-width: 0;
      gap: 4px;
    }

    .message-row.mine .message-stack {
      justify-items: end;
    }

    .message-row.other .message-stack {
      justify-items: start;
    }

    .unread-divider {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--status-warn-strong);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .unread-divider::before,
    .unread-divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--status-divider);
    }

    .message-surface {
      max-width: 100%;
      word-break: break-word;
    }

    .message-bubble {
      padding: 12px 14px;
      border-radius: 20px;
      border: 1px solid var(--line-on-bubble);
      background: linear-gradient(180deg, var(--bubble-other-top), var(--bubble-other-bottom));
      box-shadow: var(--shadow-warm);
    }

    /*
     * 媒体消息不是“透明气泡”，而是另一种消息容器。
     * 这样带 caption 的图片/视频也不会退回普通气泡底板。
     */
    .message-surface.media-message {
      padding: 0;
      border: 0;
      border-radius: 16px;
      background: transparent;
      box-shadow: none;
    }

    .message-attachment-grid {
      display: grid;
      grid-template-columns: repeat(var(--attachment-grid-columns, 2), minmax(0, 1fr));
      grid-auto-rows: var(--attachment-grid-row-height, auto);
      gap: var(--attachment-grid-gap, 8px);
      margin-top: 10px;
    }

    .message-surface.media-message .message-attachment-grid {
      margin-top: 0;
    }

    .message-surface.media-message .message-body + .message-attachment-grid {
      margin-top: 8px;
    }

    .message-surface.media-message .message-body {
      padding: 0 2px;
    }

    .message-attachment-grid[data-attachment-count="1"] {
      grid-template-columns: minmax(0, 1fr);
    }

    .message-attachment-card,
    .message-image-card,
    .message-video-card {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      border-radius: 18px;
    }

    .message-video-card {
      position: relative;
      z-index: 0;
      overflow: hidden;
      border-radius: 16px;
      isolation: isolate;
      contain: paint;
      background:
        radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.16), transparent 34%),
        linear-gradient(135deg, rgba(34, 43, 56, 0.98), rgba(9, 13, 18, 0.98));
    }

    .message-video-preview-trigger {
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
      padding: 0;
      line-height: 0;
      border-radius: inherit;
      overflow: hidden;
      background: transparent;
      color: inherit;
      text-align: inherit;
      cursor: pointer;
    }

    .message-video-preview-trigger:focus-visible {
      outline: 2px solid var(--accent-hover);
      outline-offset: 3px;
    }

    /*
     * 时间线里的自动播 video 只是预览层，不是第二颗正式播放器。
     * 它必须和 poster 共用同一套尺寸、裁剪和命中规则，避免黑边和原生媒体误触。
     */
    .message-video-poster,
    .message-video-frozen-frame,
    .message-video-preview {
      position: relative;
      z-index: 0;
      display: block;
      width: 100%;
      max-width: 100%;
      height: 100%;
      border-radius: inherit;
      object-fit: cover;
      pointer-events: none;
      background:
        radial-gradient(circle at 50% 36%, rgba(255, 255, 255, 0.16), transparent 28%),
        linear-gradient(135deg, rgba(34, 43, 56, 0.98), rgba(9, 13, 18, 0.98));
    }

    .message-video-poster--canonical-cover {
      position: absolute;
      inset: 0;
      z-index: 2;
    }

    /*
     * 冻结帧只负责高速回滑时顶住“刚才暂停的那一帧”：
     * 它覆盖在重新挂载的 video 上，等当前 DOM 真正出帧后由模板自然移除。
     */
    .message-video-frozen-frame {
      position: absolute;
      inset: 0;
      z-index: 2;
    }

    /*
     * 无 poster 的视频首帧尚未就绪时，先把 video 像素压到透明：
     * - 避免浏览器在 decoder 尚未产出首帧前短暂闪出黑底；
     * - 仍保留同一颗 video 节点持续预热，不重建节点。
     */
    .message-video-preview--gated {
      opacity: 0;
    }

    /*
     * canonical host 只是覆盖在 preview 底板上的唯一 live 表面：
     * - preview 继续负责卡片自己的尺寸与退场像素连续性；
     * - canonical 只负责 owner 期间的正式播放，不再充当唯一底板；
     * - 绝对覆盖能保证 owner 退场时只移除覆盖层，不触发布局抖动。
     */
    .message-video-canonical-host {
      position: absolute;
      inset: 0;
      z-index: 1;
      display: block;
      width: 100%;
      height: 100%;
      border-radius: inherit;
      overflow: hidden;
      pointer-events: none;
      background: #000;
    }

    .message-video-first-frame-guard {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: block;
      width: 100%;
      height: 100%;
      border-radius: inherit;
      object-fit: cover;
      pointer-events: none;
    }

    .message-video-play-indicator {
      position: absolute;
      inset: 0;
      z-index: 3;
      display: grid;
      place-items: center;
      color: rgba(255, 255, 255, 0.82);
      font-size: 34px;
      line-height: 1;
      text-shadow: 0 2px 16px rgba(0, 0, 0, 0.8);
      pointer-events: none;
    }

    .message-image-preview-trigger {
      display: block;
      width: 100%;
      height: 100%;
      padding: 0;
      line-height: 0;
      border-radius: 16px;
      overflow: hidden;
      background: transparent;
      color: inherit;
      text-align: inherit;
      cursor: zoom-in;
    }

    .message-image-preview-trigger:focus-visible {
      outline: 2px solid var(--accent-hover);
      outline-offset: 3px;
    }

    .message-image {
      display: block;
      width: 100%;
      height: 100%;
      border-radius: 16px;
      object-fit: cover;
      background: rgba(255, 255, 255, 0.04);
    }

    .message-media-unavailable {
      display: grid;
      place-items: center;
      gap: 8px;
      min-height: 120px;
      padding: 14px;
      border-radius: inherit;
      text-align: center;
      background:
        radial-gradient(circle at 32% 22%, rgba(255, 255, 255, 0.12), transparent 36%),
        linear-gradient(135deg, rgba(34, 43, 56, 0.98), rgba(9, 13, 18, 0.98));
    }

    .message-media-hint {
      font-size: 13px;
      line-height: 1.5;
      color: var(--text-muted);
    }

    .message-media-retry-trigger {
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.22);
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-main);
      font-size: 12px;
      line-height: 1.2;
      cursor: pointer;
    }

    .message-media-retry-trigger:focus-visible {
      outline: 2px solid var(--accent-hover);
      outline-offset: 2px;
    }

    /* 新消息提示属于房间壳层浮动入口：用户正在补旧未读时提示可见，但不抢走当前视角。 */
    .jump-latest-button {
      position: absolute;
      right: 18px;
      bottom: 18px;
      z-index: 1;
      padding: 10px 14px;
      border-radius: 999px;
      border: 1px solid var(--line-on-accent);
      background: linear-gradient(135deg, var(--accent-hover) 0%, var(--accent-core) 100%);
      color: var(--text-on-accent);
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.04),
        0 10px 24px rgba(224, 11, 65, 0.28);
    }

    .message-row.mine .message-bubble {
      background: linear-gradient(135deg, var(--bubble-mine-top) 0%, var(--bubble-mine-bottom) 100%);
    }

    .message-alias {
      max-width: 100%;
      padding: 0 2px;
      font-size: 12px;
      line-height: 1.4;
      white-space: normal;
      overflow: visible;
      overflow-wrap: anywhere;
      color: var(--text-muted);
    }

    /* 输入区单独放在底部壳层栏位里，避免消息很多时把输入框重新挤回顶部。 */
    .composer-bar {
      display: grid;
      gap: 6px;
      max-height: min(42vh, 360px);
      overflow: hidden;
      padding: 4px 8px;
      border: 1px solid var(--line-soft);
      border-radius: 20px;
      background:
        linear-gradient(180deg, var(--surface-panel-top), var(--surface-elevated-bottom)),
        var(--surface-elevated);
      box-shadow: var(--shadow-warm);
      backdrop-filter: blur(18px);
    }

    .composer-drafts {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
      gap: 10px;
      max-height: min(28vh, 220px);
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    .composer-draft {
      display: grid;
      gap: 6px;
      padding: 8px;
      border-radius: 18px;
      border: 1px solid var(--line-soft);
      background: rgba(255, 255, 255, 0.03);
    }

    .composer-draft-thumb {
      display: block;
      width: 100%;
      aspect-ratio: 1 / 1;
      border-radius: 14px;
      object-fit: cover;
      background: rgba(255, 255, 255, 0.04);
    }

    .composer-draft-video-placeholder {
      display: grid;
      align-items: end;
      justify-items: start;
      padding: 10px;
      background:
        radial-gradient(circle at top right, rgba(255, 255, 255, 0.12), transparent 42%),
        linear-gradient(160deg, rgba(255, 255, 255, 0.08), rgba(0, 0, 0, 0.18)),
        rgba(255, 255, 255, 0.04);
    }

    .composer-draft-video-badge {
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.36);
      color: var(--text-primary);
      font-size: 11px;
      letter-spacing: 0.08em;
    }

    .composer-draft-meta {
      min-width: 0;
      display: grid;
      gap: 4px;
    }

    .composer-draft-name {
      overflow: hidden;
      font-size: 12px;
      white-space: nowrap;
      text-overflow: ellipsis;
      color: var(--text-primary);
    }

    .composer-draft-status {
      font-size: 11px;
      color: var(--text-muted);
    }

    .composer-draft-status[data-status="failed"] {
      color: var(--status-warn-strong);
    }

    .composer-draft-remove {
      justify-self: start;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-secondary);
    }

    .composer-status {
      min-height: 0;
      padding: 0 4px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .composer-status.attention {
      color: var(--status-warn-strong);
    }

    #shellConsoleStatus {
      min-height: 0;
      overflow: visible;
      white-space: normal;
      overflow-wrap: anywhere;
      line-height: 1.3;
    }

    .shell-console-form {
      margin: 0;
    }

    .shell-console-aux-slot {
      display: flex;
      align-items: stretch;
    }

    .composer-aux-button {
      width: 50px;
      min-height: 50px;
      padding: 0;
      border-radius: 18px;
      border: 1px solid var(--line-soft);
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-secondary);
      font-size: 24px;
      line-height: 1;
    }

    /* 操作台主控行必须固定成同一套节奏：
       以后可以扩功能，但这一步先把“同一台设备”的高度和间距钉死。 */
    #shellConsoleMainRow {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: end;
    }

    #shellConsoleInputGroup {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 8px;
      align-items: end;
      min-width: 0;
    }

    #shellConsolePrimaryInput {
      min-height: 50px;
      border-radius: 20px;
    }

    #shellConsolePrimaryAction {
      min-width: 84px;
      min-height: 50px;
      border-radius: 20px;
    }

    @media (min-width: 768px) {
      .room-screen {
        padding-inline: clamp(0px, 1.2vw, 6px);
      }
    }

    @media (max-width: 640px) {
      .home-card {
        padding: 18px;
        border-radius: 24px;
      }

      .room-screen {
        gap: 10px;
        padding-inline: 0;
      }

      .room-header {
        gap: 4px;
      }

      .back-button {
        min-width: 32px;
        padding-inline: 4px;
      }

      #shellConsolePrimaryAction {
        min-width: 72px;
      }

      .jump-latest-button {
        right: 12px;
        bottom: 12px;
      }
    }
  `;

  /**
   * ChatAppKernel 是聊天壳唯一的业务入口。
   * 壳层之后只允许：
   * - 读 `snapshot()`；
   * - 发 `dispatch(command)`；
   * - 转接少量浏览器副作用清理回调。
   */
  private readonly 装配 = 创建聊天壳应用装配({
    请求重渲染: () => {
      this.requestUpdate();
    },
    等待壳渲染完成: async () => {
      await this.updateComplete;
    },
    滚动宿主: this,
    查询滚动容器: () =>
      (this.shadowRoot?.querySelector("#messageScroll") as HTMLElement | null) ?? null,
    查询消息节点: () =>
      Array.from(this.shadowRoot?.querySelectorAll("[data-event-position]") ?? []) as HTMLElement[],
    清理房间视图本地状态: ({ previewUrls }) => {
      this.回收媒体草稿预览地址(previewUrls);
    },
  });

  private get 平台() {
    return this.装配.平台;
  }

  private get kernel() {
    return this.装配.kernel;
  }

  /**
   * 壳层只读内核快照，不再缓存第二份 `chatState` 镜像。
   * 这样测试和业务代码都会被迫走同一份真相，不再通过 setter 黑箱篡改状态。
   */
  private 读取聊天快照() {
    return this.kernel.snapshot();
  }

  /**
   * 真实浏览器烟测只读取内核预算快照，不在壳层派生第二套运行时真相。
   * 这个探针只服务验证：自动播放、查看器、swarm 与重任务预算仍以聊天内核为唯一来源。
   */
  private readonly 读取预算烟测快照 = (): 聊天运行时预算状态 =>
    this.装配.读取预算烟测快照();

  /**
   * 应用运行时是壳层里唯一的应用事件入口。
   * 它现在只认内核命令，不再把 roomScroller / 阅读推进端口这些 owner 暴露给壳层。
   */
  private get 应用运行时(): 应用运行时端口 {
    return this.装配.读取应用运行时();
  }

  setTransportForTest(transport: 前端传输端口): void {
    this.装配.设置测试传输(transport);
  }

  private revokeDraftPreviewUrl(previewUrl: string): void {
    if (!previewUrl.startsWith("blob:")) {
      return;
    }
    URL.revokeObjectURL(previewUrl);
  }

  /**
   * 纯状态模块只告诉壳层“哪些旧 blob URL 应该作废”。
   * 真正的浏览器资源回收仍留在壳层执行，避免把 DOM/URL API 倒灌进纯状态模块。
   */
  private 回收媒体草稿预览地址(previewUrls: string[]): void {
    for (const previewUrl of previewUrls) {
      this.revokeDraftPreviewUrl(previewUrl);
    }
  }

  private 同步预算烟测探针(): void {
    globalThis.__kokoBudgetSnapshot = this.读取预算烟测快照;
  }

  private removeComposerDraft(localId: string): void {
    void this.kernel.dispatch({ type: "MEDIA_DRAFT_REMOVE_REQUESTED", localId });
  }

  /**
   * 失败草稿的“继续上传”和“重新上传”必须是两条不同意图：
   * - 继续上传：只允许复用旧 upload；
   * - 重新上传：明确放弃旧 upload，开启新一轮 prepare。
   *
   * 壳层只负责把用户意图转成应用事件，不在这里偷偷猜条件。
   */
  private async resumeComposerDraft(localId: string): Promise<void> {
    await this.kernel.dispatch({ type: "MEDIA_DRAFT_RESUME_REQUESTED", localId });
  }

  private async restartComposerDraft(localId: string): Promise<void> {
    await this.kernel.dispatch({ type: "MEDIA_DRAFT_RESTART_REQUESTED", localId });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    globalThis.addEventListener("resize", this.handleViewportResize);
    this.同步预算烟测探针();
    /**
     * 聊天壳只负责启动应用运行时并触发统一 bootstrap 命令。
     * 会话恢复、房间恢复、snapshot reload 全都留在内核与恢复编排里。
     */
    this.应用运行时.start();
    void this.kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
  }

  override updated(): void {
    this.同步房间宽度观察();
    this.同步操作台输入组观察();
    this.同步预算烟测探针();
  }

  override disconnectedCallback(): void {
    globalThis.removeEventListener("resize", this.handleViewportResize);
    if (globalThis.__kokoBudgetSnapshot === this.读取预算烟测快照) {
      globalThis.__kokoBudgetSnapshot = undefined;
    }
    this.清理房间宽度观察();
    this.清理操作台输入组观察();
    this.装配.销毁();
    super.disconnectedCallback();
  }

  /**
   * 唯一操作台现在只有一条 submit 主链：
   * - `join` / `message` 都先转成聊天内核 command；
   * - `hidden` 态只阻止默认提交，不允许 boot 骨架误触发业务动作。
   */
  private submitShellConsole(event: SubmitEvent): void {
    event.preventDefault();
    const consoleMode = 派生控制台模式({
      bootstrapState: this.读取聊天快照().bootstrapState,
      roomId: this.读取聊天快照().roomId,
    });
    if (this.操作台主动作已禁用(consoleMode)) {
      return;
    }
    if (consoleMode === "join") {
      void this.kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
      return;
    }
    if (consoleMode === "message") {
      void this.kernel.dispatch({ type: "SEND_MESSAGE_REQUESTED" });
    }
  }

  private handleShellConsolePrimaryInput(event: Event, isMessageMode: boolean): void {
    const target = event.target as HTMLTextAreaElement;
    if (isMessageMode) {
      void this.kernel.dispatch({ type: "MESSAGE_INPUT_CHANGED", value: target.value });
      return;
    }
    void this.kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: target.value });
  }

  private handleShellConsolePrimaryKeydown(
    event: KeyboardEvent,
    isMessageMode: boolean
  ): void {
    if (event.key !== "Enter" || event.isComposing) {
      return;
    }

    /**
     * `textarea` 不会像单行 `input` 那样自动触发表单提交。
     * 为了保住原有 IM 发送语义，这里显式收口成：
     * 1. 房间短码模式：Enter 直接进房；
     * 2. 消息模式：Enter 发送，Shift+Enter 才换行。
     */
    if (isMessageMode && event.shiftKey) {
      return;
    }

    if (this.操作台主动作已禁用(isMessageMode ? "message" : "join")) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    (event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
  }

  /**
   * 键盘 Enter、表单 submit、按钮点击都必须尊重同一套 presenter 禁用态。
   * 否则视觉上已经“禁发”，但另一条入口仍然偷偷触发发送，就会重新长出 silent return。
   */
  private 操作台主动作已禁用(consoleMode: "hidden" | "join" | "message"): boolean {
    return 派生壳级操作台状态({
      consoleMode,
      roomCodeInput: this.读取聊天快照().roomCodeInput,
      messageInput: this.读取聊天快照().messageInput,
      pending: this.读取聊天快照().pending,
      statusText: "",
      composerMediaDrafts: this.读取聊天快照().composerMediaDrafts,
    }).primaryAction.disabled;
  }

  private 读取操作台主输入高度(isMessageMode: boolean, value: string): number {
    if (!isMessageMode) {
      return 50;
    }

    const inputGroupWidth = this.操作台输入组宽度缓存;
    const 附件入口宽度 = this.读取聊天快照().roomId ? 84 : 0;
    const 输入框总宽度 = Math.max(180, inputGroupWidth - 附件入口宽度);
    const 输入框内容宽度 = Math.max(120, 输入框总宽度 - 34);
    const layout = 默认文本布局器.布局纯文本({
      text: value.length > 0 ? value : " ",
      width: 输入框内容宽度,
      fontFamily: 默认消息文本布局环境.fontFamily,
      fontSize: 默认消息文本布局环境.fontSize,
      fontWeight: 默认消息文本布局环境.fontWeight,
      lineHeight: 默认消息文本布局环境.lineHeight,
      whiteSpace: "pre-wrap",
      wordBreak: "normal",
    });

    /**
     * 高度继续由 Pretext 的行数裁决，宿主 textarea 只负责输入事件与焦点。
     * 这里补上当前输入框的垂直内边距和边框，再用单行最小高度兜住空态。
     */
    return Math.max(50, Math.max(1, layout.lineCount) * 22 + 26);
  }

  /**
   * 操作台本体继续只维护一套骨架；
   * 真正的显示语义已经上收给 presenter，这里只负责：
   * - 套用同一套 selector；
   * - 绑定输入事件；
   * - 选择当前 submit 入口。
   */
  private renderShellConsole(input: {
    mode: "hidden" | "join" | "message";
    statusText: string;
    statusAttention: boolean;
  }) {
    const consoleState = 派生壳级操作台状态({
      consoleMode: input.mode,
      roomCodeInput: this.读取聊天快照().roomCodeInput,
      messageInput: this.读取聊天快照().messageInput,
      pending: this.读取聊天快照().pending,
      statusText: input.statusText,
      statusAttention: input.statusAttention,
      composerMediaDrafts: this.读取聊天快照().composerMediaDrafts,
    });
    const isMessageMode = consoleState.mode === "message";
    const isHiddenMode = consoleState.mode === "hidden";
    const primaryInputHeight = this.读取操作台主输入高度(
      isMessageMode,
      consoleState.primaryInput.value
    );
    const composerDrafts = isMessageMode ? this.读取聊天快照().composerMediaDrafts : [];
    const 附件入口编排 = 创建操作台附件入口编排({
      auxSlot: consoleState.auxSlot,
      获取统一媒体文件输入: () =>
        this.shadowRoot?.querySelector<HTMLInputElement>(
          `#${默认统一媒体文件选择配置.inputId}`
        ) ?? null,
      处理选择媒体文件: async (files) => {
        await this.kernel.dispatch({ type: "MEDIA_FILES_SELECTED", files });
      },
    });
    const 统一媒体文件选择配置 = 附件入口编排.统一媒体文件选择配置;

    return html`
      <footer id="shellConsole" class="composer-bar">
        <div
          id="shellConsoleStatus"
          class="composer-status ${consoleState.statusAttention ? "attention" : ""}"
        >
          ${consoleState.statusText}
        </div>
        ${composerDrafts.length > 0
          ? html`
              <div id="composerMediaDrafts" class="composer-drafts">
                ${composerDrafts.map(
                  (draft) => html`
                    <div
                      class="composer-draft"
                      data-draft-card-id=${draft.localId}
                    >
                      ${draft.kind === "video"
                        ? draft.previewUrl
                          ? html`
                              <img
                                class="composer-draft-thumb"
                                data-draft-id=${draft.localId}
                                src=${draft.previewUrl}
                                alt=${draft.fileName}
                              />
                            `
                          : html`
                              <div
                                class="composer-draft-thumb composer-draft-video-placeholder"
                                data-draft-id=${draft.localId}
                                data-video-draft-placeholder="true"
                                aria-label=${`${draft.fileName} 本地视频草稿占位`}
                              >
                                <span class="composer-draft-video-badge">视频</span>
                              </div>
                            `
                        : html`
                            <img
                              class="composer-draft-thumb"
                              data-draft-id=${draft.localId}
                              src=${draft.previewUrl}
                              alt=${draft.fileName}
                            />
                          `}
                      <div class="composer-draft-meta">
                        <div class="composer-draft-name">${draft.fileName}</div>
                        <div
                          class="composer-draft-status"
                          data-status=${draft.status}
                        >
                          ${draft.status === "ready"
                            ? "可发送"
                            : draft.status === "transporting"
                              ? "上传中"
                              : draft.status === "processing"
                                ? "处理中"
                              : 派生媒体草稿失败文案(draft.errorCode)}
                        </div>
                      </div>
                      <button
                        type="button"
                        class="composer-draft-remove"
                        data-draft-remove-id=${draft.localId}
                        @click=${() => this.removeComposerDraft(draft.localId)}
                      >
                        移除
                      </button>
                      ${draft.status === "failed" &&
                      draft.errorCode !== "attachment_too_large" &&
                      draft.errorCode !== "attachment_type_not_allowed"
                        ? html`
                            <button
                              type="button"
                              class="composer-draft-remove"
                              data-draft-resume-id=${draft.localId}
                              @click=${() => this.resumeComposerDraft(draft.localId)}
                            >
                              继续上传
                            </button>
                            <button
                              type="button"
                              class="composer-draft-remove"
                              data-draft-restart-id=${draft.localId}
                              @click=${() => this.restartComposerDraft(draft.localId)}
                            >
                              重新上传
                            </button>
                          `
                        : null}
                    </div>
                  `
                )}
              </div>
            `
          : null}
        <form id="shellConsoleForm" class="shell-console-form" @submit=${this.submitShellConsole}>
          <div
            id="shellConsoleMainRow"
            ?inert=${isHiddenMode}
          >
            <div id="shellConsoleInputGroup">
              <div
                id="shellConsoleAuxSlot"
                class="shell-console-aux-slot"
                ?hidden=${!consoleState.auxSlot.visible}
              >
                <input
                  id=${统一媒体文件选择配置.inputId}
                  type="file"
                  accept=${统一媒体文件选择配置.accept}
                  ?multiple=${统一媒体文件选择配置.multiple}
                  hidden
                  @change=${附件入口编排.处理统一媒体文件变更}
                />
                <button
                  id=${统一媒体文件选择配置.buttonId}
                  type="button"
                  class="composer-aux-button"
                  aria-label="选择图片或视频"
                  ?disabled=${consoleState.auxSlot.disabled}
                  @click=${() => 附件入口编排.执行默认附件能力()}
                >
                  ${consoleState.auxSlot.label}
                </button>
              </div>
              <textarea
                id="shellConsolePrimaryInput"
                class="text-input"
                data-role=${isMessageMode ? "composer-editor" : "room-code-editor"}
                placeholder=${consoleState.primaryInput.placeholder}
                enterkeyhint=${consoleState.primaryInput.enterKeyHint}
                .value=${consoleState.primaryInput.value}
                ?disabled=${consoleState.primaryInput.disabled}
                rows="1"
                style=${`height: ${primaryInputHeight}px;`}
                @input=${(event: Event) =>
                  this.handleShellConsolePrimaryInput(event, isMessageMode)}
                @keydown=${(event: KeyboardEvent) =>
                  this.handleShellConsolePrimaryKeydown(event, isMessageMode)}
              ></textarea>
            </div>
            <button
              id="shellConsolePrimaryAction"
              class="primary-button"
              type="submit"
              ?disabled=${consoleState.primaryAction.disabled}
            >
              ${consoleState.primaryAction.label}
            </button>
          </div>
        </form>
      </footer>
    `;
  }

  private 应用消息文本布局宽度(roomWidth: number): void {
    const nextWidth = Math.max(1, Math.round(roomWidth || globalThis.innerWidth || 1024));
    if (nextWidth === this.消息文本布局宽度缓存) {
      return;
    }
    this.消息文本布局宽度缓存 = nextWidth;
    this.消息文本布局环境缓存 = 按房间宽度派生消息文本布局环境(nextWidth);
    this.聊天列表展示项缓存 = null;
    this.requestUpdate();
  }

  private 清理房间宽度观察(): void {
    this.房间宽度观察器?.disconnect();
    this.房间宽度观察器 = null;
    this.房间宽度观察目标 = null;
  }

  private 应用操作台输入组宽度(width: number): void {
    const nextWidth = Math.max(
      180,
      Math.round(width || Math.min(globalThis.innerWidth || 390, 560))
    );
    if (nextWidth === this.操作台输入组宽度缓存) {
      return;
    }
    this.操作台输入组宽度缓存 = nextWidth;
    this.requestUpdate();
  }

  private 清理操作台输入组观察(): void {
    this.操作台输入组观察器?.disconnect();
    this.操作台输入组观察器 = null;
    this.操作台输入组观察目标 = null;
  }

  private 同步操作台输入组观察(): void {
    const inputGroup =
      (this.shadowRoot?.querySelector("#shellConsoleInputGroup") as HTMLElement | null) ?? null;
    if (inputGroup === this.操作台输入组观察目标) {
      return;
    }
    this.清理操作台输入组观察();
    if (!inputGroup) {
      return;
    }
    this.操作台输入组观察目标 = inputGroup;
    if (typeof ResizeObserver !== "function") {
      return;
    }
    this.操作台输入组观察器 = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      this.应用操作台输入组宽度(entry.contentRect.width);
    });
    this.操作台输入组观察器.observe(inputGroup);
  }

  private 读取当前房间宽度(): number {
    const roomView =
      (this.房间宽度观察目标 ??
        ((this.shadowRoot?.querySelector("#roomView") as HTMLElement | null) ?? null));
    return roomView?.clientWidth || globalThis.innerWidth || 1024;
  }

  private 同步消息文本布局环境(): void {
    this.应用消息文本布局宽度(this.读取当前房间宽度());
  }

  private 同步房间宽度观察(): void {
    const roomView =
      (this.shadowRoot?.querySelector("#roomView") as HTMLElement | null) ?? null;
    if (roomView === this.房间宽度观察目标) {
      return;
    }
    this.清理房间宽度观察();
    if (!roomView) {
      return;
    }
    this.房间宽度观察目标 = roomView;
    if (typeof ResizeObserver === "function") {
      this.房间宽度观察器 = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }
        this.应用消息文本布局宽度(
          entry.contentRect.width || roomView.clientWidth || globalThis.innerWidth || 1024
        );
      });
      this.房间宽度观察器.observe(roomView);
    }
    this.同步消息文本布局环境();
  }

  private 读取消息文本布局环境(): 消息文本布局环境 {
    return this.消息文本布局环境缓存;
  }

  private 读取聊天列表展示项(聊天快照: 聊天应用快照): ReturnType<typeof 派生聊天列表展示项> {
    const layoutEnv = this.读取消息文本布局环境();
    const cache = this.聊天列表展示项缓存;
    if (
      cache &&
      cache.messages === 聊天快照.messages &&
      cache.sessionId === 聊天快照.sessionId &&
      cache.firstUnreadEventPosition === 聊天快照.firstUnreadEventPosition &&
      cache.layoutEnv === layoutEnv &&
      附件内容地址表相同(cache.contentUrlByAttachmentId, 聊天快照.media.contentUrlByAttachmentId)
    ) {
      return cache.items;
    }
    const items = 派生聊天列表展示项(
      聊天快照.messages,
      聊天快照.sessionId,
      聊天快照.firstUnreadEventPosition,
      layoutEnv,
      聊天快照.media.contentUrlByAttachmentId
    );
    this.聊天列表展示项缓存 = {
      messages: 聊天快照.messages,
      sessionId: 聊天快照.sessionId,
      firstUnreadEventPosition: 聊天快照.firstUnreadEventPosition,
      layoutEnv,
      contentUrlByAttachmentId: 聊天快照.media.contentUrlByAttachmentId,
      items,
    };
    return items;
  }

  override render() {
    const 聊天快照 = this.读取聊天快照();
    const { recoveryHint, subtitle: roomSubtitle } = 派生房间壳提示文案({
      recoveryState: 聊天快照.recoveryState,
      roomId: 聊天快照.roomId,
      displayAlias: 聊天快照.displayAlias,
    });
    const { historyHint } = 派生消息窗口提示文案({
      historyLoading: 聊天快照.historyLoading,
      historyErrorCode: 聊天快照.historyErrorCode,
    });
    const jumpToLatestLabel = 派生跳到最新入口文案({
      viewportMode: 聊天快照.viewportMode,
      hasUnreadNewerMessages: 聊天快照.hasUnreadNewerMessages,
    });
    const shellView = 派生壳主舞台模式({
      bootstrapState: 聊天快照.bootstrapState,
      roomId: 聊天快照.roomId,
    });
    const consoleMode = 派生控制台模式({
      bootstrapState: 聊天快照.bootstrapState,
      roomId: 聊天快照.roomId,
    });
    const homeSessionViewItems = 派生首页会话展示项(聊天快照.homeSessionItems);
    const shellConsole = this.renderShellConsole({
      mode: consoleMode,
      statusText:
        consoleMode === "hidden"
          ? "正在恢复身份、会话和上次停留的房间，请稍等一下。"
          : consoleMode === "message"
            ? (recoveryHint || "在这里输入消息，发送后会实时出现在房间里。")
            : "在这里输入房间短码，进入对应群聊空间。",
      statusAttention: consoleMode === "message" ? Boolean(recoveryHint) : false,
    });
    if (shellView === "boot") {
      return html`
        <section class="shell-screen">
          <section id="bootView" class="boot-screen">
            <div class="boot-card">
              <h1 class="boot-title">正在回到聊天空间</h1>
              <p class="boot-subtitle">正在恢复身份、会话和上次停留的房间，请稍等一下。</p>
            </div>
          </section>
          ${shellConsole}
        </section>
      `;
    }
    if (shellView === "home") {
      // 首页与房间页共用同一块壳级控制台；主舞台只负责展示列表和空态说明。
      return html`
        <section class="shell-screen">
          <section id="homeView" class="home-screen">
            <div class="home-card">
              <h1 class="join-title">空态首页占位</h1>
              <p class="join-subtitle">输入房间短码后进入当前聊天空间，身份和会话会继续沿用。</p>
              <div id="alias" class="join-meta">alias: ${聊天快照.displayAlias || "-"}</div>
            ${recoveryHint ? html`<div id="recoveryHint" class="hint">${recoveryHint}</div>` : null}
            ${homeSessionViewItems.length > 0
              ? html`
                  <ul id="homeRoomList" class="home-room-list">
                    ${homeSessionViewItems.map(
                      (item) => html`
                        <li>
                          <button
                            type="button"
                            class="home-room-item"
                            data-room-id=${item.roomId}
                            @click=${() =>
                              void this.kernel.dispatch({
                                type: "JOIN_HISTORY_ROOM_REQUESTED",
                                roomCode: item.roomCode,
                              })}
                          >
                            <div class="home-room-code">${item.title}</div>
                            <div class="home-room-meta">${item.meta}</div>
                          </button>
                        </li>
                      `
                    )}
                  </ul>
                `
              : null}
            </div>
          </section>
          ${shellConsole}
        </section>
      `;
    }
    const 聊天列表展示项 = this.读取聊天列表展示项(聊天快照);
    return html`
      <section class="shell-screen">
        <section id="roomView" class="room-screen">
          <header id="roomHeader" class="room-header">
            <button
              id="backBtn"
              class="back-button"
              aria-label="返回"
              @click=${() => void this.kernel.dispatch({ type: "LEAVE_ROOM_VIEW_REQUESTED" })}
            >
              ‹
            </button>
            <div class="room-heading">
              <div id="roomTitle" class="room-title">
                ${聊天快照.roomDisplayTitle || "群聊房间"}
              </div>
              <div id="roomSubtitle" class="room-subtitle">${roomSubtitle}</div>
            </div>
          </header>
          <koko-room-message-pane
             .items=${聊天列表展示项}
             .mediaPlaybackByAttachmentId=${聊天快照.media.playbackByAttachmentId}
             .mediaPreviewByAttachmentId=${聊天快照.media.previewByAttachmentId}
             .mediaVideoBudgetByAttachmentId=${聊天快照.media.videoBudgetByAttachmentId}
             .inlineAutoplayOwnerAttachmentId=${聊天快照.media.inlineAutoplayOwnerAttachmentId}
             .inlineAutoplayPlaybackByAttachmentId=${聊天快照.media.inlineAutoplayPlaybackByAttachmentId}
             .inlineAutoplayPositionByAttachmentId=${聊天快照.media.inlineAutoplayPositionByAttachmentId}
             .historyHint=${historyHint}
             .jumpToLatestLabel=${jumpToLatestLabel}
            @room-scroll-intent=${() =>
              this.应用运行时.dispatch({ type: "ROOM_SCROLL_INTENT" })}
            @room-scroll=${() => {
              this.应用运行时.dispatch({
                type: "ROOM_SCROLL_OBSERVED",
              });
            }}
            @room-media-window-observed=${(
              event: CustomEvent<{ attachmentIds: string[] }>
            ) => {
              this.应用运行时.dispatch({
                type: "ROOM_MEDIA_WINDOW_OBSERVED",
                attachmentIds: event.detail.attachmentIds,
              });
            }}
            @room-inline-autoplay-observed=${(
              event: CustomEvent<{
                candidates: Array<{
                  attachmentId: string;
                  visibilityRatio: number;
                  distanceToViewportCenter: number;
                }>;
              }>
            ) => {
              this.应用运行时.dispatch({
                type: "MEDIA_INLINE_AUTOPLAY_OBSERVED",
                candidates: event.detail.candidates,
              });
            }}
            @room-inline-autoplay-position-changed=${(
              event: CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
            ) => {
              this.应用运行时.dispatch({
                type: "MEDIA_INLINE_AUTOPLAY_POSITION_CHANGED",
                attachmentId: event.detail.attachmentId,
                position: event.detail.position,
              });
            }}
            @jump-to-latest=${() =>
              this.应用运行时.dispatch({ type: "ROOM_JUMP_TO_LATEST_REQUESTED" })}
            @room-open-media-viewer=${(event: CustomEvent<媒体查看器打开请求>) => {
              this.应用运行时.dispatch({
                type: "MEDIA_OPEN_REQUESTED",
                request: event.detail,
              });
            }}
            @room-media-session-signal=${(
              event: CustomEvent<{ attachmentId: string; signal: 媒体会话信号 }>
            ) => {
              this.应用运行时.dispatch({
                type: "MEDIA_SESSION_SIGNALLED",
                attachmentId: event.detail.attachmentId,
                signal: event.detail.signal,
              });
            }}
          ></koko-room-message-pane>
        </section>
        ${shellConsole}
      </section>
    `;
  }
}

customElements.define("koko-chat-shell", 聊天壳);
