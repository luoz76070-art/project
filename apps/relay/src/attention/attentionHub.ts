import { randomUUID } from "node:crypto";
import path from "node:path";
import type { LastTurn } from "../../../../shared/lastTurn.js";
import type { AgentGateway } from "../agents/agentGateway.js";
import type { AgentSessionSnapshot } from "../agents/sessions.js";
import type { LiveApproval, LiveTurnController, LiveTurnSnapshot } from "../codex/liveTurnController.js";
import type { DesktopApproval } from "../desktop/desktopApprovals.js";
import type { DesktopControl, DesktopStreamSnapshot } from "../desktop/desktopControl.js";
import type { UserInputRequest } from "../desktop/desktopQuestions.js";
import type { CodexStore } from "../store/codexStore.js";
import { commandRisks } from "./risk.js";

/** A thread or session the phone sent work to; F1 notifies when it finishes or needs the user. */
export type AttentionTarget =
  | { source: "desktop"; threadId: string }
  | { source: "live"; threadId: string; turnId: string }
  | { source: "agent"; agentId: string; sessionId: string };
export type AttentionRequest = {
  id: string; kind: "approval" | "question"; title: string; detail: string;
  /** Non-empty means the phone must open the app: notifications never offer "allow" for these. */
  risks: string[]; canAllow: boolean; canDeny: boolean;
};
export type AttentionItem = {
  key: string; source: AttentionTarget["source"]; agentId: string | null; threadId: string; title: string;
  running: boolean; requests: AttentionRequest[];
  /** Latest turn that finished after the phone sent work here; older turns are never reported. */
  lastTurn: LastTurn | null; updatedAt: string;
};
export type AttentionChange = { key: string; item: AttentionItem | null };
export type AttentionDecision = "allow" | "deny";
export const attentionLimits = { perOwner: 8, total: 24, idleMs: 10 * 60_000, maxAgeMs: 24 * 60 * 60_000, sweepMs: 60_000, detail: 240 };

type Raw = DesktopStreamSnapshot | LiveTurnSnapshot | AgentSessionSnapshot;
type Entry = {
  key: string; target: AttentionTarget; owners: Set<string>; createdAt: number; watchedAt: number;
  baseline: string | null; baselineKnown: boolean; seenRunning: boolean; idleSince: number | null; latest: string | null;
  title: string; item: AttentionItem; signature: string; raw: Raw | null; release: () => void;
};
type Deps = { desktop: DesktopControl; liveTurns: LiveTurnController; gateway: AgentGateway; codex: Pick<CodexStore, "getThreadSummary">; now?: () => number };

const clip = (text: string, limit = attentionLimits.detail) => { const value = text.replace(/\s+/g, " ").trim(); return value.length > limit ? `${value.slice(0, limit - 1)}…` : value; };
export function attentionKey(target: AttentionTarget) {
  return target.source === "agent" ? `agent:${target.agentId}:${target.sessionId}` : `${target.source}:${target.threadId}`;
}
export function attentionError(code: string, statusCode: number) { return Object.assign(new Error(code), { statusCode, code }); }

