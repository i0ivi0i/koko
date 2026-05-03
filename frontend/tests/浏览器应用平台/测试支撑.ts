import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { 生命周期快照 } from "../../平台/生命周期运行时";
import type { 前端传输端口 } from "../../平台/传输";

export const 读取前端源码 = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)), "utf8");

export const 读取仓库脚本源码 = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url)), "utf8");

export const 仓库内存在 = (relativePath: string): boolean => existsSync(resolve(process.cwd(), relativePath));

export const 创建假传输运行时 = (input: {
  transport?: 前端传输端口;
  接收生命周期变化?: (snapshot: 生命周期快照) => void;
  snapshot?: () => {
    lastLifecycle: 生命周期快照 | null;
    realtimePolicy: {
      intent: "resume" | "suspend";
      reconnection: boolean;
      reason: "active" | "background" | "page_hidden";
    };
  };
} = {}) => {
  const transport =
    input.transport ??
    (({
      marker: "test-transport",
    } as unknown) as 前端传输端口);

  return {
    transport: () => transport,
    聊天房间传输: () => transport,
    聊天实时连接: () => transport,
    媒体传输: () => transport,
    后台查询传输: () => transport,
    后台会话传输: () => transport,
    接收生命周期变化: input.接收生命周期变化 ?? (() => {}),
    snapshot:
      input.snapshot ??
      (() => ({
        lastLifecycle: { visibility: "visible" as const, phase: "active" as const },
        realtimePolicy: {
          intent: "resume" as const,
          reconnection: true,
          reason: "active" as const,
        },
      })),
  };
};
