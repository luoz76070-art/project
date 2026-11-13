import type { LastTurn } from "./lastTurn";
import { resultStatus } from "./sessionStatusModel";
import { SessionStatus } from "./SessionStatus";

/** Compatibility entry point for S1's existing result locations. */
export function TurnResultNotice({ result, running = false }: { result?: LastTurn | null; running?: boolean }) {
  return <SessionStatus status={resultStatus(result)} variant="notice" previous={running} />;
}
