import { z } from "zod";

export const chunkBytes = 32 * 1024;
export const maxFrameBytes = 56 * 1024 * 1024; // Includes legacy base64 uploads.
export const maxRequestsPerRelay = 32;
export const maxPendingRequests = 256;
const id = z.string().min(1).max(128);
const headers = z.record(z.string(), z.string()).refine((value) => Object.keys(value).length <= 128);
const responseHead = { id, status: z.number().int().min(200).max(599), headers };

const requestSchema = z.object({
  type: z.literal("request"), id,
  method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
  path: z.string().startsWith("/").max(8192).refine((value) => !value.startsWith("//")),
  headers, body: z.string().nullable(), stream: z.literal(true).optional(),
});
const brokerMessageSchema = z.discriminatedUnion("type", [
  requestSchema,
  z.object({ type: z.literal("cancel"), id }),
  z.object({ type: z.literal("ack"), id, seq: z.number().int().nonnegative() }),
]);
const relayMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("response"), ...responseHead, body: z.string() }),
  z.object({ type: z.literal("response-start"), ...responseHead }),
  z.object({ type: z.literal("response-chunk"), id, seq: z.number().int().nonnegative(), body: z.string().max(4 * Math.ceil(chunkBytes / 3)) }),
  z.object({ type: z.literal("response-end"), id }),
  z.object({ type: z.literal("response-error"), id, message: z.string().max(1000) }),
]);
export type BrokerMessage = z.infer<typeof brokerMessageSchema>;
export type BrokerRequest = z.infer<typeof requestSchema>;
export type RelayMessage = z.infer<typeof relayMessageSchema>;

export function decodeBrokerMessage(raw: string): BrokerMessage | null {
  try { const result = brokerMessageSchema.safeParse(JSON.parse(raw)); return result.success ? result.data : null; } catch { return null; }
}
export function decodeRelayMessage(raw: string): RelayMessage | null {
  try { const result = relayMessageSchema.safeParse(JSON.parse(raw)); return result.success ? result.data : null; } catch { return null; }
}

const hopHeaders = new Set(["host", "connection", "content-length", "transfer-encoding", "content-encoding", "keep-alive", "upgrade", "proxy-authenticate", "proxy-authorization", "te", "trailer"]);
export function canForwardHeader(name: string): boolean {
  return !hopHeaders.has(name.toLowerCase());
}
