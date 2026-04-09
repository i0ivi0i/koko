import {
  layout,
  layoutWithLines,
  measureNaturalWidth,
  prepareWithSegments,
  type PrepareOptions,
} from "@chenglou/pretext";
import {
  materializeRichInlineLineRange,
  measureRichInlineStats,
  prepareRichInline,
  walkRichInlineLineRanges,
} from "@chenglou/pretext/rich-inline";

export type 文本白空格模式 = "normal" | "pre-wrap";
export type 文本断词模式 = "normal" | "keep-all";
export type 富文本片段种类 = "text" | "code" | "chip" | "link";
export type 文本收缩策略 = "same-line-count";

export interface 文本布局环境 {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  whiteSpace?: 文本白空格模式;
  wordBreak?: 文本断词模式;
}

export interface 纯文本布局输入 extends 文本布局环境 {
  text: string;
  width: number;
  shrinkWrap?: 文本收缩策略;
}

export interface 富文本片段输入 {
  kind: 富文本片段种类;
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  break?: "normal" | "never";
  extraWidth?: number;
}

export interface 富文本布局输入 extends 文本布局环境 {
  width: number;
  segments: 富文本片段输入[];
}

export interface 文本布局片段 {
  kind: 富文本片段种类;
  text: string;
}

export interface 文本布局行 {
  index: number;
  width: number;
  text: string;
  segments: 文本布局片段[];
}

export interface 文本布局结果 {
  height: number;
  lineCount: number;
  naturalWidth: number;
  maxLineWidth: number;
  lines: 文本布局行[];
}

const 极大布局宽度 = 1_000_000;

/**
 * 这里是当前 Web 前端唯一的文本布局主权层。
 *
 * 关键边界：
 * 1. 只薄封装 Pretext 与 rich-inline，不在这里私造第二排版引擎；
 * 2. 只负责“文本几何与逐行结果”，不碰 DOM、滚动、恢复或业务状态；
 * 3. 缓存只围绕官方 prepare 结果展开，避免每次重算都重新测量文本。
 */
export function 创建文本布局器() {
  const 纯文本预处理缓存 = new Map<string, ReturnType<typeof prepareWithSegments>>();
  const 富文本预处理缓存 = new Map<string, ReturnType<typeof prepareRichInline>>();

  return {
    布局纯文本(input: 纯文本布局输入): 文本布局结果 {
      const 预处理结果 = 读取或创建纯文本预处理(input, 纯文本预处理缓存);
      const 初始布局结果 = layoutWithLines(预处理结果, input.width, input.lineHeight);
      const 最终布局宽度 =
        input.shrinkWrap === "same-line-count"
          ? 查找保持相同行数的最窄宽度(预处理结果, input.width, 初始布局结果.lineCount, input.lineHeight)
          : input.width;
      const 布局结果 =
        最终布局宽度 === input.width
          ? 初始布局结果
          : layoutWithLines(预处理结果, 最终布局宽度, input.lineHeight);
      const maxLineWidth = 读取最宽行宽度(布局结果.lines);

      return {
        height: 布局结果.height,
        lineCount: 布局结果.lineCount,
        naturalWidth: measureNaturalWidth(预处理结果),
        maxLineWidth,
        lines: 布局结果.lines.map((line, index) => ({
          index,
          width: line.width,
          text: line.text,
          segments: [
            {
              kind: "text",
              text: line.text,
            },
          ],
        })),
      };
    },

    布局富文本(input: 富文本布局输入): 文本布局结果 {
      const 预处理结果 = 读取或创建富文本预处理(input, 富文本预处理缓存);
      const 统计结果 = measureRichInlineStats(预处理结果, input.width);
      const 单行自然宽度统计 = measureRichInlineStats(预处理结果, 极大布局宽度);
      const lines: 文本布局行[] = [];

      walkRichInlineLineRanges(预处理结果, input.width, (lineRange) => {
        const line = materializeRichInlineLineRange(预处理结果, lineRange);
        lines.push({
          index: lines.length,
          width: line.width,
          text: line.fragments.map((fragment) => fragment.text).join(""),
          segments: line.fragments.map((fragment) => ({
            kind: input.segments[fragment.itemIndex]?.kind ?? "text",
            text: fragment.text,
          })),
        });
      });

      return {
        height: 统计结果.lineCount * input.lineHeight,
        lineCount: 统计结果.lineCount,
        naturalWidth: 单行自然宽度统计.maxLineWidth,
        maxLineWidth: lines.reduce((max, line) => Math.max(max, line.width), 0),
        lines,
      };
    },
  };
}

