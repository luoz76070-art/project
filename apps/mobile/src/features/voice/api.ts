import { apiGet, apiPost, buildUrl } from "../connection/http";
import { parseVoiceConfig, parseVoiceText, parseVoiceResult } from "./model";

export function voiceApi(endpoint: string, token: string) {
  const url = (path: string) => buildUrl(endpoint, `/api/voice/${path}`);
  const submitted = (raw: unknown, id: string) => raw && typeof raw === "object" && "status" in raw && raw.status === "processing" ? (parseVoiceResult(raw, id), null) : parseVoiceText(raw);
  return {
    config: async (signal: AbortSignal) => parseVoiceConfig(await apiGet(url("config"), token, signal)),
    configure: async (patch: { region?: "cn" | "sg"; workspace?: string; qwenBaseUrl?: string; qwenModel?: string; qwenKey?: string | null; deepseekKey?: string | null; deepseekBaseUrl?: string; deepseekModel?: string }, signal: AbortSignal) => parseVoiceConfig(await apiPost(url("config"), token, patch, signal)),
    transcribe: async (requestId: string, dataBase64: string, durationMs: number, signal: AbortSignal) => submitted(await apiPost(url("transcribe"), token, { requestId, dataBase64, durationMs }, signal), requestId),
    refine: async (requestId: string, text: string, signal: AbortSignal) => submitted(await apiPost(url("refine"), token, { requestId, text }, signal), requestId),
    result: async (requestId: string, signal: AbortSignal) => parseVoiceResult(await apiGet(url(`results/${encodeURIComponent(requestId)}`), token, signal), requestId),
    cancel: async (requestId: string) => { await apiPost(url("cancel"), token, { requestId }); },
  };
}
