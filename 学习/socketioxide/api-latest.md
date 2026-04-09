# socketioxide - Rust

- 来源：https://docs.rs/socketioxide/latest/socketioxide/
- 抓取日期：2026-04-04
- 抓取方式：Chrome CDP 正文抽取

---

板条箱 复制项目路径
来源
搜索
设置
帮助
概括

Socketioxide 是一个 socket.io 服务器实现，它作为塔层/服务运行。它与tower/ tokio/hyper生态系统的其他部分集成得很好。

目录
特征
兼容性
用法
初始化
处理员
萃取器
活动
中间件
发射数据
致谢
国家管理
适配器
解析器
功能标志
特征
易于使用的灵活类Axum API
完全兼容官方socket.io 客户端
支持先前版本的协议（v4）。
国家管理
命名空间
房间
致谢
通用解析器和 Msgpack 解析器
轮询和 WebSocket 传输
兼容性

因为它既可以作为塔式服务器运行layer，service也可以作为超服务器service 运行，所以你可以将它与任何支持塔式/超服务器的HTTP服务器框架一起使用：

阿克苏姆
Warp（在 Socketioxide >= 0.9.0 中不受支持，除非 Warp 迁移到 Hyper v1）
超级
齐射

请查看示例以了解有关框架集成的更多详细信息。

用法

该 API 尽可能地模仿了相应的 JS API。主要区别在于默认命名空间/不会自动创建，需要手动创建。

使用 axum 的基本示例：
use axum::routing::get;
use socketioxide::{
    extract::SocketRef,
    SocketIo,
};
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (layer, io) = SocketIo::new_layer();

    // Register a handler for the default namespace
    io.ns("/", async |s: SocketRef| {
        // For each "message" event received, send a "message-back" event with the "Hello World!" event
        s.on("message", async |s: SocketRef| {
            s.emit("message-back", "Hello World!").ok();
        });
    });

    let app = axum::Router::new()
    .route("/", get(async || "Hello, World!"))
    .layer(layer);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();

    Ok(())
}
初始化

该SocketIo结构体是库的主要入口点。它用于创建对象Layer或实例。之后，它可以作为JS API 中对象Service的等效项使用。io

创建SocketIo实例时，可以使用构建器模式通过SocketIoBuilder结构体对其进行配置。

SocketIoBuilder有关可用配置选项的更多详细信息，请参阅文档。
layer有关图层的更多详细信息，请参阅模块文档。
service有关服务的更多详细信息，请参阅模块文档。
带有自定义配置的塔层示例：
use socketioxide::SocketIo;
let (layer, io) = SocketIo::builder()
    .max_payload(10_000_000) // Max HTTP payload size of 10M
    .max_buffer_size(10_000) // Max number of packets in the buffer
    .build_layer();
Tower独立服务示例（默认配置）：
use socketioxide::SocketIo;
let (svc, io) = SocketIo::new_svc();
处理员

处理程序是异步函数或可克隆的异步闭包，它们被传递给 `Fns` io.ns、`Fs`socket.on和 ` socket.on_disconnectFns`。处理程序可以接受 0 到 16 个参数，这些参数分别实现了FromConnectParts `Fns` ConnectHandler、`Fs`FromMessageParts和MessageHandler` FromDisconnectPartsFns` 的trait DisconnectHandler。它们的设计很大程度上受到了 Axum 处理程序的启发。

对于每个传入的连接/消息，都会生成一个新任务，这样就不会阻塞事件管理任务。

handler::connect有关连接处理程序和连接中间件的更多详细信息，请查看模块文档。
请查看handler::message模块文档以了解有关消息处理程序的更多详细信息。
请查看handler::disconnect模块文档以了解有关断开连接处理程序的更多详细信息。
请查看extract模块文档以了解有关提取器的更多详细信息。
萃取器

处理程序参数被称为提取器，用于从传入的连接/消息中提取数据。它们的灵感来源于 axum 提取器。提取器是一个结构体，它实现了FromConnectPartstrait，用于 traitConnectHandler 和trait FromMessageParts的实现。MessageHandlerFromDisconnectPartsDisconnectHandler

它们可用于从处理程序的上下文中提取数据并获取特定参数。以下是一些提取器的示例：

