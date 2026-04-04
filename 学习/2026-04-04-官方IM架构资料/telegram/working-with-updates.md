# 处理更新

- 来源：https://core.telegram.org/api/updates
- 抓取日期：2026-04-04
- 抓取方式：Chrome CDP 正文抽取

---

当客户端被积极使用时，会发生一些影响当前用户的事件，例如收到新消息，用户必须尽快获知这些事件。为了避免客户端需要定期下载这些事件，系统提供了一种更新传递机制：服务器通过其与客户端的可用连接之一向用户发送通知。

订阅更新

更新事件会发送到上次活动连接中的授权用户（下载/上传文件所需的连接除外）。

因此，要开始接收更新，客户端需要初始化连接并调用 API 方法，例如获取当前状态。

务必忽略从未加密连接收到的更新（即握手完成之前收到的更新）。

如果连接已加密，但会话尚未登录或已注销，则只能处理以下更新：

updateLoginToken - 用于二维码登录
updateSentPhoneCode - 用于付费短信验证码登录
updateDcOptions - 必须应用的数据中心连接选项更改
updateConfig - 服务器端配置已更改；客户端应使用help.getConfig和help.getAppConfig重新获取配置。
updateLangPackTooLong，updateLangPack - 本地化包更新
事件序列

所有事件均以 TL 序列化的Updates对象序列的形式从套接字接收，这些对象可以像查询响应一样选择性地进行 gzip 压缩。

每个Updates对象可以包含一个或多个Update对象，分别代表不同的事件。

为了确保所有更新按精确顺序应用，并保证不会遗漏或重复应用更新， Updatesseq构造函数中包含属性，而Update构造函数中包含（带有）或属性。客户端必须结合本地存储的状态使用这些属性值，才能正确应用传入的更新。ptspts_countqts

当更新序列出现间断时，必须通过调用 API 方法之一来填补。更多信息请参见下文 »

更新序列

如前所述，每个包含更新的有效负载都有一个 TL 类型的Updates。从下面的模式可以看出，该类型有多个构造函数。

updatesTooLong#e317af7e = Updates;
updateShort#78d4dec1 update:Update date:int = Updates;
updateShortMessage#313bc7f8 flags:# out:flags.1?true mentioned:flags.4?true media_unread:flags.5?true silent:flags.13?true id:int user_id:long message:string pts:int pts_count:int date:int fwd_from:flags.2?MessageFwdHeader via_bot_id:flags.11?long reply_to:flags.3?MessageReplyHeader entities:flags.7?Vector<MessageEntity> ttl_period:flags.25?int = Updates;
updateShortChatMessage#4d6deea5 flags:# out:flags.1?true mentioned:flags.4?true media_unread:flags.5?true silent:flags.13?true id:int from_id:long chat_id:long message:string pts:int pts_count:int date:int fwd_from:flags.2?MessageFwdHeader via_bot_id:flags.11?long reply_to:flags.3?MessageReplyHeader entities:flags.7?Vector<MessageEntity> ttl_period:flags.25?int = Updates;
updateShortSentMessage#9015e101 flags:# out:flags.1?true id:int pts:int pts_count:int date:int media:flags.9?MessageMedia entities:flags.7?Vector<MessageEntity> ttl_period:flags.25?int = Updates;
updatesCombined#725b04c3 updates:Vector<Update> users:Vector<User> chats:Vector<Chat> date:int seq_start:int seq:int = Updates;
updates#74ae4240 updates:Vector<Update> users:Vector<User> chats:Vector<Chat> date:int seq:int = Updates;

updatesTooLong表示有太多事件待推送给客户端，因此需要手动获取它们。

updateShort构造函数内部的事件通常优先级较低，并且会广播给大量用户，例如，聊天参与者之一开始在大型对话中输入文本（updateChatUserTyping）。

updateShortMessage 、updateShortSentMessage和updateShortChatMessage构造函数虽然冗余，但对于 90% 的更新操作来说，它们可以显著减小传输的消息大小。接收时应将它们转换为updateShort 类型。

剩余的两个构造函数updates和updatesCombined是 Updates 序列的一部分。它们都具有一个seq属性，该属性指示 Updates 生成后的远程 Updates 状态，以及数据包中第一个Updates 生成seq_start后的远程 Updates 状态。对于updates，该属性被省略，因为假定它始终等于。seq_startseq

消息相关事件序列

