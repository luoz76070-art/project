import type { LastTurn } from "../../../../../shared/lastTurn";
export type { LastTurn } from "../../../../../shared/lastTurn";

export function validLastTurn(value: unknown): value is LastTurn {
  if (!value || typeof value !== "object") return false;
  const result = value as LastTurn;
  return typeof result.turnId === "string" && result.turnId.length > 0 && result.turnId.length <= 512
    && ["completed", "failed", "interrupted"].includes(result.status)
    && typeof result.reason?.code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(result.reason.code)
    && typeof result.reason.message === "string" && result.reason.message.length <= 512
    && typeof result.endedAt === "string" && Number.isFinite(Date.parse(result.endedAt))
    && ["provider", "observed"].includes(result.timeSource);
}

/** Missing fields are legacy; explicit null invalidates an unprovable terminal result. */
export function mergeLastTurn(previous: LastTurn | null | undefined, incoming: LastTurn | null | undefined) {
  if (incoming === undefined) return previous;
  if (!validLastTurn(incoming)) return null;
  if (previous) {
    if (previous.turnId === incoming.turnId && previous.timeSource !== incoming.timeSource) return incoming.timeSource === "provider" ? incoming : previous;
    if (previous.timeSource === "provider" && incoming.timeSource === "provider"
      && Date.parse(incoming.endedAt) < Date.parse(previous.endedAt)) return previous;
  }
  return incoming;
}