const approvalTitles = { command: "运行命令", fileChange: "修改文件", permissions: "申请权限", unsupported: "需要处理" } as const;
function codexApproval(approval: DesktopApproval | LiveApproval): AttentionRequest {
  const files = "files" in approval && approval.files?.length ? approval.files : null;
  const detail = approval.kind === "command" ? approval.command ?? approval.detail
    : files ? `${files.slice(0, 3).map(file => path.basename(file.movePath ?? file.path)).join("、")}${files.length > 3 ? ` 等 ${files.length} 个文件` : ""}`
    : approval.detail || approval.title;
  // Permission grants widen what the agent may do; review them in the app, not from a notification.
  const risks = approval.kind === "permissions" ? ["权限变更要在 App 里确认"] : approval.kind === "unsupported" ? ["要在 App 里处理"] : commandRisks(approval.command);
  const blocked = "unavailableReason" in approval && Boolean(approval.unavailableReason), decisions = approval.availableDecisions as string[];
  return { id: approval.id, kind: "approval", title: approvalTitles[approval.kind], detail: clip(detail), risks,
    canAllow: !blocked && !risks.length && decisions.includes("accept"), canDeny: !blocked && decisions.includes("decline") };
}
function codexQuestion(input: UserInputRequest): AttentionRequest {
  return { id: input.id, kind: "question", title: "需要你回答", detail: clip(input.questions[0]?.question ?? ""), risks: [], canAllow: false, canDeny: false };
}
function agentRequests(snapshot: AgentSessionSnapshot): AttentionRequest[] {
  const permissions = snapshot.permissions.filter(item => item.status === "pending").map((item): AttentionRequest => {
    const detail = item.resources.length ? item.resources.join("\n") : item.detail;
    const risks = commandRisks(`${detail}\n${item.detail}`);
    return { id: item.id, kind: "approval", title: `申请权限：${clip(item.action, 40)}`, detail: clip(detail), risks,
      canAllow: !item.unavailableReason && !risks.length && item.decisions.includes("once"), canDeny: !item.unavailableReason && item.decisions.includes("reject") };
  });
  const questions = snapshot.questions.filter(item => item.status === "pending").map((item): AttentionRequest =>
    ({ id: item.id, kind: "question", title: "需要你回答", detail: clip(item.questions[0]?.question ?? ""), risks: [], canAllow: false, canDeny: false }));
  return [...permissions, ...questions];
}

/**
 * F1: watches only what a device sent work to, and tells that device when a turn finishes or needs a decision.
 * It reads the same snapshots the chat views use and never sends anything except an explicit decision.
 */
export class AttentionHub {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<(change: AttentionChange) => void>>();
  private sweeper?: ReturnType<typeof setInterval>;
  /** One upstream listener per channel, shared by all watches (no per-watch EventEmitter listeners). */
  private desktopOff?: () => void;
  private liveListener?: (snapshot: LiveTurnSnapshot) => void;
  private stopped = false;
  private readonly now: () => number;
  constructor(private deps: Deps) { this.now = deps.now ?? (() => Date.now()); }

  /** Call before the work is sent, so the turn it starts is the first one reported. */
  watch(owner: string, target: AttentionTarget) {
    if (this.stopped) return;
    const key = attentionKey(target), existing = this.entries.get(key);
    if (existing) {
      if (!existing.owners.has(owner) && !this.room(owner, false)) return;
      existing.owners.add(owner);
      existing.watchedAt = this.now(); existing.idleSince = null; existing.seenRunning = false;
      if (target.source === "live") { existing.target = target; existing.baseline = null; }
      else existing.baseline = existing.latest;
      if (existing.raw) this.update(existing, existing.raw, true);
      if (target.source === "live") { const current = this.deps.liveTurns.getTurn(target.turnId); if (current) this.update(existing, current); }
      return;
    }
    if (!this.room(owner, true)) return;
    const now = this.now();
    const entry: Entry = { key, target, owners: new Set([owner]), createdAt: now, watchedAt: now, baseline: null, baselineKnown: target.source === "live", seenRunning: false,
      idleSince: null, latest: null, title: "", signature: "", raw: null, release: () => {},
      item: { key, source: target.source, agentId: target.source === "agent" ? target.agentId : null, threadId: target.source === "agent" ? target.sessionId : target.threadId,
        title: target.source === "agent" ? target.agentId : "Codex 任务", running: false, requests: [], lastTurn: null, updatedAt: new Date(now).toISOString() } };
    this.entries.set(key, entry);
    try { this.open(entry); } catch { this.entries.delete(key); this.detach(); return; }
    this.sweeper ??= setInterval(() => this.sweep(), attentionLimits.sweepMs);
    this.sweeper.unref?.();
  }
  items(owner: string) { return [...this.entries.values()].filter(entry => entry.owners.has(owner)).map(entry => entry.item); }
  subscribe(owner: string, listener: (change: AttentionChange) => void) {
    const set = this.listeners.get(owner) ?? new Set(); set.add(listener); this.listeners.set(owner, set);
    return () => { set.delete(listener); if (!set.size) this.listeners.delete(owner); };
  }
  revoke(owner: string) {
    this.listeners.delete(owner);
    for (const entry of [...this.entries.values()]) if (entry.owners.has(owner)) this.drop(entry, owner);
  }
  stop() { this.stopped = true; clearInterval(this.sweeper); for (const entry of [...this.entries.values()]) this.remove(entry, false); this.detach(); this.listeners.clear(); }

