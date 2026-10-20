import { type CodexMessage, type ToolMessageMeta, type ThreadRuntime, type LiveTurnStatus, type DesktopControlResponse, type LiveApprovalDecision } from "../../app/types";
import { firstLine, pathTail } from "../threads/model";
import { clip } from "../../shared/format";
import { collapseMirroredMessages, stripCodexAppDirectives, reconcileMessages } from "./messageReconciliation";
import { maxMessagesPerThread } from "../../app/config";

export function isToolMessage(message: CodexMessage) {
  return message.role === "tool" || (message.role !== "user" && message.role !== "assistant" && isToolKind(message.kind));
}

export function isToolKind(kind: string) {
  return /tool|command|exec|function|mcp|filechange|patch|plan|task|approval|shell|terminal|output/i.test(kind);
}

export function summarizeToolMessage(message: CodexMessage) {
  const meta = parseToolMessageMeta(message);
  const failed = isToolFailed(message.text);
  if (message.kind === "task_started") {
    return { title: "Codex 开始执行", action: "准备处理当前请求", detail: "等待桌面端开始输出", failed: false };
  }
  if (message.kind === "plan") {
    return { title: "计划更新", action: "更新执行计划", detail: firstLine(message.text) || "计划状态已变化", failed };
  }
  if (message.kind === "commandExecution") {
    return {
      title: failed ? "命令失败" : "运行命令",
      action: commandAction(meta.command || message.text),
      detail: toolDetailFromMeta(meta) || clip(firstMeaningfulLine(message.text), 90) || "命令已启动",
      failed,
    };
  }
  if (isToolOutputKind(message.kind)) {
    const outputPreview = firstMeaningfulToolOutputLine(message.text);
    return {
      title: failed ? "工具失败" : "工具结果",
      action: failed ? "需要查看工具输出" : meta.emptyOutput ? "工具执行完成，无文本输出" : "工具已返回结果",
      detail: outputPreview || toolDetailFromMeta(meta) || "没有额外输出",
      failed,
    };
  }
  return {
    title: toolTitle(meta.tool, message.kind),
    action: toolActionFromMeta(meta, message.kind),
    detail: toolDetailFromMeta(meta) || firstMeaningfulLine(message.text) || "工具调用已记录",
    failed,
  };
}

export function toolRawText(message: CodexMessage) {
  const text = message.text.trim();
  if (!text) return "";
  if (isEmptySuccessfulToolOutput(message)) return "";
  if (isThinToolText(text)) return "";
  return text;
}

export function isThinToolText(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return true;
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return true;
  return lines.every((line) => /^Tool:\s*[\w@./:-]+$/i.test(line) || /^Codex turn started$/i.test(line));
}

export function toolAction(text: string, source: string) {
  const raw = shellSnippet(text || source || "tool");
  const lower = raw.toLowerCase();
  const target = pathName(raw);
  if (lower.includes("apply_patch") || raw === "apply_patch") return "修改文件";
  if (lower.includes("web_search")) return "搜索网页";
  if (/\brg\b/.test(lower)) return target ? `搜索 ${target}` : "搜索代码";
  if (/\b(sed|cat|nl|head|tail)\b/.test(lower)) return target ? `读取 ${target}` : "读取文件";
  if (/\b(ls|find)\b/.test(lower)) return target ? `查看 ${target}` : "查看文件列表";
  if (/\bgit\s+status\b/.test(lower)) return "检查 Git 状态";
  if (/\bgit\s+(diff|show|log)\b/.test(lower)) return "查看 Git 变更";
  if (/\b(pnpm|npm|yarn)\s+(run\s+)?(check|lint|typecheck)\b|\btsc\b|node\s+--check\b/.test(lower)) return "运行项目检查";
  if (/\b(pnpm|npm|yarn)\s+(run\s+)?test\b/.test(lower)) return "运行测试";
  if (/\b(pnpm|npm|yarn)\s+(run\s+)?build\b|gradle\s+assemble/i.test(raw)) return "构建项目";
  if (/\bcurl\b/.test(lower)) return "检查接口";
  if (/\bscp\b|\brsync\b/.test(lower)) return "同步文件";
  if (/\bssh\b/.test(lower)) return "执行远程命令";
  if (/\bopen\b|\bosascript\b/.test(lower)) return "操作桌面应用";
  if (/\bnode\b/.test(lower)) return target ? `运行 ${target}` : "运行脚本";
  if (source === "function_call") return clip(raw.replace(/^Tool:\s*/i, ""), 42) || "调用工具";
  return clip(raw, 42) || "调用工具";
}

