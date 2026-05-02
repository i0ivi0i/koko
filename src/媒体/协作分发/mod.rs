#[path = "应用.rs"]
pub mod application;
/// tracker 同源代理属于协作分发协议适配：
/// - 它只做首帧门禁与 websocket 字节转发；
/// - 真正的 swarm/offer/peer 语义继续交给成熟 tracker upstream；
/// - shell 只负责把路由接到这里，不再自己拥有这段协议细节。
#[path = "tracker代理.rs"]
pub mod tracker代理;