  async respond(owner: string, key: string, requestId: string, decision: AttentionDecision) {
    const entry = this.entries.get(key);
    if (!entry?.owners.has(owner)) throw attentionError("attention_not_found", 404);
    const request = entry.item.requests.find(item => item.id === requestId && item.kind === "approval");
    if (!request) throw attentionError("attention_request_gone", 410);
    if (decision === "allow" ? !request.canAllow : !request.canDeny) throw attentionError("attention_needs_app", 409);
    const allow = decision === "allow", target = entry.target;
    if (target.source === "desktop") await this.deps.desktop.respondApproval(target.threadId, requestId, allow ? "accept" : "decline");
    else if (target.source === "live") await this.deps.liveTurns.respondApproval({ turnId: target.turnId, approvalId: requestId, decision: allow ? "accept" : "decline" });
    else {
      const token = (entry.raw as AgentSessionSnapshot | null)?.control?.token;
      if (!token) throw attentionError("attention_control_unavailable", 503);
      await this.deps.gateway.sessions(target.agentId).respondPermission(target.sessionId, requestId, { controlToken: token, clientMessageId: randomUUID(), decision: allow ? "once" : "reject" });
    }
    return { ok: true as const };
  }

  /** Makes room by forgetting the longest-idle watch; active work is never dropped, the new watch is skipped instead. */
  private room(owner: string, creating: boolean) {
    const idleFirst = (list: Entry[]) => list.filter(entry => entry.idleSince !== null).sort((a, b) => a.idleSince! - b.idleSince!)[0];
    const owned = [...this.entries.values()].filter(entry => entry.owners.has(owner));
    if (owned.length >= attentionLimits.perOwner) { const victim = idleFirst(owned); if (!victim) return false; this.drop(victim, owner); }
    if (creating && this.entries.size >= attentionLimits.total) { const victim = idleFirst([...this.entries.values()]); if (!victim) return false; this.remove(victim, true); }
    return true;
  }
  private drop(entry: Entry, owner: string) {
    entry.owners.delete(owner);
    for (const listener of this.listeners.get(owner) ?? []) { try { listener({ key: entry.key, item: null }); } catch { /* closes itself */ } }
    if (!entry.owners.size) this.remove(entry, false);
  }
  private open(entry: Entry) {
    const target = entry.target;
    if (target.source === "desktop") {
      this.desktopOff ??= this.deps.desktop.onStreamSnapshot(snapshot => {
        const watching = this.entries.get(`desktop:${snapshot.threadId}`);
        if (watching) this.update(watching, snapshot);
      });
      try { entry.release = this.deps.desktop.followThread(target.threadId, { allowLoad: true }); } catch (error) { this.detach(); throw error; }
      void this.deps.codex.getThreadSummary(target.threadId).then(thread => {
        if (thread?.threadName && this.entries.get(entry.key) === entry) { entry.title = thread.threadName; if (entry.raw) this.update(entry, entry.raw, true); }
      }, () => {});
      const current = this.deps.desktop.getStreamSnapshot(target.threadId);
      if (current) this.update(entry, current);
      return;
    }
    if (target.source === "live") {
      if (!this.liveListener) {
        this.liveListener = snapshot => {
          for (const watching of this.entries.values()) {
            if (watching.target.source === "live" && watching.target.turnId === snapshot.turnId) this.update(watching, snapshot);
          }
        };
        this.deps.liveTurns.on("snapshot", this.liveListener);
      }
      const current = this.deps.liveTurns.getTurn(target.turnId);
      if (current) this.update(entry, current);
      return;
    }
    let released = false, stop: (() => void) | undefined;
    entry.release = () => { released = true; stop?.(); };
    void this.deps.gateway.sessions(target.agentId).watchSession(target.sessionId, snapshot => {
      if (!released && snapshot.agentId === target.agentId && snapshot.session.id === target.sessionId) this.update(entry, snapshot);
    }, () => {}).then(value => { stop = value; if (released) value(); }, () => { if (!released && this.entries.get(entry.key) === entry) this.remove(entry, true); });
  }
  private update(entry: Entry, raw: Raw, force = false) {
    if (this.entries.get(entry.key) !== entry) return;
    entry.raw = raw;
    const target = entry.target;
    let running: boolean, requests: AttentionRequest[], lastTurn: LastTurn | null, title: string;
    if (target.source === "desktop") {
      const snapshot = raw as DesktopStreamSnapshot;
      running = snapshot.status === "starting" || snapshot.status === "inProgress" || Boolean(snapshot.activeTurnId);
      requests = [...(snapshot.approvals ?? []).filter(item => item.status === "pending").map(codexApproval),
        ...(snapshot.userInputs ?? []).filter(item => item.status === "pending").map(codexQuestion)];
      lastTurn = snapshot.lastTurn ?? null; title = entry.title || "Codex 任务";
    } else if (target.source === "live") {
      const snapshot = raw as LiveTurnSnapshot;
      running = snapshot.status === "starting" || snapshot.status === "inProgress";
      requests = [...snapshot.approvals.filter(item => item.status === "pending").map(codexApproval),
        ...snapshot.userInputs.filter(item => item.status === "pending").map(codexQuestion)];
      lastTurn = snapshot.lastTurn?.turnId === target.turnId ? snapshot.lastTurn : null;
      title = snapshot.thread?.threadName || "Codex 任务";
    } else {
      const snapshot = raw as AgentSessionSnapshot;
      running = snapshot.status === "running" || Boolean(snapshot.activeTurnId);
      requests = agentRequests(snapshot); lastTurn = snapshot.lastTurn ?? null; title = snapshot.session.title || target.agentId;
    }
    entry.latest = lastTurn?.turnId ?? entry.latest;
    if (!entry.baselineKnown) { entry.baselineKnown = true; entry.baseline = lastTurn?.turnId ?? null; if (lastTurn && this.recent(entry, lastTurn)) entry.baseline = null; }
    if (running) entry.seenRunning = true;
    const reported = lastTurn && lastTurn.turnId !== entry.baseline && (entry.seenRunning || this.recent(entry, lastTurn) || target.source === "live") ? lastTurn : entry.item.lastTurn;
    const active = running || requests.length > 0;
    entry.idleSince = active ? null : entry.idleSince ?? this.now();
    const next: AttentionItem = { ...entry.item, title, running, requests, lastTurn: reported ?? null };
    const signature = JSON.stringify([next.title, next.running, next.requests, next.lastTurn?.turnId, next.lastTurn?.status, next.lastTurn?.reason.code]);
    if (signature === entry.signature && !force) return;
    entry.signature = signature;
    entry.item = { ...next, updatedAt: new Date(this.now()).toISOString() };
    this.emit(entry, entry.item);
  }
  /** A turn whose provider-stamped end is after the watch began, for turns that finished before any snapshot arrived. */
  private recent(entry: Entry, turn: LastTurn) { return turn.timeSource === "provider" && Date.parse(turn.endedAt) >= entry.watchedAt - 5_000; }
  private emit(entry: Entry, item: AttentionItem | null) {
    for (const owner of entry.owners) for (const listener of this.listeners.get(owner) ?? []) {
      try { listener({ key: entry.key, item }); } catch { /* A broken stream closes itself. */ }
    }
  }
  private remove(entry: Entry, notify: boolean) {
    if (this.entries.get(entry.key) !== entry) return;
    this.entries.delete(entry.key);
    try { entry.release(); } catch { /* Upstream already gone. */ }
    if (notify) this.emit(entry, null);
    if (!this.entries.size && this.sweeper) { clearInterval(this.sweeper); this.sweeper = undefined; }
    this.detach();
  }
  private detach() {
    const sources = new Set([...this.entries.values()].map(entry => entry.target.source));
    if (!sources.has("desktop") && this.desktopOff) { this.desktopOff(); this.desktopOff = undefined; }
    if (!sources.has("live") && this.liveListener) { this.deps.liveTurns.off("snapshot", this.liveListener); this.liveListener = undefined; }
  }
  private sweep() {
    const now = this.now();
    for (const entry of [...this.entries.values()]) {
      if (now - entry.createdAt > attentionLimits.maxAgeMs || (entry.idleSince !== null && now - entry.idleSince > attentionLimits.idleMs)) this.remove(entry, true);
    }
  }
  /** Test hook: run the expiry pass now. */
  expire() { this.sweep(); }
}
