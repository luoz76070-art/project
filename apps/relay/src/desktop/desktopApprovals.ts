import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { conversationTurns, interactionError, record } from "./desktopQuestions.js";
import type { DesktopIpcResponse } from "./desktopIpcClient.js";
import type { NativeThreadView } from "./desktopNativeControl.js";

export type DesktopApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";
type Delivery = "submitting" | "submitted" | "uncertain";
export type DesktopApproval = {
  id: string; source: "desktop"; threadId: string; turnId: string;
  kind: "command" | "fileChange" | "permissions";
  status: "pending" | Delivery;
  title: string; detail: string; command: string | null; cwd: string | null; reason: string | null;
  preview: string; unavailableReason: string | null;
  availableDecisions: DesktopApprovalDecision[];
  createdAt: string; updatedAt: string;
};
type Candidate = Omit<DesktopApproval, "id" | "source" | "status" | "createdAt" | "updatedAt"> & {
  key: string; signature: string; requestId: string | number; method: string; permissions?: Record<string, unknown>;
};
type Binding = { candidate: Candidate; view: DesktopApproval };
type Pending = { threadId: string; signature: string; status: Delivery };
const decisions: DesktopApprovalDecision[] = ["accept", "acceptForSession", "decline", "cancel"];
const methods = {
  "item/commandExecution/requestApproval": "thread-follower-command-approval-decision",
  "item/fileChange/requestApproval": "thread-follower-file-approval-decision",
  "item/permissions/requestApproval": "thread-follower-permissions-request-approval-response",
} as const;
const text = z.string().max(32_768);
const pathText = z.string().min(1).max(4096);
const specialPath = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("root") }).strict(), z.object({ kind: z.literal("minimal") }).strict(),
  z.object({ kind: z.literal("project_roots"), subpath: pathText.nullable() }).strict(),
  z.object({ kind: z.literal("tmpdir") }).strict(), z.object({ kind: z.literal("slash_tmp") }).strict(),
  z.object({ kind: z.literal("unknown"), path: pathText, subpath: pathText.nullable() }).strict(),
]);
const filePath = z.discriminatedUnion("type", [
  z.object({ type: z.literal("path"), path: pathText }).strict(),
  z.object({ type: z.literal("glob_pattern"), pattern: pathText }).strict(),
  z.object({ type: z.literal("special"), value: specialPath }).strict(),
]);
const permissionsSchema = z.object({
  network: z.object({ enabled: z.boolean().nullable() }).strict().nullable(),
  fileSystem: z.object({
    read: z.array(pathText).max(128).nullable(), write: z.array(pathText).max(128).nullable(),
    globScanMaxDepth: z.number().int().nonnegative().optional(),
    entries: z.array(z.object({ path: filePath, access: z.enum(["read", "write", "none"]) }).strict()).max(128).optional(),
  }).strict().nullable(),
}).strict();
const changesSchema = z.array(z.object({
  path: pathText, diff: z.string().max(131_072),
  kind: z.discriminatedUnion("type", [z.object({ type: z.literal("add") }).strict(), z.object({ type: z.literal("delete") }).strict(), z.object({ type: z.literal("update"), move_path: pathText.nullable() }).strict()]),
}).strict()).min(1).max(128);

