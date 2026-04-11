import {
  创建附件能力注册表,
  type 附件能力定义,
  type 统一媒体文件选择配置,
} from "./附件能力注册.js";

export interface 附件入口辅助槽状态 {
  visible: boolean;
  disabled: boolean;
}

type 附件入口编排依赖 = {
  auxSlot: 附件入口辅助槽状态;
  获取统一媒体文件输入(): HTMLInputElement | null;
  处理选择媒体文件(files: Iterable<File>): Promise<void>;
};

export interface 附件入口编排结果 {
  能力列表: 附件能力定义[];
  统一媒体文件选择配置: 统一媒体文件选择配置;
  执行默认附件能力(): void;
  处理统一媒体文件变更(event: Event): Promise<void>;
}

/**
 * 附件入口编排只做壳层动作编排，不做媒体事实判断：
 * 1. 哪些能力存在，来自注册表；
 * 2. 点按钮时要不要触发 input，取决于当前 auxSlot 状态；
 * 3. 选中文件后只负责把文件转交给媒体发布器，并清空 input.value。
 *
 * 这样可以把 DOM 交互细节从聊天壳里抽出来，
 * 也避免让媒体模块反向持有按钮、selector 和点击时机。
 */
export function 创建操作台附件入口编排(
  deps: 附件入口编排依赖
): 附件入口编排结果 {
  const 注册表 = 创建附件能力注册表();
  const 默认能力 = 注册表.能力列表.find(
    (capability) => capability.id === 注册表.默认能力标识
  );

  const 附件入口可执行 = (): boolean => deps.auxSlot.visible && !deps.auxSlot.disabled;

  return {
    能力列表: 注册表.能力列表,
    统一媒体文件选择配置: 注册表.统一媒体文件选择配置,

    执行默认附件能力(): void {
      if (!附件入口可执行()) {
        return;
      }
      if (默认能力?.triggerStrategy !== "direct") {
        return;
      }
      /**
       * Web 官方对隐藏 file input 的自定义入口示例，仍然是按钮点击后触发 `input.click()`。
       * 这里保持这条最保守、最可预期的主路径，不再把 `showPicker()` 当成默认依赖。
       */
      deps.获取统一媒体文件输入()?.click();
    },

    async 处理统一媒体文件变更(event: Event): Promise<void> {
      const input = event.currentTarget as HTMLInputElement | null;
      if (!input?.files || input.files.length === 0) {
        return;
      }
      const selectedFiles = Array.from(input.files);
      /**
       * 同一文件连续重选时，原生 file input 只有在 value 被清空后才会再次触发 change。
       * 这里把重置动作固化在统一入口编排里，避免聊天壳和未来其他壳重复抄一遍。
       */
      input.value = "";
      await deps.处理选择媒体文件(selectedFiles);
    },
  };
}
