pub const APP_STYLE: &str = r#"
:root {
  color-scheme: dark;
  --bg: #0b111a;
  --bg-glow: radial-gradient(circle at top left, rgba(64, 132, 255, 0.18), transparent 32%),
    radial-gradient(circle at bottom right, rgba(45, 95, 185, 0.18), transparent 28%),
    linear-gradient(180deg, #0e1621 0%, #0b111a 100%);
  --surface: rgba(20, 29, 42, 0.82);
  --surface-soft: rgba(27, 38, 55, 0.78);
  --surface-strong: rgba(18, 27, 39, 0.96);
  --line: rgba(124, 149, 187, 0.14);
  --text: #f3f7ff;
  --muted: #8fa4c3;
  --accent: #5aa7ff;
  --accent-strong: #2f88ff;
  --incoming: #182331;
  --outgoing: linear-gradient(180deg, #2b90ff 0%, #2378ff 100%);
  --success: #6dc08d;
  --danger: #ff7d7d;
  --shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
  --radius-xl: 28px;
  --radius-lg: 22px;
  --radius-md: 18px;
  --radius-sm: 14px;
  --font-ui: "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  min-height: 100%;
  background: #060b12;
  font-family: var(--font-ui);
  color: var(--text);
}

body {
  background-image: var(--bg-glow);
}

.app-shell {
  min-height: 100vh;
  padding: 24px;
}

.telegram-frame {
  width: min(1280px, 100%);
  min-height: calc(100vh - 48px);
  margin: 0 auto;
  border: 1px solid var(--line);
  border-radius: 36px;
  background: rgba(8, 14, 22, 0.76);
  box-shadow: var(--shadow);
  overflow: hidden;
  backdrop-filter: blur(28px);
  display: grid;
}

.entry-layout {
  grid-template-columns: minmax(320px, 440px) 1fr;
}

.entry-aside {
  padding: 36px 32px;
  background: linear-gradient(180deg, rgba(18, 28, 41, 0.96), rgba(10, 16, 24, 0.9));
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.entry-stage {
  padding: 44px;
  display: grid;
  place-items: center;
}

.entry-card,
.chat-panel,
.member-sheet {
  background: rgba(17, 25, 36, 0.84);
  border: 1px solid rgba(146, 171, 212, 0.12);
  border-radius: var(--radius-xl);
  backdrop-filter: blur(28px);
}

.entry-card {
  width: min(520px, 100%);
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.eyebrow {
  color: var(--accent);
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.headline {
  margin: 0;
  font-size: clamp(32px, 4vw, 54px);
  line-height: 1.02;
  font-weight: 740;
}

.subhead {
  margin: 0;
  color: var(--muted);
  line-height: 1.7;
  font-size: 15px;
}

.stat-row,
.chat-layout,
.chat-toolbar,
.member-row,
.composer-row,
.entry-actions {
  display: flex;
  align-items: center;
}

.stat-row {
  gap: 12px;
  flex-wrap: wrap;
}

.pill {
  padding: 10px 14px;
  border-radius: 999px;
  background: rgba(89, 124, 180, 0.14);
  color: #d4e3ff;
  font-size: 13px;
}

.room-input {
  width: 100%;
  padding: 18px 20px;
  border-radius: 20px;
  border: 1px solid rgba(139, 170, 218, 0.16);
  background: rgba(8, 14, 24, 0.74);
  color: var(--text);
  font-size: 30px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  outline: none;
}

.room-input::placeholder,
.composer-input::placeholder {
  color: rgba(143, 164, 195, 0.52);
}

.entry-actions {
  justify-content: space-between;
  gap: 16px;
}

.telegram-button,
.ghost-button,
.icon-button {
  border: 0;
  cursor: pointer;
  font: inherit;
}

.telegram-button {
  padding: 16px 24px;
  border-radius: 18px;
  background: var(--outgoing);
  color: #fff;
  font-weight: 650;
  box-shadow: 0 16px 36px rgba(36, 116, 255, 0.35);
}

.ghost-button,
.icon-button {
  background: rgba(93, 125, 174, 0.12);
  color: var(--text);
}

.ghost-button {
  padding: 14px 18px;
  border-radius: 18px;
}

.chat-layout {
  min-height: calc(100vh - 48px);
}

.chat-sidebar {
  width: 360px;
  padding: 20px 18px;
  border-right: 1px solid var(--line);
  background: rgba(15, 23, 34, 0.92);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.chat-panel {
  flex: 1;
  border: 0;
  border-radius: 0;
  background: linear-gradient(180deg, rgba(13, 19, 30, 0.86), rgba(11, 17, 26, 0.96));
  display: flex;
  flex-direction: column;
}

.chat-toolbar {
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid var(--line);
  background: rgba(16, 23, 34, 0.74);
  backdrop-filter: blur(26px);
}

.toolbar-meta {
  display: flex;
  gap: 12px;
  align-items: center;
}

.icon-button {
  width: 42px;
  height: 42px;
  border-radius: 50%;
}

.thread-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.thread-item {
  padding: 14px 16px;
  border-radius: 22px;
  background: rgba(102, 130, 173, 0.08);
  border: 1px solid transparent;
}

.thread-item.active {
  background: rgba(54, 125, 255, 0.16);
  border-color: rgba(82, 151, 255, 0.2);
}

.thread-title,
.member-name {
  font-size: 15px;
  font-weight: 620;
}

.thread-preview,
.member-role,
.message-meta {
  color: var(--muted);
  font-size: 13px;
}

.chat-scroll {
  flex: 1;
  padding: 28px 22px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: auto;
}

.message-row {
  display: flex;
}

.message-row.incoming {
  justify-content: flex-start;
}

.message-row.outgoing {
  justify-content: flex-end;
}

.message-bubble {
  max-width: min(520px, 78%);
  padding: 14px 18px 12px;
  border-radius: 24px;
  box-shadow: 0 14px 28px rgba(0, 0, 0, 0.18);
}

.message-bubble.incoming {
  background: var(--incoming);
  border-bottom-left-radius: 10px;
}

.message-bubble.outgoing {
  background: var(--outgoing);
  border-bottom-right-radius: 10px;
}

.message-text {
  line-height: 1.6;
  font-size: 15px;
}

.message-meta {
  margin-top: 6px;
  text-align: right;
}

.composer-shell {
  padding: 18px 22px 24px;
  border-top: 1px solid var(--line);
  background: rgba(15, 21, 31, 0.8);
  backdrop-filter: blur(24px);
}

.composer-row {
  gap: 14px;
  align-items: flex-end;
}

.composer-input {
  flex: 1;
  min-height: 56px;
  max-height: 140px;
  padding: 18px 20px;
  border: 1px solid rgba(140, 169, 214, 0.14);
  border-radius: 28px;
  background: rgba(9, 15, 24, 0.8);
  color: var(--text);
  resize: vertical;
  outline: none;
  font: inherit;
}

.avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: inline-grid;
  place-items: center;
  background: linear-gradient(180deg, rgba(98, 170, 255, 0.92), rgba(42, 114, 255, 0.92));
  color: white;
  font-weight: 700;
}

.member-sheet {
  position: fixed;
  top: 48px;
  right: 32px;
  width: min(360px, calc(100vw - 64px));
  padding: 22px 20px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.44);
}

.member-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.member-row {
  gap: 12px;
  padding: 12px 14px;
  border-radius: 18px;
  background: rgba(95, 123, 167, 0.08);
}

.member-meta {
  flex: 1;
}

.role-badge {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: #dce9ff;
  background: rgba(90, 167, 255, 0.16);
}

.scrim {
  position: fixed;
  inset: 0;
  background: rgba(3, 7, 12, 0.52);
  backdrop-filter: blur(10px);
}

@media (max-width: 980px) {
  .app-shell {
    padding: 0;
  }

  .telegram-frame,
  .chat-layout {
    min-height: 100vh;
    border-radius: 0;
  }

  .entry-layout,
  .chat-layout {
    grid-template-columns: 1fr;
    display: block;
  }

  .entry-aside,
  .chat-sidebar {
    display: none;
  }

  .entry-stage {
    padding: 24px;
  }

  .member-sheet {
    top: auto;
    right: 0;
    bottom: 0;
    width: 100%;
    border-radius: 28px 28px 0 0;
  }
}
"#;
