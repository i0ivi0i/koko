import { css, html, LitElement } from "lit";
import { 创建应用运行时, type 应用运行时端口 } from "./应用运行时.js";
import { 创建聊天应用内核 } from "./聊天应用内核.js";
import "./房间消息窗.js";
import {
  创建操作台附件入口编排,
  默认统一媒体文件选择配置,
} from "./操作台/index.js";
import { type 媒体查看器打开请求 } from "./媒体/index.js";
import type { 前端传输端口 } from "./传输.js";
import { 默认文本布局器 } from "./文本布局.js";
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

export class 聊天壳 extends LitElement {
  /**
   * 文本几何已经改由 Pretext 主导后，宿主尺寸变化就不能再指望浏览器自然流偷偷兜底。
   * 这里不引入第二份“宽度状态”，只在 viewport 改变时请求一次重渲染，
   * 让消息气泡和输入区都重新按当前宿主宽度计算布局。
   */
  private readonly handleViewportResize = (): void => {
    this.requestUpdate();
  };

  static override styles = css`
    :host {
      --surface-canvas: #0b0f14;
      --surface-panel: #151b23;
      --surface-elevated: #1b2430;
      --surface-soft: #243042;
      --surface-overlay: rgba(21, 27, 35, 0.92);
      --surface-input: rgba(18, 24, 32, 0.96);
      --surface-nav: rgba(24, 31, 41, 0.92);
      --surface-scroll: rgba(9, 13, 18, 0.48);
      --surface-panel-top: rgba(28, 36, 47, 0.94);
      --surface-panel-bottom: rgba(16, 21, 29, 0.96);
      --surface-elevated-bottom: rgba(20, 27, 36, 0.96);
      --bubble-other-top: rgba(34, 43, 56, 0.98);
      --bubble-other-bottom: rgba(24, 31, 41, 0.98);
      --bubble-mine-top: rgba(255, 56, 92, 0.22);
      --bubble-mine-bottom: rgba(91, 34, 56, 0.92);
      --text-primary: #f3f7fb;
      --text-secondary: #c7d1dc;
      --text-muted: #8a97a8;
      --text-on-accent: #fff7f9;
      --accent-core: #ff385c;
      --accent-pressed: #d92a4f;
      --accent-hover: #ff5a78;
      --accent-glow: rgba(255, 56, 92, 0.2);
      --line-soft: rgba(255, 255, 255, 0.08);
      --line-strong: rgba(255, 255, 255, 0.16);
      --line-accent-soft: rgba(255, 107, 132, 0.18);
      --line-on-accent: rgba(255, 255, 255, 0.08);
      --line-on-bubble: rgba(255, 255, 255, 0.05);
      --status-warn-bg: rgba(30, 39, 52, 0.9);
      --status-warn-text: #dbe7f5;
      --status-warn-strong: #ff9bb0;
      --status-divider: rgba(255, 56, 92, 0.32);
      --shadow-warm:
        rgba(0, 0, 0, 0.2) 0px 0px 0px 1px,
        rgba(0, 0, 0, 0.28) 0px 12px 28px,
        rgba(0, 0, 0, 0.38) 0px 22px 44px;
      display: block;
      height: 100%;
      min-height: 100dvh;
      overflow: hidden;
      background:
        radial-gradient(circle at top, rgba(255, 56, 92, 0.14), transparent 30%),
        radial-gradient(circle at 82% 18%, rgba(96, 165, 250, 0.12), transparent 24%),
        linear-gradient(180deg, #0b0f14 0%, #0f141b 52%, #090d12 100%);
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
      gap: 12px;
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
      border-color: rgba(255, 56, 92, 0.45);
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
        0 12px 24px rgba(224, 11, 65, 0.22);
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
      gap: 12px;
      padding: 0;
    }

    .room-header {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 12px;
      padding: calc(4px + env(safe-area-inset-top, 0px)) 4px 10px;
    }

    .back-button {
      min-width: 72px;
      padding: 10px 14px;
      border-radius: 999px;
      background: var(--surface-nav);
      color: var(--text-secondary);
      box-shadow: var(--shadow-warm);
    }

    .room-heading {
      min-width: 0;
      text-align: center;
    }

    .room-title {
      overflow: hidden;
      font-size: clamp(18px, 2.4vw, 22px);
      font-weight: 700;
      line-height: 1.2;
      letter-spacing: -0.18px;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-primary);
    }

    .room-subtitle {
      overflow: hidden;
      margin-top: 4px;
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
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
      padding: 6px 2px;
      border-radius: 28px;
      /* 聊天窗口是内层滚动容器，触顶/触底时不应把浏览器页面回弹和外层滚动链带进来。 */
      overscroll-behavior-y: contain;
      /* 历史前插后由壳层自己做锚点恢复与兜底补偿，不能再让浏览器默认滚动锚点重复干预。 */
      overflow-anchor: none;
      scrollbar-gutter: stable both-edges;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.015)),
        var(--surface-scroll);
    }

    .message-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 100%;
      padding: 8px 4px 0;
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
    }

    .message-row.mine {
      justify-content: flex-end;
    }

    .message-row.other {
      justify-content: flex-start;
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
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
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

    .message-image-card,
    .message-video-card {
      min-width: 0;
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

    .message-video-preview {
      position: relative;
      z-index: 0;
      display: block;
      width: 100%;
      max-width: 100%;
      height: auto;
      border-radius: inherit;
      object-fit: cover;
      pointer-events: none;
      background:
        radial-gradient(circle at 50% 36%, rgba(255, 255, 255, 0.16), transparent 28%),
        linear-gradient(135deg, rgba(34, 43, 56, 0.98), rgba(9, 13, 18, 0.98));
    }

    .message-video-play-indicator {
      position: absolute;
      inset: 0;
      z-index: 1;
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
      height: auto;
      border-radius: 16px;
      object-fit: cover;
      background: rgba(255, 255, 255, 0.04);
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
      margin-bottom: 4px;
      font-size: 12px;
      color: var(--text-muted);
    }

    /* 输入区单独放在底部壳层栏位里，避免消息很多时把输入框重新挤回顶部。 */
    .composer-bar {
      display: grid;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid var(--line-soft);
      border-radius: 24px;
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
      min-height: 18px;
      padding: 0 4px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .composer-status.attention {
      color: var(--status-warn-strong);
    }

    /* 操作台状态槽必须单行收口。
       如果这里允许两行，home -> room 一切换就会把整块操作台高度撑变。 */
    #shellConsoleStatus {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
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
      gap: 10px;
      align-items: end;
    }

    #shellConsoleInputGroup {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px;
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
        padding-inline: clamp(4px, 2vw, 12px);
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
        gap: 10px;
      }

      .back-button {
        min-width: 60px;
        padding-inline: 12px;
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
  private readonly kernel = 创建聊天应用内核({
    渲染桥: {
      请求重渲染: () => {
        this.requestUpdate();
      },
      等待壳渲染完成: async () => {
        await this.updateComplete;
      },
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

  /**
   * 壳层只读内核快照，不再缓存第二份 `chatState` 镜像。
   * 这样测试和业务代码都会被迫走同一份真相，不再通过 setter 黑箱篡改状态。
   */
  private 读取聊天快照() {
    return this.kernel.snapshot();
  }
  private _应用运行时: 应用运行时端口 | null = null;

  /**
   * 应用运行时是壳层里唯一的应用事件入口。
   * 它现在只认内核命令，不再把 roomScroller / 阅读推进端口这些 owner 暴露给壳层。
   */
  private get 应用运行时(): 应用运行时端口 {
    if (!this._应用运行时) {
      this._应用运行时 = 创建应用运行时({
        dispatch: (command) => this.kernel.dispatch(command),
      });
    }
    return this._应用运行时;
  }

  setTransportForTest(transport: 前端传输端口): void {
    this._应用运行时 = null;
    this.kernel.setTransportForTest(transport);
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

  private removeComposerDraft(localId: string): void {
    void this.kernel.dispatch({ type: "MEDIA_DRAFT_REMOVE_REQUESTED", localId });
  }

  /**
   * 失败草稿点“重试”后，UI 会立刻回到 uploading。
   * 真正的上传文件 id 仍以底层上传器回填为准：
   * - 如果底层沿用旧 localId，草稿会原地更新；
   * - 如果底层为新一轮 prepare 生成了新的 localId，媒体发布器会在 file-added 后清掉旧草稿，
   *   继续保证草稿带里只保留一条真上传项，不长幽灵副本。
   */
  private async retryComposerDraft(localId: string): Promise<void> {
    await this.kernel.dispatch({ type: "MEDIA_DRAFT_RETRY_REQUESTED", localId });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    globalThis.addEventListener("resize", this.handleViewportResize);
    void this.kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
  }

  override disconnectedCallback(): void {
    globalThis.removeEventListener("resize", this.handleViewportResize);
    this.kernel.dispose();
    this._应用运行时 = null;
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

    const inputGroup =
      (this.shadowRoot?.querySelector("#shellConsoleInputGroup") as HTMLElement | null) ?? null;
    const inputGroupWidth = inputGroup?.clientWidth || Math.min(globalThis.innerWidth || 390, 560);
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
                        ? html`
                            <video
                              class="composer-draft-thumb"
                              data-draft-id=${draft.localId}
                              src=${draft.previewUrl}
                              muted
                              playsinline
                              preload="metadata"
                            ></video>
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
                            : draft.status === "uploading"
                              ? "上传中"
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
                              data-draft-retry-id=${draft.localId}
                              @click=${() => this.retryComposerDraft(draft.localId)}
                            >
                              重试
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