与消息框相关的每个事件pts（消息创建、消息编辑、消息删除等）都由一个唯一的自增标识符标识，或者qts在秘密聊天更新、某些机器人更新等情况下，由一个唯一的自增标识符标识。

每个消息框都可以被视为一个服务器端数据库表，用于存储与其关联的消息和事件。所有消息框都是完全独立的，每个 pts 序列都只与一个消息框绑定（见下文）。

Update对象可能包含有关多个事件的信息（例如，updateDeleteMessages）。因此，所有单个更新都可能有pts_count一个参数，指示接收到的更新中包含的事件数量（但也有一些例外，在这种情况下，该参数被视为 1 ）。pts_count0

每个频道和超级群组都有各自的消息框和事件序列；同一用户的私聊和普通群组则有另一套通用的事件序列。
秘密聊天、某些机器人事件和其他类型的更新还有另一套通用的二级事件序列。

总而言之，客户端必须确保以下序列的完整性才能正确处理更新：

更新序列（seq）
常用消息框序列（点）
次级事件序列（qts）
频道消息框序列 1（分）
频道消息框序列 2（分）
频道消息框序列 3（分）
等等...
Fetching state

The common update state is represented by the updates.State constructor. When the user logs in for the first time, a call to updates.getState has to be made to store the latest update state (which will not be the absolute initial state, just the latest state at the current time). The common update state can also be fetched from updates.differenceTooLong.

The channel update state is represented simply by the pts of the event sequence: when first logging in, the initial channel state can be obtained from the dialog constructor when fetching dialogs, from the full channel info, or it can be received as an updateChannelTooLong update.

The secondary update state is represented by the qts of the secret event sequence, it is contained in the updates.State of the common update state.

The Updates sequence state is represented by the date and seq of the Updates sequence, it is contained in the updates.State of the common update state.

Update handling

Update handling in Telegram clients consists of receiving events, making sure there were no gaps and no events were missed based on the locally stored state of the correspondent event sequence, and then updating the locally stored state based on the parameters received.

When the client receives payload with serialized updates, first of all, it needs to walk through all of the nested Update objects and check if they belong to any of message box sequences (have pts or qts parameters). Those updates need to be handled separately according to corresponding local state and new pts/qts values. Details below »

After message box updates are handled, if there are any other updates remaining the client needs to handle them with respect to seq. Details below »

pts: checking and applying

Here, local_pts will be the local state, pts will be the remote state, pts_count will be the number of events in the update.

If local_pts + pts_count === pts, the update can be applied.
If local_pts + pts_count > pts, the update was already applied, and must be ignored.
If local_pts + pts_count < pts, there's an update gap that must be filled.

For example, let's assume the client has the following local state for the channel 123456789:

local_pts = 131

Now let's assume an updateNewChannelMessage from channel 123456789 is received with pts = 132 and pts_count=1. Since local_pts + pts_count === pts, the total number of events since the last stored state is, in fact, equal to pts_count: this means the update can be safely accepted and the remote pts applied:

local_pts = 132

Since:

pts indicates the server state after the new channel message events are generated
pts_count indicates the number of events in the new channel update
The server state before the new channel message event was generated has to be: pts_before = pts - pts_count = 131, which is, in fact, equal to our local state.

Now let's assume an updateNewChannelMessage from channel 123456789 is received with pts = 132 and pts_count=1. Since local_pts + pts_count > pts (133 > 132), the update is skipped because we've already handled this update (in fact, our current local_pts was set by this same update, and it was resent twice due to network issues or other issues).

Now let's assume an updateDeleteChannelMessages from channel 123456789 is received with pts = 140 and pts_count=5. Since local_pts + pts_count < pts (137 < 140), this means that updates were missed, and the gap must be recovered.

Secret chats & bots

The whole process is very similar for secret chats and certain bot updates, but there is a qts instead of pts, and events are never grouped, so it's assumed that qts_count is always equal to 1.

seq: checking and applying

On the top level when handling received updates and updatesCombined there are four possible cases:

If seq_start === 0, the updates can be applied: this is a special case for updates that aren't ordered and should just be applied immediately.
If local_seq + 1 === seq_start, the updates can be applied.
If local_seq + 1 > seq_start, the updates were already applied, and must be ignored.
If local_seq + 1 < seq_start, there's an updates gap that must be filled (updates.getDifference must be used as with common and secret event sequences).

