import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { 创建存储运行时 } from "../../平台/存储运行时";
import { 读取前端源码, 读取仓库脚本源码 } from "./测试支撑";

describe("浏览器端应用平台化基线 / 架构边界与门禁", () => {
  it("聊天壳会把业务入口收进总装入口，自身只保留 view + bridge", () => {
    const source = 读取前端源码("总装/聊天壳.ts");

    expect(source).toContain('from "./应用装配.js"');
    expect(source).toContain("private readonly 装配 = 创建聊天壳应用装配(");
    expect(source).toContain("private get kernel()");
    expect(source).toContain("return this.装配.kernel;");
    expect(source).not.toContain("private transport:");
    expect(source).not.toContain("private storage:");
    expect(source).not.toContain("private roomKernel =");
    expect(source).not.toContain("private _恢复编排端口");
    expect(source).not.toContain("private _实时编排端口");
    expect(source).not.toContain("private _阅读推进编排端口");
    expect(source).not.toContain("private roomShellState()");
    expect(source).not.toContain("private joinHistoryRoom(");
    expect(source).not.toContain("private leaveCurrentRoomView(");
    expect(source).not.toContain("private sendCurrentMessage(");
    expect(source).not.toContain("private get chatState()");
    expect(source).not.toContain("private set chatState(");
    expect(source).not.toContain("get roomScroller()");
    expect(source).not.toContain("get 恢复编排端口()");
    expect(source).not.toContain("get 阅读推进编排端口()");
    expect(source).not.toContain("get shouldPrimeReadAnchorAfterInitialSettle()");
    expect(source).not.toContain("set shouldPrimeReadAnchorAfterInitialSettle(");
    expect(source).not.toContain("this.kernel.transportPort()");
    expect(source).not.toContain("this.kernel.roomScrollerPort()");
    expect(source).not.toContain("this.kernel.recoveryPort()");
    expect(source).not.toContain("this.kernel.readPort()");
    expect(source).not.toContain("this.kernel.replaceSnapshot(");
  });

  it("聊天壳会把布局观测与文本布局派生收进独立中文 owner，而不是继续堆在总装壳文件里", () => {
    const shellSource = 读取前端源码("总装/聊天壳.ts");
    const layoutOwnerSource = 读取前端源码("总装/聊天壳布局协作.ts");

    expect(existsSync(resolve(process.cwd(), "总装/聊天壳布局协作.ts"))).toBe(true);
    expect(shellSource).toContain('from "./聊天壳布局协作.js"');
    expect(layoutOwnerSource).toContain("export class 聊天壳布局观测器");
    expect(layoutOwnerSource).toContain("export function 按房间宽度派生消息文本布局环境");
    expect(shellSource).not.toContain("function 按房间宽度派生消息文本布局环境");
    expect(shellSource).not.toContain("function 附件内容地址表相同");
    expect(shellSource).not.toContain("private 同步房间宽度观察(): void");
    expect(shellSource).not.toContain("private 同步操作台输入组观察(): void");
    expect(shellSource).not.toContain("private 清理房间宽度观察(): void");
    expect(shellSource).not.toContain("private 清理操作台输入组观察(): void");
    expect(shellSource).not.toContain("private 读取当前房间宽度(): number");
  });

  it("聊天壳会把操作台模板与输入高度推导收进独立视图 owner，而不是继续塞在壳组件类里", () => {
    const shellSource = 读取前端源码("总装/聊天壳.ts");
    const consoleViewSource = 读取前端源码("总装/聊天壳操作台视图.ts");

    expect(existsSync(resolve(process.cwd(), "总装/聊天壳操作台视图.ts"))).toBe(true);
    expect(shellSource).toContain('from "./聊天壳操作台视图.js"');
    expect(shellSource).toContain("渲染聊天壳操作台({");
    expect(consoleViewSource).toContain("export function 渲染聊天壳操作台");
    expect(consoleViewSource).toContain("function 读取操作台主输入高度");
    expect(shellSource).not.toContain("private renderShellConsole(");
    expect(shellSource).not.toContain("private 读取操作台主输入高度(");
    expect(shellSource).not.toContain("function 派生媒体草稿失败文案(");
  });

  it("聊天主链编排不再共写一个 shared chatState，而是只消费各自显式 state slice", () => {
    const kernelSource = 读取前端源码("总装/聊天应用内核.ts");
    const recoverySource = 读取前端源码("恢复/壳层/房间恢复编排.ts");
    const realtimeSource = 读取前端源码("实时/应用.ts");
    const readSource = 读取前端源码("房间/壳层/阅读推进.ts");
    const scrollerSource = 读取前端源码("时间线/滚动器.ts");

    expect(kernelSource).not.toContain("private chatState:");
    expect(existsSync(resolve(process.cwd(), "房间实时编排.ts"))).toBe(false);

    expect(recoverySource).not.toContain("读取状态(): 聊天状态");
    expect(recoverySource).not.toContain("更新状态(patch: Partial<聊天状态>)");
    expect(recoverySource).not.toContain("roomShellPatch(): Partial<聊天状态>");

    expect(realtimeSource).not.toContain("读取状态(): 聊天状态");
    expect(realtimeSource).not.toContain("更新状态(patch: Partial<聊天状态>)");
    expect(realtimeSource).not.toContain("roomShellPatch(): Partial<聊天状态>");

    expect(readSource).not.toContain("读取状态(): 聊天状态");
    expect(readSource).not.toContain("更新状态(patch: Partial<聊天状态>)");
    expect(readSource).not.toContain("roomShellPatch(): Partial<聊天状态>");

    expect(scrollerSource).not.toContain("更新状态(patch: Partial<聊天状态>)");
  });

  it("聊天壳当前已把滚动和媒体信号先交给应用运行时，而不是在模板里直接裁决", () => {
    const source = 读取前端源码("总装/聊天壳.ts");

    expect(source).toMatch(/this\.应用运行时\.dispatch\(\{\s*type:\s*"ROOM_SCROLL_INTENT"/);
    expect(source).toMatch(/this\.应用运行时\.dispatch\(\{\s*type:\s*"ROOM_SCROLL_OBSERVED"/);
    expect(source).toMatch(/this\.应用运行时\.dispatch\(\{\s*type:\s*"ROOM_MEDIA_WINDOW_OBSERVED"/);
    expect(source).toMatch(/this\.应用运行时\.dispatch\(\{\s*type:\s*"ROOM_JUMP_TO_LATEST_REQUESTED"/);
    expect(source).toMatch(/this\.应用运行时\.dispatch\(\{\s*type:\s*"MEDIA_OPEN_REQUESTED"/);
    expect(source).toMatch(/this\.应用运行时\.dispatch\(\{\s*type:\s*"MEDIA_SESSION_SIGNALLED"/);
    expect(source).toMatch(
      /this\.应用运行时\.dispatch\(\{\s*type:\s*"MEDIA_INLINE_AUTOPLAY_POSITION_CHANGED"/
    );
    expect(source).toContain(".inlineAutoplayPositionByAttachmentId=");
    expect(source).toContain("this.应用运行时.start()");
    expect(source).toContain("this.装配.销毁()");
    expect(source).not.toContain("this.kernel.处理选择媒体文件(");
    expect(source).not.toContain("this.kernel.移除媒体草稿(");
    expect(source).not.toContain("this.kernel.重试媒体草稿(");
  });

  it("聊天壳渲染路径只读快照，不再在模板里直接摸内核 helper 或转发媒体测试 setter", () => {
    const shellSource = 读取前端源码("总装/聊天壳.ts");
    const kernelSource = 读取前端源码("总装/聊天应用内核.ts");
    const swarmSource = 读取前端源码("媒体/媒体协作分发.ts");
    const testHarnessSource = 读取前端源码("tests/common/聊天测试支架.ts");

    expect(shellSource).not.toContain("this.kernel.构建附件内容地址(");
    expect(shellSource).not.toContain("setMediaPlayerForTest(");
    expect(shellSource).not.toContain("setMediaViewerForTest(");
    expect(shellSource).not.toContain("setMediaPublisherForTest(");
    expect(shellSource).not.toContain("host: this,");

    expect(kernelSource).not.toContain("构建附件内容地址(attachmentId: string");
    expect(kernelSource).not.toContain("设置媒体播放器供测试(");
    expect(kernelSource).not.toContain("设置媒体查看器供测试(");
    expect(kernelSource).not.toContain("设置媒体发布器供测试(");
    expect(kernelSource).not.toContain("export interface 聊天应用内核宿主");
    expect(kernelSource).not.toContain("deps.host.updateComplete");
    expect(kernelSource).not.toContain("deps.host.requestUpdate()");
    expect(kernelSource).not.toContain("注入快照补丁供测试(");
    expect(testHarnessSource).not.toContain("注入聊天快照补丁供测试(");
    expect(swarmSource).not.toContain("navigator.serviceWorker.ready");
  });

  it("聊天壳样式和内核状态投影必须有明确 owner，内核不得保留一跳媒体包装方法", () => {
    const shellSource = 读取前端源码("总装/聊天壳.ts");
    const kernelSource = 读取前端源码("总装/聊天应用内核.ts");
    const styleSource = 读取前端源码("总装/聊天壳样式.ts");
    const projectionSource = 读取前端源码("总装/聊天内核状态投影.ts");

    expect(shellSource).toContain('from "./聊天壳样式.js"');
    expect(shellSource).toContain("static override styles = 聊天壳样式;");
    expect(shellSource).not.toContain("static override styles = css`");
    expect(styleSource).toContain("export const 聊天壳样式 = css`");

    expect(kernelSource).toContain('from "./聊天内核状态投影.js"');
    expect(projectionSource).toContain("export function 投影恢复编排状态");
    expect(projectionSource).toContain("export function 投影阅读推进状态");
    expect(kernelSource).not.toMatch(
      /private async 处理选择媒体文件|private 移除媒体草稿|private async 继续上传媒体草稿|private async 重新上传媒体草稿|private 打开媒体查看器/
    );
  });

  it("应用运行时只负责把浏览器事件翻成内核 command，不再知道具体 owner 动词", () => {
    const source = 读取前端源码("平台/应用运行时.ts");

    expect(source).toContain("dispatch(command)");
    expect(source).not.toContain("标记用户滚动意图(): void");
    expect(source).not.toContain("处理聊天视口滚动(scrollContainer: HTMLElement): void");
    expect(source).not.toContain("请求跳到最新(): Promise<void>");
    expect(source).not.toContain("登记程序滚动来源(source:");
    expect(source).not.toContain("打开媒体(request:");
  });

  it("聊天应用内核不再自己直接订阅平台事件", () => {
    const source = 读取前端源码("总装/聊天应用内核.ts");

    expect(source).not.toContain("this.platform.订阅事件");
    expect(source).not.toContain("取消平台事件订阅");
  });

  it("浏览器应用平台只发布浏览器运行时事实，不发布聊天/媒体业务裁决", () => {
    const source = 读取前端源码("平台/浏览器应用平台.ts");

    expect(source).toContain('| { type: "LIFECYCLE_CHANGED"; snapshot: 生命周期快照 }');
    expect(source).toContain('| { type: "PRIMARY_CONTEXT_FOCUSED" }');
    expect(source).toContain('| { type: "OFFLINE_STATUS_CHANGED"; online: boolean }');
    expect(source).not.toContain('"ROOM_');
    expect(source).not.toContain('"MESSAGE_');
    expect(source).not.toContain('"MEDIA_');
    expect(source).not.toContain('"READ_');
  });

  it("媒体协作分发不再直接访问 navigator.storage.persist 或裸 localStorage", () => {
    const source = 读取前端源码("媒体/媒体协作分发.ts");

    expect(source).not.toContain("navigator?.storage");
    expect(source).not.toContain("window.localStorage");
    expect(source).not.toContain("globalThis.localStorage");
  });

  it("平台存储运行时在 Node 环境不得读取全局 localStorage 伪浏览器入口", () => {
    const 原始描述 = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("不应读取 Node 全局 localStorage");
      },
    });

    try {
      const runtime = 创建存储运行时();
      expect(runtime.壳层记忆().读取当前房间标识()).toBe("");
      expect(runtime.媒体资产仓库?.()).toBeDefined();
      expect(runtime.协作分发缓存仓库?.()).toBeDefined();
    } finally {
      if (原始描述) {
        Object.defineProperty(globalThis, "localStorage", 原始描述);
      } else {
        delete (globalThis as { localStorage?: unknown }).localStorage;
      }
    }
  });

  it("资产协作分发运行时不再通过模块级 singleton 持有全局真相", () => {
    const source = 读取前端源码("媒体/资产协作分发运行时.ts");

    expect(source).not.toContain("let 资产协作分发Actor实例");
    expect(source).not.toContain("发送资产协作分发事件 =");
    expect(source).not.toContain("投影资产协作分发预算(");
  });

  it("前端 package.json 会把浏览器应用宪法守门脚本接入构建前置检查", () => {
    const packageJson = JSON.parse(读取前端源码("package.json"));

    expect(packageJson.scripts["check:browser-app-constitution"]).toContain(
      "check-frontend-browser-app-constitution.mjs"
    );
    expect(packageJson.scripts.build).toContain("check:browser-app-constitution");
  });

  it("前端 package.json 会把架构适应度门禁接入构建前置检查", () => {
    const packageJson = JSON.parse(读取前端源码("package.json"));

    expect(packageJson.scripts["check:architecture-fitness"]).toContain(
      "check-frontend-architecture-fitness.mjs"
    );
    expect(packageJson.scripts.build).toContain("check:architecture-fitness");
  });

  it("架构适应度门禁会锁住 owner 注册表、平台内层 import 边界和热点文件增长", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain("前端运行时 owner 注册表");
    expect(source).toContain("frontend/后台/应用内核.ts");
    expect(source).toContain("frontend/恢复/应用.ts");
    expect(source).toContain("frontend/实时/应用.ts");
    expect(source).toContain("frontend/平台/应用生命周期.ts");
    expect(source).toContain("frontend/媒体/资产协作分发运行时.ts");
    expect(source).toContain('label: "platform internal import boundary"');
    expect(source).toContain("frontend/总装/聊天应用内核.ts");
    expect(source).toContain("frontend/媒体/播放会话/应用.ts");
  });

  it("架构适应度门禁会把后台根文件锁成已清零目标，避免后台 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain("const 前端已清零根文件规则 = [");
    expect(source).toContain('path: "frontend/后台壳.ts"');
    expect(source).toContain('path: "frontend/后台应用内核.ts"');
    expect(source).toContain('path: "frontend/后台查询编排.ts"');
    expect(source).toContain('path: "frontend/后台会话编排.ts"');
    expect(source).toContain('path: "frontend/后台壳编排.ts"');
    expect(source).toContain("frontend/后台/壳.ts");
    expect(source).toContain("frontend/后台/应用内核.ts");
  });

  it("架构适应度门禁会把传输根文件锁成已清零目标，避免平台 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/传输.ts"');
    expect(source).toContain('ownerPath: "frontend/平台/传输.ts"');
  });

  it("架构适应度门禁会把存储根文件锁成已清零目标，避免平台 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/存储.ts"');
    expect(source).toContain('ownerPath: "frontend/平台/存储.ts"');
  });

  it("架构适应度门禁会把调试旧根文件锁成已清零目标，避免平台 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/调试兼容.ts"');
    expect(source).toContain('ownerPath: "frontend/平台/调试浏览器适配.ts"');
  });

  it("架构适应度门禁会把应用生命周期根文件锁成已清零目标，避免平台 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/应用生命周期.ts"');
    expect(source).toContain('ownerPath: "frontend/平台/应用生命周期.ts"');
  });

  it("架构适应度门禁会把应用运行时根文件锁成已清零目标，避免平台 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/应用运行时.ts"');
    expect(source).toContain('ownerPath: "frontend/平台/应用运行时.ts"');
  });

  it("架构适应度门禁会把聊天应用编排桥接根文件锁成已清零目标，避免总装 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/聊天应用编排桥接.ts"');
    expect(source).toContain('ownerPath: "frontend/总装/聊天应用编排桥接.ts"');
  });

  it("架构适应度门禁会把阅读推进编排根文件锁成已清零目标，避免房间壳层 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/阅读推进编排.ts"');
    expect(source).toContain('ownerPath: "frontend/房间/壳层/阅读推进.ts"');
  });

  it("架构适应度门禁会把房间恢复编排根文件锁成已清零目标，避免恢复壳层 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/房间恢复编排.ts"');
    expect(source).toContain('ownerPath: "frontend/恢复/壳层/房间恢复编排.ts"');
  });

  it("架构适应度门禁会把房间时间线根文件锁成已清零目标，避免时间线 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain("const 前端已清零根文件规则 = [");
    expect(source).toContain("检查已清零根文件规则");
    expect(source).toContain('path: "frontend/房间时间线.ts"');
    expect(source).toContain('ownerPath: "frontend/时间线/领域.ts"');
  });

  it("架构适应度门禁会把实时会话运行时根文件锁成已清零目标，避免实时 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/实时会话运行时.ts"');
    expect(source).toContain('ownerPath: "frontend/实时/会话运行时.ts"');
  });

  it("架构适应度门禁会把房间视口运行时根文件锁成已清零目标，避免时间线视口 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/房间视口运行时.ts"');
    expect(source).toContain('ownerPath: "frontend/时间线/视口运行时.ts"');
  });

  it("架构适应度门禁会把房间时间线运行时根文件锁成已清零目标，避免时间线运行时 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/房间时间线运行时.ts"');
    expect(source).toContain('ownerPath: "frontend/时间线/运行时.ts"');
  });

  it("架构适应度门禁会把房间内核根文件锁成已清零目标，避免房间运行时 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/房间内核.ts"');
    expect(source).toContain('ownerPath: "frontend/房间/运行时.ts"');
  });

  it("架构适应度门禁会把房间滚动器根文件锁成已清零目标，避免时间线滚动 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/房间滚动器.ts"');
    expect(source).toContain('ownerPath: "frontend/时间线/滚动器.ts"');
  });

  it("架构适应度门禁会把媒体运行时根文件锁成已清零目标，避免媒体 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/媒体运行时.ts"');
    expect(source).toContain('ownerPath: "frontend/媒体/运行时.ts"');
  });

  it("架构适应度门禁会把文本布局根文件锁成已清零目标，避免文本几何 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/文本布局.ts"');
    expect(source).toContain('ownerPath: "frontend/房间消息窗/文本布局.ts"');
  });

  it("架构适应度门禁会把视图根文件锁成已清零目标，避免展示 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/视图.ts"');
    expect(source).toContain('ownerPath: "frontend/房间消息窗/视图.ts"');
  });

  it("架构适应度门禁会把房间消息窗根文件锁成已清零目标，避免消息窗 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/房间消息窗.ts"');
    expect(source).toContain('ownerPath: "frontend/房间消息窗/壳.ts"');
  });

  it("架构适应度门禁会把共享契约根文件锁成已清零目标，避免稳定协议面又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/契约.ts"');
    expect(source).toContain('ownerPath: "frontend/聊天共享/契约.ts"');
  });

  it("架构适应度门禁会把聊天状态根文件锁成已清零目标，避免总状态桶又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/状态.ts"');
    expect(source).toContain('ownerPath: "frontend/总装/聊天状态.ts"');
  });

  it("架构适应度门禁会拦住旧恢复/实时入口和聊天媒体 owner 回流", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('label: "chat media owner fallback"');
    expect(source).toContain('label: "legacy room realtime owner reflux"');
    expect(source).toContain('label: "legacy recovery owner reflux"');
  });

  it("架构适应度门禁会拦住视频预览 owner 重新引入 canonical/original 冷源旁路", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('label: "video preview cold-source fallback"');
    expect(source).toContain("frontend/媒体/壳层/视频预览协作.ts");
    expect(source).toContain("读取视频canonical冷源地址");
  });

  it("架构适应度门禁会拦住旧 reuseOnly 保守门槛重新回流到播放或 runtime owner", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('label: "reuseOnly playback barrier"');
    expect(source).toContain('label: "reuseOnly runtime barrier"');
    expect(source).toContain("frontend/媒体/媒体播放.ts");
    expect(source).toContain("frontend/媒体/资产协作分发运行时.ts");
  });

  it("架构适应度门禁会拦住房间消息窗重新创建或解释 WebTorrent 字节入口", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('label: "room message pane WebTorrent byte owner barrier"');
    expect(source).toContain("frontend/房间消息窗/壳.ts");
    expect(source).toContain("new\\s+WebTorrent");
    expect(source).toContain("createServer");
    expect(source).toContain("streamURL");
  });

  it("架构适应度门禁会拦住新增第二个全局 WebTorrent owner 文件", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('label: "duplicate global WebTorrent owner file"');
    expect(source).toContain("全局唯一WebTorrent");
    expect(source).toContain("WebTorrent状态机");
  });

  it("架构适应度门禁会拦住旧房间快照恢复兼容门面文件重新出现", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('label: "legacy recovery facade file"');
    expect(source).toContain("聊天恢复/壳层/房间快照恢复.ts");
  });

  it("架构适应度门禁会拦住房间消息窗自动播观察 owner 的一跳转发包装函数回流", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('label: "room message pane autoplay observer wrapper"');
    expect(source).toContain("private\\s+dispatch自动播候选\\s*\\(");
    expect(source).toContain("private\\s+调度自动播候选\\s*\\(");
    expect(source).toContain("private\\s+取消自动播候选调度\\s*\\(");
    expect(source).toContain("private\\s+清理自动播候选观察\\s*\\(");
  });

  it("架构适应度门禁会拦住聊天壳重新调用内核私有 helper 或媒体测试 setter", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('label: "chat shell private kernel/test setter barrier"');
    expect(source).toContain("frontend/总装/聊天壳.ts");
    expect(source).toContain("this\\.kernel\\.");
    expect(source).toContain("setMedia(Player|Viewer|Publisher)ForTest");
  });

  it("热点文件行数门禁会按 owner 风险收紧预算，而不是继续一刀切放到 1800 行", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain(
      'path: "frontend/总装/聊天应用内核.ts", maxEffectiveLines: 850, maxPhysicalLines: 960'
    );
    expect(source).toContain(
      'path: "frontend/总装/聊天壳.ts", maxEffectiveLines: 460, maxPhysicalLines: 560'
    );
    expect(source).toContain(
      'path: "frontend/总装/聊天壳样式.ts", maxEffectiveLines: 760, maxPhysicalLines: 900'
    );
    expect(source).toContain(
      'path: "frontend/总装/聊天内核状态投影.ts", maxEffectiveLines: 150, maxPhysicalLines: 170'
    );
    expect(source).toContain(
      'path: "frontend/媒体/播放会话/应用.ts", maxEffectiveLines: 800, maxPhysicalLines: 900'
    );
    expect(source).toContain(
      'path: "frontend/媒体/播放会话/会话投影.ts", maxEffectiveLines: 105, maxPhysicalLines: 115'
    );
    expect(source).toContain(
      'path: "frontend/媒体/播放会话/草稿发布.ts", maxEffectiveLines: 105, maxPhysicalLines: 120'
    );
    expect(source).toContain(
      'path: "frontend/媒体/播放会话/运行时副作用.ts", maxEffectiveLines: 75, maxPhysicalLines: 90'
    );
    expect(source).toContain('path: "frontend/实时/应用.ts", maxEffectiveLines: 260');
    expect(source).toContain(
      'path: "frontend/房间消息窗/壳.ts", maxEffectiveLines: 1250, maxPhysicalLines: 1520'
    );
    expect(source).toContain(
      'path: "frontend/房间消息窗/附件渲染.ts", maxEffectiveLines: 290, maxPhysicalLines: 330'
    );
    expect(source).toContain(
      'path: "frontend/房间消息窗/视频附件渲染.ts", maxEffectiveLines: 540, maxPhysicalLines: 570'
    );
    expect(source).toContain(
      'path: "frontend/房间消息窗/图片附件渲染.ts", maxEffectiveLines: 80, maxPhysicalLines: 95'
    );
  });

  it("房间消息窗不应再保留自动播观察 owner 的一跳转发包装函数", () => {
    const source = 读取前端源码("房间消息窗/壳.ts");

    expect(source).not.toContain("private dispatch自动播候选(");
    expect(source).not.toContain("private 调度自动播候选(");
    expect(source).not.toContain("private 取消自动播候选调度(");
    expect(source).not.toContain("private 清理自动播候选观察(");
    expect(source).not.toContain("private 根据矩形计算自动播候选(");
    expect(source).not.toContain("private 同步自动播候选观察(");
    expect(source).not.toContain("private 读取自动播候选(");
  });

  it("附件渲染必须按图片和视频 owner 拆分，并禁止重新读取旧媒体真相", () => {
    const attachmentSource = 读取前端源码("房间消息窗/附件渲染.ts");
    const imageSource = 读取前端源码("房间消息窗/图片附件渲染.ts");
    const videoSource = 读取前端源码("房间消息窗/视频附件渲染.ts");

    expect(attachmentSource).toContain('from "./图片附件渲染.js"');
    expect(attachmentSource).toContain('from "./视频附件渲染.js"');
    expect(imageSource).toContain("export const 渲染图片附件");
    expect(videoSource).toContain("export const 渲染视频附件");

    for (const source of [imageSource, videoSource]) {
      expect(source).not.toMatch(
        /originalSrc|original_url|manifest|reuseOnly|WebTorrent|videojs|全局唯一播放器|资产协作分发运行时/
      );
    }
  });

  it("realtime真实链路的构建预热不应被120秒 beforeAll hook 超时误杀", () => {
    const source = 读取前端源码("tests/realtime真实链路.spec.ts");

    expect(source).toContain("beforeAll(() => {");
    expect(source).toContain("ensureBackendBinaryPrepared();");
    expect(source).toContain("}, 300000);");
  });

  it("架构适应度热点门禁会按有效源码行数裁决，而不是把注释和空行也算成热点增长", async () => {
    const modulePath = fileURLToPath(
      new URL("../../../scripts/check-frontend-architecture-fitness.mjs", import.meta.url)
    );
    const script = await import(modulePath);
    const source = `
const keep = true;

// 纯注释不该把热点文件误判成增长
/*
 * JSDoc 和块注释也不该算进复杂度预算
 */
const stillKeep = true;
`;

    expect(script.统计有效源码行数(source)).toBe(2);
    expect(
      script.检查热点文件增长(
        [{ path: "virtual.ts", maxEffectiveLines: 2 }],
        (path: string) => {
          expect(path).toBe("virtual.ts");
          return source;
        }
      )
    ).toEqual([]);
    expect(
      script.检查热点文件增长(
        [{ path: "virtual.ts", maxEffectiveLines: 1 }],
        () => source
      )
    ).toEqual([
      expect.objectContaining({
        file: "virtual.ts",
        label: "hotspot growth ratchet",
      }),
    ]);
  });

  it("架构适应度门禁会拦住生产文件使用兜底桶命名", async () => {
    const modulePath = fileURLToPath(
      new URL("../../../scripts/check-frontend-architecture-fitness.mjs", import.meta.url)
    );
    const script = await import(modulePath);

    expect(
      script.检查生产文件兜底命名([
        "frontend/媒体/helper.ts",
        "frontend/房间消息窗/wrapper.ts",
        "frontend/平台/兼容入口.ts",
      ])
    ).toEqual([
      expect.objectContaining({
        file: "frontend/媒体/helper.ts",
        label: "fallback bucket filename",
      }),
      expect.objectContaining({
        file: "frontend/房间消息窗/wrapper.ts",
        label: "fallback bucket filename",
      }),
      expect.objectContaining({
        file: "frontend/平台/兼容入口.ts",
        label: "fallback bucket filename",
      }),
    ]);
    expect(script.检查生产文件兜底命名(["frontend/媒体/协作分发/tracker代理.ts"])).toEqual([]);
  });

  it("生产播放链命名不得把平台补齐或旧数据投影写成兼容层", () => {
    const videoJsShellSource = 读取前端源码("媒体/videojs播放器壳.ts");
    const swarmSource = 读取前端源码("媒体/媒体协作分发.ts");
    const buildSource = 读取前端源码("build.mjs");
    const attachmentSource = 读取前端源码("房间消息窗/附件渲染.ts");
    const videoAttachmentSource = 读取前端源码("房间消息窗/视频附件渲染.ts");
    const mediaHttpSource = 读取前端源码("媒体/适配/媒体HTTP接口.ts");

    expect(videoJsShellSource).not.toContain("兼容RemotePlayback异步契约");
    expect(videoJsShellSource).not.toContain("可兼容远端播放对象");
    expect(videoJsShellSource).not.toContain("远端播放Promise兼容标记");
    expect(swarmSource).not.toContain("确保IndexedDBChunkStoreBuffer兼容");
    expect(buildSource).not.toContain("浏览器兼容构建目标");
    expect(buildSource).not.toContain("浏览器兼容构建能力覆盖");
    expect(attachmentSource).not.toContain("legacy-grid");
    expect(videoAttachmentSource).not.toContain("legacy_stream");
    expect(mediaHttpSource).not.toContain("_legacyOriginalUrl");
  });

  it("宪法守门会拦住协作分发全局 singleton 和新增浏览器全局旁路", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-browser-app-constitution.mjs");

    expect(source).toContain('label: "module-level actor singleton"');
    expect(source).toContain("Actor实例");
    expect(source).toContain('label: "navigator.serviceWorker"');
    expect(source).toContain('label: "navigator.storage"');
    expect(source).toContain('label: "BroadcastChannel"');
  });

  it("宪法守门脚本会拦住 controllerchange 直监听和组件层 @state 运行时真相回流", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-browser-app-constitution.mjs");

    expect(source).toContain("controllerchange");
    expect(source).toContain('label: "lit @state runtime truth"');
    expect(source).toContain("/@state\\s*\\(/g");
  });

  it("聊天壳和后台壳都通过各自应用内核间接拿 transport，而不是壳层自己 new HttpRealtime传输", () => {
    const chatSource = 读取前端源码("总装/聊天壳.ts");
    const kernelSource = 读取前端源码("总装/聊天应用内核.ts");
    const adminOwnerSource = 读取前端源码("后台/壳.ts");
    const adminKernelOwnerSource = 读取前端源码("后台/应用内核.ts");

    expect(chatSource).not.toContain("new HttpRealtime传输(window.location.origin)");
    expect(kernelSource).toContain('from "./聊天应用编排桥接.js"');
    expect(kernelSource).toContain("const rawPlatform = deps.platform ?? 获取默认浏览器应用平台()");
    expect(kernelSource).toContain("创建聊天内核平台桥接(rawPlatform)");
    expect(kernelSource).toContain("this.平台桥接.聊天房间传输()");
    expect(kernelSource).not.toContain("this.platform.transport.transport()");
    expect(kernelSource).toContain('from "../平台/index.js"');

    expect(adminOwnerSource).toContain('from "./应用内核.js"');
    expect(adminOwnerSource).not.toContain('from "../平台/index.js"');
    expect(adminOwnerSource).not.toContain("private transport:");
    expect(adminOwnerSource).not.toContain("new HttpRealtime传输(window.location.origin)");
    expect(adminKernelOwnerSource).toContain('from "../平台/index.js"');
    expect(adminKernelOwnerSource).toContain("deps.platform ?? 获取默认浏览器应用平台()");
    expect(adminKernelOwnerSource).toContain("this.platform.transport.后台查询传输()");
    expect(adminKernelOwnerSource).toContain("this.platform.transport.后台会话传输()");
    expect(adminKernelOwnerSource).not.toContain("this.platform.transport.transport()");
    expect(adminKernelOwnerSource).not.toContain("overviewText:");
    expect(adminKernelOwnerSource).not.toContain("detailText:");
  });

  it("平台传输运行时直接依赖平台 owner，旧根入口已经删除", () => {
    const transportOwnerSource = 读取前端源码("平台/传输.ts");
    const transportRuntimeSource = 读取前端源码("平台/传输运行时.ts");

    expect(existsSync(resolve(process.cwd(), "传输.ts"))).toBe(false);
    expect(transportOwnerSource).toContain("export function 创建前端传输(");
    expect(transportRuntimeSource).toContain('from "./传输.js"');
    expect(transportRuntimeSource).not.toContain('from "../传输.js"');
  });

  it("平台存储运行时直接依赖平台 owner，旧根入口已经删除", () => {
    const storageOwnerSource = 读取前端源码("平台/存储.ts");
    const storageRuntimeSource = 读取前端源码("平台/存储运行时.ts");

    expect(existsSync(resolve(process.cwd(), "存储.ts"))).toBe(false);
    expect(storageOwnerSource).toContain("export function 创建浏览器存储(");
    expect(storageRuntimeSource).toContain('from "./存储.js"');
    expect(storageRuntimeSource).not.toContain('from "../存储.js"');
  });

  it("构建 alias 直指平台调试浏览器适配 owner，旧根入口已经删除", () => {
    const debugOwnerSource = 读取前端源码("平台/调试浏览器适配.ts");
    const buildSource = 读取前端源码("build.mjs");

    expect(existsSync(resolve(process.cwd(), "调试兼容.ts"))).toBe(false);
    expect(debugOwnerSource).toContain("debugFactory");
    expect(buildSource).toContain("path.join(frontendRoot, '平台', '调试浏览器适配.ts')");
    expect(buildSource).not.toContain("path.join(frontendRoot, '调试兼容.ts')");
  });

  it("应用生命周期 owner 进入平台层，旧根入口已经删除，内核直接依赖平台 owner", () => {
    const lifecycleOwnerSource = 读取前端源码("平台/应用生命周期.ts");
    const kernelSource = 读取前端源码("总装/聊天应用内核.ts");

    expect(existsSync(resolve(process.cwd(), "应用生命周期.ts"))).toBe(false);
    expect(lifecycleOwnerSource).toContain("createMachine(");
    expect(kernelSource).toContain('from "../平台/应用生命周期.js"');
    expect(kernelSource).not.toContain('from "./应用生命周期.js"');
  });

  it("应用运行时 owner 进入平台层，旧根入口已经删除，总装直接依赖平台 owner", () => {
    const runtimeOwnerSource = 读取前端源码("平台/应用运行时.ts");
    const assemblySource = 读取前端源码("总装/应用装配.ts");

    expect(existsSync(resolve(process.cwd(), "应用运行时.ts"))).toBe(false);
    expect(runtimeOwnerSource).toContain("翻译平台事件为内核命令");
    expect(assemblySource).toContain('from "../平台/应用运行时.js"');
    expect(assemblySource).not.toContain('from "../应用运行时.js"');
  });

  it("聊天应用编排桥接 owner 进入总装层，旧根入口已经删除，聊天内核直接依赖总装 owner", () => {
    const bridgeOwnerSource = 读取前端源码("总装/聊天应用编排桥接.ts");
    const kernelSource = 读取前端源码("总装/聊天应用内核.ts");

    expect(existsSync(resolve(process.cwd(), "聊天应用编排桥接.ts"))).toBe(false);
    expect(bridgeOwnerSource).toContain("export interface 聊天内核平台端口");
    expect(kernelSource).toContain('from "./聊天应用编排桥接.js"');
    expect(kernelSource).not.toContain('from "./总装/聊天应用编排桥接.js"');
  });

  it("入口会把浏览器 API 启动职责交给平台骨架，不再自己直连 service worker 和持久化存储", () => {
    const source = 读取前端源码("入口.ts");

    expect(source).toContain('from "./平台/index.js"');
    expect(source).toContain("获取默认浏览器应用平台");
    expect(source).toContain("void 平台.启动()");
    expect(source).not.toContain("navigator.serviceWorker.register");
    expect(source).not.toContain("navigator.storage.persist()");
  });

});
