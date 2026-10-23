import path from "node:path";
import { LocalAppServerClient, localAppServerError } from "../codex/localAppServerClient.js";
import { OpenCodeClient, type OpenCodeConfig } from "./openCodeClient.js";
import { OpenCodeAdapter } from "./openCodeAdapter.js";
import { ClaudeAdapter } from "./claudeAdapter.js";
import { DeepSeekAdapter } from "./deepSeekAdapter.js";
import { DeepSeekClient } from "./deepSeekClient.js";
import type { DeepSeekConfig } from "./deepSeekProtocol.js";
import type { ClaudeConfig } from "./claudeProtocol.js";
import { agentError, type SessionAdapter } from "./sessions.js";

export type AgentStatus = {
  id: string;
  label: string;
  state: "unprobed" | "probing" | "connected" | "failed";
  transport: string;
  usesAccessibility: boolean;
  sameDesktopThreadVerified: boolean;
  capabilities: { inspectLoadedSessions: boolean; sendMessage: boolean; steer: boolean; interrupt: boolean; approve: boolean };
  loadedSessions: { count: number; hasMore: boolean } | null;
  checkedAt: string | null;
  errorCode: string | null;
};

export interface AgentAdapter {
  readonly sessionApi?: SessionAdapter;
  snapshot(): AgentStatus;
  probe(): Promise<AgentStatus>;
  stop(): Promise<void>;
}

export class CodexExistingServerAdapter implements AgentAdapter {
  private state: AgentStatus = {
    id: "codex", label: "Codex", state: "unprobed", transport: "local-app-server-socket",
    usesAccessibility: false, sameDesktopThreadVerified: false,
    capabilities: { inspectLoadedSessions: false, sendMessage: false, steer: false, interrupt: false, approve: false },
    loadedSessions: null, checkedAt: null, errorCode: null,
  };
  private probing: Promise<AgentStatus> | null = null;
  private generation = 0;

  constructor(private readonly client: LocalAppServerClient) {
    client.on("disconnect", (error: Error & { code?: string }) => {
      this.state = { ...this.state, state: "failed", errorCode: error.code ?? "CODEX_SOCKET_DISCONNECTED", loadedSessions: null,
        capabilities: { ...this.state.capabilities, inspectLoadedSessions: false } };
    });
  }

  snapshot(): AgentStatus {
    return { ...this.state, capabilities: { ...this.state.capabilities }, loadedSessions: this.state.loadedSessions ? { ...this.state.loadedSessions } : null };
  }

  probe(): Promise<AgentStatus> {
    if (this.probing) return this.probing;
    const generation = this.generation;
    const pending = this.runProbe(generation).finally(() => { if (this.probing === pending) this.probing = null; });
    this.probing = pending;
    return pending;
  }

  async stop(): Promise<void> {
    ++this.generation;
    this.probing = null;
    this.state = { ...this.state, state: "unprobed", loadedSessions: null, errorCode: null,
      capabilities: { ...this.state.capabilities, inspectLoadedSessions: false } };
    await this.client.stop();
  }

  private async runProbe(generation: number): Promise<AgentStatus> {
    this.state = { ...this.state, state: "probing", errorCode: null };
    try {
      await this.client.connect();
      const summary = await this.client.loadedThreadSummary();
      if (generation !== this.generation) return this.snapshot();
      this.state = { ...this.state, state: "connected", loadedSessions: summary, checkedAt: new Date().toISOString(),
        capabilities: { ...this.state.capabilities, inspectLoadedSessions: true } };
    } catch (error) {
      if (generation !== this.generation) return this.snapshot();
      const code = (error as { code?: unknown })?.code;
      this.state = { ...this.state, state: "failed", errorCode: typeof code === "string" && code.startsWith("CODEX_") ? code : "CODEX_SOCKET_FAILED",
        checkedAt: new Date().toISOString(), loadedSessions: null,
        capabilities: { ...this.state.capabilities, inspectLoadedSessions: false } };
      await this.client.stop();
    }
    return this.snapshot();
  }
}

export class AgentGateway {
  private readonly adapters: Map<string, AgentAdapter>;
  private stopped = false;

  constructor(adapters: AgentAdapter[]) {
    this.adapters = new Map(adapters.map(adapter => [adapter.snapshot().id, adapter]));
    if (this.adapters.size !== adapters.length) throw new Error("Agent IDs must be unique");
  }

  snapshot(): AgentStatus[] { return [...this.adapters.values()].map(adapter => adapter.snapshot()); }

  probe(id: string): Promise<AgentStatus> {
    if (this.stopped) throw Object.assign(localAppServerError("AGENT_GATEWAY_STOPPED"), { statusCode: 503 });
    const adapter = this.adapters.get(id);
    if (!adapter) throw Object.assign(localAppServerError("AGENT_NOT_CONFIGURED"), { statusCode: 404 });
    return adapter.probe();
  }

  sessions(id: string): SessionAdapter {
    if (this.stopped) throw agentError("AGENT_GATEWAY_STOPPED", 503);
    const adapter = this.adapters.get(id);
    if (!adapter) throw agentError("AGENT_NOT_CONFIGURED", 404);
    if (!adapter.sessionApi) throw agentError("AGENT_SESSION_API_UNAVAILABLE", 409);
    return adapter.sessionApi;
  }

  claudeBridge(): ClaudeAdapter | null { const adapter = this.adapters.get("claude"); return adapter instanceof ClaudeAdapter ? adapter : null; }

  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.all([...this.adapters.values()].map(adapter => adapter.stop()));
  }
}

export function createAgentGateway(config: { codexHome: string; opencode?: OpenCodeConfig; claude?: ClaudeConfig; deepseek?: DeepSeekConfig }): AgentGateway {
  const adapters: AgentAdapter[] = [new CodexExistingServerAdapter(new LocalAppServerClient({
    socketPath: path.join(config.codexHome, "app-server-control", "app-server-control.sock"),
  }))];
  if (config.opencode) adapters.push(new OpenCodeAdapter(new OpenCodeClient(config.opencode)));
  if (config.claude) adapters.push(new ClaudeAdapter());
  if (config.deepseek) adapters.push(new DeepSeekAdapter(new DeepSeekClient(config.deepseek)));
  return new AgentGateway(adapters);
}
