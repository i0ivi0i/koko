import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { 创建浏览器应用平台 } from "../平台/浏览器应用平台";
import type { 浏览器应用平台事件 } from "../平台/浏览器应用平台";
import type { 生命周期快照 } from "../平台/生命周期运行时";
import type { 服务工作线程运行时事件 } from "../平台/服务工作线程运行时";
import type { 前端传输端口 } from "../平台/传输";

const 读取前端源码 = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

const 读取仓库脚本源码 = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)), "utf8");

const 创建假传输运行时 = (input: {
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

describe("浏览器端应用平台化基线", () => {
  it("聊天壳会把业务入口收进总装门面，自身只保留 view + bridge", () => {
    const source = 读取前端源码("聊天壳.ts");

    expect(source).toContain('from "./总装/应用装配.js"');
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

  it("聊天主链编排不再共写一个 shared chatState，而是只消费各自显式 state slice", () => {
    const kernelSource = 读取前端源码("聊天应用内核.ts");
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
    const source = 读取前端源码("聊天壳.ts");

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
    const shellSource = 读取前端源码("聊天壳.ts");
    const kernelSource = 读取前端源码("聊天应用内核.ts");
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
    const source = 读取前端源码("聊天应用内核.ts");

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
    expect(source).toContain("frontend/聊天应用内核.ts");
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

  it("架构适应度门禁会把调试兼容根文件锁成已清零目标，避免平台 owner 又散回根目录", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/调试兼容.ts"');
    expect(source).toContain('ownerPath: "frontend/平台/调试兼容.ts"');
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

  it("架构适应度门禁会拦住旧恢复/实时门面和聊天媒体 owner 回流", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('label: "chat media owner fallback"');
    expect(source).toContain('label: "legacy room realtime facade fallback"');
    expect(source).toContain('label: "legacy recovery facade fallback"');
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

  it("热点文件行数门禁会按 owner 风险收紧预算，而不是继续一刀切放到 1800 行", () => {
    const source = 读取仓库脚本源码("scripts/check-frontend-architecture-fitness.mjs");

    expect(source).toContain('path: "frontend/聊天应用内核.ts", maxEffectiveLines: 1500');
    expect(source).toContain('path: "frontend/媒体/播放会话/应用.ts", maxEffectiveLines: 1450');
    expect(source).toContain('path: "frontend/实时/应用.ts", maxEffectiveLines: 260');
  });

  it("架构适应度热点门禁会按有效源码行数裁决，而不是把注释和空行也算成热点增长", async () => {
    const modulePath = fileURLToPath(
      new URL("../../scripts/check-frontend-architecture-fitness.mjs", import.meta.url)
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
    const chatSource = 读取前端源码("聊天壳.ts");
    const kernelSource = 读取前端源码("聊天应用内核.ts");
    const adminOwnerSource = 读取前端源码("后台/壳.ts");
    const adminKernelOwnerSource = 读取前端源码("后台/应用内核.ts");

    expect(chatSource).not.toContain("new HttpRealtime传输(window.location.origin)");
    expect(kernelSource).toContain('from "./总装/聊天应用编排桥接.js"');
    expect(kernelSource).toContain("const rawPlatform = deps.platform ?? 获取默认浏览器应用平台()");
    expect(kernelSource).toContain("创建聊天内核平台桥接(rawPlatform)");
    expect(kernelSource).toContain("this.平台桥接.聊天房间传输()");
    expect(kernelSource).not.toContain("this.platform.transport.transport()");
    expect(kernelSource).toContain('from "./平台/index.js"');

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

  it("平台传输运行时直接依赖平台 owner，旧根门面已经删除", () => {
    const transportOwnerSource = 读取前端源码("平台/传输.ts");
    const transportRuntimeSource = 读取前端源码("平台/传输运行时.ts");

    expect(existsSync(resolve(process.cwd(), "传输.ts"))).toBe(false);
    expect(transportOwnerSource).toContain("export function 创建前端传输(");
    expect(transportRuntimeSource).toContain('from "./传输.js"');
    expect(transportRuntimeSource).not.toContain('from "../传输.js"');
  });

  it("平台存储运行时直接依赖平台 owner，旧根门面已经删除", () => {
    const storageOwnerSource = 读取前端源码("平台/存储.ts");
    const storageRuntimeSource = 读取前端源码("平台/存储运行时.ts");

    expect(existsSync(resolve(process.cwd(), "存储.ts"))).toBe(false);
    expect(storageOwnerSource).toContain("export function 创建浏览器存储(");
    expect(storageRuntimeSource).toContain('from "./存储.js"');
    expect(storageRuntimeSource).not.toContain('from "../存储.js"');
  });

  it("构建 alias 直指平台调试兼容 owner，旧根门面已经删除", () => {
    const debugOwnerSource = 读取前端源码("平台/调试兼容.ts");
    const buildSource = 读取前端源码("build.mjs");

    expect(existsSync(resolve(process.cwd(), "调试兼容.ts"))).toBe(false);
    expect(debugOwnerSource).toContain("debugFactory");
    expect(buildSource).toContain("path.join(frontendRoot, '平台', '调试兼容.ts')");
    expect(buildSource).not.toContain("path.join(frontendRoot, '调试兼容.ts')");
  });

  it("应用生命周期 owner 进入平台层，旧根门面已经删除，内核直接依赖平台 owner", () => {
    const lifecycleOwnerSource = 读取前端源码("平台/应用生命周期.ts");
    const kernelSource = 读取前端源码("聊天应用内核.ts");

    expect(existsSync(resolve(process.cwd(), "应用生命周期.ts"))).toBe(false);
    expect(lifecycleOwnerSource).toContain("createMachine(");
    expect(kernelSource).toContain('from "./平台/应用生命周期.js"');
    expect(kernelSource).not.toContain('from "./应用生命周期.js"');
  });

  it("应用运行时 owner 进入平台层，旧根门面已经删除，总装直接依赖平台 owner", () => {
    const runtimeOwnerSource = 读取前端源码("平台/应用运行时.ts");
    const assemblySource = 读取前端源码("总装/应用装配.ts");

    expect(existsSync(resolve(process.cwd(), "应用运行时.ts"))).toBe(false);
    expect(runtimeOwnerSource).toContain("翻译平台事件为内核命令");
    expect(assemblySource).toContain('from "../平台/应用运行时.js"');
    expect(assemblySource).not.toContain('from "../应用运行时.js"');
  });

  it("聊天应用编排桥接 owner 进入总装层，旧根门面已经删除，聊天内核直接依赖总装 owner", () => {
    const bridgeOwnerSource = 读取前端源码("总装/聊天应用编排桥接.ts");
    const kernelSource = 读取前端源码("聊天应用内核.ts");

    expect(existsSync(resolve(process.cwd(), "聊天应用编排桥接.ts"))).toBe(false);
    expect(bridgeOwnerSource).toContain("export interface 聊天内核平台端口");
    expect(kernelSource).toContain('from "./总装/聊天应用编排桥接.js"');
    expect(kernelSource).not.toContain('from "./聊天应用编排桥接.js"');
  });

  it("入口会把浏览器 API 启动职责交给平台骨架，不再自己直连 service worker 和持久化存储", () => {
    const source = 读取前端源码("入口.ts");

    expect(source).toContain('from "./平台/index.js"');
    expect(source).toContain("获取默认浏览器应用平台");
    expect(source).toContain("void 平台.启动()");
    expect(source).not.toContain("navigator.serviceWorker.register");
    expect(source).not.toContain("navigator.storage.persist()");
  });

  it("平台会把多上下文、通知、离线能力收进统一快照与命令入口，而不是让壳层自己直连浏览器 API", async () => {
    const lifecycleListeners: Array<(snapshot: 生命周期快照) => void> = [];
    const transportLifecycleCalls: 生命周期快照[] = [];
    const startupSteps: string[] = [];
    const showNotification = vi.fn(async () => true);
    const setBadge = vi.fn(async () => {});
    const clearBadge = vi.fn(async () => {});
    const appRegistration = {
      sync: {
        register: async () => {},
      },
    };
    const mediaRegistration = {};
    const offlineReady = vi.fn(async (input?: { 已注册服务工作线程?: Array<unknown> }) => {
      startupSteps.push(`offline:${Boolean((input?.已注册服务工作线程 ?? []).at(0))}`);
    });
    const startServiceWorker = vi.fn(async () => {
      startupSteps.push("serviceWorker");
    });
    const declarePrimary = vi.fn(() => {});
    const dedupeNotification = vi.fn(() => true);
    const hasShownNotification = vi.fn(() => false);

    const platform = 创建浏览器应用平台({
      lifecycle: {
        snapshot: () => ({ visibility: "visible" as const, phase: "active" as const }),
        订阅: (listener) => {
          lifecycleListeners.push(listener);
          return () => {};
        },
      },
      storage: {
        壳层记忆: () => {
          throw new Error("not used");
        },
      },
      serviceWorker: {
        启动: startServiceWorker,
        读取注册: () => appRegistration ?? mediaRegistration,
        snapshot: () => ({
          workerRegistered: true,
          persistentStorageRequested: true,
          controllerAttached: true,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => true,
      },
      transport: 创建假传输运行时({
        接收生命周期变化: (snapshot) => {
          transportLifecycleCalls.push(snapshot);
        },
        snapshot: () => ({
          lastLifecycle: { visibility: "visible" as const, phase: "active" as const },
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: true,
            reason: "active" as const,
          },
        }),
      }),
      multiContext: {
        snapshot: () => ({
          contextId: "tab-a",
          isPrimaryContext: true,
          lastPrimaryContextId: "tab-a",
          lastFocusedContextId: null,
          deliveredNotificationIds: [],
        }),
        声明主上下文: declarePrimary,
        请求聚焦当前上下文: () => {},
        通知已展示: hasShownNotification,
        登记通知已展示: dedupeNotification,
      },
      notification: {
        snapshot: () => ({
          permission: "granted" as const,
          lastClickedNotificationId: null,
          badgeCount: 0,
        }),
        请求权限: async () => "granted" as const,
        显示通知: showNotification,
        设置角标: setBadge,
        清除角标: clearBadge,
        订阅点击: () => () => {},
      },
      offline: {
        就绪: offlineReady,
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: true,
          queuedTaskCapability: "background-sync" as const,
        }),
      },
    });

    await platform.启动();
    await platform.dispatch({
      type: "SHOW_NOTIFICATION",
      id: "msg-1",
      title: "新消息",
      body: "hello",
      tag: "room-1",
    });
    await platform.dispatch({ type: "SET_BADGE", count: 3 });
    lifecycleListeners[0]?.({ visibility: "visible", phase: "active" });

    expect(declarePrimary).toHaveBeenCalledTimes(2);
    expect(offlineReady).toHaveBeenCalledTimes(1);
    expect(startServiceWorker).toHaveBeenCalledTimes(1);
    expect(startupSteps).toEqual(["serviceWorker", "offline:true"]);
    expect(transportLifecycleCalls).toEqual([
      { visibility: "visible", phase: "active" },
      { visibility: "visible", phase: "active" },
    ]);
    expect(showNotification).toHaveBeenCalledWith({
      id: "msg-1",
      title: "新消息",
      body: "hello",
      tag: "room-1",
    });
    expect(setBadge).toHaveBeenCalledWith(3);
    expect(clearBadge).toHaveBeenCalledTimes(1);
    expect(platform.snapshot()).toMatchObject({
      serviceWorker: {
        controllerAttached: true,
        workerWaiting: false,
        lastMessageType: null,
      },
      multiContext: {
        contextId: "tab-a",
        isPrimaryContext: true,
      },
      notification: {
        permission: "granted",
      },
      offline: {
        online: true,
        backgroundSyncSupported: true,
      },
    });
  });

  it("离线运行时在线状态变化会被平台转成稳定事件，而不是要求业务层自己轮询平台快照", async () => {
    let 离线快照监听器: ((snapshot: { online: boolean }) => void) | null = null;
    const 事件记录: Array<{ type: string; online?: boolean }> = [];

    const platform = 创建浏览器应用平台({
      lifecycle: {
        snapshot: () => ({ visibility: "visible" as const, phase: "active" as const }),
        订阅: () => () => {},
      },
      storage: {
        壳层记忆: () => {
          throw new Error("not used");
        },
      },
      serviceWorker: {
        启动: async () => {},
        读取注册: () => null,
        snapshot: () => ({
          workerRegistered: false,
          persistentStorageRequested: false,
          controllerAttached: false,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => false,
      },
      transport: 创建假传输运行时({
        接收生命周期变化: () => {},
        snapshot: () => ({
          lastLifecycle: { visibility: "visible" as const, phase: "active" as const },
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: true,
            reason: "active" as const,
          },
        }),
      }),
      multiContext: {
        snapshot: () => ({
          contextId: "tab-a",
          isPrimaryContext: true,
          lastPrimaryContextId: "tab-a",
          lastFocusedContextId: null,
          deliveredNotificationIds: [],
        }),
        声明主上下文: () => {},
        请求聚焦当前上下文: () => {},
        通知已展示: () => false,
        登记通知已展示: () => true,
      },
      notification: {
        snapshot: () => ({
          permission: "granted" as const,
          lastClickedNotificationId: null,
          badgeCount: 0,
        }),
        请求权限: async () => "granted" as const,
        显示通知: async () => true,
        设置角标: async () => {},
        清除角标: async () => {},
        订阅点击: () => () => {},
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: false,
          queuedTaskCapability: "none" as const,
        }),
        订阅: (listener: (snapshot: { online: boolean }) => void) => {
          离线快照监听器 = listener;
          return () => {
            离线快照监听器 = null;
          };
        },
      } as never,
    });
    platform.订阅事件?.((event) => {
      事件记录.push(event as { type: string; online?: boolean });
    });

    const 触发离线快照 = 离线快照监听器 as ((snapshot: { online: boolean }) => void) | null;
    if (typeof 触发离线快照 === "function") {
      触发离线快照({ online: false });
      触发离线快照({ online: true });
    }

    expect(事件记录).toEqual([
      { type: "OFFLINE_STATUS_CHANGED", online: false },
      { type: "OFFLINE_STATUS_CHANGED", online: true },
    ]);
  });

  it("平台显示通知前会先走多上下文去重，同一条通知不会跨标签重复弹两次", async () => {
    const showNotification = vi.fn(async () => true);
    const hasShownNotification = vi
      .fn<(...args: [string]) => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const dedupeNotification = vi
      .fn<(...args: [string]) => boolean>()
      .mockReturnValueOnce(true);

    const platform = 创建浏览器应用平台({
      lifecycle: {
        snapshot: () => ({ visibility: "hidden" as const, phase: "background" as const }),
        订阅: () => () => {},
      },
      storage: {
        壳层记忆: () => {
          throw new Error("not used");
        },
      },
      serviceWorker: {
        启动: async () => {},
        读取注册: () => null,
        snapshot: () => ({
          workerRegistered: false,
          persistentStorageRequested: false,
          controllerAttached: false,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => false,
      },
      transport: 创建假传输运行时({
        接收生命周期变化: () => {},
        snapshot: () => ({
          lastLifecycle: null,
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: false,
            reason: "background" as const,
          },
        }),
      }),
      multiContext: {
        snapshot: () => ({
          contextId: "tab-b",
          isPrimaryContext: false,
          lastPrimaryContextId: "tab-a",
          lastFocusedContextId: null,
          deliveredNotificationIds: [],
        }),
        声明主上下文: () => {},
        请求聚焦当前上下文: () => {},
        通知已展示: hasShownNotification,
        登记通知已展示: dedupeNotification,
      },
      notification: {
        snapshot: () => ({
          permission: "granted" as const,
          lastClickedNotificationId: null,
          badgeCount: 0,
        }),
        请求权限: async () => "granted" as const,
        显示通知: showNotification,
        设置角标: async () => {},
        清除角标: async () => {},
        订阅点击: () => () => {},
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: false,
          queuedTaskCapability: "none" as const,
        }),
      },
    });

    await platform.dispatch({
      type: "SHOW_NOTIFICATION",
      id: "msg-dup",
      title: "重复消息",
    });
    await platform.dispatch({
      type: "SHOW_NOTIFICATION",
      id: "msg-dup",
      title: "重复消息",
    });

    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(hasShownNotification).toHaveBeenCalledTimes(2);
    expect(dedupeNotification).toHaveBeenCalledTimes(1);
  });

  it("通知展示失败时不会提前占掉跨标签去重名额，后续上下文还能继续尝试", async () => {
    const showNotification = vi
      .fn<(...args: Array<unknown>) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const hasShown = vi
      .fn<(...args: [string]) => boolean>()
      .mockReturnValue(false);
    const markShown = vi.fn();

    const platform = 创建浏览器应用平台({
      lifecycle: {
        snapshot: () => ({ visibility: "hidden" as const, phase: "background" as const }),
        订阅: () => () => {},
      },
      storage: {
        壳层记忆: () => {
          throw new Error("not used");
        },
      },
      serviceWorker: {
        启动: async () => {},
        读取注册: () => null,
        snapshot: () => ({
          workerRegistered: false,
          persistentStorageRequested: false,
          controllerAttached: false,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => false,
      },
      transport: 创建假传输运行时({
        接收生命周期变化: () => {},
        snapshot: () => ({
          lastLifecycle: null,
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: false,
            reason: "background" as const,
          },
        }),
      }),
      multiContext: {
        snapshot: () => ({
          contextId: "tab-b",
          isPrimaryContext: false,
          lastPrimaryContextId: "tab-a",
          lastFocusedContextId: null,
          deliveredNotificationIds: [],
        }),
        声明主上下文: () => {},
        请求聚焦当前上下文: () => {},
        通知已展示: hasShown,
        登记通知已展示: markShown,
      },
      notification: {
        snapshot: () => ({
          permission: "granted" as const,
          lastClickedNotificationId: null,
          badgeCount: 0,
        }),
        请求权限: async () => "granted" as const,
        显示通知: showNotification,
        设置角标: async () => {},
        清除角标: async () => {},
        订阅点击: () => () => {},
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: false,
          queuedTaskCapability: "none" as const,
        }),
      },
    });

    expect(
      await platform.dispatch({
        type: "SHOW_NOTIFICATION",
        id: "msg-retry",
        title: "第一次失败",
      })
    ).toBe(false);
    expect(
      await platform.dispatch({
        type: "SHOW_NOTIFICATION",
        id: "msg-retry",
        title: "第二次成功",
      })
    ).toBe(true);

    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(markShown).toHaveBeenCalledTimes(1);
  });

  it("通知点击后会由平台统一触发当前上下文聚焦、主上下文声明和 badge 清理", async () => {
    const 聚焦当前上下文 = vi.fn();
    const 声明主上下文 = vi.fn();
    const 清除角标 = vi.fn(async () => {});
    let 点击监听器: ((notificationId: string) => void) | null = null;

    创建浏览器应用平台({
      lifecycle: {
        snapshot: () => ({ visibility: "hidden" as const, phase: "background" as const }),
        订阅: () => () => {},
      },
      storage: {
        壳层记忆: () => {
          throw new Error("not used");
        },
      },
      serviceWorker: {
        启动: async () => {},
        读取注册: () => null,
        snapshot: () => ({
          workerRegistered: false,
          persistentStorageRequested: false,
          controllerAttached: false,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => false,
      },
      transport: 创建假传输运行时({
        接收生命周期变化: () => {},
        snapshot: () => ({ lastLifecycle: null, realtimePolicy: null as never }),
      }),
      multiContext: {
        snapshot: () => ({
          contextId: "tab-click",
          isPrimaryContext: false,
          lastPrimaryContextId: null,
          lastFocusedContextId: null,
          deliveredNotificationIds: [],
        }),
        声明主上下文,
        请求聚焦当前上下文: 聚焦当前上下文,
        通知已展示: () => false,
        登记通知已展示: () => true,
      },
      notification: {
        snapshot: () => ({
          permission: "granted" as const,
          lastClickedNotificationId: null,
          badgeCount: 3,
        }),
        请求权限: async () => "granted" as const,
        显示通知: async () => true,
        设置角标: async () => {},
        清除角标,
        订阅点击: (listener) => {
          点击监听器 = listener;
          return () => {
            点击监听器 = null;
          };
        },
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: false,
          queuedTaskCapability: "none" as const,
        }),
      },
    });

    // TypeScript 不会追踪闭包里对可空变量的赋值，这里先拷贝到局部常量再做函数类型收窄。
    const 已注册点击监听器 = 点击监听器 as ((notificationId: string) => void) | null;
    if (typeof 已注册点击监听器 === "function") {
      已注册点击监听器("msg-click");
    }
    // 点击链路里包含异步前台恢复与 badge 清理，这里等待微任务完成后再断言。
    await Promise.resolve();
    await Promise.resolve();

    expect(聚焦当前上下文).toHaveBeenCalledTimes(1);
    expect(声明主上下文).toHaveBeenCalledTimes(1);
    expect(清除角标).toHaveBeenCalledTimes(1);
  });

  it("通知点击时如果多上下文运行时提供前台恢复能力，平台会优先调用它", async () => {
    const 请求回到应用前台 = vi.fn(async () => true);
    const 声明主上下文 = vi.fn();
    const 聚焦当前上下文 = vi.fn();
    const 清除角标 = vi.fn(async () => {});
    let 点击监听器: ((notificationId: string) => void) | null = null;

    创建浏览器应用平台({
      lifecycle: {
        snapshot: () => ({ visibility: "hidden" as const, phase: "background" as const }),
        订阅: () => () => {},
      },
      storage: {
        壳层记忆: () => {
          throw new Error("not used");
        },
      },
      serviceWorker: {
        启动: async () => {},
        读取注册: () => null,
        snapshot: () => ({
          workerRegistered: false,
          persistentStorageRequested: false,
          controllerAttached: false,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => false,
      },
      transport: 创建假传输运行时({
        接收生命周期变化: () => {},
        snapshot: () => ({ lastLifecycle: null, realtimePolicy: null as never }),
      }),
      multiContext: {
        snapshot: () => ({
          contextId: "tab-click",
          isPrimaryContext: false,
          lastPrimaryContextId: null,
          lastFocusedContextId: null,
          deliveredNotificationIds: [],
        }),
        声明主上下文,
        请求聚焦当前上下文: 聚焦当前上下文,
        请求回到应用前台,
        通知已展示: () => false,
        登记通知已展示: () => true,
      },
      notification: {
        snapshot: () => ({
          permission: "granted" as const,
          lastClickedNotificationId: null,
          badgeCount: 0,
        }),
        请求权限: async () => "granted" as const,
        显示通知: async () => true,
        设置角标: async () => {},
        清除角标,
        订阅点击: (listener) => {
          点击监听器 = listener;
          return () => {
            点击监听器 = null;
          };
        },
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: false,
          queuedTaskCapability: "none" as const,
        }),
      },
    });

    const 已注册点击监听器 = 点击监听器 as ((notificationId: string) => void) | null;
    if (typeof 已注册点击监听器 === "function") {
      已注册点击监听器("msg-click");
    }
    await Promise.resolve();
    await Promise.resolve();

    expect(请求回到应用前台).toHaveBeenCalledTimes(1);
    expect(聚焦当前上下文).not.toHaveBeenCalled();
    expect(声明主上下文).toHaveBeenCalledTimes(1);
    expect(清除角标).toHaveBeenCalledTimes(1);
  });

  it("平台会透传 service worker 事件，并提供显式接受更新命令", async () => {
    let sw事件监听器: ((event: 服务工作线程运行时事件) => void) | null = null;
    const 接受更新 = vi.fn(() => true);
    const serviceWorker = {
      启动: async () => {},
      读取注册: () => null,
      发送消息: () => true,
      订阅事件: (listener: (event: 服务工作线程运行时事件) => void) => {
        sw事件监听器 = listener;
        return () => {
          sw事件监听器 = null;
        };
      },
      接受更新,
      snapshot: () => ({
        workerRegistered: true,
        persistentStorageRequested: true,
        controllerAttached: true,
        workerWaiting: false,
        lastMessageType: null,
        lastMessage: null,
      }),
    };

    const platform = 创建浏览器应用平台({
      lifecycle: {
        snapshot: () => ({ visibility: "hidden" as const, phase: "background" as const }),
        订阅: () => () => {},
      },
      storage: {
        壳层记忆: () => {
          throw new Error("not used");
        },
      },
      serviceWorker,
      transport: 创建假传输运行时({
        接收生命周期变化: () => {},
        snapshot: () => ({
          lastLifecycle: null,
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: false,
            reason: "background" as const,
          },
        }),
      }),
      multiContext: {
        snapshot: () => ({
          contextId: "tab-event",
          isPrimaryContext: true,
          lastPrimaryContextId: "tab-event",
          lastFocusedContextId: null,
          deliveredNotificationIds: [],
        }),
        声明主上下文: () => {},
        请求聚焦当前上下文: () => {},
        通知已展示: () => false,
        登记通知已展示: () => true,
      },
      notification: {
        snapshot: () => ({
          permission: "granted" as const,
          lastClickedNotificationId: null,
          badgeCount: 0,
        }),
        请求权限: async () => "granted" as const,
        显示通知: async () => true,
        设置角标: async () => {},
        清除角标: async () => {},
        订阅点击: () => () => {},
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: false,
          queuedTaskCapability: "none" as const,
        }),
      },
    });

    const 扩展平台 = platform as unknown as {
      订阅事件?(listener: (event: unknown) => void): () => void;
      dispatch(command: { type: "ACCEPT_SERVICE_WORKER_UPDATE" }): Promise<boolean | void>;
    };
    const 捕获事件: unknown[] = [];

    扩展平台.订阅事件?.((event) => {
      捕获事件.push(event);
    });
    const 已注册监听器 = sw事件监听器;
    if (typeof 已注册监听器 === "function") {
      (已注册监听器 as (event: 服务工作线程运行时事件) => void)({
        type: "SERVICE_WORKER_UPDATE_READY",
        scope: "app",
      });
    }
    const dispatch结果 = await 扩展平台.dispatch({ type: "ACCEPT_SERVICE_WORKER_UPDATE" });

    expect(dispatch结果).toBe(true);
    expect(接受更新).toHaveBeenCalledTimes(1);
    expect(捕获事件).toEqual(
      expect.arrayContaining([{ type: "SERVICE_WORKER_UPDATE_READY", scope: "app" }])
    );
  });

  it("平台快照会继续暴露 service worker runtime 的 controller / waiting / message 状态", () => {
    const platform = 创建浏览器应用平台({
      lifecycle: {
        snapshot: () => ({ visibility: "hidden" as const, phase: "background" as const }),
        订阅: () => () => {},
      },
      storage: {
        壳层记忆: () => {
          throw new Error("not used");
        },
      },
      serviceWorker: {
        启动: async () => {},
        读取注册: () => null,
        发送消息: () => true,
        snapshot: () => ({
          workerRegistered: true,
          persistentStorageRequested: true,
          controllerAttached: true,
          workerWaiting: true,
          lastMessageType: "SW_UPDATED",
          lastMessage: { type: "SW_UPDATED", scope: "app" },
        }),
      },
      transport: 创建假传输运行时({
        接收生命周期变化: () => {},
        snapshot: () => ({
          lastLifecycle: null,
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: false,
            reason: "background" as const,
          },
        }),
      }),
      multiContext: {
        snapshot: () => ({
          contextId: "tab-c",
          isPrimaryContext: true,
          lastPrimaryContextId: "tab-c",
          lastFocusedContextId: null,
          deliveredNotificationIds: [],
        }),
        声明主上下文: () => {},
        请求聚焦当前上下文: () => {},
        通知已展示: () => false,
        登记通知已展示: () => true,
      },
      notification: {
        snapshot: () => ({
          permission: "default" as const,
          lastClickedNotificationId: null,
          badgeCount: 0,
        }),
        请求权限: async () => "default" as const,
        显示通知: async () => false,
        设置角标: async () => {},
        清除角标: async () => {},
        订阅点击: () => () => {},
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: false,
          queuedTaskCapability: "none" as const,
        }),
      },
    });

    expect(platform.snapshot().serviceWorker).toEqual({
      workerRegistered: true,
      persistentStorageRequested: true,
      controllerAttached: true,
      workerWaiting: true,
      lastMessageType: "SW_UPDATED",
      lastMessage: { type: "SW_UPDATED", scope: "app" },
    });
  });

  it("controllerchange 后只有主上下文允许推进应用刷新完成态", async () => {
    let 服务工作线程事件监听器: ((event: 服务工作线程运行时事件) => void) | null = null;
    let 多上下文事件监听器:
      | ((event: {
          type: "PRIMARY_CONTEXT_CHANGED";
          contextId: string;
          isPrimaryContext: boolean;
        }) => void)
      | null = null;
    const 平台事件记录: Array<{ type: string; scope?: "app" | "media" }> = [];
    const 多上下文快照 = {
      contextId: "tab-a",
      isPrimaryContext: false,
      lastPrimaryContextId: null as string | null,
      lastFocusedContextId: null,
      deliveredNotificationIds: [],
    };

    const platform = 创建浏览器应用平台({
      lifecycle: {
        snapshot: () => ({ visibility: "visible" as const, phase: "active" as const }),
        订阅: () => () => {},
      },
      storage: {
        壳层记忆: () => {
          throw new Error("not used");
        },
      },
      serviceWorker: {
        启动: async () => {},
        读取注册: () => null,
        订阅事件: (listener) => {
          服务工作线程事件监听器 = listener;
          return () => {
            服务工作线程事件监听器 = null;
          };
        },
        snapshot: () => ({
          workerRegistered: true,
          persistentStorageRequested: false,
          controllerAttached: false,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
      },
      transport: 创建假传输运行时({
        接收生命周期变化: () => {},
        snapshot: () => ({
          lastLifecycle: { visibility: "visible" as const, phase: "active" as const },
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: true,
            reason: "active" as const,
          },
        }),
      }),
      multiContext: {
        snapshot: () => ({ ...多上下文快照 }),
        订阅事件: (listener) => {
          多上下文事件监听器 = listener;
          return () => {
            多上下文事件监听器 = null;
          };
        },
        声明主上下文: () => {},
        请求聚焦当前上下文: () => {},
        通知已展示: () => false,
        登记通知已展示: () => true,
      },
      notification: {
        snapshot: () => ({
          permission: "granted" as const,
          lastClickedNotificationId: null,
          badgeCount: 0,
        }),
        请求权限: async () => "granted" as const,
        显示通知: async () => true,
        设置角标: async () => {},
        清除角标: async () => {},
        订阅点击: () => () => {},
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: true,
          queuedTaskCapability: "background-sync" as const,
        }),
      },
    });
    platform.订阅事件?.((event) => {
      平台事件记录.push(event);
    });

    await platform.启动();
    const 派发服务工作线程事件 =
      服务工作线程事件监听器 as
        | ((event: 服务工作线程运行时事件) => void)
        | null;
    if (派发服务工作线程事件) {
      派发服务工作线程事件({
        type: "SERVICE_WORKER_UPDATE_READY",
        scope: "app",
      });
      派发服务工作线程事件({
        type: "SERVICE_WORKER_CONTROLLER_READY",
      });
    }

    expect(平台事件记录).toContainEqual({
      type: "SERVICE_WORKER_UPDATE_READY",
      scope: "app",
    });
    expect(平台事件记录).not.toContainEqual({
      type: "SERVICE_WORKER_CONTROLLER_READY",
    });
    expect(platform.snapshot().cacheUpdate).toMatchObject({
      updateState: "waiting_refresh",
      controllerReadyPending: true,
      controllerReadyContextId: null,
    });

    多上下文快照.isPrimaryContext = true;
    多上下文快照.lastPrimaryContextId = "tab-a";
    const 派发多上下文事件 =
      多上下文事件监听器 as
        | ((event: {
            type: "PRIMARY_CONTEXT_CHANGED";
            contextId: string;
            isPrimaryContext: boolean;
          }) => void)
        | null;
    if (派发多上下文事件) {
      派发多上下文事件({
        type: "PRIMARY_CONTEXT_CHANGED",
        contextId: "tab-a",
        isPrimaryContext: true,
      });
    }

    expect(平台事件记录).toContainEqual({
      type: "SERVICE_WORKER_CONTROLLER_READY",
    });
    expect(platform.snapshot().cacheUpdate).toMatchObject({
      updateState: "idle",
      controllerReadyContextId: "tab-a",
    });
  });

  it("存储驱逐只通过稳定缓存更新事件发布 acceleration loss，不直接 patch 壳层", async () => {
    let 存储事件监听器:
      | ((event: { type: "STORAGE_EVICTION_DETECTED" }) => void)
      | null = null;
    const 平台事件记录: 浏览器应用平台事件[] = [];
    const platform = 创建浏览器应用平台({
      lifecycle: {
        snapshot: () => ({ visibility: "visible" as const, phase: "active" as const }),
        订阅: () => () => {},
      },
      storage: {
        壳层记忆: () => {
          throw new Error("not used");
        },
        订阅事件: (listener) => {
          存储事件监听器 = listener as typeof 存储事件监听器;
          return () => {
            存储事件监听器 = null;
          };
        },
      },
      serviceWorker: {
        启动: async () => {},
        读取注册: () => null,
        订阅事件: () => () => {},
        snapshot: () => ({
          workerRegistered: true,
          persistentStorageRequested: false,
          controllerAttached: true,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
      },
      transport: 创建假传输运行时({
        接收生命周期变化: () => {},
        snapshot: () => ({
          lastLifecycle: { visibility: "visible" as const, phase: "active" as const },
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: true,
            reason: "active" as const,
          },
        }),
      }),
      multiContext: {
        snapshot: () => ({
          contextId: "tab-a",
          isPrimaryContext: true,
          lastPrimaryContextId: "tab-a",
          lastFocusedContextId: null,
          deliveredNotificationIds: [],
        }),
        订阅事件: () => () => {},
        声明主上下文: () => {},
        请求聚焦当前上下文: () => {},
        通知已展示: () => false,
        登记通知已展示: () => true,
      },
      notification: {
        snapshot: () => ({
          permission: "granted" as const,
          lastClickedNotificationId: null,
          badgeCount: 0,
        }),
        请求权限: async () => "granted" as const,
        显示通知: async () => true,
        设置角标: async () => {},
        清除角标: async () => {},
        订阅点击: () => () => {},
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: true,
          queuedTaskCapability: "background-sync" as const,
        }),
      },
    });
    platform.订阅事件?.((event) => {
      平台事件记录.push(event);
    });

    const 派发存储事件 = 存储事件监听器 as
      | ((event: { type: "STORAGE_EVICTION_DETECTED" }) => void)
      | null;
    派发存储事件?.({ type: "STORAGE_EVICTION_DETECTED" });

    expect(platform.snapshot().cacheUpdate).toMatchObject({
      accelerationState: "acceleration_loss",
    });
    expect(平台事件记录).toContainEqual({
      type: "CACHE_UPDATE_CHANGED",
      snapshot: expect.objectContaining({
        accelerationState: "acceleration_loss",
      }),
    });
  });
});
