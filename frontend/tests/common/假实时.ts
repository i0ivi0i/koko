/**
 * 假 Socket 只表达“前端实时端口会收到什么事件”。
 * 它不模拟业务真相，只为测试编排 owner 提供一个受控信号源。
 */
export class 假Socket {
  private handlers = new Map<string, Array<(payload: unknown) => void>>();
  public sentEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];
  public subscribeResults: Array<Record<string, unknown>> = [];

  on(event: string, handler: (payload: unknown) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, payload: Record<string, unknown>): boolean {
    this.sentEvents.push({ event, payload });
    if (event === "subscribe_room_stream") {
      if (this.subscribeResults.length > 0) {
        this.fire("control_result", this.subscribeResults.shift()!);
      } else if (payload.from === 99) {
        this.fire("control_result", {
          kind: "need_snapshot_reload",
          room_id: payload.room_id,
          expected_position: 99,
        });
      } else {
        this.fire("control_result", {
          kind: "subscribed",
          room_id: payload.room_id,
          latest_event_position: Number(payload.from ?? 0),
        });
      }
    }
    if (event === "create_message" || event === "send_text_message") {
      const text =
        typeof payload.text === "string"
          ? payload.text
          : typeof payload.body === "string"
            ? payload.body
            : "";
      const attachmentIds = Array.isArray(payload.attachment_ids)
        ? payload.attachment_ids
        : [];
      this.fire("room_event", {
        type: "message_created",
        room_id: "r-test",
        message_id: "m-1",
        client_message_id: payload.client_message_id,
        sender_session_id: "s-test",
        sender_display_alias: "暴躁的企鹅",
        text,
        attachments: attachmentIds.map((attachmentId) => ({
          kind: String(attachmentId).includes("video") ? ("video" as const) : ("image" as const),
          attachment_id: String(attachmentId),
          width: String(attachmentId).includes("video") ? 1280 : 120,
          height: String(attachmentId).includes("video") ? 720 : 90,
          has_preview_asset: String(attachmentId).includes("video"),
        })),
        event_position: 1,
      });
    }
    return true;
  }

  disconnect(): void {}

  trigger(event: string, payload: unknown): void {
    this.fire(event, payload);
  }

  private fire(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}
