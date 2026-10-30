import { Capacitor, registerPlugin } from "@capacitor/core";
import type { MessageDiagnosticReport } from "./messageDiagnostics";
import type { createConnectionJournal } from "../connection/diagnosticJournal";

declare const __WEB_BUILD_ID__: string;
export const webBuildId = typeof __WEB_BUILD_ID__ === "undefined" ? "unknown" : __WEB_BUILD_ID__;
export const diagnosticSummaryBytes = 2048, diagnosticFileBytes = 65536;
const bytes = (text: string) => new TextEncoder().encode(text).length;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
const version = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9._-]{1,80}$/.test(value) ? value : null;
const build = (value: unknown, prefix: string) => typeof value === "string" && new RegExp(`^${prefix}-[a-f0-9-]{36}$`).test(value) ? value : "unknown";
const states = new Set(["connecting", "connected", "reconnecting", "stopped"]);
const reasons = new Set(["connect", "open", "closed", "socket-error", "heartbeat-timeout", "retry", "stop"]);

export function projectDiagnosticEnvironment(native: unknown, gateway: unknown, context: {
  platform: "android" | "browser"; webVersionCode: number; webBuildId: string; documentHotVersion: string | null;
  nativeRead: "ok" | "unavailable" | "browser"; gatewayRead: "ok" | "unsupported" | "unauthorized" | "unavailable";
}) {
  const n = object(native), g = object(gateway), tunnel = object(g.tunnel);
  const supported = g.schema === "mobile-codex-gateway-diagnostics-v1";
  const events = (supported && Array.isArray(tunnel.events) ? tunnel.events : []).slice(-20).flatMap(raw => {
    const item = object(raw), time = typeof item.at === "string" ? Date.parse(item.at) : NaN;
    if (!Number.isFinite(time) || integer(item.generation) === null || integer(item.seq) === null || !states.has(String(item.state)) || !reasons.has(String(item.reason))) return [];
    return [{ at: new Date(time).toISOString(), seq: Number(item.seq), generation: Number(item.generation), state: String(item.state), reason: String(item.reason),
      ...(Number.isInteger(item.closeCode) && Number(item.closeCode) >= 1000 && Number(item.closeCode) <= 4999 ? { closeCode: Number(item.closeCode) } : {}) }];
  });
  return {
    platform: context.platform,
    native: { state: context.nativeRead, versionCode: context.nativeRead === "ok" ? integer(n.nativeVersionCode) : null },
    web: { versionCode: context.webVersionCode, buildId: build(context.webBuildId, "web") },
    hot: { active: version(n.activeVersion), pending: version(n.pendingVersion), loaded: version(context.documentHotVersion) },
    gateway: { state: context.gatewayRead === "ok" && !supported ? "unsupported" : context.gatewayRead, buildId: supported ? build(g.buildId, "gateway") : "unknown",
      tunnel: { enabled: supported && tunnel.enabled === true, omitted: integer(tunnel.omitted) ?? 0, events } },
  };
}

export async function readDiagnosticEnvironment(options: {
  signal: AbortSignal; platform: "android" | "browser"; webVersionCode: number; documentHotVersion: string | null;
  readNative: () => Promise<unknown>; readGateway: (signal: AbortSignal) => Promise<unknown>; timeoutMs?: number;
}) {
  const controller = new AbortController(), abort = () => controller.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectDeadline!: (reason: Error) => void;
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const cancelled = () => rejectDeadline(new Error("diagnostic_read_cancelled"));
  controller.signal.addEventListener("abort", cancelled, { once: true });
  timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 4000);
  try {
    controller.signal.throwIfAborted();
    const [native, gateway] = await Promise.allSettled([
      options.platform === "android" ? Promise.race([Promise.resolve().then(options.readNative), deadline]) : Promise.resolve(null),
      Promise.race([Promise.resolve().then(() => options.readGateway(controller.signal)), deadline]),
    ]);
    options.signal.throwIfAborted();
    const status = gateway.status === "rejected" ? object(gateway.reason).status : null;
    return projectDiagnosticEnvironment(native.status === "fulfilled" ? native.value : null, gateway.status === "fulfilled" ? gateway.value : null, {
      ...options, webBuildId,
      nativeRead: options.platform === "browser" ? "browser" : native.status === "fulfilled" ? "ok" : "unavailable",
      gatewayRead: gateway.status === "fulfilled" ? "ok" : status === 404 ? "unsupported" : status === 401 || status === 403 ? "unauthorized" : "unavailable",
    });
  } finally {
    clearTimeout(timer); controller.signal.removeEventListener("abort", cancelled); options.signal.removeEventListener("abort", abort); controller.abort();
  }
}

