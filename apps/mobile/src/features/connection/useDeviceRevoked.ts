import { useSyncExternalStore } from "react";
import { relayAuthorization } from "./authorization";

export function useDeviceRevoked(endpoint: string, token: string) {
  const state = relayAuthorization(endpoint, token);
  return useSyncExternalStore(state.subscribe, state.isRevoked);
}
