import { html } from "lit";
import type { 聊天应用快照 } from "./聊天应用内核.js";
import {
  创建操作台附件入口编排,
  默认统一媒体文件选择配置,
} from "../操作台/index.js";
import { 默认文本布局器 } from "../房间消息窗/文本布局.js";
import {
  默认消息文本布局环境,
  派生壳级操作台状态,
} from "../房间消息窗/视图.js";

type 聊天壳操作台视图输入 = {
  mode: "hidden" | "join" | "message";
  statusText: string;
  statusAttention: boolean;
  roomId: string | null;
  roomCodeInput: 聊天应用快照["roomCodeInput"];
  messageInput: 聊天应用快照["messageInput"];
  pending: 聊天应用快照["pending"];
  composerMediaDrafts: 聊天应用快照["composerMediaDrafts"];
  操作台输入组宽度: number;
  获取统一媒体文件输入(): HTMLInputElement | null;
  处理选择媒体文件(files: Iterable<File>): Promise<void>;
  提交操作台(event: SubmitEvent): void;
  处理主输入(event: Event, isMessageMode: boolean): void;
  处理主输入按键(event: KeyboardEvent, isMessageMode: boolean): void;
  移除媒体草稿(localId: string): void;
  继续上传媒体草稿(localId: string): void | Promise<void>;
  重新上传媒体草稿(localId: string): void | Promise<void>;
};

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

function 读取操作台主输入高度(input: {
  isMessageMode: boolean;
  roomId: string | null;
  操作台输入组宽度: number;
  value: string;
}): number {
  if (!input.isMessageMode) {
    return 50;
  }

  const 附件入口宽度 = input.roomId ? 84 : 0;
  const 输入框总宽度 = Math.max(180, input.操作台输入组宽度 - 附件入口宽度);
  const 输入框内容宽度 = Math.max(120, 输入框总宽度 - 34);
  const layout = 默认文本布局器.布局纯文本({
    text: input.value.length > 0 ? input.value : " ",
    width: 输入框内容宽度,
    fontFamily: 默认消息文本布局环境.fontFamily,
    fontSize: 默认消息文本布局环境.fontSize,
    fontWeight: 默认消息文本布局环境.fontWeight,
    lineHeight: 默认消息文本布局环境.lineHeight,
    whiteSpace: "pre-wrap",
    wordBreak: "normal",
  });

  /**
   * 输入高度仍由同一套文本布局器裁决：
   * 1. 消息模式按真实行数伸缩；
   * 2. room code 模式维持单行高度；
   * 3. 宿主 textarea 只接事件，不自己再猜行高。
   */
  return Math.max(50, Math.max(1, layout.lineCount) * 22 + 26);
}

/**
 * 操作台视图 owner 只关心壳层底部这一个 UI 片段：
 * 1. 把 presenter 快照投影成统一模板；
 * 2. 统一接线附件入口、主输入、提交按钮；
 * 3. 不持有业务真相，只消费调用方提供的切片和回调。
 */
export function 渲染聊天壳操作台(input: 聊天壳操作台视图输入) {
  const consoleState = 派生壳级操作台状态({
    consoleMode: input.mode,
    roomCodeInput: input.roomCodeInput,
    messageInput: input.messageInput,
    pending: input.pending,
    statusText: input.statusText,
    statusAttention: input.statusAttention,
    composerMediaDrafts: input.composerMediaDrafts,
  });
  const isMessageMode = consoleState.mode === "message";
  const isHiddenMode = consoleState.mode === "hidden";
  const primaryInputHeight = 读取操作台主输入高度({
    isMessageMode,
    roomId: input.roomId,
    操作台输入组宽度: input.操作台输入组宽度,
    value: consoleState.primaryInput.value,
  });
  const composerDrafts = isMessageMode ? input.composerMediaDrafts : [];
  const 附件入口编排 = 创建操作台附件入口编排({
    auxSlot: consoleState.auxSlot,
    获取统一媒体文件输入: input.获取统一媒体文件输入,
    处理选择媒体文件: input.处理选择媒体文件,
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
                  <div class="composer-draft" data-draft-card-id=${draft.localId}>
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
                      <div class="composer-draft-status" data-status=${draft.status}>
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
                      @click=${() => input.移除媒体草稿(draft.localId)}
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
                            @click=${() => input.继续上传媒体草稿(draft.localId)}
                          >
                            继续上传
                          </button>
                          <button
                            type="button"
                            class="composer-draft-remove"
                            data-draft-restart-id=${draft.localId}
                            @click=${() => input.重新上传媒体草稿(draft.localId)}
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
      <form id="shellConsoleForm" class="shell-console-form" @submit=${input.提交操作台}>
        <div id="shellConsoleMainRow" ?inert=${isHiddenMode}>
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
              @input=${(event: Event) => input.处理主输入(event, isMessageMode)}
              @keydown=${(event: KeyboardEvent) => input.处理主输入按键(event, isMessageMode)}
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