export function toolActionFromMeta(meta: ToolMessageMeta, source: string) {
  if (meta.tool === "multi_tool_use.parallel") {
    const count = Array.isArray(meta.args?.tool_uses) ? meta.args.tool_uses.length : 0;
    return count > 0 ? `并行调用 ${count} 个工具` : "并行调用工具";
  }
  if (meta.tool === "write_stdin") return "向运行中的命令发送输入";
  if (meta.tool === "apply_patch") return "修改文件";
  if (meta.command) return commandAction(meta.command);
  if (meta.tool) return friendlyToolName(meta.tool);
  return toolAction(meta.text, source);
}

export function commandAction(command: string) {
  return toolAction(command, "commandExecution");
}

export function toolDetail(text: string) {
  const command = text.match(/^Command:\s*(.+)$/im)?.[1];
  const tool = text.match(/^Tool:\s*(.+)$/im)?.[1];
  const workdir = text.match(/^Workdir:\s*(.+)$/im)?.[1];
  return [tool && `工具 ${clip(tool, 32)}`, command && clip(command, 80), workdir && pathTail(workdir)].filter(Boolean).join(" · ");
}

export function parseToolMessageMeta(message: CodexMessage): ToolMessageMeta {
  const text = message.text.trim();
  const tool = text.match(/^Tool:\s*(.+)$/im)?.[1]?.trim() ?? "";
  const args = parseToolArgs(text);
  const command =
    text.match(/^Command:\s*(.+)$/im)?.[1]?.trim() ??
    stringArg(args, "command") ??
    stringArg(args, "cmd") ??
    stringArg(args, "script") ??
    "";
  const workdir = text.match(/^Workdir:\s*(.+)$/im)?.[1]?.trim() ?? stringArg(args, "workdir") ?? stringArg(args, "cwd") ?? "";
  const output = toolOutputBody(text);
  return {
    text,
    tool,
    command,
    workdir,
    args,
    output,
    emptyOutput: isToolOutputKind(message.kind) && output.trim().length === 0,
  };
}

export function parseToolArgs(text: string): Record<string, unknown> | null {
  const withoutToolLine = text.replace(/^Tool:\s*.+$/im, "").trim();
  if (!withoutToolLine.startsWith("{")) return null;
  return parseJsonRecord(withoutToolLine);
}

