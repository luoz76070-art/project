/** Public, runtime-independent result of the most recently ended turn.
 * Omitted means an older producer; null means no reliable result is available.
 * A new running turn does not erase the preceding result. Results stay in memory.
 */
export type LastTurnStatus = "completed" | "failed" | "interrupted";
export type LastTurn = {
  /** Native turn identity, or an authoritative terminal marker ID, scoped to its session. */
  turnId: string;
  status: LastTurnStatus;
  reason: { code: string; message: string };
  endedAt: string;
  /** observed is the first observation of this boundary, not a claimed provider timestamp. */
  timeSource: "provider" | "observed";
};
