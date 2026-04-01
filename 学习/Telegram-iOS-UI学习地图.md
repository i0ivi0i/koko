# Telegram iOS UI 学习地图

目标：只学习 Telegram iOS 的 UI 元素、交互层次、视觉节奏与资源组织，不把实现代码当直接模仿对象。

## 先看什么

1. [submodules/ChatListUI/Sources/ChatListController.swift](/E:/koko/学习/Telegram-iOS/submodules/ChatListUI/Sources/ChatListController.swift)
看聊天列表页的总入口，重点学页面层级、顶部区域、搜索切入点、列表状态切换，不深挖内部实现。

2. [submodules/ChatListUI/Sources/ChatListControllerNode.swift](/E:/koko/学习/Telegram-iOS/submodules/ChatListUI/Sources/ChatListControllerNode.swift)
看聊天列表页主骨架，重点学导航栏和列表主体之间的空间关系、滚动驱动的层次变化。

3. [submodules/ChatListUI/Sources/Node/ChatListItem.swift](/E:/koko/学习/Telegram-iOS/submodules/ChatListUI/Sources/Node/ChatListItem.swift)
看单个会话 cell 的组成，重点学头像、标题、预览、时间、未读徽标、分隔与按压态这些元素应该如何组合。

4. [submodules/ChatListUI/Sources/ChatListSearchContainerNode.swift](/E:/koko/学习/Telegram-iOS/submodules/ChatListUI/Sources/ChatListSearchContainerNode.swift)
看聊天列表搜索态，重点学搜索栏进入后页面如何切层、搜索结果和原列表如何分离。

5. [submodules/SearchBarNode](/E:/koko/学习/Telegram-iOS/submodules/SearchBarNode)
看通用搜索栏组件，重点学 iOS 风格搜索框本体、占位文案、取消动作、焦点态与容器材质。

6. [submodules/Display/Source/NavigationBar.swift](/E:/koko/学习/Telegram-iOS/submodules/Display/Source/NavigationBar.swift)
看导航栏系统，重点学返回按钮、标题、背景材质、滚动时的层次变化，不关注底层绘制细节。

7. [submodules/Display/Source/NavigationBackButtonNode.swift](/E:/koko/学习/Telegram-iOS/submodules/Display/Source/NavigationBackButtonNode.swift)
看 Telegram iOS 返回控件，重点学箭头、文案、点击热区和视觉密度。

8. [submodules/Display/Source/NavigationTransitionCoordinator.swift](/E:/koko/学习/Telegram-iOS/submodules/Display/Source/NavigationTransitionCoordinator.swift)
看页面推进/返回时的过渡组织，重点学“层级推进感”而不是具体动画代码。

9. [submodules/TelegramUI/Components/Chat](/E:/koko/学习/Telegram-iOS/submodules/TelegramUI/Components/Chat)
看聊天页总目录，重点学聊天页由哪些视觉区块构成：顶部栏、消息流、气泡、输入区、附件区、搜索态。

10. [submodules/TelegramUI/Components/ChatInputNode](/E:/koko/学习/Telegram-iOS/submodules/TelegramUI/Components/ChatInputNode)
看聊天输入区，重点学输入框、附件按钮、发送按钮、录音/动作按钮的布局关系和状态切换。

11. [submodules/TelegramUI/Components/ChatInputPanelContainer](/E:/koko/学习/Telegram-iOS/submodules/TelegramUI/Components/ChatInputPanelContainer)
看输入区与键盘、附件面板、底部安全区之间的衔接方式，重点学“底部工具带”的层次感。

12. [submodules/AttachmentTextInputPanelNode/Sources/AttachmentTextInputPanelNode.swift](/E:/koko/学习/Telegram-iOS/submodules/AttachmentTextInputPanelNode/Sources/AttachmentTextInputPanelNode.swift)
看带附件入口的文本输入面板，重点学输入区并不是一个普通圆角 input，而是复合操作条。

13. [submodules/ChatMessageBackground/Sources/ChatMessageBackground.swift](/E:/koko/学习/Telegram-iOS/submodules/ChatMessageBackground/Sources/ChatMessageBackground.swift)
看消息气泡背景系统，重点学来消息、去消息、选中态、上下文态的视觉边界。