export function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function stringArg(args: Record<string, unknown> | null, key: string) {
  const value = args?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function toolTitle(tool: string, kind: string) {
  if (tool === "exec_command" || /command|exec|shell|terminal/i.test(kind)) return "运行命令";
  if (tool === "write_stdin") return "继续命令";
  if (tool === "apply_patch" || /filechange|patch/i.test(kind)) return "修改文件";
  if (/approval/i.test(kind)) return "权限请求";
  return "工具调用";
}

export function friendlyToolName(tool: string) {
  const labels: Record<string, string> = {
    exec_command: "运行命令",
    write_stdin: "继续运行中的命令",
    apply_patch: "修改文件",
    "multi_tool_use.parallel": "并行调用工具",
  };
  return labels[tool] ?? `调用 ${clip(tool, 42)}`;
}

export function toolDetailFromMeta(meta: ToolMessageMeta) {
  const details = [
    meta.tool && `工具 ${clip(meta.tool, 36)}`,
    meta.command && clip(shellSnippet(meta.command), 90),
    meta.workdir && pathTail(meta.workdir),
    sessionDetail(meta.args),
    parallelDetail(meta.args),
  ];
  return details.filter(Boolean).join(" · ");
}

export function sessionDetail(args: Record<string, unknown> | null) {
  const sessionId = args?.session_id;
  return typeof sessionId === "number" || typeof sessionId === "string" ? `会话 ${sessionId}` : "";
}

export function parallelDetail(args: Record<string, unknown> | null) {
  const uses = args?.tool_uses;
  if (!Array.isArray(uses) || uses.length === 0) return "";
  const names = uses
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const name = (item as { recipient_name?: unknown }).recipient_name;
      return typeof name === "string" ? name.replace(/^functions\./, "") : "";
    })
    .filter(Boolean)
    .slice(0, 3);
  return names.length > 0 ? names.join("、") : "";
}

export function firstMeaningfulLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^Tool:|^Command:|^Workdir:/i.test(line)) ?? "";
}

