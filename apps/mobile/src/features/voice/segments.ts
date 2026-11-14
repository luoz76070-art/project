import type { VoiceResult } from "./model";

/** V5: a long recording reaches the page in pieces of about 30 s while it goes on. */
export type VoiceSegment = { sessionId: string; index: number; startMs: number; durationMs: number; dataBase64: string };
export const voiceSegmentMs = 30_000;
export const voiceSegmentedMaxMs = 600_000;

type SegmentApi = {
  transcribe(requestId: string, dataBase64: string, durationMs: number, signal: AbortSignal, asrHints?: string[]): Promise<string | null>;
  result(requestId: string, signal: AbortSignal): Promise<VoiceResult>;
};

export function parseVoiceSegment(raw: unknown, sessionId: string): VoiceSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.sessionId !== sessionId || !Number.isSafeInteger(value.index) || Number(value.index) < 0 || Number(value.index) > 100) return null;
  if (!Number.isSafeInteger(value.startMs) || Number(value.startMs) < 0 || !Number.isSafeInteger(value.durationMs) || Number(value.durationMs) < 1 || Number(value.durationMs) > 120_000) return null;
  if (typeof value.dataBase64 !== "string" || value.dataBase64.length < 16) return null;
  return value as VoiceSegment;
}

/** Joins the texts of consecutive pieces; a space goes only between two Latin words or numbers. */
export function joinTranscripts(parts: readonly (string | undefined)[]) {
  return parts.reduce<string>((text, part) => {
    const next = (part ?? "").trim();
    if (!next) return text;
    if (!text) return next;
    return /[A-Za-z0-9]$/.test(text) && /^[A-Za-z0-9]/.test(next) ? `${text} ${next}` : `${text}${next}`;
  }, "");
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
    signal.addEventListener("abort", stop, { once: true });
  });
}

// A refusal the gateway answered on purpose (bad input, revoked device, unsupported audio) will not change on retry.
function definitive(error: unknown) {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500 && ![408, 425, 429].includes(status);
}

/**
 * Transcribes one piece. A lost or slow response is looked up under the same request ID before the piece is
 * sent again under that ID, so each piece is paid for once (V1 keeps results for 15 minutes).
 */
export async function transcribeSegment(api: SegmentApi, requestId: string, segment: VoiceSegment, signal: AbortSignal, hints?: string[], timing = { attempts: 3, pollMs: 1500, polls: 40 }): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < timing.attempts; attempt++) {
    try {
      const text = await api.transcribe(requestId, segment.dataBase64, segment.durationMs, signal, hints);
      if (text !== null) return text;
    } catch (error) {
      if (signal.aborted || definitive(error)) throw error;
      lastError = error;
    }
    for (let poll = 0; poll < timing.polls; poll++) {
      let result: VoiceResult | null = null;
      try { result = await api.result(requestId, signal); }
      catch (error) { if (signal.aborted) throw error; lastError = error; }
      if (result?.status === "completed") {
        if (result.outcome === "succeeded") return result.text;
        throw Object.assign(new Error(result.errorCode), { code: result.errorCode });
      }
      // The gateway never got it: send it again under the same ID.
      if (result?.status === "not_found") break;
      await wait(timing.pollMs, signal);
    }
  }
  throw lastError ?? new Error("语音转写超时，请重新转写");
}