14. [submodules/TelegramUI/Images.xcassets/Chat](/E:/koko/学习/Telegram-iOS/submodules/TelegramUI/Images.xcassets/Chat)
看聊天相关图标与资源，重点学搜索、输入区、上下文菜单、空态、消息内图标的图形语言。

15. [submodules/WallpaperBackgroundNode](/E:/koko/学习/Telegram-iOS/submodules/WallpaperBackgroundNode)
看聊天背景层，重点学 Telegram 为什么不是简单纯色背景，而是有专门的壁纸与边缘光感处理。

16. [submodules/TelegramPresentationData](/E:/koko/学习/Telegram-iOS/submodules/TelegramPresentationData)
看主题和展示数据入口，重点学暗色主题、强调色、文本层级和不同界面的一致性约束。

## 第二轮再看

1. [submodules/TelegramUI/Components/ChatList](/E:/koko/学习/Telegram-iOS/submodules/TelegramUI/Components/ChatList)
补聊天列表页的组件化细节，适合在你已经知道整体骨架之后再看。

2. [submodules/ChatListSearchRecentPeersNode](/E:/koko/学习/Telegram-iOS/submodules/ChatListSearchRecentPeersNode)
补搜索历史、最近联系人这类辅助搜索层。

3. [submodules/TelegramUI/Components/SearchInputPanelComponent](/E:/koko/学习/Telegram-iOS/submodules/TelegramUI/Components/SearchInputPanelComponent)
补搜索输入区在不同场景下的视觉统一性。

4. [submodules/TabBarUI](/E:/koko/学习/Telegram-iOS/submodules/TabBarUI)
如果后面要做完整 Telegram 主壳，再学底部 tab 的密度、材质和徽标节奏。

5. [submodules/ContextUI](/E:/koko/学习/Telegram-iOS/submodules/ContextUI)
如果后面要补长按菜单和预览层，再学上下文菜单的层级与阴影语言。

## 目前可以跳过

- [Telegram/Watch](/E:/koko/学习/Telegram-iOS/Telegram/Watch)
这是 Apple Watch 壳，不是我们当前复刻目标。

- [Telegram/WidgetKitWidget](/E:/koko/学习/Telegram-iOS/Telegram/WidgetKitWidget)
这是桌面小组件和 Widget 相关，不影响聊天主壳复刻。

- [Telegram/NotificationService](/E:/koko/学习/Telegram-iOS/Telegram/NotificationService)
偏通知扩展，不是前台聊天壳设计入口。

- [Telegram/Share](/E:/koko/学习/Telegram-iOS/Telegram/Share)
偏系统分享扩展，不是主聊天流程。

- [submodules/MtProtoKit](/E:/koko/学习/Telegram-iOS/submodules/MtProtoKit)
这是协议和网络层，和 UI 学习无关。

- [submodules/TelegramCore](/E:/koko/学习/Telegram-iOS/submodules/TelegramCore)
这是核心业务和数据层，当前目标不需要看。

- [submodules/Postbox](/E:/koko/学习/Telegram-iOS/submodules/Postbox)
这是存储层，对 UI 复刻没有直接价值。

- [third-party](/E:/koko/学习/Telegram-iOS/third-party)
第三方依赖目录，当前完全不需要碰。

## 学习顺序建议

1. 先看导航栏和页面层级：`Display/Navigation*`。
2. 再看聊天列表：`ChatListUI`。
3. 再看搜索：`SearchBarNode`、`ChatListSearch*`。
4. 再看聊天页：`TelegramUI/Components/Chat`。
5. 再看输入区和发送动作：`ChatInputNode`、`AttachmentTextInputPanelNode`、`MessageInput*`。
6. 最后补资源与主题：`Images.xcassets/Chat`、`WallpaperBackgroundNode`、`TelegramPresentationData`。

## 读法约束

- 看文件名、目录名、资源名、少量结构入口，先建立“UI 由哪些层组成”的地图。
- 不要一开始就跟着函数实现往下钻。
- 不要把 Telegram 的业务逻辑、网络逻辑、状态管理当作复刻目标。
- 我们要复刻的是：视觉元素、间距节奏、层级关系、搜索与导航交互、聊天输入区气质。
- 我们不要复刻的是：它的整套工程结构、协议实现、业务状态机。
