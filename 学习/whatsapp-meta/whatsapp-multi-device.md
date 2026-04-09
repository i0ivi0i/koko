# WhatsApp 如何实现多设备功能 - Meta 工程团队

- 来源：https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/
- 抓取日期：2026-04-04
- 抓取方式：Chrome CDP 正文抽取

---

发布于2021年7月14日安全与隐私
WhatsApp 如何实现多设备功能

多年来，人们一直要求我们打造真正的多设备体验，让人们无需连接智能手机即可在其他设备上使用 WhatsApp。

今天，我们宣布推出 WhatsApp 更新后的多设备功能的有限公开测试版。 

有了这项新功能，您现在可以在手机和最多四台其他非手机设备上同时使用 WhatsApp——即使您的手机没电了。每台设备都会独立连接到您的 WhatsApp，并通过端到端加密保持 WhatsApp 用户所期望的隐私和安全级别。更重要的是，我们开发了新技术，在保持端到端加密的同时，还能跨设备同步您的数据，例如联系人姓名、聊天记录、星标消息等等。

为了实现这一目标，我们不得不重新思考 WhatsApp 的架构，并设计新的系统，以实现独立的跨设备体验，同时保护隐私和端到端加密。 

把智能手机排除在外

目前，WhatsApp 在网页、macOS、Windows 和 Portal 上的配套设备体验以智能手机应用为主要设备，手机成为所有用户数据的唯一来源，也是唯一能够对其他用户的消息进行端到端加密、发起通话等的设备。配套设备与手机保持持续的安全连接，并在其自身的用户界面上镜像手机内容。

这种架构能够轻松实现手机和配套设备之间的无缝同步体验，同时确保安全性。然而，它也带来了一些显著的可靠性方面的妥协：由于所有操作都由手机执行，配套设备运行速度较慢，且经常断开连接——尤其是在手机信号差、电量不足或应用程序进程被手机操作系统终止的情况下。此外，它还限制了同一时间只能有一个配套设备处于运行状态，这意味着用户无法在Portal上通话的同时，在电脑上查看消息。 

新的 WhatsApp 多设备架构消除了这些障碍，不再需要智能手机作为数据来源，同时还能无缝、安全地同步用户数据并保护用户隐私。

实现这一目标的挑战在于，如何在不以新的方式将用户的私人信息存储在我们的服务器上的情况下，保持跨设备的安全性用户体验。

应对多设备的安全挑战

在推出多设备功能之前，WhatsApp 上的每个用户都使用同一个身份密钥进行标识，所有加密通信密钥均由此密钥派生而来。而启用多设备功能后，每个设备都拥有了自己的身份密钥。

WhatsApp 服务器维护着每个用户帐户与其所有设备标识之间的映射关系。当用户想要发送消息时，他们会从服务器获取设备列表密钥。  

我们还解决了防止恶意或被入侵的服务器通过秘密地将设备添加到用户帐户来窃听通信的难题。我们采用多种技术相结合的方式来解决这个问题：首先，我们扩展了安全码，使其能够代表用户所有设备身份的组合，这样任何人及其联系人都可以随时验证他们正在发送消息的所有设备。 

其次，为了减少用户进行身份验证的次数，我们开发并将推广一项名为“自动设备验证”的技术。该系统允许设备之间自动建立信任关系，用户只需在重新注册整个账户时比对其他用户的安全码，而无需每次将新设备关联到账户时都进行验证。 

最后，我们还为用户提供了更多控制权和保护措施，让他们可以自行管理哪些设备已关联到自己的账户。首先，用户仍然可以通过手机扫描二维码来关联新的伴侣设备。如果用户的手机已启用生物识别认证，则此过程需要先进行生物识别认证才能完成关联。此外，用户还可以查看所有已关联到自己账户的伴侣设备及其上次使用时间，并可根据需要远程注销这些设备。 

维护消息隐私

