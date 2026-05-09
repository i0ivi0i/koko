import { css } from "lit";

export const 聊天壳样式 = css`
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
      position: relative;
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
      display: block;
      width: 100%;
      height: 100%;
      border-radius: inherit;
      pointer-events: none;
      background: transparent;
    }

    /*
     * preview video 在未出首帧前不能自带深色背景：
     * - 有 poster 的视频依赖 <video poster="..."> 原生属性作为可见底板；
     * - 如果 video 自带不透明背景，native poster 在部分浏览器里会被背景遮住；
     * - 保持 transparent 让 native poster / 下层 <img> poster / 卡片渐变依次透出。
     */
    .message-video-preview {
      background: transparent;
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

    /*
     * canonical host 在 handoff 期间只负责后台追 source/time：
     * - DOM 可以先挂上，避免唯一播放器失去目标宿主；
     * - 但在真正 committed 之前，它不能和 frozen/preview 共同争可见槽位；
     * - 因此 covered 态一律透明，由唯一 bridge surface 顶住。
     */
    .message-video-canonical-host[data-covered="true"] {
      opacity: 0;
      background: transparent;
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
