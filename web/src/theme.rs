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

.entry-card {
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
.member-row,
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

.icon-button {
  width: 42px;
  height: 42px;
  border-radius: 50%;
}

.member-name {
  font-size: 15px;
  font-weight: 620;
}

.member-role,
.message-meta {
  color: var(--muted);
  font-size: 13px;
}

.chat-main-view {
  min-height: calc(100vh - 48px);
  background:
    radial-gradient(circle at top, rgba(67, 132, 244, 0.14), transparent 22%),
    linear-gradient(180deg, rgba(14, 23, 35, 0.94), rgba(8, 13, 21, 0.98));
  display: flex;
  flex-direction: column;
}

.chat-topbar,
.chat-topbar-leading,
.chat-composer-pill,
.member-sheet-actions {
  display: flex;
  align-items: center;
}

.chat-topbar {
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(150, 175, 214, 0.08);
  background: rgba(17, 27, 40, 0.68);
  backdrop-filter: blur(32px);
}

.chat-topbar-leading {
  gap: 12px;
  min-width: 0;
}

.chat-back-button {
  background: rgba(90, 114, 154, 0.16);
}

.chat-topbar-meta {
  min-width: 0;
}

.chat-topbar-title,
.member-sheet-title {
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.chat-topbar-subtitle {
  color: var(--muted);
  font-size: 13px;
  margin-top: 2px;
}

.chat-topbar-action {
  padding: 12px 16px;
  border-radius: 999px;
  background: rgba(92, 120, 162, 0.14);
}

.chat-wall {
  flex: 1;
  padding: 18px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: auto;
}

.chat-date-chip {
  align-self: center;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(19, 29, 44, 0.72);
  border: 1px solid rgba(150, 175, 214, 0.08);
  color: rgba(230, 238, 255, 0.82);
  font-size: 12px;
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

.message-card {
  max-width: min(540px, 82%);
  padding: 10px 14px 8px;
  border-radius: 20px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.14);
  position: relative;
}

.message-card.incoming {
  background: rgba(32, 44, 62, 0.96);
  border-bottom-left-radius: 8px;
  border-top-left-radius: 12px;
}

.message-card.outgoing {
  background: linear-gradient(180deg, #268cff 0%, #2d74ff 100%);
  border-bottom-right-radius: 8px;
  color: #f8fbff;
}

.message-text {
  line-height: 1.6;
  font-size: 15px;
}

.message-sender {
  margin-bottom: 6px;
  color: #74b7ff;
  font-size: 12px;
  font-weight: 600;
}

.message-meta {
  margin-top: 4px;
  text-align: right;
  font-size: 11px;
}

.message-card.outgoing .message-meta {
  color: rgba(239, 247, 255, 0.78);
}

.chat-bottom-bar {
  padding: 12px 14px 16px;
  background: rgba(14, 20, 31, 0.74);
  backdrop-filter: blur(26px);
}

.chat-composer-pill {
  gap: 12px;
  padding: 8px 8px 8px 12px;
  border: 1px solid rgba(150, 175, 214, 0.1);
  border-radius: 30px;
  background: rgba(20, 29, 43, 0.92);
  box-shadow: 0 18px 32px rgba(0, 0, 0, 0.18);
}

.composer-input {
  font: inherit;
}

.chat-composer-input {
  flex: 1;
  min-height: 46px;
  max-height: 120px;
  padding: 11px 4px;
  border: 0;
  background: transparent;
  color: var(--text);
  resize: vertical;
  outline: none;
}

.composer-attach {
  flex-shrink: 0;
  background: rgba(83, 109, 151, 0.12);
}

.composer-send-button {
  border: 0;
  flex-shrink: 0;
  padding: 0 18px;
  height: 42px;
  border-radius: 999px;
  background: linear-gradient(180deg, #2791ff 0%, #2e73ff 100%);
  color: #fff;
  font: inherit;
  font-weight: 640;
  cursor: pointer;
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
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 24px;
  pointer-events: none;
}

.member-sheet-card {
  width: min(420px, 100%);
  max-height: min(78vh, 760px);
  padding: 12px 14px 14px;
  border: 1px solid rgba(150, 175, 214, 0.12);
  border-radius: 30px;
  background: rgba(19, 28, 40, 0.94);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(28px);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
}

.member-sheet-handle {
  width: 44px;
  height: 5px;
  margin: 0 auto 12px;
  border-radius: 999px;
  background: rgba(177, 193, 223, 0.22);
}

.member-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
  padding: 0 4px;
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.member-row {
  gap: 12px;
  padding: 12px;
  border-radius: 22px;
  background: rgba(93, 120, 163, 0.08);
  border: 1px solid rgba(150, 175, 214, 0.08);
  flex-wrap: wrap;
}

.member-meta {
  flex: 1;
  min-width: 120px;
}

.role-badge {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: #dce9ff;
  background: rgba(90, 167, 255, 0.16);
}

.member-sheet-actions {
  gap: 8px;
  margin-left: auto;
}

.member-action-button {
  padding: 10px 12px;
  border-radius: 14px;
}

.member-action-button.danger {
  color: #ffd5d5;
  background: rgba(255, 100, 100, 0.14);
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
  .chat-main-view {
    min-height: 100vh;
    border-radius: 0;
  }

  .entry-layout {
    grid-template-columns: 1fr;
    display: block;
  }

  .entry-aside {
    display: none;
  }

  .entry-stage {
    padding: 24px;
  }

  .member-sheet {
    padding: 0;
    align-items: flex-end;
  }

  .member-sheet-card {
    width: 100%;
    border-radius: 28px 28px 0 0;
  }

  .chat-topbar {
    padding: 14px 14px 12px;
  }

  .chat-topbar-action {
    padding: 10px 14px;
  }

  .chat-wall {
    padding-left: 10px;
    padding-right: 10px;
  }

  .chat-bottom-bar {
    padding: 10px 10px 14px;
  }

  .chat-composer-pill {
    gap: 10px;
  }

  .message-card {
    max-width: min(92%, 540px);
  }
}
"#;

#[cfg(test)]
mod tests {
    use super::APP_STYLE;

    #[test]
    fn member_sheet_style_should_keep_card_and_overlay_separate() {
        assert!(!APP_STYLE.contains(".entry-card,\n.chat-panel,\n.member-sheet {"));
        assert!(APP_STYLE.contains(".member-sheet-card {"));
    }

    #[test]
    fn member_sheet_style_should_keep_list_scrollable_inside_card() {
        assert!(APP_STYLE.contains(".member-sheet-card {\n  width: min(420px, 100%);"));
        assert!(APP_STYLE.contains("display: flex;\n  flex-direction: column;"));
        assert!(APP_STYLE.contains(".member-list {\n  display: flex;"));
        assert!(APP_STYLE.contains("flex: 1;\n  min-height: 0;\n  overflow: auto;"));
    }
}