当用户进行一对一聊天时，发送方和接收方的设备之间会建立成对加密会话。WhatsApp 多设备功能采用客户端扇出方式， 即发送消息的 WhatsApp 客户端会将消息加密并多次发送到发送方和接收方设备列表中的N 个不同设备。每条消息都使用与每个设备建立的成对加密会话进行单独加密。消息送达后不会存储在服务器上。对于群组聊天，我们仍然使用 Signal 协议中相同的可扩展发送方密钥加密方案。

WhatsApp 的传统架构以智能手机作为信息来源。但借助全新的多设备功能，最多可以有四台其他非手机设备独立连接到 WhatsApp，同时仍能保持同等的隐私和安全级别。

针对多设备端到端加密，调整语音和视频协议  

当 WhatsApp 上的某人发起语音或视频通话时：

The initiator generates a set of random 32-byte SRTP master secrets for each of the recipient’s devices.

The initiator sends an incoming call message (using the client-fanout approach described above) to each of the devices of the recipient. Each recipient’s device receives this message, which contains the encrypted SRTP master secret.
If the responder answers the call from one of the devices, a SRTP encrypted call is started, protected by the SRTP master secret generated for that device.

The SRTP master secret persists in memory on the client device and is used only during the call. Our servers do not have access to the SRTP master secrets.

For group calls, the server randomly selects a participant device that is in the call (either the initiator or a device on which a user has accepted the call) to generate the SRTP master secret. That device generates the secret and sends it to other active participant devices through pairwise end-to-end encryption. This process is repeated, and the keys are reset whenever someone joins or leaves the call.

Keeping message history and other application states in sync across devices

We want to ensure that people have a consistent experience with WhatsApp no matter the device they are using. To achieve this, we synchronize message history as well as other application state data (such as contact names, whether a chat is archived, or if a message is starred) across devices. All of this data is synchronized and end-to-end encrypted between your devices.

For message history: When a companion device is linked, the primary device encrypts a bundle of the messages from recent chats and transfers them to the newly linked device. The key to this encrypted message history blob is delivered to the newly linked device via an end-to-end encrypted message. After the companion device downloads, decrypts, unpacks, and stores the messages securely, the keys are deleted. From that point forward, the companion device accesses the message history from its own local database.

Other application data requires more than an initial transfer from the phone. We also need an ongoing synchronization every time someone modifies their application state (e.g., when they add a new contact, mute a chat, or star a message).

To solve this, the WhatsApp server securely stores a copy of each application state that all of someone’s devices can access. To properly secure this, all the information, and even the metadata about the information (what kind of user data is stored or accessed), is end-to-end encrypted with constantly changing keys known only to that person’s devices. 

How to try WhatsApp multi-device beta 

我们计划先从现有测试计划中的一小部分用户中测试这项功能。在逐步扩大推广范围之前，我们会持续优化性能并添加一些其他功能。选择参与的用户随时可以退出。

有关测试版的更多信息以及注册，请访问WhatsApp 帮助中心。

有关 WhatsApp 多设备支持的更多信息，请阅读我们更新后的白皮书。

分享此内容：
 Facebook 线程 WhatsApp LinkedIn Reddit X 蓝天 乳齿象Hacker News 电子邮件
标签：       WHATSAPP
Prev
Enforcing encryption at scale
Next
Fully Sharded Data Parallel: faster AI training with fewer GPUs
阅读更多关于安全和隐私的内容
查看全部 
2026年3月13日
给我打补丁吧：针对默认安全 Android 应用的 AI 代码修改
2026年3月9日
Messenger 中的高级浏览保护功能如何运作
2026年2月4日
没有显示屏？没问题：XR 设备的跨设备密码认证
2026年1月27日
Rust 大规模应用：为 WhatsApp 增加一层安全保障
2025年12月15日
人工智能如何改变默认安全移动框架的采用
2025年11月20日
关键透明度登陆 Messenger