  private 读取消息文本布局环境(): 消息文本布局环境 {
    const roomView =
      (this.shadowRoot?.querySelector("#roomView") as HTMLElement | null) ?? null;
    const roomWidth = roomView?.clientWidth || globalThis.innerWidth || 1024;
    const 气泡外框附加宽度 =
      默认消息文本布局环境.bubbleHorizontalPadding +
      默认消息文本布局环境.bubbleHorizontalBorderWidth;
    const bubbleMaxWidth =
      roomWidth <= 640
        ? Math.min(roomWidth * 0.88, 720)
        : roomWidth >= 768
          ? Math.min(roomWidth * 0.7, 760)
          : Math.min(roomWidth * 0.82, 720);
    const 多行正文上限 = Math.max(
      120,
      bubbleMaxWidth - 气泡外框附加宽度
    );
    const 单行正文直通上限 = Math.max(
      多行正文上限,
      Math.min(
        多行正文上限 + 56,
        Math.max(120, roomWidth - 气泡外框附加宽度 - 8),
        420
      )
    );

    /**
     * 这里把当前 CSS 气泡宽度规则翻译成 Presenter 可消费的稳定布局环境：
     * 1. 宽度来源收口到壳层，避免 Presenter 和消息窗各自再猜；
     * 2. 传给 Pretext 的是正文可用内容宽度，不是整个气泡外框宽度；
     * 3. 当前宿主使用 `border-box`，所以左右边框也必须一起扣掉；
     * 4. `.message-bubble` 不再保留 CSS `max-width` 第二裁决，真正的宽度主权只留给 Presenter。
     */
    return {
      ...默认消息文本布局环境,
      maxContentWidth: 多行正文上限,
      /**
       * 单行直通上限只做很小幅度放宽：
       * - 让本来就短的消息有机会保持单行；
       * - 但不把长消息一路放大成超长单行。
       */
      singleLineMaxContentWidth: 单行正文直通上限,
    };
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
    const 消息文本布局环境 = this.读取消息文本布局环境();
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
    return html`
      <section class="shell-screen">
        <section id="roomView" class="room-screen">
          <header id="roomHeader" class="room-header">
            <button
              id="backBtn"
              class="back-button"
              @click=${() => void this.kernel.dispatch({ type: "LEAVE_ROOM_VIEW_REQUESTED" })}
            >
              返回
            </button>
            <div class="room-heading">
              <div id="roomTitle" class="room-title">
                ${聊天快照.roomDisplayTitle || "群聊房间"}
              </div>
              <div id="roomSubtitle" class="room-subtitle">${roomSubtitle}</div>
            </div>
          </header>
          <koko-room-message-pane
              .items=${派生聊天列表展示项(
              聊天快照.messages,
              聊天快照.sessionId,
              聊天快照.firstUnreadEventPosition,
              消息文本布局环境,
              聊天快照.media.contentUrlByAttachmentId
             )}
            .mediaPlaybackByAttachmentId=${聊天快照.media.playbackByAttachmentId}
            .historyHint=${historyHint}
            .jumpToLatestLabel=${jumpToLatestLabel}
            @room-scroll-intent=${() =>
              this.应用运行时.dispatch({ type: "ROOM_SCROLL_INTENT" })}
            @room-scroll=${(event: Event) => {
              const target = (
                event as CustomEvent<{ scrollContainer: HTMLElement }>
              ).detail.scrollContainer;
              this.应用运行时.dispatch({
                type: "ROOM_SCROLL_OBSERVED",
                scrollContainer: target,
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
          ></koko-room-message-pane>
        </section>
        ${shellConsole}
      </section>
    `;
  }
}

customElements.define("koko-chat-shell", 聊天壳);