export function desktopApprovalCandidates(threadId: string, state: Record<string, unknown>): Candidate[] {
  const active = conversationTurns(state).filter(t => t.status === "inProgress" && typeof t.turnId === "string");
  const result: Candidate[] = [];
  const requests = Array.isArray(state.requests) ? state.requests : [];
  for (const value of requests.slice(0, 64)) {
    const request = record(value), params = record(request?.params);
    if (!request || !params || params.threadId !== threadId || typeof params.turnId !== "string" || typeof params.itemId !== "string") continue;
    if (typeof request.id !== "string" && !(typeof request.id === "number" && Number.isSafeInteger(request.id))) continue;
    if (typeof request.method !== "string" || !Object.hasOwn(methods, request.method)) continue;
    const turn = active.find(t => t.turnId === params.turnId);
    if (!turn) continue;
    const kind = request.method === "item/commandExecution/requestApproval" ? "command" : request.method === "item/fileChange/requestApproval" ? "fileChange" : "permissions";
    const candidate: Candidate = {
      key: JSON.stringify([request.method, request.id]), signature: "", requestId: request.id, method: request.method,
      threadId, turnId: params.turnId, kind,
      title: kind === "command" ? "命令执行请求" : kind === "fileChange" ? "文件修改请求" : "权限请求",
      detail: "请核对操作内容和授权范围。", command: null, cwd: null, reason: null, preview: "", unavailableReason: null,
      availableDecisions: [...decisions],
    };
    const reason = text.nullish().safeParse(params.reason), cwd = pathText.nullish().safeParse(params.cwd ?? state.cwd);
    candidate.reason = reason.success ? reason.data ?? null : null;
    candidate.cwd = cwd.success ? cwd.data ?? null : null;
    let understood = reason.success && cwd.success;
    const known = new Set(["threadId", "turnId", "itemId", "reason"]);
    if (kind === "command") {
      for (const field of ["approvalId", "command", "cwd", "networkApprovalContext", "commandActions", "additionalPermissions", "proposedExecpolicyAmendment", "proposedNetworkPolicyAmendments", "availableDecisions"]) known.add(field);
      const command = text.nullish().safeParse(params.command);
      candidate.command = command.success ? command.data ?? null : null;
      understood &&= command.success;
      const context = z.object({ host: pathText, protocol: z.enum(["http", "https", "socks5Tcp", "socks5Udp"]) }).strict().nullish().safeParse(params.networkApprovalContext);
      understood &&= context.success && Boolean(candidate.command?.trim() || (context.success && context.data));
      if (context.success && context.data) candidate.preview += `网络目标：${context.data.protocol}://${context.data.host}\n`;
      if (params.additionalPermissions != null) {
        const permissions = permissionsSchema.safeParse(params.additionalPermissions);
        understood &&= permissions.success;
        candidate.preview += permissions.success ? `附加权限：\n${JSON.stringify(permissions.data, null, 2)}\n` : "附加权限无法核验，请在电脑查看。\n";
      }
      // An explicitly empty or complex-only list must never become a generic accept.
      if (params.availableDecisions != null) {
        candidate.availableDecisions = Array.isArray(params.availableDecisions)
          ? decisions.filter(d => (params.availableDecisions as unknown[]).includes(d)) : [];
        if (!Array.isArray(params.availableDecisions) || params.availableDecisions.some(d => typeof d !== "string" || !decisions.includes(d as DesktopApprovalDecision))) candidate.unavailableReason = "此请求包含手机暂不支持的策略选项，其余选项请在电脑处理。";
      }
    } else if (kind === "fileChange") {
      known.add("grantRoot");
      const grantRoot = pathText.nullish().safeParse(params.grantRoot);
      understood &&= grantRoot.success;
      if (grantRoot.success && grantRoot.data) candidate.detail += `\n会话写入范围：${grantRoot.data}`;
      const items = Array.isArray(turn.items) ? turn.items : [];
      const item = items.map(record).find(item => item?.type === "fileChange" && item.id === params.itemId);
      const changes = changesSchema.safeParse(item?.changes);
      understood &&= changes.success;
      if (changes.success) candidate.preview = changes.data.map(c => `${c.kind.type} ${c.path}${c.kind.type === "update" && c.kind.move_path ? ` → ${c.kind.move_path}` : ""}\n${c.diff}`).join("\n\n");
      if (candidate.preview.length > 262_144) { understood = false; candidate.preview = "文件差异过大，请在电脑查看完整内容。"; }
    } else {
      known.add("cwd"); known.add("permissions");
      const permissions = permissionsSchema.safeParse(params.permissions);
      understood &&= permissions.success;
      candidate.detail = "允许一次仅限当前任务；本会话允许会延续到当前会话。拒绝或取消不会授予额外权限。";
      candidate.preview = permissions.success ? JSON.stringify(permissions.data, null, 2) : "无法读取完整权限范围，请在电脑查看。";
      if (permissions.success) candidate.permissions = Object.fromEntries(Object.entries(permissions.data).filter(([, value]) => value != null));
    }
    understood &&= Object.keys(params).every(key => known.has(key));
    if (candidate.preview.length > 262_144) { understood = false; candidate.preview = "操作详情过大，请在电脑查看完整内容。"; }
    if (!understood) {
      candidate.availableDecisions = candidate.availableDecisions.filter(d => d === "decline" || d === "cancel");
      candidate.unavailableReason = "无法完整核验此操作的内容或权限范围；允许操作请在电脑处理。";
    }
    if (!candidate.availableDecisions.length && !candidate.unavailableReason) candidate.unavailableReason = "此请求没有手机可用的选项，请在电脑处理。";
    candidate.signature = createHash("sha256").update(JSON.stringify([request, candidate.preview, candidate.unavailableReason])).digest("hex");
    result.push(candidate);
  }
  // Ambiguous raw request identities cannot be routed safely.
  return result.filter(c => result.filter(other => other.key === c.key).length === 1);
}

