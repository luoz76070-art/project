import type { SubscriptionDiagnostic } from "./subscription";

export type ConnectionDiagnostic = SubscriptionDiagnostic & { seq: number; subscription: number; channel: "desktop" | "live" };
export function createConnectionJournal() {
  let total = 0, subscriptions = 0;
  const events: ConnectionDiagnostic[] = [];
  return {
    subscribe(channel: ConnectionDiagnostic["channel"]) {
      const subscription = ++subscriptions;
      return (event: SubscriptionDiagnostic) => {
        events.push({ seq: ++total, subscription, channel, at: event.at, generation: event.generation, state: event.state, reason: event.reason });
        if (events.length > 20) events.shift();
      };
    },
    snapshot: () => ({ omitted: total - events.length, events: events.map(event => ({ ...event })) }),
  };
}