Data：从接收到的任何数据中提取并反序列化，如果发生反序列化错误，则不会调用处理程序：
用于ConnectHandler：从传入的身份验证数据中提取和反序列化数据
用于ConnectMiddleware：从传入的身份验证数据中提取并反序列化。如果发生错误，中间件链将停止并connect_error发送一个事件。
用于MessageHandler：从传入的消息数据中提取和反序列化数据
TryData：从接收到的任何数据中提取并反序列化，但会指定一个Result错误类型：
对于ConnectHandler`and` ConnectMiddleware：从传入的身份验证数据中提取和反序列化数据
用于MessageHandler：从传入的消息数据中提取和反序列化数据
SocketRef：提取对以下内容的引用Socket
AckSender可用于向当前消息事件发送确认响应
ProtocolVersion提取套接字的协议版本
TransportType提取套接字的传输类型
DisconnectReason提取断开连接的原因
State：提取Clone先前用 . 设置的状态SocketIoBuilder::with_state。
Extension提取相应套接字扩展的克隆
MaybeExtension：提取相应套接字扩展的克隆（如果存在）
HttpExtension提取 http 请求扩展的克隆
MaybeHttpExtension：提取 HTTP 请求扩展的副本（如果存在）
SocketIoSocketIo提取对句柄的引用
提取器订单

提取器按照其在处理程序签名中的声明顺序运行。如果提取器返回错误，则不会调用处理程序，并且如果启用了tracing::error!该功能，则会发出一个调用。tracing

对于某些提取器来说MessageHandler，它们需要消费事件，因此只需要实现该FromMessage特性。

请注意，任何实现了该接口的提取器FromMessageParts默认也会实现该FromMessage特性。

活动

事件分为三种类型：

当建立新连接时，会发出 connect 事件。可以使用 ` ConnectHandlerand`io.ns方法处理该事件。
当收到新消息时，会触发消息事件。可以使用 ` MessageHandlerand`socket.on方法来处理该事件。
当套接字关闭时，会发出断开连接事件。可以使用 ` DisconnectHandlerand`socket.on_disconnect方法处理该事件。

Only one handler can exist for an event so registering a new handler for an event will replace the previous one.

Middlewares

When providing a ConnectHandler for a namespace you can add any number of ConnectMiddleware in front of it. It is useful to add authentication or logging middlewares.

A middleware must return a Result<(), E> where E: Display.

If the result is Ok(()), the next middleware is called or if there is no more middleware, the socket is connected and the ConnectHandler is called.
If the result is an error, the namespace connection will be refused and the error will be returned with a connect_error event and a message field with the error.
Because the socket is not yet connected to the namespace, you can't send messages to it from the middleware.

See the handler::connect module doc for more details on middlewares and examples.

Emiting data

Data can be emitted to a socket with the Socket::emit method. It takes an event name and a data argument. The data argument can be any type that implements the serde::Serialize trait.

You can emit from the SocketIo handle or the SocketRef. The difference is that you can move the io handle everywhere because it is a cheaply cloneable struct. The SocketRef is a reference to the socket and you should avoid storing it in your own code (e.g. in HashMap/Vec). If you do so, you will have to remove the socket reference when the socket is disconnected to avoid memory leaks.

Moreover the io handle can emit to any namespace while the SocketRef can only emit to the namespace of the socket.

When using any emit fn, if you provide tuple-like data (tuple, arrays), it will be considered as multiple emit arguments. If you send a vector it will be considered as a single argument.

Emitting binary data

To emit binary data, you must use a data type that implements Serialize as binary data. Currently if you use Vec<u8> it will be considered as a number sequence and not binary data. To counter that you must either use a special type like Bytes or use the serde_bytes crate. If you want to emit generic binary data, use rmpv::Value rather than serde_json::Value otherwise the binary data will also be serialized as a number sequence.

Emit errors

If the data can’t be serialized, a ParserError will be returned.

If the socket is disconnected or the internal channel is full, a SendError will be returned. Moreover, a tracing log will be emitted if the tracing feature is enabled.

Emitting with operators

To configure the emit, you can chain Operators methods to the emit call. With that you can easily configure the following options:

rooms: emit, join, leave to specific rooms
namespace: emit to a specific namespace (only from the SocketIo handle)
timeout: set a custom timeout when waiting for an ack
binary: emit a binary payload with the message
local: broadcast only to the current node (in case of a cluster)

Check the operators module doc for more details on operators.

Acknowledgements

You can ensure that a message has been received by the client/server with acknowledgements.

Server acknowledgements

They are implemented with the AckSender extractor. You can send an ack response with an optional binary payload with the AckSender::send method. If the client doesn’t send an ack id to respond to, the AckSender::send method will do nothing.

Client acknowledgements

If you want to emit/broadcast a message and await for a/many client(s) acknowledgment(s) you can use:

