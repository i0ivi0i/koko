import type { 聊天应用快照 } from "./聊天应用内核.js";
import {
  默认消息文本布局环境,
  type 消息文本布局环境,
} from "../房间消息窗/视图.js";

type 聊天附件内容地址表 = 聊天应用快照["media"]["contentUrlByAttachmentId"];

type 聊天壳布局观测回调 = {
  同步房间宽度: (width: number) => void;
  同步操作台输入组宽度: (width: number) => void;
};

export function 按房间宽度派生消息文本布局环境(roomWidth: number): 消息文本布局环境 {
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

export function 附件内容地址表相同(
  left: 聊天附件内容地址表,
  right: 聊天附件内容地址表
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
      leftEntry.thumbnailSrc === rightEntry.thumbnailSrc
    );
  });
}

/**
 * 壳层布局观测器只拥有浏览器几何观察：
 * 1. 房间视图区宽度变化；
 * 2. 操作台输入组宽度变化。
 * 它不裁决业务，不持有聊天快照，只把几何变化翻成壳层回调。
 */
export class 聊天壳布局观测器 {
  private 房间宽度观察目标: HTMLElement | null = null;
  private 房间宽度观察器: ResizeObserver | null = null;
  private 操作台输入组观察目标: HTMLElement | null = null;
  private 操作台输入组观察器: ResizeObserver | null = null;

  constructor(private readonly 回调: 聊天壳布局观测回调) {}

  释放(): void {
    this.清理房间宽度观察();
    this.清理操作台输入组观察();
  }

  读取当前房间宽度(shadowRoot: ShadowRoot | null): number {
    const roomView =
      (this.房间宽度观察目标 ??
        ((shadowRoot?.querySelector("#roomView") as HTMLElement | null) ?? null));
    return roomView?.clientWidth || globalThis.innerWidth || 1024;
  }

  同步消息文本布局环境(shadowRoot: ShadowRoot | null): void {
    this.回调.同步房间宽度(this.读取当前房间宽度(shadowRoot));
  }

  同步房间宽度观察(shadowRoot: ShadowRoot | null): void {
    const roomView = (shadowRoot?.querySelector("#roomView") as HTMLElement | null) ?? null;
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
        this.回调.同步房间宽度(
          entry.contentRect.width || roomView.clientWidth || globalThis.innerWidth || 1024
        );
      });
      this.房间宽度观察器.observe(roomView);
    }
    this.同步消息文本布局环境(shadowRoot);
  }

  同步操作台输入组观察(shadowRoot: ShadowRoot | null): void {
    const inputGroup =
      (shadowRoot?.querySelector("#shellConsoleInputGroup") as HTMLElement | null) ?? null;
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
      this.回调.同步操作台输入组宽度(entry.contentRect.width);
    });
    this.操作台输入组观察器.observe(inputGroup);
  }

  private 清理房间宽度观察(): void {
    this.房间宽度观察器?.disconnect();
    this.房间宽度观察器 = null;
    this.房间宽度观察目标 = null;
  }

  private 清理操作台输入组观察(): void {
    this.操作台输入组观察器?.disconnect();
    this.操作台输入组观察器 = null;
    this.操作台输入组观察目标 = null;
  }
}
