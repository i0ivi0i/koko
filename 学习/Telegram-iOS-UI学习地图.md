# Telegram iOS UI 学习地图

## 边界

- 学习对象：`E:\koko\学习\Telegram-iOS`
- 学习仓快照：`b3d4c97d`
- 目标：学习 Telegram iOS 的 UI 元素设计、交互层次、信息架构、暗色主题处理和转场语气。
- 禁止漂移：不要把这份仓库当成“直接抄代码实现”的来源，先看界面元素和产品表达，再决定自己的壳层如何复刻。

## 建议学习顺序

### 1. 会话列表主入口

- 路径：`E:\koko\学习\Telegram-iOS\submodules\ChatListUI\Sources`
- 先看文件：
  - `ChatListController.swift`
  - `ChatListControllerNode.swift`
  - `Node\ChatListItem.swift`
  - `Node\ChatListBadgeNode.swift`
  - `Node\ChatListTypingNode.swift`
  - `Node\ChatListViewTransition.swift`
- 重点学习：
  - 会话列表 cell 的信息密度
  - 时间、未读、打字态、归档态如何叠层
  - 列表进入搜索、进入聊天时的层级切换语气
  - 空态和 shimmer 如何保持 Telegram 的“轻而不空”

### 2. 搜索栏与搜索容器

- 路径：`E:\koko\学习\Telegram-iOS\submodules\SearchBarNode\Sources`
- 先看文件：
  - `SearchBarNode.swift`
  - `SearchBarPlaceholderNode.swift`
- 重点学习：
  - iOS 风格搜索栏的圆角、内边距、占位文本和图标位置
  - 激活前后、输入中、取消搜索时的状态层次
  - 搜索栏作为“导航层附属物”而不是普通 input 的表达方式

### 3. 列表页的搜索结果层

- 路径：`E:\koko\学习\Telegram-iOS\submodules\ChatListUI\Sources`
- 先看文件：
  - `ChatListSearchContainerNode.swift`
  - `ChatListSearchListPaneNode.swift`
  - `ChatListSearchPaneContainerNode.swift`
  - `ChatListSearchMediaNode.swift`
- 重点学习：
  - 搜索结果如何接到原聊天列表之上，而不是突兀切页
  - 搜索结果分层、分组、切 pane 的方式
  - 搜索态与正常列表态之间的视觉连续性

### 4. 底部输入区骨架

- 路径：`E:\koko\学习\Telegram-iOS\submodules\AttachmentTextInputPanelNode\Sources`
- 先看文件：
  - `AttachmentTextInputPanelNode.swift`
  - `AttachmentTextInputActionButtonsNode.swift`
- 重点学习：
  - 聊天输入区的整体几何形态
  - 输入框、附件按钮、发送按钮之间的节奏关系
  - 空输入、有输入、附件展开时的层次变化

### 5. 更细的聊天输入组件

- 路径：`E:\koko\学习\Telegram-iOS\submodules\TelegramUI\Components\ChatInputNode\Sources`
- 先看文件：
  - `ChatInputNode.swift`
- 重点学习：
  - 文本输入区内部的细节排布
  - 文本、占位、光标、发送触发、状态切换的视觉语气
  - 为什么 Telegram 的输入区看起来像系统组件但又比系统更精致

### 6. 底部标签栏

- 路径：`E:\koko\学习\Telegram-iOS\submodules\TabBarUI\Sources`
- 先看文件：
  - `TabBarController.swift`
  - `TabBarContollerNode.swift`
  - `TabBarNode.swift`
- 重点学习：
  - Telegram iOS 标签栏图标、选中态、浮层感
  - 深色主题下 tab bar 如何既稳又不闷
  - 你的 Web 壳如果未来扩成多入口，这里是最值得复刻的参考

### 7. 视觉资源与图标语言

- 路径：
  - `E:\koko\学习\Telegram-iOS\submodules\TelegramUI\Images.xcassets`
  - `E:\koko\学习\Telegram-iOS\Telegram\Telegram-iOS\Icons.xcassets`
- 重点学习：
  - Chat List、Avatar、Tabs 这些分组如何组织图标语言
  - Telegram iOS 图标为什么显得“轻、准、干净”
  - 哪些元素用矢量 pdf，哪些用位图，哪些是主题变体

### 8. 暗色背景、毛玻璃、上下文层

- 路径：
  - `E:\koko\学习\Telegram-iOS\submodules\WallpaperBackgroundNode\Sources`
  - `E:\koko\学习\Telegram-iOS\submodules\ContextUI\Sources`
  - `E:\koko\学习\Telegram-iOS\submodules\UndoUI\Sources`
  - `E:\koko\学习\Telegram-iOS\submodules\TelegramUI\Resources\Animations`
- 先看文件：
  - `WallpaperBackgroundNode.swift`
  - `ContextController.swift`
  - `UndoOverlayController.swift`
- 重点学习：
  - Telegram 的暗色背景不是单一底色，而是前后景分层
  - 长按菜单、浮层、撤销提示为什么看起来像原生 iOS，不像 Web 弹窗
  - 动效资源如何只在关键时刻出现，不把界面做油

## 现在先别深挖的目录

### 可先跳过的大目录

- `E:\koko\学习\Telegram-iOS\third-party`
  - 基本是依赖和底层库，不是 UI 复刻入口。
- `E:\koko\学习\Telegram-iOS\build-system`
  - 构建体系，不提供界面语言价值。
- `E:\koko\学习\Telegram-iOS\buildbox`
  - 构建环境，不值得为 UI 复刻花时间。
- `E:\koko\学习\Telegram-iOS\tools`
  - 工具链，不是产品界面表达。
- `E:\koko\学习\Telegram-iOS\scripts`
  - 构建和维护脚本，不是当前重点。
- `E:\koko\学习\Telegram-iOS\Tests`
  - 测试对验证有用，但对先学 UI 元素帮助有限。
- `E:\koko\学习\Telegram-iOS\Telegram\Watch`
  - watchOS 交互语言和 iPhone 主壳差异太大。
- `E:\koko\学习\Telegram-iOS\Telegram\WidgetKitWidget`
  - Widget 适合以后补充，但不是聊天主壳优先级。

### 可暂缓的大型子模块

- `AdUI`
- `BotPaymentsUI`
- `GraphUI`
- `PremiumUI`
- `SettingsUI`
- `StatisticsUI`
- `WebUI`

这些模块也有界面价值，但会把注意力带离“聊天列表 / 搜索 / 聊天页 / 输入区 / 暗色层次”这条主线。

## 建议你接下来怎么学

1. 先只看 `ChatListUI`、`SearchBarNode`、`AttachmentTextInputPanelNode`。
2. 一边看路径，一边对照 App Store 截图或真机 Telegram，先记“元素长什么样”，不要急着问“它怎么实现”。
3. 看完再回到 `koko`，把我们自己的页面拆成：
   - 顶部导航
   - 搜索栏
   - 会话列表 cell
   - 聊天气泡
   - 输入区
   - 浮层/错误/撤销提示
4. 最后才决定哪些细节要复刻到 CSS，哪些必须靠交互编排补上。