SocketRef::emit_with_ack for a single client
BroadcastOperators::emit_with_ack for broadcasting or emit configuration.
SocketIo::emit_with_ack for broadcasting to an entire namespace.
State management

There are two ways to manage the state of the server:

Per socket state

You can enable the extensions feature and use the extensions field on any socket to manage the state of each socket. It is backed by a RwLock<HashMap>> so you can safely access it from multiple threads. However, the value must be Clone and 'static. When calling get, or using the Extension/MaybeExtension extractor, the value will always be cloned. See the extensions module doc for more details.

Global state

You can enable the state feature and use SocketIoBuilder::with_state method to set multiple global states for the server. You can then access them from any handler with the State extractor.

The state is stored in the SocketIo handle and is shared between all the sockets. The only limitation is that all the provided state types must be clonable. Therefore it is recommended to use the Arc type to share the state between the handlers.

You can then use the State extractor to access the state in the handlers.

Adapters

This library is designed to support clustering through the use of adapters. Adapters enable broadcasting messages and managing socket room memberships across nodes without requiring changes to your code. The Adapter trait abstracts the underlying system, making it easy to integrate with different implementations.

Adapters typically interact with third-party systems like Redis, Postgres, Kafka, etc., to facilitate message exchange between nodes.

The default adapter is the LocalAdapter, a simple in-memory implementation. If you intend to use a different adapter, ensure that extractors are either generic over the adapter type or explicitly specify the adapter type for each extractor that requires it.

Write this:
async fn my_handler<A: Adapter>(s: SocketRef<A>, io: SocketIo<A>) { }
let (layer, io) = SocketIo::new_layer();
io.ns("/", my_handler);
Instead of that:
async fn my_handler(s: SocketRef, io: SocketIo) { }
let (layer, io) = SocketIo::new_layer();
io.ns("/", my_handler);

Refer to the README for a list of available adapters and the examples for detailed usage guidance. You can also consult specific adapter crate documentation for more information.

Parsers

This library uses the socket.io common parser which is the default for all the socket.io implementations. Socketioxide also provided a msgpack parser. It is faster and more efficient than the default parser especially for binary data or payloads with a lot of numbers. To enable it, you must enable the msgpack feature and then use the with_parser fn to set the parser to ParserConfig::msgpack.

Feature flags
v4: enable support for the socket.io protocol v4
tracing: enable logging with tracing calls
extensions: enable per-socket state with the extensions module
state: enable global state management
msgpack: enable msgpack custom parser
Modules
ack
Acknowledgement related types and functions.
adapter
Adapters are responsible for managing the internal state of the server (rooms, sockets, etc…). When a socket joins or leaves a room, the adapter is responsible for updating the state. The default adapter is the LocalAdapter, which stores the state in memory. Other adapters can be made to share the state between multiple servers.
extensionsextensions
Extensions used to store extra data in each socket instance.
extract
Extractors for ConnectHandler, ConnectMiddleware, MessageHandler and DisconnectHandler.
handler
Functions and types used to handle incoming connections and messages. There is three main types of handlers: connect, message and disconnect.
layer
A tower Layer for socket.io so it can be used as a middleware with frameworks supporting layers.
operators
Operators are used to select sockets to send a packet to, or to configure the packet that will be emitted.
service
A Tower Service and Hyper Service for socket.io so it
socket
A Socket represents a client connected to a namespace. The socket struct itself should not be used directly, but through a SocketRef.
Structs
AdapterError
Error type for the CoreAdapter trait.
ParserConfig
The parser to use to encode and decode socket.io packets
ParserError
A parser error that wraps any error that can occur during parsing.
SocketIo
The SocketIo instance can be cheaply cloned and moved around everywhere in your program. It can be used as the main handle to access the whole socket.io context.
SocketIoBuilder
A builder to create a SocketIo instance. It contains everything to configure the socket.io server with a SocketIoConfig. It can be used to build either a Tower Layer or a Service.
SocketIoConfig
Configuration for Socket.IO & Engine.IO
Enums
AckError
Error type for ack operations.
BroadcastError
Error type for broadcast operations.
EmitWithAckError
Error type for the emit_with_ack method.
NsInsertError
Represents errors that can occur when inserting a new route.
协议版本
Socket.IO 协议版本。可通过该Socket::protocol方法或提取器访问。
发送错误
发送操作的错误类型。
套接字错误
使用底层 engine.io 套接字时出现错误类型
运输类型
transport客户使用的类型。