/**
 * 当前 Web 前端统一复用这一份布局器实例：
 * - 消息展示项和输入区共享同一套 prepare 缓存；
 * - 避免同一个页面里为了不同宿主再养多份重复测量状态。
 */
export const 默认文本布局器 = 创建文本布局器();

function 读取或创建纯文本预处理(
  input: 纯文本布局输入,
  cache: Map<string, ReturnType<typeof prepareWithSegments>>
): ReturnType<typeof prepareWithSegments> {
  const key = JSON.stringify({
    text: input.text,
    font: 构建字体简写(input),
    whiteSpace: input.whiteSpace ?? "normal",
    wordBreak: input.wordBreak ?? "normal",
  });
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const prepared = prepareWithSegments(input.text, 构建字体简写(input), 构建布局选项(input));
  cache.set(key, prepared);
  return prepared;
}

function 读取或创建富文本预处理(
  input: 富文本布局输入,
  cache: Map<string, ReturnType<typeof prepareRichInline>>
): ReturnType<typeof prepareRichInline> {
  const items = input.segments.map((segment) => {
    const item = {
      text: segment.text,
      font: 构建字体简写({
        fontFamily: segment.fontFamily ?? input.fontFamily,
        fontSize: segment.fontSize ?? input.fontSize,
        fontWeight: segment.fontWeight ?? input.fontWeight,
      }),
      ...(segment.break ? { break: segment.break } : {}),
      ...(segment.extraWidth !== undefined ? { extraWidth: segment.extraWidth } : {}),
    };
    return item;
  });
  const key = JSON.stringify(items);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const prepared = prepareRichInline(items);
  cache.set(key, prepared);
  return prepared;
}

function 构建字体简写(input: {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
}): string {
  /**
   * Pretext 直接消费 canvas `font` shorthand。
   * 这里统一在一处组装，避免调用方到处拼字符串导致字体规则漂移。
   */
  return `${input.fontWeight} ${input.fontSize}px ${input.fontFamily}`;
}

function 构建布局选项(input: 文本布局环境): PrepareOptions {
  return {
    whiteSpace: input.whiteSpace ?? "normal",
    wordBreak: input.wordBreak ?? "normal",
  };
}

function 查找保持相同行数的最窄宽度(
  prepared: ReturnType<typeof prepareWithSegments>,
  maxWidth: number,
  targetLineCount: number,
  lineHeight: number
): number {
  /**
   * 这里直接照官方 bubbles demo 的思路：
   * 1. 先拿当前最大宽度下的目标行数；
   * 2. 再二分搜索“仍然不增加行数”的最窄宽度；
   * 3. 最后再按这个更紧的宽度 materialize 最终逐行结果。
   *
   * 这样消息气泡不会只停在“浏览器 fit-content 风格”的最宽一行，
   * 而会像官方 demo 一样，在相同行数下继续压掉最后一行后的浪费空间。
   */
  if (targetLineCount <= 1) {
    return maxWidth;
  }

  let lo = 1;
  let hi = Math.max(1, Math.ceil(maxWidth));

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const lineCount = layout(prepared, mid, lineHeight).lineCount;
    if (lineCount <= targetLineCount) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  return lo;
}

function 读取最宽行宽度(lines: Array<{ width: number }>): number {
  return lines.reduce((max, line) => Math.max(max, line.width), 0);
}
