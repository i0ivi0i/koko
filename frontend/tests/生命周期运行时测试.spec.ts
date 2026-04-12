import { describe, expect, it } from "vitest";
import { 创建生命周期运行时 } from "../平台/生命周期运行时";

type 假事件处理器 = (event?: Event) => void;

class 假事件源 {
  private readonly handlers = new Map<string, 假事件处理器[]>();

  addEventListener(type: string, handler: 假事件处理器): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  触发(type: string): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(new Event(type));
    }
  }
}

describe("生命周期运行时", () => {
  it("会把浏览器可见性和页面阶段翻译成稳定快照", () => {
    const windowSource = new 假事件源();
    const documentSource = Object.assign(new 假事件源(), {
      visibilityState: "visible" as DocumentVisibilityState,
    });

    const runtime = 创建生命周期运行时({
      window: windowSource as unknown as Window,
      document: documentSource as unknown as Document,
    });

    expect(runtime.snapshot()).toEqual({
      visibility: "visible",
      phase: "active",
    });

    documentSource.visibilityState = "hidden";
    documentSource.触发("visibilitychange");
    expect(runtime.snapshot()).toEqual({
      visibility: "hidden",
      phase: "background",
    });

    windowSource.触发("pagehide");
    expect(runtime.snapshot()).toEqual({
      visibility: "hidden",
      phase: "page_hidden",
    });
  });

  it("会把后续生命周期变化推送给订阅者，让平台层可以只消费浏览器运行时事实", () => {
    const windowSource = new 假事件源();
    const documentSource = Object.assign(new 假事件源(), {
      visibilityState: "visible" as DocumentVisibilityState,
    });

    const runtime = 创建生命周期运行时({
      window: windowSource as unknown as Window,
      document: documentSource as unknown as Document,
    });
    const snapshots: Array<{ visibility: string; phase: string }> = [];

    runtime.订阅((snapshot) => {
      snapshots.push(snapshot);
    });

    documentSource.visibilityState = "hidden";
    documentSource.触发("visibilitychange");
    windowSource.触发("resume");

    expect(snapshots).toEqual([
      {
        visibility: "hidden",
        phase: "background",
      },
      {
        visibility: "hidden",
        phase: "resumed",
      },
    ]);
  });
});
