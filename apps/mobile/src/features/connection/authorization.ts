export const deviceRevokedMessage = "电脑拒绝了这台设备：可能已被撤销，或访问令牌不对。请重新配对。";
export const deviceRevokedError = () => Object.assign(new Error(deviceRevokedMessage), { status: 401 });

/** In-memory only. A different Relay path or newly paired token gets its own state. */
const connections = new Map<string, ReturnType<typeof createAuthorization>>();
function createAuthorization() {
  let revoked = false;
  const listeners = new Set<() => void>();
  return {
    isRevoked: () => revoked,
    assertValid() { if (revoked) throw deviceRevokedError(); },
    revoke() { if (revoked) return; revoked = true; for (const listener of listeners) listener(); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export function relayAuthorization(endpoint: string, token: string) {
  const base = endpoint.trim().replace(/\/+$/, "");
  const key = JSON.stringify([base, token]);
  let state = connections.get(key);
  if (!state) { state = createAuthorization(); connections.set(key, state); }
  return state;
}
export function requestAuthorization(url: string, headers?: Record<string, string>) {
  const header = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === "authorization")?.[1];
  const api = url.lastIndexOf("/api/");
  return api >= 0 && header?.startsWith("Bearer ") && header.slice(7).trim() ? relayAuthorization(url.slice(0, api), header.slice(7)) : undefined;
}