export function makeDiagnosticsExport(report: MessageDiagnosticReport, environment: ReturnType<typeof projectDiagnosticEnvironment>, connection: ReturnType<ReturnType<typeof createConnectionJournal>["snapshot"]>) {
  const full = { ...report, environment, connection, exportLimits: { summaryBytes: diagnosticSummaryBytes, fileBytes: diagnosticFileBytes }, trimmedRecords: 0 };
  // Fixed-size metadata normally stays below the cap; trim only detail, retaining counts.
  full.sameTextGroups = report.sameTextGroups.map(group => ({ ...group, records: [...group.records] }));
  let detail = JSON.stringify(full);
  while (bytes(detail) > diagnosticFileBytes) {
    const group = full.sameTextGroups.find(item => item.records.length);
    if (!group) throw new Error("diagnostic_file_too_large");
    group.records.pop(); group.omittedRecords++; full.trimmedRecords++; detail = JSON.stringify(full);
  }
  const summary = {
    schema: "mc-diag-2", at: report.capturedAt, thread: report.threadSha256.slice(0, 12), environment: {
      platform: environment.platform, apk: environment.native, web: environment.web, hot: environment.hot,
      gateway: { state: environment.gateway.state, buildId: environment.gateway.buildId },
    }, cache: report.cache,
    users: Object.fromEntries(report.stages.map(stage => [stage.stage, { total: stage.totalUserMessages, analyzed: stage.analyzedUserMessages }])),
    dom: { total: report.dom.totalUserTextElements, analyzed: report.dom.totalUserTextElements - report.dom.omittedElements,
      ids: report.dom.distinctIds, duplicateIds: report.dom.duplicateIds, matched: report.dom.matchedNodes,
      duplicates: report.dom.duplicates.slice(-2).map(item => ({ id: item.messageId.slice(0, 12), dom: item.nodes, runtime: item.runtime, rendered: item.rendered })) },
    sameText: report.sameTextGroups.slice(0, 2).map(group => ({ hash: group.displaySha256.slice(0, 12), counts: group.counts })),
    connection: { omitted: connection.omitted + Math.max(0, connection.events.length - 3), events: connection.events.slice(-3) },
    tunnel: { omitted: environment.gateway.tunnel.omitted + Math.max(0, environment.gateway.tunnel.events.length - 2), events: environment.gateway.tunnel.events.slice(-2) },
    detailBytes: bytes(detail), omittedSummaryItems: 0,
  };
  let text = JSON.stringify(summary);
  while (bytes(text) > diagnosticSummaryBytes) {
    if (summary.connection.events.length) { summary.connection.events.shift(); summary.connection.omitted++; }
    else if (summary.tunnel.events.length) { summary.tunnel.events.shift(); summary.tunnel.omitted++; }
    else if (summary.sameText.length) summary.sameText.pop();
    else if (summary.dom.duplicates.length) summary.dom.duplicates.pop();
    else throw new Error("diagnostic_summary_too_large");
    summary.omittedSummaryItems++; text = JSON.stringify(summary);
  }
  return { summary: text, detail, summaryBytes: bytes(text), detailBytes: bytes(detail) };
}

const DiagnosticExport = registerPlugin<{ save(options: { text: string }): Promise<{ status: "saved" | "cancelled" }> }>("DiagnosticExport");
export async function saveDiagnosticFile(text: string): Promise<"saved" | "cancelled" | "downloaded"> {
  if (bytes(text) > diagnosticFileBytes || JSON.parse(text).schema !== "mobile-codex-message-diagnostics-v2") throw new Error("diagnostic_file_invalid");
  if (Capacitor.isNativePlatform()) {
    if (!Capacitor.isPluginAvailable("DiagnosticExport")) throw new Error("diagnostic_export_unsupported");
    const result = await DiagnosticExport.save({ text });
    if (result.status !== "saved" && result.status !== "cancelled") throw new Error("diagnostic_export_failed");
    return result.status;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = `mobile-codex-diagnostics-${Date.now()}.json`;
  try { document.body.appendChild(link); link.click(); return "downloaded"; }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