export class DesktopApprovals {
  private readonly bindings = new Map<string, Map<string, Binding>>();
  private readonly unconfirmed = new Map<string, Pending>();
  constructor(private readonly io: {
    read: (threadId: string) => NativeThreadView | null;
    request: (method: string, params: unknown, owner: string) => Promise<DesktopIpcResponse>;
    wait: (finished: () => boolean) => Promise<void>;
    changed: (threadId: string) => void;
  }) {}

  sync(threadId: string, state: Record<string, unknown>): void {
    const previous = new Map([...(this.bindings.get(threadId)?.values() ?? [])].map(b => [b.candidate.key, b]));
    const next = new Map<string, Binding>();
    const candidates = desktopApprovalCandidates(threadId, state);
    for (const [key, pending] of this.unconfirmed) if (pending.threadId === threadId && !candidates.some(c => c.signature === pending.signature)) this.unconfirmed.delete(key);
    for (const candidate of candidates) {
      const old = previous.get(candidate.key), now = new Date().toISOString();
      const pending = this.unconfirmed.get(this.pendingKey(candidate));
      const binding = old?.candidate.signature === candidate.signature ? old : {
        candidate, view: { id: randomUUID(), source: "desktop" as const, threadId, turnId: candidate.turnId, kind: candidate.kind,
          status: pending?.status ?? "pending" as const, title: candidate.title, detail: candidate.detail, command: candidate.command, cwd: candidate.cwd, reason: candidate.reason,
          preview: candidate.preview, unavailableReason: candidate.unavailableReason, availableDecisions: candidate.availableDecisions, createdAt: now, updatedAt: now },
      };
      next.set(binding.view.id, binding);
    }
    this.bindings.set(threadId, next);
  }

  invalidate(threadId: string): void {
    this.bindings.delete(threadId);
    for (const pending of this.unconfirmed.values()) if (pending.threadId === threadId) pending.status = "uncertain";
  }

  snapshot(threadId: string): DesktopApproval[] {
    return [...(this.bindings.get(threadId)?.values() ?? [])].map(b => ({ ...b.view, availableDecisions: [...b.view.availableDecisions] }));
  }

  async respond(threadId: string, id: string, decision: DesktopApprovalDecision): Promise<{ status: "resolved" | "submitted" | "uncertain" }> {
    const binding = this.bindings.get(threadId)?.get(id), view = this.io.read(threadId);
    if (!binding || !view) throw interactionError("approval_expired");
    if (binding.view.status !== "pending") throw interactionError("approval_already_submitted");
    if (!binding.candidate.availableDecisions.includes(decision)) throw interactionError("invalid_approval_decision", 400);
    if (this.unconfirmed.size >= 128) throw interactionError("desktop_approval_limit", 429);
    const candidate = binding.candidate, key = this.pendingKey(candidate);
    const pending: Pending = { threadId, signature: candidate.signature, status: "submitting" };
    this.unconfirmed.set(key, pending);
    this.setStatus(binding, "submitting"); this.io.changed(threadId);
    const current = () => this.io.read(threadId)?.epoch === view.epoch;
    const unresolved = () => this.bindings.get(threadId)?.has(id);
    try {
      const method = methods[candidate.method as keyof typeof methods];
      const params = candidate.kind === "permissions"
        ? { conversationId: threadId, requestId: candidate.requestId, response: { permissions: decision === "decline" || decision === "cancel" ? {} : candidate.permissions, scope: decision === "acceptForSession" ? "session" : "turn", strictAutoReview: decision === "decline" || decision === "cancel" } }
        : { conversationId: threadId, requestId: candidate.requestId, decision };
      const response = await this.io.request(method, params, view.owner);
      const outer = record(response.result), result = record(outer?.result ?? outer);
      if (!current() || response.resultType !== "success" || response.method !== method || response.handledByClientId !== view.owner || (outer?.method != null && outer.method !== method) || result?.ok !== true) throw interactionError("approval_response_unknown");
      if (!unresolved()) return { status: "resolved" };
      pending.status = "submitted"; this.setStatus(binding, "submitted"); this.io.changed(threadId);
      await this.io.wait(() => !current() || !unresolved());
      return { status: !current() ? "uncertain" : unresolved() ? "submitted" : "resolved" };
    } catch {
      pending.status = "uncertain";
      if (current() && unresolved()) { this.setStatus(binding, "uncertain"); this.io.changed(threadId); }
      return { status: "uncertain" };
    }
  }

  private pendingKey(candidate: Candidate): string { return JSON.stringify([candidate.threadId, candidate.signature]); }
  private setStatus(binding: Binding, status: Delivery): void { binding.view.status = status; binding.view.updatedAt = new Date().toISOString(); }
}
