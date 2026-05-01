import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const 读取前端源码 = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("前端共享契约门面", () => {
  it("根文件退成聊天共享契约门面，关键生产模块直连新 owner", () => {
    const facadeSource = 读取前端源码("契约.ts");
    const ownerSource = 读取前端源码("聊天共享/契约.ts");
    const stateSource = 读取前端源码("状态.ts");
    const messagePaneViewSource = 读取前端源码("房间消息窗/视图.ts");
    const transportSource = 读取前端源码("平台/传输.ts");
    const recoverySource = 读取前端源码("恢复/应用.ts");
    const fitnessSource = 读取前端源码("../scripts/check-frontend-architecture-fitness.mjs");

    expect(facadeSource).toContain('export * from "./聊天共享/契约.js"');
    expect(facadeSource).not.toContain("export interface 消息事件 {");
    expect(facadeSource).not.toContain("export interface 房间快照 {");

    expect(ownerSource).toContain("export interface 消息事件 {");
    expect(ownerSource).toContain("export interface 房间快照 {");
    expect(ownerSource).toContain("export interface 媒体定位结果 {");

    expect(stateSource).toContain('from "./聊天共享/契约.js"');
    expect(stateSource).not.toContain('from "./契约.js"');
    expect(messagePaneViewSource).toContain('from "../聊天共享/契约.js"');
    expect(messagePaneViewSource).not.toContain('from "../契约.js"');
    expect(transportSource).toContain('from "../聊天共享/契约.js"');
    expect(transportSource).not.toContain('from "../契约.js"');
    expect(recoverySource).toContain('from "../聊天共享/契约.js"');
    expect(recoverySource).not.toContain('from "../契约.js"');

    expect(fitnessSource).toContain('path: "frontend/契约.ts"');
    expect(fitnessSource).toContain('ownerPath: "frontend/聊天共享/契约.ts"');
  });
});
