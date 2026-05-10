import { existsSync,readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach,describe,expect,it,vi } from "vitest";

const { ioSpy } = vi.hoisted(() => ({
  ioSpy: vi.fn(() => ({}) as never),
}));

vi.mock("socket.io-client", () => ({
  io: ioSpy,
}));
const 读取平台传输Owner源码 = () =>
  readFileSync(resolve(process.cwd(), "平台/传输.ts"), "utf8");

describe("传输 / 组合根与边界", () => {
  beforeEach(() => {
    ioSpy.mockClear();
    vi.restoreAllMocks();
  });

  it("平台传输 owner 已经成为唯一入口，旧根入口已删除", () => {
    const ownerSource = 读取平台传输Owner源码();

    expect(existsSync(resolve(process.cwd(), "传输.ts"))).toBe(false);
    expect(ownerSource).toContain("export function 创建前端传输(");
  });
  it("前端传输组合根 会把 socket 生命周期与运行时策略委托给 实时连接适配", () => {
    const source = 读取平台传输Owner源码();

    expect(source).toContain('from "../聊天实时/适配/实时连接适配.js"');
    expect(source).toContain("const 实时连接 = new 实时连接适配(baseUrl);");
    expect(source).toContain("实时连接.createSocket(sessionId, powToken)");
    expect(source).toContain("实时连接.接收运行时策略(policy);");
    expect(source).toContain("读取运行时策略: () => 实时连接.读取运行时策略(),");
    expect(source).toContain("实时连接.释放Socket(socket);");
    expect(source).not.toContain("private 当前运行时策略");
    expect(source).not.toContain("private readonly 活跃Socket表");
  });
  it("前端传输组合根 会把房间主链 HTTP 调用委托给 房间HTTP接口", () => {
    const source = 读取平台传输Owner源码();

    expect(source).toContain('from "../聊天恢复/适配/房间HTTP接口.js"');
    expect(source).toContain("const 房间传输 = 创建房间HTTP接口({");
    expect(source).toContain("...房间传输,");
  });
  it("前端传输组合根 会把 media 与 admin HTTP 适配拆回各自接口，只保留组合根职责", () => {
    const source = 读取平台传输Owner源码();

    expect(source).toContain('from "../媒体/适配/媒体HTTP接口.js"');
    expect(source).toContain('from "../后台/适配/后台HTTP接口.js"');
    expect(source).toContain("const 媒体传输 = new 媒体HTTP接口({");
    expect(source).toContain("const 后台传输 = new 后台HTTP接口({");
    expect(source).toContain("媒体传输.prepareMediaUpload(kind, sessionId, file, sourceHash)");
    expect(source).toContain("媒体传输.reuseMediaBySourceHash(kind, input)");
    expect(source).toContain("媒体传输.forwardMediaAttachment(kind, input)");
    expect(source).toContain("媒体传输.abandonMediaUpload(sessionId, attachmentId)");
    expect(source).toContain("媒体传输.completeMediaUpload(sessionId, attachmentId)");
    expect(source).toContain("媒体传输.loadMediaLocator(sessionId, attachmentId, signal)");
    expect(source).toContain("后台传输.loadAdminOverview(token)");
    expect(source).toContain("后台传输.adminLogin(username, password)");
    expect(source).toContain("后台传输.adminRooms(token)");
    expect(source).toContain("后台传输.adminRoomDetail(token, roomId)");
    expect(source).not.toContain("private 解析流媒体资产(");
    expect(source).not.toContain("private 解析Blob媒体资产(");
  });
  it("平台传输 owner 改成工厂组合，不再维持巨型 class 热点", () => {
    const source = 读取平台传输Owner源码();

    expect(source).toContain("export function 创建前端传输(");
    expect(source).not.toContain("export class HttpRealtime传输");
  });
  it("前端传输组合根 会把聊天房间/realtime/media/admin 显式投影成窄接口，而不是让所有调用者都抱住巨型端口", () => {
    const source = 读取平台传输Owner源码();

    expect(source).toContain('from "../聊天共享/适配/聊天房间传输端口.js"');
    expect(source).toContain('from "../聊天共享/适配/聊天实时连接端口.js"');
    expect(source).toContain("export interface 媒体传输端口");
    expect(source).toContain("export interface 后台查询传输端口");
    expect(source).toContain("export interface 后台会话传输端口");
    expect(source).not.toContain("export const 投影聊天房间传输端口");
    expect(source).not.toContain("export const 投影聊天实时连接端口");
    expect(source).not.toContain("export const 投影媒体传输端口");
    expect(source).not.toContain("export const 投影后台查询传输端口");
    expect(source).not.toContain("export const 投影后台会话传输端口");
  });
  it("聊天 realtime / 房间恢复 / 后台 admin / 媒体定位 当前已经只消费各自需要的 transport 子表面", () => {
    const realtimeSource = readFileSync(resolve(process.cwd(), "实时/应用.ts"), "utf8");
    const recoverySource = readFileSync(resolve(process.cwd(), "恢复/壳层/房间恢复编排.ts"), "utf8");
    const readSource = readFileSync(resolve(process.cwd(), "房间/壳层/阅读推进.ts"), "utf8");
    const mediaSource = readFileSync(resolve(process.cwd(), "媒体/播放会话/应用.ts"), "utf8");
    const mediaDraftSource = readFileSync(resolve(process.cwd(), "媒体/播放会话/草稿发布.ts"), "utf8");
    const adminQuerySource = readFileSync(resolve(process.cwd(), "后台/查询编排.ts"), "utf8");
    const adminSessionSource = readFileSync(resolve(process.cwd(), "后台/会话编排.ts"), "utf8");

    expect(realtimeSource).toContain("deps.transport.createSocket(sessionId, powToken)");
    expect(realtimeSource).toContain("deps.transport.释放Socket?.(realtimeSocket);");
    expect(realtimeSource).not.toContain("deps.transport.loadRoomSnapshot");
    expect(realtimeSource).not.toContain("deps.transport.adminLogin");

    expect(recoverySource).toContain("deps.transport.bootstrapAnonymousIdentity(deviceAnonymousToken)");
    expect(recoverySource).toContain("deps.transport.joinOrCreateRoom(sessionId, roomCode)");
    expect(recoverySource).toContain("deps.transport.loadRoomSnapshot(roomId, sessionId)");
    expect(recoverySource).not.toContain("deps.transport.adminRooms");
    expect(recoverySource).not.toContain("deps.transport.prepareMediaUpload");

    expect(readSource).toContain(
      "deps.transport.updateRoomReadAnchor(state.roomId, state.sessionId, nextPosition)"
    );
    // Task 3 把 loadRoomHistory 调用拆成多行 + 把 55 / oldestMessage.event_position 提为局部变量,
    // 这里改为只断言"调用了正确传输方法 + 仍然消费分页大小常量"这两个边界事实。
    expect(readSource).toContain("deps.transport.loadRoomHistory(");
    expect(readSource).toContain("历史分页默认页大小 = 55");
    expect(readSource).not.toContain("deps.transport.createSocket");

    expect(mediaSource).toContain("deps.transport().loadMediaLocator(sessionId, attachmentId, signal)");
    expect(mediaSource).toContain("deps.transport().forwardMediaAttachment(kind, input)");
    expect(mediaSource).toContain("deps.transport().buildAttachmentContentUrl(");
    expect(mediaDraftSource).toContain("deps.transport().prepareMediaUpload(kind, sessionId, file, sourceHash)");
    expect(mediaDraftSource).toContain("deps.transport().reuseMediaBySourceHash(kind, input)");
    expect(mediaSource).not.toContain("deps.transport().adminLogin");
    expect(mediaSource).not.toContain("deps.transport().joinOrCreateRoom");

    expect(adminQuerySource).toContain("transport.loadAdminOverview(token)");
    expect(adminQuerySource).toContain("transport.adminRooms(token)");
    expect(adminQuerySource).toContain("transport.adminRoomDetail(token, roomId)");
    expect(adminQuerySource).not.toContain("transport.loadRoomSnapshot");

    expect(adminSessionSource).toContain("transport.adminLogin(state.username, state.password)");
    expect(adminSessionSource).not.toContain("transport.loadAdminOverview");
  });
});
