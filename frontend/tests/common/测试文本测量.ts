/**
 * Pretext 在 happy-dom 里需要最小可用的测量上下文。
 * 这里把 shim 独立成单文件，避免聊天测试支架继续承担平台能力初始化职责。
 */
export function 安装测试文本测量画布(): void {
  class 假二维上下文 {
    font = "16px Microsoft YaHei";

    measureText(text: string): { width: number } {
      const px = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "16");
      return { width: text.length * px * 0.58 };
    }
  }

  class 假OffscreenCanvas {
    getContext(kind: string): 假二维上下文 | null {
      if (kind !== "2d") {
        return null;
      }
      return new 假二维上下文();
    }
  }

  Object.defineProperty(globalThis, "OffscreenCanvas", {
    value: 假OffscreenCanvas,
    configurable: true,
    writable: true,
  });
}
