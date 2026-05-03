import { expect } from "vitest";
import "../../总装/聊天壳";
import type { 媒体附件草稿 as 图片附件草稿 } from "../../媒体/媒体草稿";
import type { 媒体查看器打开请求, 媒体播放结果 } from "../../媒体/index.js";
import { 聊天壳 } from "../../总装/聊天壳";
import type { 聊天状态 } from "../../总装/聊天状态";
import { 假传输 } from "./假传输.js";
import { 安装测试文本测量画布 } from "./测试文本测量.js";

安装测试文本测量画布();

type 聊天壳测试内核 = {
  snapshot(): 聊天状态;
  写入视口调试状态供测试(
    patch: Partial<
      Pick<
        聊天状态,
        | "lastReadEventPosition"
        | "firstUnreadEventPosition"
        | "initialUnreadSettled"
        | "scrollPhase"
        | "hasUserScrollIntent"
        | "pendingReadAnchorPosition"
        | "historyLoadThrottleUntil"
        | "viewportMode"
      >
    >
  ): void;
  读取房间滚动器供测试(): unknown;
};

type 聊天媒体测试端口 = {
  设置媒体播放器供测试(player: {
    解析播放结果(input: {
      attachmentId: string;
      kind: "image" | "video";
      surface?: "viewer" | "inline_autoplay";
      consumerId?: string;
    }): Promise<媒体播放结果>;
    释放附件播放资源?(input: {
      attachmentId: string;
      consumerId?: string;
      丢弃未完成补齐?: boolean;
    }): void;
  }): void;
  设置媒体查看器供测试(viewer: {
    打开(input: 媒体查看器打开请求): void;
    同步?(input: 媒体查看器打开请求): void;
    销毁(): void;
  }): void;
  设置媒体发布器供测试(publisher: {
    处理选择媒体文件(files: Iterable<File>): Promise<void>;
    移除草稿(localId: string): void;
    继续上传草稿(localId: string): Promise<void>;
    重新上传草稿(localId: string): Promise<void>;
    清空(): void;
    销毁(): void;
  }): void;
  写入媒体草稿列表供测试(drafts: 图片附件草稿[]): void;
};

function 读取聊天壳测试内核(el: 聊天壳): 聊天壳测试内核 {
  return (el as unknown as { kernel: 聊天壳测试内核 }).kernel;
}

/**
 * 测试替身只注入到“媒体编排”这一层。
 * 正式壳层和内核表面不再暴露这些 setter，避免测试缝重新长回生产入口。
 */
function 读取聊天媒体编排供测试(el: 聊天壳): 聊天媒体测试端口 {
  return (读取聊天壳测试内核(el) as unknown as { 媒体编排: 聊天媒体测试端口 }).媒体编排;
}

export async function 等待组件稳定(el: 聊天壳): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

/**
 * 绝大多数聊天壳集成都先需要一个“已经入房”的壳。
 * 这里把重复的 DOM 挂载、假传输注入、进房动作收口成一个测试辅助器，
 * 避免每个 spec 自己再拼一遍样板流程。
 */
export async function 创建已入房聊天壳(
  transport = new 假传输(),
  roomCode = "ROOM01"
): Promise<聊天壳> {
  const el = document.createElement("koko-chat-shell") as 聊天壳;
  el.setTransportForTest(transport);
  document.body.appendChild(el);
  await 等待组件稳定(el);
  输入房间短码到操作台(el, roomCode);
  读取操作台主动作(el).click();
  await 等待组件稳定(el);
  await 等待组件稳定(el);
  return el;
}

/**
 * 集成测试以后统一从内核快照读状态，不再偷摸壳层私有字段。
 * 这样测试也跟真实分层保持一致：壳层只渲染，真相在内核。
 */
export function 读取聊天快照供测试(el: 聊天壳): 聊天状态 {
  return 读取聊天壳测试内核(el).snapshot();
}

export function 读取房间滚动器供测试<T = unknown>(el: 聊天壳): T {
  return 读取聊天壳测试内核(el).读取房间滚动器供测试() as T;
}

/**
 * 媒体草稿属于前端本地体验态，测试里不需要真的走上传器。
 * 这里直接注入草稿，只为了锁住 presenter 和渲染结果，
 * 不把测试耦合到 Uppy 的内部事件细节。
 */
export function 注入媒体草稿(el: 聊天壳, draft: 图片附件草稿): void {
  const 当前草稿 =
    (读取聊天壳测试内核(el) as unknown as {
      snapshot(): 聊天状态 & { composerMediaDrafts?: 图片附件草稿[] };
    }).snapshot?.().composerMediaDrafts ?? [];
  读取聊天媒体编排供测试(el).写入媒体草稿列表供测试([
    ...当前草稿.filter((item) => item.localId !== draft.localId),
    draft,
  ]);
}

