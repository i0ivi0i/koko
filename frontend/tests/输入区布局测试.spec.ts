// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeStorage,
  假传输,
  创建房间快照,
  等待组件稳定,
  读取操作台主输入,
  读取操作台主动作,
  输入房间短码到操作台,
  输入消息到操作台,
} from "./common/聊天测试支架";
import { 聊天壳 } from "../聊天壳";

describe("聊天壳集成 / 输入区布局", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: createFakeStorage(),
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("图片辅助按钮是紧凑图标按钮，不再保留图片文案的宽按钮约束", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain(".composer-aux-button");
    expect(styles).not.toContain("min-width: 68px");
  });

  it("消息模式会把主输入切成多行 textarea，并按 Pretext 结果增长高度", async () => {
    const transport = new 假传输();
    transport.joinQueue = [创建房间快照("r-test", 1)];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const 输入框 = 读取操作台主输入(el);
    expect(输入框.tagName).toBe("TEXTAREA");
    const 初始高度 = Number.parseFloat((输入框 as HTMLTextAreaElement).style.height || "0");

    输入消息到操作台(
      el,
      "这是一段需要自动换行的长消息，用来确认输入区高度会随着 Pretext 的布局结果继续增长，而不是永远卡在单行。"
    );
    await 等待组件稳定(el);

    const 更新后高度 = Number.parseFloat(
      ((读取操作台主输入(el) as HTMLTextAreaElement).style.height || "0")
    );

    expect(更新后高度).toBeGreaterThan(初始高度);
    el.remove();
  });

  it("消息模式按 Enter 会直接发送，而不是像普通 textarea 一样吞掉提交", async () => {
    const transport = new 假传输();
    transport.joinQueue = [创建房间快照("r-test", 1)];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    输入消息到操作台(el, "hello");
    读取操作台主输入(el).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("#messageList")?.textContent).toContain("hello");
    el.remove();
  });

  it("消息模式按 Shift+Enter 不会误发送", async () => {
    const transport = new 假传输();
    transport.joinQueue = [创建房间快照("r-test", 1)];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    输入消息到操作台(el, "hello");
    读取操作台主输入(el).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })
    );
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("#messageList")?.textContent ?? "").not.toContain("hello");
    el.remove();
  });
});