export function firstMeaningfulToolOutputLine(value: string) {
  return toolOutputBody(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

export function toolOutputBody(value: string) {
  const match = String(value || "").match(/(?:^|\n)Output:\n?([\s\S]*)$/);
  return match ? match[1].trim() : "";
}

export function isToolOutputKind(kind: string) {
  return /output|result/i.test(kind);
}

export function isToolFailed(text: string) {
  const value = String(text || "");
  return (
    /(?:process exited with code|exit code)\s+[1-9]\d*/i.test(value) ||
    /(?:^|\n)\s*(?:error|failed|failure|exception|traceback)\b[:\s]/i.test(value) ||
    /status[=:]\s*(failed|error)/i.test(value)
  );
}

export function isEmptySuccessfulToolOutput(message: CodexMessage) {
  return isToolOutputKind(message.kind) && toolOutputBody(message.text).length === 0 && !isToolFailed(message.text);
}

export function shellSnippet(value: string) {
  const raw = String(value || "").trim();
  const command = raw.match(/^Command:\s*([\s\S]+)/im)?.[1]?.trim();
  const match = (command || raw).match(/-lc\s+["']([\s\S]*)["']\s*$/);
  return (match ? match[1] : command || raw).replace(/\\n/g, " ").replace(/\\(["'])/g, "$1");
}

export function pathName(value: string) {
  const match = String(value || "").match(
    /(?:^|\s)(?:["'])?((?:\.{0,2}\/|~\/|\/)[^\s"'|;&)]+|[\w.-]+\.(?:mjs|js|ts|tsx|json|md|css|html|sh|py|swift|toml|ya?ml))(?:["'])?/,
  );
  if (!match) return "";
  return match[1].replace(/\/+$|["']/g, "").split("/").filter(Boolean).pop() || "";
}

export function takeSmoothChunk(buffer: string) {
  const length = buffer.length;
  const base = length > 5000 ? 18 : length > 2600 ? 14 : length > 1200 ? 10 : length > 520 ? 7 : length > 180 ? 4 : 2;
  let end = Math.min(length, base);
  while (end < length && end < base + 4 && /[\s，。！？、；：,.!?;:]/.test(buffer[end])) end += 1;
  return buffer.slice(0, end);
}

export function roleLabel(role: string) {
  const labels: Record<string, string> = {
    user: "你",
    assistant: "Codex",
    developer: "规则",
    system: "系统",
    tool: "工具",
  };
  return labels[role] ?? role;
}

export function roleClass(role: string) {
  if (role === "user") return "from-user";
  if (role === "assistant") return "from-assistant";
  return "from-system";
}

export function shouldFallbackToRelay(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("no-client-found") ||
    lower.includes("desktop-ipc-request-timeout") ||
    lower.includes("desktop-ipc-not-connected") ||
    lower.includes("desktop-ipc-closed") ||
    lower.includes("cannot find") ||
    lower.includes("no handler") ||
    lower.includes("no-handler")
  );
}

export function messagesForRender(messages: CodexMessage[]) {
  return collapseMirroredMessages(
    messages.flatMap((message) => {
      if (!isTextConversationMessage(message) || isEmptyChatMessage(message) || isGeneratedContextMessage(message)) return [];
      if (message.role !== "assistant") return [message];
      const text = stripCodexAppDirectives(message.text);
      return text ? [{ ...message, text }] : [];
    }),
  );
}

export function isTextConversationMessage(message: CodexMessage) {
  return (message.role === "user" || message.role === "assistant") && !isToolMessage(message);
}

export function isEmptyChatMessage(message: CodexMessage) {
  return !isToolMessage(message) && message.text.trim().length === 0;
}

export function isGeneratedContextMessage(message: CodexMessage) {
  if (message.role !== "user") return false;
  const text = message.text.trim();
  return (
    text.startsWith("<environment_context>") ||
    text.startsWith("<permissions instructions>") ||
    text.startsWith("<app-context>") ||
    text.startsWith("<collaboration_mode>") ||
    text.startsWith("<personality_spec>") ||
    text.startsWith("<skills_instructions>") ||
    text.startsWith("<plugins_instructions>") ||
    text.startsWith("# AGENTS.md instructions") ||
    text.startsWith("<INSTRUCTIONS>") ||
    text.startsWith("Knowledge cutoff:") ||
    text.startsWith("You are ")
  );
}

export function isEmptyToolMessage(message: CodexMessage) {
  if (!isToolMessage(message)) return false;
  if (message.kind === "task_started") return false;
  if (isEmptySuccessfulToolOutput(message)) return true;
  return message.text.trim().length === 0;
}

export function latestAssistantFromMessages(messages: CodexMessage[]) {
  return [...messages].reverse().find((message) => message.role === "assistant" && message.text.trim().length > 0) ?? null;
}

export function hasAssistantOutputAfterLatestUser(messages: CodexMessage[]) {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return latestAssistantFromMessages(messages) !== null;
  return messages.slice(latestUserIndex + 1).some((message) => message.role === "assistant" && message.text.trim().length > 0);
}

export function latestAssistantIdFromMessages(messages: CodexMessage[]) {
  return latestAssistantFromMessages(messages)?.id ?? null;
}

export function nextSmoothMessageId(runtime: ThreadRuntime, messages: CodexMessage[]) {
  const latest = latestAssistantFromMessages(messages);
  if (!latest) return runtime.smoothMessageId;
  if (runtime.smoothMessageId === latest.id) return latest.id;
  const previous = runtime.messages.find((message) => message.id === latest.id);
  return !previous || previous.text !== latest.text ? latest.id : runtime.smoothMessageId;
}

export function turnInlineIndicator(
  messages: CodexMessage[],
  runtime: ThreadRuntime,
  options: { desktop: boolean; pendingApproval: boolean },
): { messageId: string; label: string; detail: string; tone: "thinking" | "outputting" | "approval" } | null {
  const active = isRuntimeTurnActive(runtime);
  if (!active && !options.pendingApproval) return null;

  const latestAssistant = latestAssistantFromMessages(messages);
  const latestUser = [...messages].reverse().find((message) => message.role === "user") ?? null;
  const fallback = [...messages].reverse().find((message) => message.role === "assistant" || message.role === "user") ?? null;

  if (options.pendingApproval) {
    const target = latestAssistant ?? latestUser ?? fallback;
    return { messageId: target?.id ?? "", label: "等待审批", detail: "确认后继续执行", tone: "approval" };
  }

  if (runtime.activity) {
    const labels = { thinking: "正在思考", working: "Codex 正在工作", outputting: "正在输出" };
    return {
      messageId: (latestAssistant ?? latestUser ?? fallback)?.id ?? "",
      label: labels[runtime.activity],
      detail: runtime.activity === "working" ? "正在执行操作，完成后继续同步" : options.desktop ? "同步电脑会话" : "实时接收输出",
      tone: runtime.activity === "outputting" ? "outputting" : "thinking",
    };
  }

  if (hasAssistantOutputAfterLatestUser(messages) && latestAssistant) {
    return {
      messageId: latestAssistant.id,
      label: "正在输出",
      detail: options.desktop ? "同步桌面输出" : "实时接收输出",
      tone: "outputting",
    };
  }

  const target = latestUser ?? fallback;
  return {
    messageId: target?.id ?? "",
    label: "正在思考",
    detail: options.desktop ? "等待桌面响应" : "等待 Codex 回复",
    tone: "thinking",
  };
}

export function isRuntimeTurnActive(runtime: ThreadRuntime) {
  if (runtime.lastTurnError) return false;
  if (runtime.turnStatus === "starting" || runtime.turnStatus === "inProgress") return true;
  if (runtime.turnStatus === "completed" || runtime.turnStatus === "interrupted" || runtime.turnStatus === "failed") return false;
  return runtime.sending;
}

export function mergeMessages(current: CodexMessage[], incoming: CodexMessage[]) {
  return reconcileMessages(current, incoming);
}

export function mergeMessagesById(current: CodexMessage[], incoming: CodexMessage[]) {
  return reconcileMessages(current, incoming);
}

export function capMessages(messages: CodexMessage[], runtime?: { historyBrowsing?: boolean }) {
  if (messages.length <= maxMessagesPerThread) return messages;
  return runtime?.historyBrowsing ? messages.slice(0, maxMessagesPerThread) : messages.slice(-maxMessagesPerThread);
}

export function canUseEventSource() {
  return typeof EventSource !== "undefined";
}

export function turnStatusText(status: LiveTurnStatus | "idle") {
  if (status === "starting") return "Codex 启动中";
  if (status === "inProgress") return "Codex 正在处理";
  if (status === "completed") return "Codex 已完成";
  if (status === "interrupted") return "Codex 已打断";
  if (status === "failed") return "Codex 运行失败";
  return "";
}

export function activeTurnActivity(
  runtime: ThreadRuntime,
  options: { desktop: boolean; hasAssistantOutput: boolean; pendingApproval: boolean },
) {
  if (options.pendingApproval) return { label: "等待审批", detail: "确认后继续执行" };
  if (runtime.activity === "working") return { label: "Codex 正在工作", detail: "正在执行操作，完成后继续同步" };
  if (runtime.activity === "thinking") return { label: "正在思考", detail: "电脑仍在处理当前请求" };
  if (runtime.activity === "outputting") return { label: "正在输出", detail: "正在同步电脑回复" };
  if (runtime.turnStatus === "starting") {
    return { label: "正在思考", detail: options.desktop ? "等待桌面响应" : "等待 Codex 回复" };
  }
  if (options.hasAssistantOutput) {
    return { label: "正在输出", detail: options.desktop || runtime.watchMode === "desktop-tail" ? "同步桌面输出" : "实时接收输出" };
  }
  return { label: "正在思考", detail: options.desktop || runtime.watchMode === "desktop-tail" ? "等待桌面响应" : "等待 Codex 回复" };
}

export function desktopActionText(action: DesktopControlResponse["action"]) {
  if (action === "ui-submit") return "已提交到电脑 Codex";
  if (action === "steer-turn") return "已向桌面 Codex 发送引导";
  if (action === "interrupt-turn") return "已向桌面 Codex 发送打断";
  return "已在桌面 Codex 启动 turn";
}

export function approvalDecisionText(decision: LiveApprovalDecision) {
  if (decision === "accept") return "已允许一次";
  if (decision === "acceptForSession") return "已允许本会话";
  if (decision === "decline") return "已拒绝审批";
  return "已取消审批";
}
