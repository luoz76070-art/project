import { z } from "zod";
import type { OpenCodeEvent } from "./openCodeClient.js";
import { messagesSchema, messagesView, sessionIdSchema } from "./openCodeProtocol.js";
import { agentError } from "./sessions.js";

type Messages = z.infer<typeof messagesSchema>["data"];
type Text = { messageId: string; ordinal: number; text: string; timestamp: number; complete: boolean; fromStart: boolean };
const textEvent = z.object({
  sessionID: sessionIdSchema, assistantMessageID: z.string().regex(/^msg_[a-zA-Z0-9_-]{1,128}$/u),
  ordinal: z.number().int().min(0).max(999), timestamp: z.number().finite().min(0).max(8.64e15),
  delta: z.string().max(1_000_000).optional(), text: z.string().max(1_000_000).optional(),
});

/** REST projects text at text.ended. Keep live, bounded deltas separately until then. */
export class OpenCodeStreamText {
  private readonly parts = new Map<string, Text>();
  private bytes = 0;

  apply(event: OpenCodeEvent, sessionId: string): boolean {
    if (!["session.text.started", "session.text.delta", "session.text.ended"].includes(event.type)) return false;
    const parsed = textEvent.safeParse({ ...event.data, timestamp: event.created });
    if (!parsed.success || parsed.data.sessionID !== sessionId) throw agentError("OPENCODE_PROTOCOL_ERROR");
    const data = parsed.data, key = `${data.assistantMessageID}:${data.ordinal}`;
    let part = this.parts.get(key);
    if (!part) {
      if (this.parts.size >= 128) throw agentError("OPENCODE_RESPONSE_TOO_LARGE");
      part = { messageId: data.assistantMessageID, ordinal: data.ordinal, text: "", timestamp: data.timestamp, complete: false, fromStart: event.type === "session.text.started" };
      this.parts.set(key, part);
    }
    if (event.type === "session.text.delta") {
      if (data.delta === undefined) throw agentError("OPENCODE_PROTOCOL_ERROR");
      if (part.complete) return true;
      const bytes = Buffer.byteLength(data.delta);
      if (this.bytes + bytes > 1_000_000) throw agentError("OPENCODE_RESPONSE_TOO_LARGE");
      this.bytes += bytes; part.text += data.delta;
    } else if (event.type === "session.text.ended") {
      if (data.text === undefined) throw agentError("OPENCODE_PROTOCOL_ERROR");
      const bytes = this.bytes - Buffer.byteLength(part.text) + Buffer.byteLength(data.text);
      if (bytes > 1_000_000) throw agentError("OPENCODE_RESPONSE_TOO_LARGE");
      this.bytes = bytes; part.text = data.text; part.complete = true; part.fromStart = true;
    }
    return true;
  }

  project(messages: Messages) {
    const copy = structuredClone(messages);
    // The publisher counts text ordinals separately from reasoning/tool parts.
    // This projection exposes text only, so its indices can follow those ordinals.
    for (const message of copy) if (message.content) message.content = message.content.filter(item => item.type === "text");
    for (const [key, part] of this.parts) {
      let message = copy.find(item => item.id === part.messageId);
      if (!message) { message = { id: part.messageId, type: "assistant", time: { created: part.timestamp }, content: [] }; copy.push(message); }
      if (message.type !== "assistant") throw agentError("OPENCODE_PROTOCOL_ERROR");
      message.content ??= [];
      let content = message.content[part.ordinal];
      if (content && content.type !== "text") throw agentError("OPENCODE_PROTOCOL_ERROR");
      if (part.complete && content?.text === part.text) {
        this.parts.delete(key); this.bytes -= Buffer.byteLength(part.text); continue;
      }
      // A mid-run subscriber may not yet have earlier text ordinals. Keep their positions.
      if (!content) { content = { type: "text", text: "" }; message.content[part.ordinal] = content; }
      content.text = part.text;
    }
    return { messages: messagesView(copy), partialText: [...this.parts.values()].some(part => !part.fromStart && !part.complete) };
  }
}