export function 注入图片草稿(el: 聊天壳, draft: 图片附件草稿): void {
  注入媒体草稿(el, draft);
}

export function 注入媒体播放器供测试(
  el: 聊天壳,
  player: {
    解析播放结果(input: {
      attachmentId: string;
      kind: "image" | "video";
      surface?: "viewer" | "inline_autoplay";
      consumerId?: string;
    }): Promise<媒体播放结果>;
    释放附件播放资源?(input: {
      attachmentId: string;
      consumerId?: string;
      丢弃未完成补齐?: boolean;
    }): void;
  }
): void {
  读取聊天媒体编排供测试(el).设置媒体播放器供测试(player);
}

export function 注入媒体查看器供测试(
  el: 聊天壳,
  viewer: {
    打开(input: 媒体查看器打开请求): void;
    同步?(input: 媒体查看器打开请求): void;
    销毁(): void;
  }
): void {
  读取聊天媒体编排供测试(el).设置媒体查看器供测试(viewer);
}

export function 注入媒体发布器供测试(
  el: 聊天壳,
  publisher: {
    处理选择媒体文件(files: Iterable<File>): Promise<void>;
    移除草稿(localId: string): void;
    继续上传草稿(localId: string): Promise<void>;
    重新上传草稿(localId: string): Promise<void>;
    清空(): void;
    销毁(): void;
  }
): void {
  读取聊天媒体编排供测试(el).设置媒体发布器供测试(publisher);
}

export function 读取操作台主输入(el: 聊天壳): HTMLTextAreaElement | HTMLInputElement {
  const input = el.shadowRoot!.querySelector(
    "#shellConsolePrimaryInput"
  ) as HTMLTextAreaElement | HTMLInputElement | null;
  expect(input).not.toBeNull();
  return input!;
}

export function 读取操作台主动作(el: 聊天壳): HTMLButtonElement {
  const action = el.shadowRoot!.querySelector(
    "#shellConsolePrimaryAction"
  ) as HTMLButtonElement | null;
  expect(action).not.toBeNull();
  return action!;
}

export function 读取操作台表单(el: 聊天壳): HTMLFormElement {
  const form = el.shadowRoot!.querySelector("#shellConsoleForm") as HTMLFormElement | null;
  expect(form).not.toBeNull();
  return form!;
}

export function 读取附件入口按钮(el: 聊天壳): HTMLButtonElement {
  const button = el.shadowRoot!.querySelector(
    "#composerMediaPickerBtn"
  ) as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  return button!;
}

export function 读取统一媒体文件输入(el: 聊天壳): HTMLInputElement {
  const input = el.shadowRoot!.querySelector(
    "#composerMediaFileInput"
  ) as HTMLInputElement | null;
  expect(input).not.toBeNull();
  return input!;
}

export function 输入房间短码到操作台(el: 聊天壳, roomCode: string): void {
  const input = 读取操作台主输入(el);
  input.value = roomCode;
  input.dispatchEvent(new Event("input"));
}

export function 输入消息到操作台(el: 聊天壳, message: string): void {
  const input = 读取操作台主输入(el);
  input.value = message;
  input.dispatchEvent(new Event("input"));
}

export function 设置测试滚动阶段(
  el: 聊天壳,
  patch: {
    lastReadEventPosition?: number | null;
    initialUnreadSettled?: boolean;
    firstUnreadEventPosition?: number | null;
    scrollPhase?: 聊天状态["scrollPhase"];
    hasUserScrollIntent?: boolean;
    pendingReadAnchorPosition?: number | null;
    historyLoadThrottleUntil?: number;
    viewportMode?: 聊天状态["viewportMode"];
  }
): void {
  读取聊天壳测试内核(el).写入视口调试状态供测试(patch);
}

export function 模拟用户滚动意图(scroll: HTMLElement): void {
  scroll.dispatchEvent(new Event("pointerdown"));
}

export function 模拟消息滚动视口(
  el: 聊天壳,
  scroll: HTMLElement,
  rows: Array<{ eventPosition: number; top: number; bottom: number }>
): void {
  const byPosition = new Map(rows.map((row) => [row.eventPosition, row]));
  Object.defineProperty(scroll, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 320,
      bottom: 300,
      width: 320,
      height: 300,
      toJSON: () => ({}),
    }),
  });
  const elements = Array.from(
    el.shadowRoot!.querySelectorAll("[data-event-position]")
  ) as HTMLElement[];
  for (const element of elements) {
    const eventPosition = Number(element.dataset.eventPosition);
    const row = byPosition.get(eventPosition) ?? {
      eventPosition,
      top: 1000 + eventPosition * 10,
      bottom: 1040 + eventPosition * 10,
    };
    Object.defineProperty(element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: row.top,
        top: row.top,
        left: 0,
        right: 320,
        bottom: row.bottom,
        width: 320,
        height: row.bottom - row.top,
        toJSON: () => ({}),
      }),
    });
  }
}
