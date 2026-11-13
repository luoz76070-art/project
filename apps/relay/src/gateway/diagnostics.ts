import { readFileSync } from "node:fs";
import type { TunnelDiagnosticEvent } from "../transport/tunnel.js";

declare const __GATEWAY_BUILD_ID__: string;
function readBuildId(): string {
  if (typeof __GATEWAY_BUILD_ID__ !== "undefined") return __GATEWAY_BUILD_ID__;
  try {
    const value = JSON.parse(readFileSync(new URL("../build-info.json", import.meta.url), "utf8")).buildId;
    return typeof value === "string" && /^gateway-[a-f0-9-]{36}$/.test(value) ? value : "unknown";
  } catch { return "unknown"; }
}
export const gatewayBuildId = readBuildId();

export function createGatewayDiagnostics(enabled: boolean) {
  let total = 0;
  const events: (TunnelDiagnosticEvent & { seq: number })[] = [];
  return {
    record(event: TunnelDiagnosticEvent) {
      // Explicit projection: never capture error text, broker URL or credentials.
      events.push({ seq: ++total, at: event.at, generation: event.generation, state: event.state, reason: event.reason,
        ...(event.closeCode === undefined ? {} : { closeCode: event.closeCode }) });
      if (events.length > 20) events.shift();
    },
    snapshot: () => ({ enabled, omitted: total - events.length, events: events.map(event => ({ ...event })) }),
  };
}
