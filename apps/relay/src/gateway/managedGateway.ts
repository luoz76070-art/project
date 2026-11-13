import { randomUUID } from "node:crypto";
import { createRelayServer } from "../server/createRelayServer.js";
import { startTunnel, type TunnelState } from "../transport/tunnel.js";
import { parseManagedConfig, pairingEndpoint, type ManagedConfig } from "./config.js";
import { createGatewayDiagnostics } from "./diagnostics.js";

export type GatewayRuntimeStatus = {
  kind: "mobile-codex-gateway"; version: 1; instanceId: string; startedAt: string;
  desktopTransport: "native"; sameDesktopThreadVerified: false;
  tunnel: { enabled: boolean; state: TunnelState };
  endpoint: string;
};

export async function startManagedGateway(input: ManagedConfig) {
  const config = parseManagedConfig(input);
  const instanceId = randomUUID(), startedAt = new Date().toISOString();
  let tunnel: ReturnType<typeof startTunnel> | undefined;
  let tunnelState: TunnelState = "stopped";
  const diagnostics = createGatewayDiagnostics(Boolean(config.tunnel));
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  let stopping: Promise<void> | undefined;
  const snapshot = (): GatewayRuntimeStatus => ({
    kind: "mobile-codex-gateway", version: 1, instanceId, startedAt, desktopTransport: "native", sameDesktopThreadVerified: false,
    tunnel: { enabled: Boolean(config.tunnel), state: tunnelState }, endpoint: pairingEndpoint(config),
  });
  const app = await createRelayServer({
    config: { host: "127.0.0.1", port: config.port, token: config.token, codexHome: config.codexHome, defaultCwd: config.workspace, desktopTransport: "native", opencode: config.opencode, claude: config.claude, deepseek: config.deepseek },
    logger: false,
    gateway: { snapshot, diagnostics: diagnostics.snapshot, managerKey: config.managerKey, requestStop: () => { void stop().catch(() => console.error('{"error":"GATEWAY_STOP_FAILED"}')); } },
  });
  app.addHook("onClose", async () => { tunnel?.stop(); await tunnel?.done; finish(); });
  function stop(): Promise<void> {
    return stopping ??= (async () => {
      // Cancel forwarded requests before waiting for the local HTTP server.
      tunnel?.stop();
      try { await app.close(); }
      finally { await tunnel?.done; finish(); }
    })();
  }
  try {
    await app.listen({ host: "127.0.0.1", port: config.port });
    // Binding is the singleton lock. Never connect the broker if listen failed.
    if (config.tunnel) tunnel = startTunnel({
      ...config.tunnel, localRelay: `http://127.0.0.1:${config.port}`, reconnectMs: 3000, requestTimeoutMs: 180000, heartbeatMs: 15000,
    }, { onState: state => { tunnelState = state; }, onDiagnostic: diagnostics.record, log: () => {} });
  } catch (error) { await stop(); throw error; }
  return { app, snapshot, stop, done };
}
