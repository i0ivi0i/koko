import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../../平台/存储";
import { createFakeStorage, 假传输 } from "../common/聊天测试支架";
import { 创建聊天应用内核 } from "../../总装/聊天应用内核";
import { 创建内核依赖, 读取媒体编排供测试 } from "../common/聊天应用内核支架";

const 前端根目录允许文件 = [
  ".tsbuildinfo",
  "入口.ts",
  "app-sw.ts",
  "build.mjs",
  "css.d.ts",
  "dev-seeder.d.mts",
  "dev-seeder.mjs",
  "idb-chunk-store.d.ts",
  "index.html",
  "media-sw.ts",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "vitest.config.ts",
  "webtorrent.d.ts",
];

describe("聊天应用内核 - 架构边界与公开入口", () => {
  it("时间线合流不再在聊天应用内核里直接揉 messages 数组，frontend 根目录也只保留白名单文件", () => {
    const source = readFileSync(resolve(process.cwd(), "总装/聊天应用内核.ts"), "utf8");
    const 根目录文件 = readdirSync(resolve(process.cwd()))
      .filter((entry) => statSync(resolve(process.cwd(), entry)).isFile())
      .sort();

    expect(existsSync(resolve(process.cwd(), "聊天应用内核.ts"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "聊天壳.ts"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "总装/聊天应用内核.ts"))).toBe(true);
    expect(existsSync(resolve(process.cwd(), "总装/聊天壳.ts"))).toBe(true);
    expect(根目录文件).toEqual([...前端根目录允许文件].sort());
    expect(source).not.toContain("推进房间时间线(this.时间线状态.messages");
  });

  it("实时编排接线仍只注入端口，不在聊天应用内核里解释控制面失败", () => {
    const source = readFileSync(resolve(process.cwd(), "总装/聊天应用内核.ts"), "utf8");

    expect(source).toContain("创建内核实时编排端口({");
    expect(source).not.toContain("control_result");
    expect(source).not.toContain("need_snapshot_reload");
    expect(source).not.toContain('code: "invalid_session"');
  });

  it("聊天应用内核不再直接依赖完整浏览器应用平台全表面，而是只消费窄平台桥接", () => {
    const source = readFileSync(resolve(process.cwd(), "总装/聊天应用内核.ts"), "utf8");

    expect(source).toContain("创建聊天内核平台桥接(");
    expect(source).toContain("private readonly 平台桥接: 聊天内核平台端口;");
    expect(existsSync(resolve(process.cwd(), "总装/聊天本地状态折叠.ts"))).toBe(true);
    expect(source).toContain('from "./聊天本地状态折叠.js"');
    expect(source).toContain("this.平台桥接.聊天房间传输()");
    expect(source).toContain("this.平台桥接.聊天实时连接()");
    expect(source).toContain("this.平台桥接.媒体传输()");
    expect(source).toContain("this.平台桥接.壳层记忆()");
    expect(source).toContain("const platformSnapshot = this.平台桥接.snapshot()");
    expect(source).toContain("void this.平台桥接.dispatch({");
    expect(source).not.toContain("navigator.serviceWorker");
    expect(source).not.toContain("window.addEventListener");
    expect(source).not.toContain("new BroadcastChannel");
    expect(source).not.toContain("new Notification(");
    expect(source).not.toContain("private readonly platform: 浏览器应用平台");
    expect(source).not.toContain("this.platform.transport.transport()");
    expect(source).not.toContain("投影聊天房间传输端口");
    expect(source).not.toContain("投影聊天实时连接端口");
    expect(source).not.toContain("投影媒体传输端口");
    expect(source).not.toContain("this.platform.storage.壳层记忆()");
    expect(source).not.toContain("this.platform.snapshot()");
    expect(source).not.toContain("private 应用本地状态补丁(");
    expect(source).not.toContain("function 记录有变化字段(");
    expect(source).not.toContain("function 浅比较对象(");
  });

  it("聊天应用内核 会把 realtime recovery read 接线委托给 聊天应用编排桥接", () => {
    const source = readFileSync(resolve(process.cwd(), "总装/聊天应用内核.ts"), "utf8");
    const bridgeSource = readFileSync(resolve(process.cwd(), "总装/聊天应用编排桥接.ts"), "utf8");

    expect(source).toContain('from "./聊天应用编排桥接.js"');
    expect(source).toContain('from "../恢复/壳层/房间恢复编排.js"');
    expect(source).toContain('from "../房间/壳层/阅读推进.js"');
    expect(source).toContain("创建内核恢复编排端口({");
    expect(source).toContain("创建内核实时编排端口({");
    expect(source).toContain("创建内核阅读推进编排端口({");
    expect(bridgeSource).toContain('from "../恢复/壳层/房间恢复编排.js"');
    expect(bridgeSource).toContain('from "../房间/壳层/阅读推进.js"');
    expect(source).not.toContain("创建房间恢复编排({");
    expect(source).not.toContain("创建房间实时编排({");
    expect(source).not.toContain("创建阅读推进编排({");
  });

  it("聊天应用内核通过媒体播放会话应用接入媒体 owner，而不是继续直连旧媒体编排入口", () => {
    const source = readFileSync(resolve(process.cwd(), "总装/聊天应用内核.ts"), "utf8");

    expect(source).toContain('from "../媒体/播放会话/应用.js"');
    expect(source).toContain("创建媒体播放会话应用(");
    expect(source).not.toContain('from "./聊天媒体编排.js"');
  });

  it("滚动观察命令不再把 DOM 容器穿过运行时和聊天内核", () => {
    const kernelSource = readFileSync(resolve(process.cwd(), "总装/聊天应用内核.ts"), "utf8");
    const runtimeSource = readFileSync(resolve(process.cwd(), "平台/应用运行时.ts"), "utf8");
    const shellSource = readFileSync(resolve(process.cwd(), "总装/聊天壳.ts"), "utf8");

    expect(existsSync(resolve(process.cwd(), "应用运行时.ts"))).toBe(false);
    expect(kernelSource).not.toContain('type: "ROOM_SCROLL_OBSERVED"; scrollContainer: HTMLElement');
    expect(kernelSource).not.toContain("处理聊天视口滚动(scrollContainer: HTMLElement): void");
    expect(runtimeSource).not.toContain('type: "ROOM_SCROLL_OBSERVED"; scrollContainer: HTMLElement');
    expect(shellSource).not.toContain("detail.scrollContainer");
  });

  it("进房与输入框命令不再在聊天应用内核里内联裁剪和草稿清理逻辑", () => {
    const source = readFileSync(resolve(process.cwd(), "总装/聊天应用内核.ts"), "utf8");

    expect(source).toContain('from "../房间/应用.js"');
    expect(source).toContain('from "../输入框/应用.js"');
    expect(source).toContain("处理房间号输入变更(");
    expect(source).toContain("处理进房请求(");
    expect(source).toContain("处理历史房间进房请求(");
    expect(source).toContain("处理消息输入变更(");
    expect(source).toContain("处理发送消息请求(");
    expect(source).not.toContain("const trimmedRoomCode = command.roomCode.trim();");
    expect(source).not.toContain("const currentDrafts = this.输入状态.composerMediaDrafts;");
    expect(source).not.toContain("const hasReadyDraft = currentDrafts.some");
    expect(source).not.toContain("const hasBlockingDraft = currentDrafts.some");
  });

  it("聊天应用编排桥接会把平台依赖裁成窄平台桥接，而不是偷拿聊天业务真相", () => {
    const source = readFileSync(resolve(process.cwd(), "总装/聊天应用编排桥接.ts"), "utf8");

    expect(existsSync(resolve(process.cwd(), "聊天应用编排桥接.ts"))).toBe(false);
    expect(source).toContain("export interface 聊天内核平台端口");
    expect(source).toContain("export function 创建聊天内核平台桥接(");
    expect(source).toContain("聊天房间传输()");
    expect(source).toContain("壳层记忆()");
    expect(source).not.toContain("BOOTSTRAP_REQUESTED");
    expect(source).not.toContain("MESSAGE_INPUT_CHANGED");
    expect(source).not.toContain("SEND_MESSAGE_REQUESTED");
  });

  it("恢复编排撤销阅读节流时会区分补锚 flush 与跟随采样，不再都降成 dispose", () => {
    const kernelSource = readFileSync(resolve(process.cwd(), "总装/聊天应用内核.ts"), "utf8");
    const bridgeSource = readFileSync(resolve(process.cwd(), "总装/聊天应用编排桥接.ts"), "utf8");

    expect(kernelSource).toContain("取消待刷新已读锚点: () => this.阅读推进编排端口.取消待刷新已读锚点()");
    expect(kernelSource).toContain(
      "取消待跟随最新采样: () => this.阅读推进编排端口.取消待跟随最新采样()"
    );
    expect(bridgeSource).toContain("cancelPendingReadAnchorFlush: deps.取消待刷新已读锚点");
    expect(bridgeSource).toContain("cancelPendingFollowLatestReadSample: deps.取消待跟随最新采样");
    expect(kernelSource).not.toContain("cancelPendingReadAnchorFlush: () => this.阅读推进编排端口.dispose()");
    expect(kernelSource).not.toContain(
      "cancelPendingFollowLatestReadSample: () => this.阅读推进编排端口.dispose()"
    );
  });

  it("不再暴露 transportPort / replaceSnapshot 这类兼容旧壳层的旁路入口", () => {
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });

    expect(typeof kernel.snapshot).toBe("function");
    expect(typeof kernel.dispatch).toBe("function");
    expect(typeof kernel.dispose).toBe("function");
    expect("transportPort" in kernel).toBe(false);
    expect("roomScrollerPort" in kernel).toBe(false);
    expect("recoveryPort" in kernel).toBe(false);
    expect("readPort" in kernel).toBe(false);
    expect("replaceSnapshot" in kernel).toBe(false);
    expect("readRecoveryPrimeFlag" in kernel).toBe(false);
    expect("writeRecoveryPrimeFlag" in kernel).toBe(false);
  });

  it("只通过 dispatch / snapshot 暴露聊天业务入口，壳层不再自己拼 join/send/leave 过程", async () => {
    const transport = new 假传输();
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport,
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });

    const snapshot = kernel.snapshot();

    expect(transport.joinCalls).toEqual([{ sessionId: "s-test", roomCode: "ROOM01" }]);
    expect(snapshot.roomId).toBe("r-test");
    expect(snapshot.roomDisplayTitle).toBe("ROOM01");
  });

  it("发送命令也通过内核 dispatch 统一进入，而不是壳层自己保留 sendCurrentMessage 业务入口", async () => {
    const transport = new 假传输();
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport,
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await kernel.dispatch({ type: "MESSAGE_INPUT_CHANGED", value: "hello kernel" });
    await kernel.dispatch({ type: "SEND_MESSAGE_REQUESTED" });

    expect(
      transport.socket.sentEvents.some(
        ({ event, payload }) => event === "create_message" && payload.text === "hello kernel"
      )
    ).toBe(true);
  });

  it("壳层媒体动作也只通过 dispatch 进入内核，不再直接摸媒体编排对象", async () => {
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    const imageFile = new File([new Uint8Array([1, 2, 3])], "picked.jpg", {
      type: "image/jpeg",
    });
    const fake媒体发布器 = {
      处理选择媒体文件: vi.fn().mockResolvedValue(undefined),
      移除草稿: vi.fn(),
      继续上传草稿: vi.fn().mockResolvedValue(undefined),
      重新上传草稿: vi.fn().mockResolvedValue(undefined),
      清空: vi.fn(),
      销毁: vi.fn(),
    };
    const fake查看器 = {
      打开: vi.fn(),
      销毁: vi.fn(),
    };

    读取媒体编排供测试(kernel).设置媒体发布器供测试(fake媒体发布器);
    读取媒体编排供测试(kernel).设置媒体查看器供测试(fake查看器);

    await kernel.dispatch({ type: "MEDIA_FILES_SELECTED", files: [imageFile] });
    await kernel.dispatch({ type: "MEDIA_DRAFT_RESUME_REQUESTED", localId: "draft-1" });
    await kernel.dispatch({ type: "MEDIA_DRAFT_RESTART_REQUESTED", localId: "draft-3" });
    await kernel.dispatch({ type: "MEDIA_DRAFT_REMOVE_REQUESTED", localId: "draft-2" });
    await kernel.dispatch({
      type: "MEDIA_OPEN_REQUESTED",
      request: {
        startAttachmentId: "att-1",
        items: [],
      },
    });

    expect(fake媒体发布器.处理选择媒体文件).toHaveBeenCalledWith([imageFile]);
    expect(fake媒体发布器.继续上传草稿).toHaveBeenCalledWith("draft-1");
    expect(fake媒体发布器.重新上传草稿).toHaveBeenCalledWith("draft-3");
    expect(fake媒体发布器.移除草稿).toHaveBeenCalledWith("draft-2");
    expect(fake查看器.打开).toHaveBeenCalledWith({
      startAttachmentId: "att-1",
      items: [],
    });
  });

  it("打开正式查看器时只登记一次 media_viewer_open 程序滚动来源", async () => {
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    const 滚动器 = (
      kernel as unknown as {
        读取房间滚动器供测试(): {
          登记程序滚动来源(source: "media_viewer_open"): void;
        };
      }
    ).读取房间滚动器供测试();
    const 登记程序滚动来源 = vi.spyOn(滚动器, "登记程序滚动来源");
    const 打开查看器 = vi.fn();

    读取媒体编排供测试(kernel).设置媒体查看器供测试({
      打开: 打开查看器,
      销毁: vi.fn(),
    });

    await kernel.dispatch({
      type: "MEDIA_OPEN_REQUESTED",
      request: {
        startAttachmentId: "att-1",
        items: [],
      },
    });

    expect(打开查看器).toHaveBeenCalledTimes(1);
    expect(登记程序滚动来源).toHaveBeenCalledTimes(1);
    expect(登记程序滚动来源).toHaveBeenCalledWith("media_viewer_open");
  });

  it("壳层媒体失败草稿的新双动作也必须只通过 dispatch 进入内核", async () => {
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    const fake媒体发布器 = {
      处理选择媒体文件: vi.fn().mockResolvedValue(undefined),
      移除草稿: vi.fn(),
      继续上传草稿: vi.fn().mockResolvedValue(undefined),
      重新上传草稿: vi.fn().mockResolvedValue(undefined),
      清空: vi.fn(),
      销毁: vi.fn(),
    };

    读取媒体编排供测试(kernel).设置媒体发布器供测试(fake媒体发布器);

    await kernel.dispatch({
      type: "MEDIA_DRAFT_RESUME_REQUESTED",
      localId: "draft-resume",
    } as never);
    await kernel.dispatch({
      type: "MEDIA_DRAFT_RESTART_REQUESTED",
      localId: "draft-restart",
    } as never);

    expect(fake媒体发布器.继续上传草稿).toHaveBeenCalledWith("draft-resume");
    expect(fake媒体发布器.重新上传草稿).toHaveBeenCalledWith("draft-restart");
  });
});