If the updates were applied, local Updates state must be updated with seq (unless it's 0) and date from the constructor.

For all the other Updates type constructors there is no need to check seq or change a local state.

Recovering gaps

To do this, updates.getDifference (common/secret state) or updates.getChannelDifference (channel state) with the respective local states must be called.

Manually obtaining updates through the above methods is required in the following situations:

On startup, only updates.getDifference should be called, to fetch updates received while the client was offline (preferably with some flags to reduce server load, see the method's docs).
updates.getChannelDifference does not have to be manually called for all channels on startup.
Instead, updates.getChannelDifference will be automatically triggered (only for channels that need catching up) by a set of updateChannelTooLong updates that will be returned by the updates.getDifference call.
Loss of sync: a gap was found in seq / pts / qts (as described above). It may be useful to wait up to 0.5 seconds in this situation and abort the sync in case a new update arrives, that fills the gap.
Session loss on the server: the client receives a new session created notification. This can be caused by garbage collection on the MTProto server or a server reboot.
Incorrect update: the client cannot deserialize the received data.
Incomplete update: the client is missing data about a chat/user from one of the shortened constructors, such as updateShortChatMessage, etc.
Long period without updates: no updates for 15 minutes or longer.
The server requests the client to fetch the difference using updateChannelTooLong or updatesTooLong.

When calling updates.getDifference if the updates.differenceSlice constructor is returned in response, the full difference was too large to be received in one request. The intermediate status, intermediate_state, must be saved on the client and the query must be repeated, using the intermediate status as the current status.

To fetch the updates difference of a channel, updates.getChannelDifference is used.
If the difference is too large to be received in one request, the final flag of the result is not set (see docs).
The intermediate status, represented by the pts, must be saved on the client and the query must be repeated, using the intermediate status as the current status.

For performance reasons and for better user experience, client can set maximum gap size to be filled: pts_total_limit parameter of updates.getDifference and limit parameter for updates.getChannelDifference can be used.

If the gap is too large and there are too many updates to fetch, a *TooLong constructor will be returned. In this case, the client must re-fetch the state, re-start fetching updates from that state and follow the instructions that can be found here.

It is recommended to use limit 10-100 for channels and 1000-10000 otherwise.

Do not re-invoke updates.getChannelDifference if the returned difference is final, unless the user has opened the channel/supergroup ».

Subscribing to updates of channels/supergroups

The API will automatically send passive updates (i.e. as standalone Updates constructors in the socket) for channels/supergroups the user/bot is a member of.

However, clients (user accounts only) should also additionally invoke updates.getChannelDifference periodically for channels and supergroups the user is currently viewing (i.e. explicitly opened channels/supergroups in one or more tabs/windows).

If the returned difference is non-final, the method should be called immediately with the new parameters as usual.

If the returned difference is final, and the user is still viewing the messages of the supergroup/channel (i.e. via distinct tabs/windows), updates.getChannelDifference should be re-invoked after timeout seconds (if the flag is specified, otherwise after 1 second).

This mechanism may also be used to enable passive reception of updates from channels or supergroups we're not a member of: if the specified channel or supergroup is public, or is private but temporarily available for a limited time thanks to a chatInvitePeek, the API will start passively sending updates (i.e. as standalone Updates constructors in the socket, as is already the case for normal channels/supergroups we've already joined) to all logged-in sessions, as long as any of the sessions continues to periodically invoke updates.getChannelDifference every timeout seconds (returned by the method, or every second if the timeout flag is absent from the return value of the method, or immediately with the new parameters if the returned difference is non-final).

Clients should stop updates.getChannelDifference polling once the user closes the channel/supergroup: the API will continue emitting passive updates only if the user is a member of the channel/supergroup.

客户端还应将使用上述机制进行短轮询的频道/超级组的最大数量限制为 10（即，如果用户在 11 个不同的频道上打开 11 个窗口，则仅使用updates.getChannelDifference进行短轮询前 10 个频道）。

示例实现

实现过程中还必须注意推迟通过套接字接收的更新，同时填补事件和更新序列中的空白，并避免填补同一序列中的空白。

示例实现：tdlib、MadelineProto。

实现这一目标的一个有趣且简单的方法是，不用使用各种锁，而是运行后台循环，就像MadelineProto »中那样。

推送更新通知

如果客户端在事件发生时没有有效的网络连接，推送通知也很有用。

