/**
 * 计算pinned索引 单测（修漏洞 C）
 *
 * 验证虚拟列表 pinned 扫描从 O(N) 降到 O(K)：
 * - 原实现：每次 scroll 都对整个 items 数组 for-of 找 pinned attachment（N=3000 时每帧扫 3000 条）；
 * - 新实现：尾部倒序 + short-circuit（pinned 通常 ≤ 3 个、且都在近期消息内，命中即停）。
 *
 * 测试目标：
 * - 空 pinned 直接返回；
 * - 尾部 pinned 一击即中；
 * - 多 pinned 分散在尾部仍只扫到最远那条；
 * - 不存在的 attachmentId 不抛错；
 * - 跳过非 message kind 项（如未读分隔条）；
 * - 性能契约：N=3000 + pinned 在尾部 1 条，扫描步数 ≪ N。
 */
import { describe, it, expect } from "vitest";
import { 计算pinned索引 } from "../../房间消息窗/壳.js";
import type { 聊天列表展示项, 消息展示项 } from "../../房间消息窗/视图.js";

/**
 * 制造最小可观察的视频消息项 stub。
 * 仅填 `计算pinned索引` 实际读取的字段（kind / attachments[].kind / attachmentId），
 * 不构造真实派生结果，避免本测试与文本布局耦合。
 */
const 制造视频消息项 = (
  id: string,
  attachmentIds: string[]
): 消息展示项 =>
  ({
    kind: "message",
    id,
    attachments: attachmentIds.map((aid) => ({
      kind: "video" as const,
      attachmentId: aid,
      width: 100,
      height: 100,
      layoutX: 0,
      layoutY: 0,
      displayWidth: 100,
      displayHeight: 100,
      posterSrc: null,
    })),
  }) as 消息展示项;

describe("计算pinned索引 - 尾部倒序短路扫描", () => {
  it("空 pinnedAttachmentIds：返回空 Set，不扫描", () => {
    const items: 聊天列表展示项[] = Array.from({ length: 1000 }, (_, i) =>
      制造视频消息项(`m-${i}`, [`a-${i}`])
    );
    const result = 计算pinned索引(items, []);
    expect(result.size).toBe(0);
  });

  it("pinned 在尾部：命中即停（扫描 ≤ pinned 数量）", () => {
    const items: 聊天列表展示项[] = Array.from({ length: 1000 }, (_, i) =>
      制造视频消息项(`m-${i}`, [`a-${i}`])
    );
    const result = 计算pinned索引(items, ["a-999"]);
    expect(result.has(999)).toBe(true);
    expect(result.size).toBe(1);
  });

  it("多 pinned 都在尾部 100 条内", () => {
    const items: 聊天列表展示项[] = Array.from({ length: 1000 }, (_, i) =>
      制造视频消息项(`m-${i}`, [`a-${i}`])
    );
    const result = 计算pinned索引(items, ["a-998", "a-995", "a-990"]);
    expect(result.has(998)).toBe(true);
    expect(result.has(995)).toBe(true);
    expect(result.has(990)).toBe(true);
    expect(result.size).toBe(3);
  });

  it("pinned 包含不存在的 attachmentId：不抛错，返回已找到的", () => {
    const items: 聊天列表展示项[] = Array.from({ length: 100 }, (_, i) =>
      制造视频消息项(`m-${i}`, [`a-${i}`])
    );
    const result = 计算pinned索引(items, ["a-50", "a-不存在"]);
    expect(result.has(50)).toBe(true);
    expect(result.size).toBe(1);
  });

  it("跳过非 message kind 项（如 unread-divider）", () => {
    const items: 聊天列表展示项[] = [
      制造视频消息项("m-1", ["a-1"]),
      { kind: "unread-divider", id: "unread-divider", label: "未读消息" },
      制造视频消息项("m-2", ["a-2"]),
    ];
    const result = 计算pinned索引(items, ["a-1", "a-2"]);
    expect(result.size).toBe(2);
    expect(result.has(0)).toBe(true);
    expect(result.has(2)).toBe(true);
  });

  it("性能契约：N=3000 + pinned 在尾部，扫描步数 ≪ N（< 50）", () => {
    const items: 聊天列表展示项[] = Array.from({ length: 3000 }, (_, i) =>
      制造视频消息项(`m-${i}`, [`a-${i}`])
    );
    /**
     * 用 Proxy 拦截索引访问计数。
     * 注意：除了 items[i] 还会被读 length，所以接受少量额外访问，整体上限 < 50 即满足"远小于 N"。
     */
    let scanCount = 0;
    const itemsProxy = new Proxy(items, {
      get(target, prop) {
        if (typeof prop === "string" && /^\d+$/.test(prop)) {
          scanCount++;
        }
        return Reflect.get(target, prop);
      },
    });
    计算pinned索引(itemsProxy, ["a-2998"]);
    expect(scanCount).toBeLessThan(50);
  });

  it("全部 pinned 不存在：尾部倒序到底，返回空（不抛错）", () => {
    const items: 聊天列表展示项[] = Array.from({ length: 100 }, (_, i) =>
      制造视频消息项(`m-${i}`, [`a-${i}`])
    );
    const result = 计算pinned索引(items, ["全部不存在"]);
    expect(result.size).toBe(0);
  });
});
