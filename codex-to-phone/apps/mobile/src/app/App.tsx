import { loadWorkspaceCache, saveWorkspaceCache } from "../features/threads/cache";
import { PairingPanel } from "../features/connection/PairingPanel";
import React, { useState, useRef, useMemo, useEffect } from "react";
import { type ConnectionProfile, type ThemeMode, type SplitMode, type ApprovalPolicy, type SandboxMode, type ThreadSummary, type ThreadRuntime, type DiagnosticStep, type RelayStatus, type UpdateState, type HotUpdateState, type LoadThreadsOptions, type HotUpdateManifest, type DesktopActiveResponse, type CodexMessage, type LiveTurnSnapshot, type SendRoute, type PendingAttachment, type DesktopControlResponse, type UploadResponse, type DesktopStreamSnapshot, type LiveApproval, type LiveApprovalDecision, type UserInputRequest } from "./types";
import { defaultProfileId, defaultTheme, defaultSplitMode, defaultApprovalPolicy, defaultSandboxMode, defaultSidePaneSize, defaultTopPaneSize, newThreadId, updateManifestUrl, appVersionCode, hotUpdateManifestUrl, desktopPollActiveMs, desktopPollIdleMs, liveSnapshotThrottleMs, livePollFallbackMs, statusKeepaliveMs, appVersionLabel } from "./config";
import { loadThreadRuntimeCache, defaultRuntime, getRuntime, saveThreadRuntimeCache, turnProgressPatch, desktopSendControl, desktopRejectedSendPatch, desktopControlPatch, desktopControlOfflinePatch, desktopControlResponsePatch, desktopMessageReceived, desktopInterruptResponsePatch, desktopApprovalsPatch, approvalResponsePatch } from "../features/chat/runtime";
import { messagesForRender, activeTurnActivity, turnInlineIndicator, capMessages, mergeMessages, mergeMessagesById, turnStatusText, desktopActionText, nextSmoothMessageId, canUseEventSource } from "../features/chat/messages";
import { groupThreadsByProject, mergeThreads, shortPath, isDesktopSource, firstLine, threadListDetail, cleanTitle, sourceClass, sourceLabel, retainCodexThread, sessionInRange, sessionListRefreshMs, type SessionRange } from "../features/threads/model";
import { ProjectGroups } from "../features/threads/ProjectGroups";
import { SessionRangeControl } from "../features/threads/SessionRangeControl";
import { loadConnectionProfiles, saveConnectionSettings, profileNameFromEndpoint, upsertConnectionProfile, saveConnectionProfiles } from "../features/connection/profiles";
import { loadThreadList, loadActiveTurns, threadFromLiveTurn, readThread } from "../features/connection/queries";
import { assertSecureEndpoint, toFriendlyFetchError, apiGet as requestGet, buildUrl, normalizeEndpoint, apiPost as requestPost } from "../features/connection/http";
import { makeDiagnosticText, connectionBadge, openHealthUrl } from "../features/connection/diagnostics";
import { Capacitor } from "@capacitor/core";
import { NativeHotUpdate } from "../features/updates/native";
import { useApkUpdate } from "../features/updates/useApkUpdate";
import { apkBusy, apkCanContinue, apkStatusText, parseAndroidUpdateManifest } from "../features/updates/apk";
import { ApkUpdateProgress } from "../features/updates/ApkUpdateProgress";
import { composeMessageWithAttachments, attachmentSummaryText, fileToBase64, mimeTypeFromName, isImageFile, revokeAttachmentPreviews } from "../features/chat/attachments";
import { isNearBottom, scrollMessagesToBottom } from "../features/chat/viewport";
import { clamp, applyTheme } from "../shared/preferences";
import { Menu, RefreshCcw, Settings, PanelLeft, X, Search, Sparkles, Monitor, Loader2, Wifi, Columns3, Rows3, MessageSquare, Copy, Activity, CircleStop, AlertCircle, FileUp, Send, ExternalLink, Server, KeyRound, EyeOff, Eye, Clipboard, Sun, Moon, CheckCircle2, Terminal, Plus, ArrowUp, ChevronLeft } from "lucide-react";
import { formatDate } from "../shared/format";
import { UserInputCard } from "../features/chat/UserInputCard";
import { MessageBubble, MessageTimeline, GenerationStatus, ApprovalCard, AttachmentTray } from "../features/chat/components";
import { writeClipboard } from "../shared/clipboard";
import { VoiceInput } from "../features/voice/VoiceInput";
import { VoiceSettings } from "../features/voice/VoiceSettings";

import { createSnapshotReducer } from "../features/connection/snapshotPatch";
import { subscribeEvents, type SubscriptionState } from "../features/connection/subscription";
const AgentWorkspace = React.lazy(() => import("../features/agents/AgentWorkspace"));

export function App() {
  const [agentMode, setAgentMode] = useState(false);
  const [connection, setConnection] = useState<ConnectionProfile>(() => {
    const profiles = loadConnectionProfiles();
    return profiles.find((profile) => profile.id === defaultProfileId) ?? profiles[0];
  });
  const scope = `${connection.id}:${connection.cacheNamespace ?? connection.updatedAt}:${normalizeEndpoint(connection.endpoint)}`;
  return agentMode
    ? <React.Suspense fallback={<main className="agent-workspace"><p className="inline-loading">正在打开 Agent…</p></main>}><AgentWorkspace key={scope} endpoint={normalizeEndpoint(connection.endpoint)} token={connection.token} scope={scope} onBack={() => setAgentMode(false)} /></React.Suspense>
    : <Workspace key={scope} connection={connection} scope={scope} onApply={setConnection} onOpenAgents={() => setAgentMode(true)} />;
}

function Workspace({ connection, scope, onApply, onOpenAgents }: { connection: ConnectionProfile; scope: string; onApply: (profile: ConnectionProfile) => void; onOpenAgents: () => void }) {
  const scopeAbortRef = useRef(new AbortController());
  const threadListRequestRef = useRef<AbortController | null>(null);
  const userInputSubmissionsRef = useRef(new Set<string>());
  const approvalSubmissionsRef = useRef(new Set<string>());
  const desktopInterruptRef = useRef<{ threadId: string; controlToken: string; expectedTurnId: string; clientMessageId: string } | null>(null);
  const endpoint = normalizeEndpoint(connection.endpoint);
  const token = connection.token;
  const apiGet = <T,>(url: string, auth?: string) => requestGet<T>(url, auth, scopeAbortRef.current.signal);
  const apiPost = <T,>(url: string, auth: string, body: unknown) => requestPost<T>(url, auth, body, scopeAbortRef.current.signal);
  useEffect(() => {
    const controller = new AbortController();
    scopeAbortRef.current = controller;
    return () => { controller.abort(); threadListRequestRef.current?.abort(); };
  }, []);
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>(() => loadConnectionProfiles());
  const [activeProfileId, setActiveProfileId] = useState(connection.id);
  const [draftEndpoint, setDraftEndpoint] = useState(endpoint);
  const [draftToken, setDraftToken] = useState(token);
  const [theme, setTheme] = useState<ThemeMode>(defaultTheme);
  const [splitMode, setSplitMode] = useState<SplitMode>(defaultSplitMode);
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(defaultApprovalPolicy);
  const [sandboxMode, setSandboxMode] = useState<SandboxMode>(defaultSandboxMode);
  const [sidePaneSize, setSidePaneSize] = useState(defaultSidePaneSize);
  const [topPaneSize, setTopPaneSize] = useState(defaultTopPaneSize);
  const [resizingPane, setResizingPane] = useState<"side" | "top" | null>(null);
  const workspaceCache = useMemo(() => loadWorkspaceCache(scope), [scope]);
  const [threads, setThreads] = useState<ThreadSummary[]>(workspaceCache.threads);
  const [threadState, setThreadState] = useState<Record<string, ThreadRuntime>>(() => loadThreadRuntimeCache(scope));
  const [selected, setSelected] = useState<ThreadSummary | null>(() => workspaceCache.threads.find(thread => thread.id === workspaceCache.selectedId) ?? null);
  const [isNewThread, setIsNewThread] = useState(workspaceCache.isNewThread);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "desktop" | "relay">("all");
  const [threadPage, setThreadPage] = useState({ offset: 0, hasMore: false, search: "" });
  const [threadRange, setThreadRange] = useState<SessionRange>("recent");
  const [status, setStatus] = useState("准备连接");
  const [liveStatus, setLiveStatus] = useState("live 未检测");
  const [desktopControlStatus, setDesktopControlStatus] = useState("desktop control 未检测");
  const [connectionState, setConnectionState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [diagnostics, setDiagnostics] = useState<DiagnosticStep[]>([]);
  const [diagnosticText, setDiagnosticText] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [submittingMessage, setSubmittingMessage] = useState(false);
  const [queueCancelling, setQueueCancelling] = useState<string | null>(null);
  const [activeDesktopThreadId, setActiveDesktopThreadId] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<SubscriptionState>("connecting");
  const [liveStreamFallbackTurnId, setLiveStreamFallbackTurnId] = useState<string | null>(null);
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>({
    checking: false,
    manifest: null,
    available: false,
    error: "",
    lastCheckedAt: "",
  });
  const [hotUpdateState, setHotUpdateState] = useState<HotUpdateState>({
    checking: false,
    installing: false,
    manifest: null,
    status: null,
    available: false,
    error: "",
  });
  const apkUpdate = useApkUpdate();
  const apkUpdating = apkUpdate.pending || apkBusy(apkUpdate.status);
  const apkDownloading = apkUpdate.status?.phase === "downloading" || apkUpdate.status?.phase === "verifying";
  const apkReady = apkCanContinue(apkUpdate.status);
  const updateCheckLock = useRef(false);

  const messagesRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceGridRef = useRef<HTMLElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const listRefreshReady = useRef(false);
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const selectedRef = useRef<ThreadSummary | null>(null);
  const activeRuntimeRef = useRef<ThreadRuntime>(defaultRuntime());
  const sendLockRef = useRef(false);
  const forceBottomRef = useRef(false);
  const atBottomRef = useRef(true);
  const activeThreadKey = selected?.id ?? (isNewThread ? newThreadId : "");
  const activeRuntime = getRuntime(threadState, activeThreadKey);
  const pendingInputId = activeRuntime.userInputs?.[0]?.id;
  const messages = activeRuntime.messages;
  const visibleMessages = useMemo(() => messagesForRender(messages), [messages]);
  const draft = activeRuntime.draft;
  const attachments = activeRuntime.attachments;
  const sending = activeRuntime.sending;
  const loadingMessages = activeRuntime.loading;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const candidates = threads.filter(thread => (sessionInRange(thread.updatedAt, threadRange) || retainCodexThread(thread.id, selected?.id ?? null, getRuntime(threadState, thread.id)))
      && (sourceFilter === "all" || (sourceFilter === "desktop" ? isDesktopSource(thread) : !isDesktopSource(thread))));
    if (!needle) return candidates;
    return candidates.filter((thread) =>
      [thread.threadName, thread.cwd, thread.originator, thread.source]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [threads, query, sourceFilter, threadRange, selected?.id, threadState]);
  const groupedFiltered = useMemo(() => groupThreadsByProject(filtered), [filtered]);

  const workspaceTitle = selected?.threadName || (isNewThread ? "新线程" : "Mobile Codex");
  const workspaceSubtitle =
    selected?.cwd ||
    (connectionState === "ok" ? "Relay 已连接" : connectionState === "testing" ? "检测连接中" : "打开设置配置 Endpoint 和 Token");
  const chatSubtitle = selected?.cwd || (isNewThread ? "准备创建新的 Codex 线程" : workspaceSubtitle);
  const isDesktopWatch = activeRuntime.watchMode === "desktop-tail";
  const desktopCapability = activeRuntime.desktopControl;
  const desktopSend = desktopSendControl(activeRuntime, relayStatus?.desktopControl?.mode);
  const nativeDesktop = desktopSend.native;
  const canUseDesktopIpc = Boolean(isDesktopWatch && selected?.id && (desktopCapability ? desktopCapability.token : !nativeDesktop && activeDesktopThreadId === selected.id));
  const canInterrupt = isDesktopWatch ? Boolean(desktopCapability?.canInterrupt && desktopCapability.token && desktopCapability.activeTurnId) : Boolean(activeRuntime.activeTurnId);
  const isDesktopHistoryOnly = Boolean(isDesktopWatch && selected?.id && !canUseDesktopIpc);
  const isLiveTurnActive = activeRuntime.turnStatus === "starting" || activeRuntime.turnStatus === "inProgress";
  const canQueue = Boolean(nativeDesktop && desktopCapability?.queue?.available);
  const desktopQueue = desktopCapability?.queue?.items ?? [];
  useEffect(() => { setQueueCancelling(null); }, [activeThreadKey]);
  const latestAssistantMessage = [...visibleMessages].reverse().find((message) => message.role === "assistant");
  const latestAssistantMessageId = latestAssistantMessage?.id ?? "";
  const latestAssistantHasText = Boolean(latestAssistantMessage?.text.trim());
  const smoothLatestAssistant = Boolean(latestAssistantMessageId && activeRuntime.smoothMessageId === latestAssistantMessageId);
  const smoothPending = Boolean(smoothLatestAssistant && (activeRuntime.sending || isLiveTurnActive));
  const pendingApprovals = activeRuntime.approvals.filter((approval) => ["pending", "submitting", "submitted", "uncertain"].includes(approval.status));
  const turnActivity = activeTurnActivity(activeRuntime, {
    desktop: canUseDesktopIpc,
    hasAssistantOutput: latestAssistantHasText,
    pendingApproval: pendingApprovals.length > 0,
  });
  const inlineTurnIndicator = turnInlineIndicator(visibleMessages, activeRuntime, {
    desktop: canUseDesktopIpc || activeRuntime.watchMode === "desktop-tail",
    pendingApproval: pendingApprovals.length > 0,
  });
  const showInlineTurnIndicator = Boolean(
    !loadingMessages &&
      inlineTurnIndicator &&
      !activeRuntime.lastTurnError &&
      !(activeRuntime.turnStatus === "completed" && latestAssistantHasText),
  );
  const canControlSelected = Boolean(isNewThread || selected);
  const canSubmitMessage = Boolean(draft.trim() || attachments.length > 0) && canControlSelected && !submittingMessage && (!sending || isLiveTurnActive) && (!(selected && isDesktopSource(selected)) || desktopSend.ready);
  const canSend = canSubmitMessage && !(isLiveTurnActive && nativeDesktop && !canQueue);
  const controlText = canUseDesktopIpc
    ? activeRuntime.sending
      ? nativeDesktop ? "运行中，可选择引导或排队" : "运行中，可继续引导或打断"
      : "发送到所选桌面会话"
    : isDesktopHistoryOnly
      ? "正在同步桌面控制状态"
    : isLiveTurnActive
      ? "运行中，可发送引导或打断"
    : selected
      ? "发送到当前会话"
      : "发送后创建手机线程";
  const layoutClass = `mode-${splitMode}`;
  const shellStyle = {
    "--side-pane": `${Math.round(sidePaneSize)}px`,
    "--top-pane": `${Math.round(topPaneSize)}px`,
  } as React.CSSProperties;

  function updateRuntime(key: string, updater: (runtime: ThreadRuntime) => ThreadRuntime) {
    if (!key) return;
    setThreadState((current) => ({
      ...current,
      [key]: updater(current[key] ?? defaultRuntime()),
    }));
  }

  function patchRuntime(key: string, patch: Partial<ThreadRuntime>) {
    updateRuntime(key, (runtime) => ({ ...runtime, ...patch }));
  }

  function removeRuntime(key: string) {
    setThreadState((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function loadThreads(options: LoadThreadsOptions = {}) {
    if (options.silent && threadListRequestRef.current) return;
    threadListRequestRef.current?.abort();
    const controller = new AbortController(); threadListRequestRef.current = controller;
    const parent = scopeAbortRef.current.signal, abort = () => controller.abort();
    parent.addEventListener("abort", abort, { once: true });
    if (parent.aborted) controller.abort();
    if (!options.silent) { setLoading(true); setStatus("同步线程中"); }
    try {
      saveConnectionSettings(endpoint, token);
      const search = options.search ?? threadPage.search;
      const range = options.range ?? threadRange;
      const data = await loadThreadList(endpoint, token, controller.signal, options.append ? threadPage.offset : 0, search, range);
      const activeTurns = options.silent ? [] : await loadActiveTurns(endpoint, token, controller.signal).catch(() => []);
      if (controller.signal.aborted) return;
      if (!options.silent || threadPage.offset <= 120) setThreadPage({ offset: data.nextOffset ?? 0, hasMore: data.hasMore ?? false, search });
      const currentWorkspace = workspaceCacheRef.current;
      const retainedThreads = currentWorkspace.threads.filter(thread => retainCodexThread(thread.id, currentWorkspace.selectedId, getRuntime(cacheStateRef.current, thread.id)));
      const mergedThreads = mergeThreads(
        activeTurns.map((turn) => threadFromLiveTurn(turn)).filter((thread): thread is ThreadSummary => Boolean(thread)),
        data.threads,
        options.append || options.silent ? currentWorkspace.threads : retainedThreads,
      ).filter(thread => sessionInRange(thread.updatedAt, range) || retainCodexThread(thread.id, currentWorkspace.selectedId, getRuntime(cacheStateRef.current, thread.id)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      setThreads(mergedThreads);
      setStatus(`已同步 ${mergedThreads.length} 个线程`);
      if (!options.silent) void refreshActiveDesktopThread();
      for (const turn of activeTurns) {
        applyLiveTurnSnapshot(turn.threadId, turn);
      }

      setSelected(current => current ? mergedThreads.find(thread => thread.id === current.id) ?? current : null);

      if (!options.silent && mergedThreads.length > 0 && !currentWorkspace.selectedId && !currentWorkspace.isNewThread) {
        await openThread(mergedThreads[0], { closeSidebar: true });
      }
    } catch (error) {
      if (!controller.signal.aborted) setStatus(toFriendlyFetchError(error));
    } finally {
      parent.removeEventListener("abort", abort);
      if (threadListRequestRef.current === controller) { threadListRequestRef.current = null; if (!controller.signal.aborted) setLoading(false); }
    }
  }

  useEffect(() => {
    const refresh = () => {
      const sidebar = sidebarRef.current;
      if (!document.hidden && sidebar && (sidebar.classList.contains("open") || (getComputedStyle(sidebar).visibility !== "hidden" && sidebar.getBoundingClientRect().right > 0))) void loadThreads({ silent: true });
    };
    if (listRefreshReady.current) refresh();
    listRefreshReady.current = true;
    const timer = window.setInterval(refresh, sessionListRefreshMs);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarOpen, splitMode, selected?.id, isNewThread, threadRange, threadPage.search, threadPage.offset]);

  async function testConnection() {
    if (normalizeEndpoint(draftEndpoint) !== endpoint || draftToken !== token) {
      await saveCurrentProfile();
      return;
    }
    setConnectionState("testing");
    setStatus("测试连接中");
    setLiveStatus("live 检测中");
    setDiagnostics([]);
    setDiagnosticText("");
    setCopied("");
    saveConnectionSettings(endpoint, token);

    const steps: DiagnosticStep[] = [];
    const startedAt = new Date().toISOString();

    async function runStep(name: string, action: () => Promise<string>) {
      try {
        const detail = await action();
        steps.push({ name, ok: true, detail });
      } catch (error) {
        steps.push({ name, ok: false, detail: toFriendlyFetchError(error) });
        throw error;
      } finally {
        setDiagnostics([...steps]);
      }
    }

    try {
      await runStep("Relay /health", async () => {
        const data = await apiGet<{ ok: boolean }>(buildUrl(endpoint, "/health"));
        if (!data.ok) throw new Error("Relay health returned ok=false");
        return "ok";
      });

      await runStep("Token /api/threads", async () => {
        const data = await apiGet<{ threads: ThreadSummary[] }>(buildUrl(endpoint, "/api/threads?limit=1"), token);
        return `ok, threads=${data.threads.length}`;
      });

      await runStep("Live /api/live/health", async () => {
        const data = await apiGet<{ ok: boolean; mode: string; error?: string }>(buildUrl(endpoint, "/api/live/health"), token);
        if (!data.ok) throw new Error(data.error ?? "live health returned ok=false");
        return `ok, mode=${data.mode}`;
      });

      await runStep("Desktop control /api/desktop/control/health", async () => {
        const data = await apiGet<{ ok: boolean; mode: string; error?: string }>(buildUrl(endpoint, "/api/desktop/control/health"), token);
        if (!data.ok) throw new Error(data.error ?? "desktop control returned ok=false");
        return `ok, mode=${data.mode}`;
      });

      await runStep("Status /api/status", async () => {
        const data = await refreshRelayStatus();
        const executable =
          typeof data.codexExecutable === "string"
            ? data.codexExecutable
            : data.codexExecutable?.executable;
        const executableSource =
          typeof data.codexExecutable === "string"
            ? "legacy"
            : data.codexExecutable?.source ?? "unknown";
        const codexDetail = executable
          ? `codex=${shortPath(executable)}`
          : `codex 未找到（${executableSource}）`;
        return `ok, ${codexDetail}, upload=${shortPath(data.uploadDir)}, cwd=${shortPath(data.defaultCwd)}`;
      });

      setConnectionState("ok");
      setStatus("连接测试通过");
      setLiveStatus("live 已连接");
      setDesktopControlStatus("desktop control 已连接");
      setDiagnosticText(makeDiagnosticText(startedAt, endpoint, steps));
      await loadThreads({ selectLatest: !selected && !isNewThread });
    } catch {
      setConnectionState("error");
      setStatus("连接测试失败");
      setDiagnosticText(makeDiagnosticText(startedAt, endpoint, steps));
    }
  }

  async function openThread(thread: ThreadSummary, options: { closeSidebar?: boolean } = {}) {
    setSelected(thread);
    setIsNewThread(false);
    setStatus("读取线程中");
    forceBottomRef.current = scrollPositionsRef.current[thread.id] === undefined;
    atBottomRef.current = forceBottomRef.current;
    patchRuntime(thread.id, { loading: true, status: "读取线程中" });
    try {
      const shouldUseDesktopTail = isDesktopSource(thread);
      const data = await readThread(endpoint, token, thread, scopeAbortRef.current.signal);
      updateRuntime(thread.id, (runtime) => {
        const reset = Boolean(runtime.generation && data.generation && runtime.generation !== data.generation);
        const historyBrowsing = Boolean(runtime.historyBrowsing && !reset);
        const mergedMessages = capMessages(mergeMessages(reset ? [] : runtime.messages, data.messages), { historyBrowsing });
        return {
          ...runtime,
          ...turnProgressPatch(reset ? { ...runtime, turnStatus: "idle", activity: undefined, sending: false, activeTurnId: null } : runtime, data),
          messages: mergedMessages,
          loaded: true,
          cursor: data.cursor ?? runtime.cursor,
          generation: data.generation,
          historyBefore: historyBrowsing ? runtime.historyBefore : data.windowStart,
          historyBrowsing,
          watchMode: shouldUseDesktopTail ? "desktop-tail" : "none",
          watching: shouldUseDesktopTail,
          readonlyReason: shouldUseDesktopTail
            ? "当前通过桌面 session 日志实时读取；发送会优先进入电脑 Codex。Windows 走 Desktop IPC，macOS 走可见 UI 注入。"
            : "",
          status: shouldUseDesktopTail
            ? `桌面实时监听中，保留 ${messagesForRender(mergedMessages).length} 条记录`
            : `已打开 ${messagesForRender(mergedMessages).length} 条记录`,
        };
      });
      patchRuntime(thread.id, {
        loaded: true,
        loading: false,
      });
      setStatus(data.messages.length > 0 ? "已同步最新记录，原有记录已保留" : "已打开线程，原有记录已保留");
      if (options.closeSidebar) setSidebarOpen(false);
      if (scrollPositionsRef.current[thread.id] !== undefined) requestAnimationFrame(() => {
        if (selectedRef.current?.id === thread.id && messagesRef.current) messagesRef.current.scrollTop = scrollPositionsRef.current[thread.id];
      });
    } catch (error) {
      setStatus(toFriendlyFetchError(error));
      patchRuntime(thread.id, { status: toFriendlyFetchError(error) });
    } finally {
      patchRuntime(thread.id, { loading: false });
    }
  }

  async function checkLiveStatus() {
    try {
      const data = await apiGet<{ ok: boolean; mode: string; error?: string }>(buildUrl(endpoint, "/api/live/health"), token);
      setLiveStatus(data.ok ? `live 已连接：${data.mode}` : `live 不可用：${data.error ?? "未知错误"}`);
    } catch (error) {
      setLiveStatus(`live 不可用：${toFriendlyFetchError(error)}`);
    }
    try {
      const data = await apiGet<{ ok: boolean; mode: string; error?: string }>(buildUrl(endpoint, "/api/desktop/control/health"), token);
      setDesktopControlStatus(data.ok ? `desktop control 已连接：${data.mode}` : `desktop control 不可用：${data.error ?? "未知错误"}`);
    } catch (error) {
      setDesktopControlStatus(`desktop control 不可用：${toFriendlyFetchError(error)}`);
    }
  }

  async function refreshRelayStatus(): Promise<RelayStatus> {
    const data = await apiGet<RelayStatus>(buildUrl(endpoint, "/api/status"), token);
    setRelayStatus(data);
    if (data.live) {
      setLiveStatus(data.live.ok ? `live 已连接：${data.live.mode}` : `live 不可用：${data.live.error ?? "未知错误"}`);
    }
    if (data.desktopControl) {
      setDesktopControlStatus(
        data.desktopControl.ok ? `desktop control 已连接：${data.desktopControl.mode}` : `desktop control 不可用：${data.desktopControl.error ?? "未知错误"}`,
      );
    }
    if (data.activeDesktopThread?.id) setActiveDesktopThreadId(data.activeDesktopThread.id);
    return data;
  }

  async function checkForUpdates(manual: boolean) {
    if (updateCheckLock.current || apkUpdating || hotUpdateState.installing) return;
    if (!updateManifestUrl) {
      const detail = "当前构建未配置在线更新地址";
      setUpdateState((current) => ({
        ...current,
        checking: false,
        error: manual ? detail : "",
        lastCheckedAt: manual ? new Date().toISOString() : current.lastCheckedAt,
      }));
      if (manual) setStatus(detail);
      return;
    }
    updateCheckLock.current = true;
    setUpdateState((current) => ({ ...current, checking: true, error: "" }));
    try {
      const url = new URL(updateManifestUrl);
      url.searchParams.set("t", String(Date.now()));
      const manifest = parseAndroidUpdateManifest(await apiGet<unknown>(url.href));
      const available = Number(manifest.versionCode) > appVersionCode;
      setUpdateState({
        checking: false,
        manifest,
        available,
        error: "",
        lastCheckedAt: new Date().toISOString(),
      });
      if (manual) setStatus(available ? `发现新版本 v${manifest.versionName}` : "当前已是最新版本");
    } catch (error) {
      const detail = toFriendlyFetchError(error);
      setUpdateState((current) => ({
        ...current,
        checking: false,
        available: false,
        manifest: null,
        error: detail,
        lastCheckedAt: new Date().toISOString(),
      }));
      if (manual) setStatus(`检查更新失败：${detail}`);
    } finally {
      updateCheckLock.current = false;
    }
  }

  async function installApkUpdate() {
    if (hotUpdateState.installing || updateState.checking || apkDownloading || apkUpdate.pending) return;
    if (apkUpdate.supported) {
      await apkUpdate.start(updateState.manifest);
      return;
    }
    const url = updateState.manifest?.apkUrl;
    if (!url) {
      setStatus("没有可下载的更新包");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    setStatus("请在浏览器下载并覆盖安装；新版 Android App 支持应用内下载与安装");
  }

  async function checkHotUpdate(manual: boolean) {
    if (!Capacitor.isNativePlatform() || !hotUpdateManifestUrl) {
      setHotUpdateState((current) => ({
        ...current,
        checking: false,
        error: manual && !hotUpdateManifestUrl ? "当前构建未配置热更新地址" : "",
      }));
      return;
    }

    setHotUpdateState((current) => ({ ...current, checking: true, error: "" }));
    try {
      const [manifest, nativeStatus] = await Promise.all([
        apiGet<HotUpdateManifest>(`${hotUpdateManifestUrl}?t=${Date.now()}`),
        NativeHotUpdate.getStatus(),
      ]);
      const maxNativeVersionCode = manifest.maxNativeVersionCode ?? 2_147_483_647;
      const compatible =
        appVersionCode >= manifest.minNativeVersionCode &&
        appVersionCode <= maxNativeVersionCode &&
        nativeStatus.nativeVersionCode === appVersionCode;
      const available = compatible && nativeStatus.activeVersion !== manifest.version;
      setHotUpdateState({
        checking: false,
        installing: false,
        manifest,
        status: nativeStatus,
        available,
        error: compatible ? "" : "热更新与当前 APK 版本不兼容，请安装新版 APK",
      });
      if (manual) {
        setStatus(available ? `发现热更新 ${manifest.version}` : compatible ? "当前热更新已是最新" : "需要安装新版 APK");
      }
    } catch (error) {
      const detail = toFriendlyFetchError(error);
      setHotUpdateState((current) => ({ ...current, checking: false, error: detail }));
      if (manual) setStatus(`检查热更新失败：${detail}`);
    }
  }

  async function applyHotUpdate() {
    if (apkUpdating) return;
    const manifest = hotUpdateState.manifest;
    if (!manifest || !hotUpdateState.available) return;
    setHotUpdateState((current) => ({ ...current, installing: true, error: "" }));
    setStatus(`正在安装热更新 ${manifest.version}`);
    try {
      await NativeHotUpdate.install({
        url: manifest.htmlUrl,
        sha256: manifest.sha256,
        version: manifest.version,
        minNativeVersionCode: manifest.minNativeVersionCode,
        maxNativeVersionCode: manifest.maxNativeVersionCode ?? 2_147_483_647,
      });
    } catch (error) {
      const detail = toFriendlyFetchError(error);
      setHotUpdateState((current) => ({ ...current, installing: false, error: detail }));
      setStatus(`热更新失败：${detail}`);
    }
  }

  async function rollbackHotUpdate() {
    if (apkUpdating || hotUpdateState.installing) return;
    if (!Capacitor.isNativePlatform()) return;
    setStatus("正在回退热更新");
    try {
      await NativeHotUpdate.rollback();
    } catch (error) {
      setStatus(`回退失败：${toFriendlyFetchError(error)}`);
    }
  }

  async function refreshActiveDesktopThread() {
    try {
      const data = await apiGet<DesktopActiveResponse>(buildUrl(endpoint, "/api/desktop/active"), token);
      setActiveDesktopThreadId(data.thread?.id ?? null);
    } catch {
      setActiveDesktopThreadId(null);
    }
  }

  async function openActiveDesktopThread() {
    setStatus("定位桌面当前窗口");
    try {
      const data = await apiGet<{ thread: ThreadSummary | null }>(buildUrl(endpoint, "/api/desktop/active"), token);
      if (!data.thread) {
        setStatus("未找到桌面线程");
        return;
      }
      setActiveDesktopThreadId(data.thread.id);
      const existing = threads.find((thread) => thread.id === data.thread?.id) ?? data.thread;
      await openThread(existing, { closeSidebar: true });
    } catch (error) {
      setStatus(toFriendlyFetchError(error));
    }
  }

  function startNewThread() {
    setSelected(null);
    setIsNewThread(true);
    patchRuntime(newThreadId, { messages: [], draft: "", attachments: [], loaded: true, status: "新线程" });
    setSidebarOpen(false);
    setStatus("新线程");
  }

  async function persistProfiles(profiles: ConnectionProfile[], activeId: string) {
    try {
      assertSecureEndpoint(profiles.find(profile => profile.id === activeId)!.endpoint);
      await saveConnectionProfiles(profiles, activeId);
      return true;
    } catch (error) { setStatus(toFriendlyFetchError(error)); return false; }
  }

  async function applyPairedConnection(pairedEndpoint: string, pairedToken: string) {
    const profile: ConnectionProfile = { id: activeProfileId, name: profileNameFromEndpoint(pairedEndpoint), endpoint: pairedEndpoint, token: pairedToken, cacheNamespace: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    const next = upsertConnectionProfile(connectionProfiles, profile);
    if (!await persistProfiles(next, profile.id)) throw new Error("设备凭证保存失败，请重新生成配对信息");
    saveConnectionSettings(pairedEndpoint, pairedToken);
    onApply(profile);
  }

  async function saveCurrentProfile() {
    const normalizedEndpoint = normalizeEndpoint(draftEndpoint);
    const now = new Date().toISOString();
    const nextProfile: ConnectionProfile = {
      id: activeProfileId || `profile-${Date.now()}`,
      name: profileNameFromEndpoint(normalizedEndpoint),
      endpoint: normalizedEndpoint,
      token: draftToken,
      cacheNamespace: endpoint === normalizedEndpoint && token === draftToken ? connection.cacheNamespace ?? connection.updatedAt : crypto.randomUUID(),
      updatedAt: now,
    };
    const next = upsertConnectionProfile(connectionProfiles, nextProfile);
    if (!await persistProfiles(next, nextProfile.id)) return;
    setConnectionProfiles(next);
    setActiveProfileId(nextProfile.id);
    saveConnectionSettings(normalizedEndpoint, draftToken);
    onApply(nextProfile);
    setStatus("连接档案已保存");
  }

  async function addConnectionProfile() {
    const id = `profile-${Date.now()}`;
    const nextProfile: ConnectionProfile = {
      id,
      name: "新连接",
      endpoint: "http://127.0.0.1:8787",
      token: "",
      updatedAt: new Date().toISOString(),
    };
    const next = upsertConnectionProfile(connectionProfiles, nextProfile);
    if (!await persistProfiles(next, id)) return;
    setConnectionProfiles(next);
    setActiveProfileId(id);
    onApply(nextProfile);
    setStatus("已新建连接档案");
  }

  async function selectConnectionProfile(profileId: string) {
    const profile = connectionProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    if (!await persistProfiles(connectionProfiles, profile.id)) return;
    setActiveProfileId(profile.id);
    onApply(profile);
    saveConnectionSettings(profile.endpoint, profile.token);
    setStatus(`已切换到 ${profile.name}`);
  }

  async function deleteConnectionProfile() {
    if (connectionProfiles.length <= 1) {
      setStatus("至少保留一个连接档案");
      return;
    }
    const next = connectionProfiles.filter((profile) => profile.id !== activeProfileId);
    const fallback = next[0];
    if (!await persistProfiles(next, fallback.id)) return;
    setConnectionProfiles(next);
    setActiveProfileId(fallback.id);
    onApply(fallback);
    saveConnectionSettings(fallback.endpoint, fallback.token);
    setStatus("连接档案已删除");
  }

  async function sendMessage(delivery?: "steer" | "queue") {
    if (sendLockRef.current || !(delivery === "steer" ? canSubmitMessage : canSend)) return;
    sendLockRef.current = true;
    setSubmittingMessage(true);
    try { await submitMessage(delivery); }
    finally { sendLockRef.current = false; setSubmittingMessage(false); }
  }

  async function submitMessage(delivery?: "steer" | "queue") {
    const threadKey = activeThreadKey;
    const runtime = getRuntime(threadState, threadKey);
    const userText = runtime.draft.trim();
    const pendingAttachments = runtime.attachments;
    const message = composeMessageWithAttachments(userText, pendingAttachments);
    if (!threadKey || !message) return;
    const clientMessageId = runtime.pendingMessageText === message && runtime.pendingMessageId ? runtime.pendingMessageId : crypto.randomUUID();
    patchRuntime(threadKey, { pendingMessageId: clientMessageId, pendingMessageText: message });
    const control = desktopSendControl(runtime, relayStatus?.desktopControl?.mode);
    const mode = control.native ? delivery ?? (control.guard?.expectedTurnId ? "queue" : "start") : "auto";
    const sendRoute = await resolveSendRoute();
    if (sendRoute === "desktop") {
      const result = await sendDesktopMessage(threadKey, message, userText, pendingAttachments, clientMessageId, mode, control.guard);
      if (result === "sent") {
        return;
      }
    }
    if (sending && activeRuntime.activeTurnId && selected?.id) {
      await steerActiveTurn(threadKey, selected.id, activeRuntime.activeTurnId, message, userText, pendingAttachments, clientMessageId);
      return;
    }
    if (sending) {
      return;
    }
    const targetThread = selected;
    patchRuntime(threadKey, {
      sending: true,
      draft: "",
      attachments: [],
      status: "启动 Codex turn",
      turnStatus: "starting",
      lastTurnError: "",
    });
    setStatus("启动 Codex turn");
    forceBottomRef.current = true;
    const optimistic: CodexMessage = {
      id: `local-${Date.now()}`,
      timestamp: new Date().toISOString(),
      role: "user",
      text: message,
      kind: "local",
      attachments: pendingAttachments,
    };
    updateRuntime(threadKey, (runtime) => ({ ...runtime, messages: [...runtime.messages, optimistic] }));
    try {
      const data = await apiPost<LiveTurnSnapshot>(
        buildUrl(endpoint, "/api/live/turns"),
        token,
        {
          threadId: targetThread?.id,
          message,
          clientMessageId,
          cwd: targetThread?.cwd,
          approvalPolicy,
          sandbox: sandboxMode,
        },
      );
      const createdThread = data.thread ?? {
        id: data.threadId,
        threadName: `手机: ${firstLine(userText) || attachmentSummaryText(pendingAttachments) || "新线程"}`,
        updatedAt: new Date().toISOString(),
        cwd: targetThread?.cwd ?? null,
        source: "appServer",
        originator: "Codex app-server",
      };
      const baseMessages = threadKey === data.threadId ? [...getRuntime(threadState, threadKey).messages, optimistic] : [optimistic];
      patchRuntime(data.threadId, {
        pendingMessageId: undefined, pendingMessageText: undefined,
        messages: capMessages(mergeMessagesById(baseMessages, data.messages)),
        loaded: true,
        watchMode: "none",
        watching: false,
        readonlyReason: "已由手机 Relay 接管；后续发送、引导、打断都会走手机控制通道。",
        status: turnStatusText(data.status),
        activeTurnId: data.turnId,
        turnStatus: data.status,
        lastEventCount: data.eventCount,
        lastTurnError: data.error ?? "",
        approvals: data.approvals ?? [],
      });
      if (threadKey !== data.threadId) {
        removeRuntime(threadKey);
      }
      setStatus(turnStatusText(data.status));
      setIsNewThread(false);

      if (!targetThread || targetThread.id !== data.threadId) {
        setSelected(createdThread);
      }
      void loadThreads();
    } catch (error) {
      setStatus(toFriendlyFetchError(error));
      patchRuntime(threadKey, {
        sending: false,
        draft: userText,
        attachments: pendingAttachments,
        status: toFriendlyFetchError(error),
        turnStatus: "failed",
        lastTurnError: toFriendlyFetchError(error),
      });
    }
  }

  async function resolveSendRoute(): Promise<SendRoute> {
    if (!selected?.id || !isDesktopSource(selected)) return "relay";
    if (desktopSend.native) return "desktop";
    try {
      const data = await apiGet<DesktopActiveResponse>(buildUrl(endpoint, "/api/desktop/active"), token);
      setActiveDesktopThreadId(data.thread?.id ?? null);
      const isCurrentDesktopStream = data.thread?.id === selected.id && data.source === "ipc-stream";
      patchRuntime(selected.id, {
        watchMode: "desktop-tail",
        watching: isCurrentDesktopStream,
        readonlyReason: isCurrentDesktopStream
          ? "已确认桌面当前窗口正在同步这个线程；发送会优先进入电脑 Codex 当前窗口。"
          : "这是桌面来源线程；发送会先尝试电脑 Codex。Windows 使用 Desktop IPC，macOS 使用可见 UI 注入。",
      });
      return "desktop";
    } catch {
      return "desktop";
    }
  }

  async function sendDesktopMessage(
    threadKey: string,
    message: string,
    restoreDraft: string,
    pendingAttachments: PendingAttachment[],
    clientMessageId: string,
    requestedMode: "auto" | "start" | "steer" | "queue",
    capturedGuard: ReturnType<typeof desktopSendControl>["guard"],
  ): Promise<"sent" | "fallback"> {
    if (!selected?.id) return "fallback";
    if (sending && !activeRuntime.sending) return "fallback";
    if (selectedRef.current?.id !== threadKey) return "sent";
    const control = desktopSendControl(activeRuntimeRef.current, relayStatus?.desktopControl?.mode);
    if (!control.ready) {
      const detail = "正在同步桌面控制状态，请稍后手动发送；草稿已保留。";
      patchRuntime(threadKey, { status: detail, desktopSendFeedback: detail });
      setStatus(detail);
      return "sent";
    }
    const native = control.native;
    const mode = native ? requestedMode : "auto";
    const postingText = mode === "queue" ? "正在加入待发队列…" : mode === "steer" ? "正在发送引导…" : "正在发送到桌面 Codex…";
    patchRuntime(threadKey, {
      ...(!native ? { sending: true, turnStatus: "inProgress" as const, activity: "thinking" as const, draft: "", attachments: [] } : {}),
      desktopSendFeedback: postingText,
      status: postingText,
      lastTurnError: "",
    });
    forceBottomRef.current = true;
    setStatus(postingText);
    const submittedAt = new Date().toISOString();

    try {
      const data = await apiPost<DesktopControlResponse>(
        buildUrl(endpoint, `/api/desktop/control/threads/${encodeURIComponent(selected.id)}/messages`),
        token,
        {
          message,
          clientMessageId,
          cwd: selected.cwd,
          mode,
          ...(native ? capturedGuard : control.guard),
        },
      );
      if (!data.ok && !data.delivery) throw new Error(data.error ?? "Desktop 控制请求失败");
      if (data.action === "queue-message") {
        updateRuntime(threadKey, runtime => ({ ...runtime, ...desktopControlResponsePatch(runtime, data, clientMessageId) }));
        setStatus("已排队，当前任务结束后执行");
        return "sent";
      }
      const optimistic: CodexMessage = {
        id: `desktop-local-${clientMessageId}`,
        clientMessageId,
        timestamp: submittedAt,
        role: "user",
        text: message,
        kind: "local",
        attachments: pendingAttachments,
      };
      if (!native || data.delivery === "confirmed") updateRuntime(threadKey, (runtime) => ({ ...runtime, messages: capMessages(mergeMessagesById(runtime.messages, [optimistic]), runtime) }));
      if (data.delivery) {
        updateRuntime(threadKey, runtime => ({ ...runtime, ...desktopControlResponsePatch(runtime, data, clientMessageId) }));
        setStatus(data.delivery === "confirmed" ? "桌面已确认收到消息" : "提交结果待确认，正在同步会话");
        return "sent";
      }
      patchRuntime(threadKey, { pendingMessageId: undefined, pendingMessageText: undefined });
      const statusText = data.warning ? "已提交到桌面 Codex，等待同步确认" : desktopActionText(data.action);
      patchRuntime(threadKey, {
        status: statusText,
        desktopSendFeedback: statusText,
        turnStatus: "inProgress",
        sending: true,
        watching: true,
        readonlyReason:
          data.mode === "macos-ui-injector-control"
            ? data.warning
              ? "已通过 macOS 可见 UI 注入；如果手机端稍后才出现记录，属于桌面日志同步延迟。"
              : "已通过 macOS 可见 UI 注入；手机发送会粘贴到电脑 Codex 当前线程。"
            : "已接入 Desktop IPC；手机发送会进入电脑 Codex 当前线程。",
      });
      setStatus(statusText);
      return "sent";
    } catch (error) {
      const detail = toFriendlyFetchError(error);
      const rejected = [400, 401, 403, 409, 429].includes((error as { status?: number }).status ?? 0);
      updateRuntime(threadKey, runtime => {
        const confirmed = desktopMessageReceived(runtime, clientMessageId);
        if (native && confirmed) return runtime;
        return {
          ...runtime,
          ...desktopRejectedSendPatch(runtime, (error as { code?: unknown })?.code, clientMessageId),
          ...(native && !rejected ? desktopControlResponsePatch(runtime, { action: mode === "queue" ? "queue-message" : mode === "steer" ? "steer-turn" : "start-turn", delivery: "uncertain" }, clientMessageId) : {}),
          ...(!native ? {
            sending: false, turnStatus: "failed" as const,
            draft: runtime.draft || restoreDraft,
            attachments: runtime.attachments.length ? runtime.attachments : pendingAttachments,
          } : {}),
          desktopSendFeedback: undefined,
          status: detail,
          lastTurnError: detail,
        };
      });
      if (selectedRef.current?.id === threadKey && !(native && desktopMessageReceived(activeRuntimeRef.current, clientMessageId))) setStatus(detail);
      return "sent";
    }
  }

  async function cancelQueuedMessage(clientMessageId: string) {
    if (!selected?.id || queueCancelling) return;
    const threadId = selected.id;
    setQueueCancelling(clientMessageId);
    try {
      await apiPost(buildUrl(endpoint, `/api/desktop/control/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(clientMessageId)}/cancel`), token, {});
      patchRuntime(threadId, { desktopSendFeedback: "已取消待发消息" });
      setStatus("已取消待发消息");
    } catch (error) { setStatus(toFriendlyFetchError(error)); }
    finally { setQueueCancelling(null); }
  }

  async function steerActiveTurn(
    threadKey: string,
    threadId: string,
    turnId: string,
    message: string,
    restoreDraft: string,
    pendingAttachments: PendingAttachment[],
    clientMessageId: string,
  ) {
    patchRuntime(threadKey, { draft: "", attachments: [], status: "发送引导中" });
    const optimistic: CodexMessage = {
      id: `steer-local-${Date.now()}`,
      timestamp: new Date().toISOString(),
      role: "user",
      text: message,
      kind: "steeringUserMessage",
      attachments: pendingAttachments,
    };
    updateRuntime(threadKey, (runtime) => ({ ...runtime, messages: [...runtime.messages, optimistic] }));
    try {
      const data = await apiPost<{ turn: LiveTurnSnapshot }>(buildUrl(endpoint, `/api/live/turns/${encodeURIComponent(turnId)}/steer`), token, {
        threadId,
        message, clientMessageId,
      });
      applyLiveTurnSnapshot(threadKey, data.turn);
      patchRuntime(threadKey, { pendingMessageId: undefined, pendingMessageText: undefined });
      setStatus("已发送引导");
    } catch (error) {
      const detail = toFriendlyFetchError(error);
      patchRuntime(threadKey, { draft: restoreDraft, attachments: pendingAttachments, status: detail, lastTurnError: detail });
      setStatus(detail);
    }
  }

  async function interruptActiveTurn() {
    const threadKey = activeThreadKey;
    if (!threadKey || !selected?.id || !canInterrupt) return;
    patchRuntime(threadKey, { status: "发送打断请求" });
    setStatus("发送打断请求");
    if (isDesktopWatch) {
      let clientMessageId: string | undefined;
      try {
        const controlToken = desktopCapability!.token!, expectedTurnId = desktopCapability!.activeTurnId!;
        const previous = desktopInterruptRef.current;
        const guard = previous?.threadId === selected.id && previous.controlToken === controlToken && previous.expectedTurnId === expectedTurnId
          ? previous : { threadId: selected.id, controlToken, expectedTurnId, clientMessageId: crypto.randomUUID() };
        desktopInterruptRef.current = guard;
        clientMessageId = guard.clientMessageId;
        patchRuntime(threadKey, { desktopInterrupt: { clientMessageId, delivery: "submitted" } });
        const data = await apiPost<DesktopControlResponse>(
          buildUrl(endpoint, `/api/desktop/control/threads/${encodeURIComponent(selected.id)}/interrupt`),
          token,
          { controlToken: guard.controlToken, expectedTurnId: guard.expectedTurnId, clientMessageId: guard.clientMessageId },
        );
        if (!data.ok && !data.delivery) throw new Error(data.error ?? "Desktop 打断失败");
        const text = data.delivery === "confirmed" ? data.turnStatus === "interrupted" ? "桌面已确认打断" : "桌面任务已结束" : "打断结果待确认，正在同步会话";
        updateRuntime(threadKey, runtime => ({ ...runtime, ...desktopInterruptResponsePatch(runtime, data, guard.clientMessageId) }));
        setStatus(text);
      } catch (error) {
        const detail = toFriendlyFetchError(error);
        const rejected = [400, 401, 403, 409, 429].includes((error as { status: number }).status);
        const interruptedId = clientMessageId;
        if (!rejected && interruptedId) updateRuntime(threadKey, runtime => ({ ...runtime, ...desktopInterruptResponsePatch(runtime, { delivery: "uncertain" }, interruptedId) }));
        else patchRuntime(threadKey, { desktopInterrupt: undefined, status: detail, lastTurnError: detail });
        setStatus(detail);
      }
      return;
    }
    if (!activeRuntime.activeTurnId) return;
    try {
      const data = await apiPost<{ turn: LiveTurnSnapshot }>(
        buildUrl(endpoint, `/api/live/turns/${encodeURIComponent(activeRuntime.activeTurnId)}/interrupt`),
        token,
        { threadId: selected.id },
      );
      applyLiveTurnSnapshot(threadKey, data.turn);
      setStatus("已打断");
    } catch (error) {
      const detail = toFriendlyFetchError(error);
      patchRuntime(threadKey, { status: detail, lastTurnError: detail });
      setStatus(detail);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!token.trim()) {
      setStatus("请先填写 Token");
      return;
    }
    setUploading(true);
    setStatus("上传文件中");
    const uploadedAttachments: PendingAttachment[] = [];
    try {
      for (const file of Array.from(files)) {
        if (file.size > 25 * 1024 * 1024) {
          throw new Error(`${file.name} 超过 25MB`);
        }
        const dataBase64 = await fileToBase64(file);
        const response = await apiPost<UploadResponse>(buildUrl(endpoint, "/api/uploads"), token, {
          fileName: file.name,
          dataBase64,
        });
        uploadedAttachments.push({
          id: `upload-${Date.now()}-${uploadedAttachments.length}`,
          fileName: response.upload.originalName || response.upload.fileName || file.name,
          path: response.upload.path,
          relativePath: response.upload.relativePath,
          size: response.upload.size,
          createdAt: response.upload.createdAt,
          mimeType: file.type || mimeTypeFromName(file.name),
          previewUrl: isImageFile(file) ? URL.createObjectURL(file) : null,
        });
      }
      const targetKey = activeThreadKey || newThreadId;
      if (!activeThreadKey) {
        setSelected(null);
        setIsNewThread(true);
      }
      updateRuntime(targetKey, (runtime) => {
        const existing = runtime.attachments ?? [];
        return {
          ...runtime,
          attachments: [...existing, ...uploadedAttachments],
          loaded: true,
          status: `已上传 ${uploadedAttachments.length} 个文件`,
        };
      });
      setStatus(`已上传 ${uploadedAttachments.length} 个文件`);
      await refreshRelayStatus().catch(() => undefined);
    } catch (error) {
      revokeAttachmentPreviews(uploadedAttachments);
      setStatus(toFriendlyFetchError(error));
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  function removeAttachment(attachmentId: string) {
    const targetKey = activeThreadKey || newThreadId;
    updateRuntime(targetKey, (runtime) => {
      const removed = runtime.attachments.find((attachment) => attachment.id === attachmentId);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return {
        ...runtime,
        attachments: runtime.attachments.filter((attachment) => attachment.id !== attachmentId),
      };
    });
  }

  function applyLiveTurnSnapshot(threadKey: string, turn: LiveTurnSnapshot) {
    updateRuntime(threadKey, (runtime) => {
      const messages = capMessages(mergeMessagesById(runtime.messages, turn.messages), runtime);
      return {
        ...runtime,
        messages,
        sending: turn.status === "starting" || turn.status === "inProgress",
        loaded: true,
        status: turnStatusText(turn.status),
        activeTurnId: turn.status === "starting" || turn.status === "inProgress" ? turn.turnId : null,
        turnStatus: turn.status,
        lastEventCount: turn.eventCount,
        lastTurnError: turn.error ?? "",
        approvals: turn.approvals ?? runtime.approvals,
        userInputs: turn.userInputs ?? [],
        smoothMessageId: nextSmoothMessageId(runtime, messages),
      };
    });
  }

  function applyDesktopStreamSnapshot(threadKey: string, snapshot: DesktopStreamSnapshot) {
    updateRuntime(threadKey, (runtime) => {
      const messages = capMessages(mergeMessagesById(runtime.messages, snapshot.messages), runtime);
      const snapshotActive = snapshot.status === "starting" || snapshot.status === "inProgress";
      return {
        ...runtime,
        ...turnProgressPatch(runtime, { turnStatus: snapshot.status }),
        messages,
        loaded: true,
        status: snapshotActive ? "桌面实时同步中" : turnStatusText(snapshot.status),
        watching: true,
        activeTurnId: null,
        lastEventCount: snapshot.eventCount,
        userInputs: snapshot.interactionsAvailable ? snapshot.userInputs ?? [] : [],
        ...desktopApprovalsPatch(runtime, snapshot.approvals, snapshot.interactionsAvailable),
        ...desktopControlPatch(runtime, snapshot.control),
        lastTurnError: "",
        smoothMessageId: nextSmoothMessageId(runtime, messages),
      };
    });
  }

  async function respondUserInput(request: UserInputRequest, answers: Record<string, string[]>) {
    if (request.threadId !== activeThreadKey || userInputSubmissionsRef.current.has(request.id)) return;
    const signal = scopeAbortRef.current.signal;
    const threadKey = request.threadId;
    userInputSubmissionsRef.current.add(request.id);
    const patchInput = (status: UserInputRequest["status"]) => updateRuntime(threadKey, runtime => ({
      ...runtime, userInputs: runtime.userInputs?.map(item => item.id === request.id ? { ...item, status } : item),
    }));
    patchInput("submitting");
    try {
      const route = request.kind === "relay"
        ? `/api/live/turns/${encodeURIComponent(request.turnId)}/user-inputs/${encodeURIComponent(request.id)}/respond`
        : `/api/desktop/threads/${encodeURIComponent(threadKey)}/user-inputs/${encodeURIComponent(request.id)}/respond`;
      const result = await apiPost<{ status?: "resolved" | "submitted" | "uncertain"; turn?: LiveTurnSnapshot }>(buildUrl(endpoint, route), token, request.kind === "relay" ? { threadId: threadKey, answers } : { answers });
      if (signal.aborted) return;
      if (result.turn) {
        const input = result.turn.userInputs?.find(item => item.id === request.id);
        if (input) patchInput(input.status);
        else updateRuntime(threadKey, runtime => ({ ...runtime, userInputs: runtime.userInputs?.filter(item => item.id !== request.id) }));
      }
      else if (result.status === "resolved") updateRuntime(threadKey, runtime => ({ ...runtime, userInputs: runtime.userInputs?.filter(item => item.id !== request.id) }));
      else patchInput(result.status === "uncertain" ? "uncertain" : "submitted");
    } catch (error) {
      if (signal.aborted) return;
      if ((error as { status?: number }).status === 409) updateRuntime(threadKey, runtime => ({ ...runtime, userInputs: runtime.userInputs?.filter(item => item.id !== request.id), status: "该问题已处理或失效，正在同步" }));
      else patchInput("uncertain");
    } finally { userInputSubmissionsRef.current.delete(request.id); }
  }

  async function respondApproval(approval: LiveApproval, decision: LiveApprovalDecision) {
    const threadKey = activeThreadKey;
    const desktop = approval.source === "desktop";
    const turnId = activeRuntime.activeTurnId;
    if (!threadKey || (desktop ? approval.threadId !== threadKey : !turnId) || approvalSubmissionsRef.current.has(approval.id)) return;
    if (activeRuntime.approvals.find(item => item.id === approval.id)?.status !== "pending" || !approval.availableDecisions.includes(decision)) return;
    const signal = scopeAbortRef.current.signal;
    approvalSubmissionsRef.current.add(approval.id);
    const patchApproval = (status: "resolved" | "submitting" | "submitted" | "uncertain") => updateRuntime(threadKey, runtime => ({ ...runtime, ...approvalResponsePatch(runtime, approval.id, status) }));
    patchApproval("submitting");
    try {
      const route = desktop
        ? `/api/desktop/threads/${encodeURIComponent(threadKey)}/approvals/${encodeURIComponent(approval.id)}/respond`
        : `/api/live/turns/${encodeURIComponent(turnId!)}/approvals/${encodeURIComponent(approval.id)}/respond`;
      const data = await apiPost<{ status?: "resolved" | "submitted" | "uncertain"; turn?: LiveTurnSnapshot }>(buildUrl(endpoint, route), token, { decision });
      if (signal.aborted) return;
      if (desktop) patchApproval(data.status ?? "uncertain");
      else if (data.turn) {
        // Only update the original card; a late HTTP snapshot must not revive a finished turn.
        const item = data.turn.approvals.find(item => item.id === approval.id);
        patchApproval(item?.status === "pending" ? "submitted" : "resolved");
      }
    } catch (error) {
      if (signal.aborted) return;
      if ((error as { status?: number }).status === 409) patchApproval("resolved");
      else patchApproval("uncertain");
    } finally { approvalSubmissionsRef.current.delete(approval.id); }
  }

  function applyDesktopDelta(threadId: string, data: { messages: CodexMessage[]; cursor: number; generation?: string; reset?: boolean; turnStatus?: ThreadRuntime["turnStatus"]; activity?: ThreadRuntime["activity"] }) {
    updateRuntime(threadId, (runtime) => {
      const nextMessages = capMessages(mergeMessages(data.reset ? [] : runtime.messages, data.messages), runtime);
      return {
        ...runtime,
        ...turnProgressPatch(data.reset ? { ...runtime, turnStatus: "idle", activity: undefined, sending: false, activeTurnId: null } : runtime, data),
        cursor: data.cursor, generation: data.generation,
        messages: nextMessages, watching: true,
        historyBefore: data.reset ? 0 : runtime.historyBefore,
        status: data.turnStatus ? turnStatusText(data.turnStatus) : runtime.status,
        smoothMessageId: nextSmoothMessageId(runtime, nextMessages),
      };
    });
  }

  async function watchDesktopDelta(threadId: string, cursor: number) {
    const generation = activeRuntimeRef.current.generation;
    const data = await apiGet<Parameters<typeof applyDesktopDelta>[1]>(
      buildUrl(endpoint, `/api/desktop/threads/${encodeURIComponent(threadId)}/delta?cursor=${cursor}${generation ? `&generation=${encodeURIComponent(generation)}` : ""}`), token,
    );
    if (data.cursor !== cursor || data.messages.length || data.reset || data.turnStatus || data.activity) applyDesktopDelta(threadId, data);
  }

  async function pollLiveTurn(threadKey: string, turnId: string) {
    const data = await apiGet<{ turn: LiveTurnSnapshot | null; error?: string }>(
      buildUrl(endpoint, `/api/live/turns/${encodeURIComponent(turnId)}`),
      token,
    );
    if (!data.turn) throw new Error(data.error ?? "live turn not found");
    applyLiveTurnSnapshot(threadKey, data.turn);
    if (data.turn.status === "completed") {
      setStatus("Codex 已完成");
      void loadThreads();
    }
    if (data.turn.status === "interrupted") setStatus("Codex 已打断");
    if (data.turn.status === "failed") setStatus(data.turn.error ?? "Codex 运行失败");
  }

  function onMessagesScroll() {
    const element = messagesRef.current;
    if (!element) return;
    const bottom = isNearBottom(element);
    if (activeThreadKey) scrollPositionsRef.current[activeThreadKey] = element.scrollTop;
    atBottomRef.current = bottom;
    if (bottom) setHasNewMessages(false);
  }

  async function loadEarlierHistory() {
    if (!selected || activeRuntime.loadingHistory || !activeRuntime.historyBefore) return;
    const threadId = selected.id;
    const viewport = messagesRef.current;
    const previousHeight = viewport?.scrollHeight ?? 0;
    const previousTop = viewport?.scrollTop ?? 0;
    atBottomRef.current = false;
    forceBottomRef.current = false;
    patchRuntime(threadId, { loadingHistory: true });
    try {
      const params = new URLSearchParams({ before: String(activeRuntime.historyBefore), maxBytes: "262144", maxMessages: "80" });
      if (activeRuntime.generation) params.set("generation", activeRuntime.generation);
      const data = await apiGet<{ messages: CodexMessage[]; cursor: number; windowStart: number; generation: string; reset?: boolean }>(buildUrl(endpoint, `/api/desktop/threads/${encodeURIComponent(threadId)}?${params}`), token);
      updateRuntime(threadId, runtime => ({ ...runtime, messages: capMessages(mergeMessages(data.messages, data.reset ? [] : runtime.messages), { historyBrowsing: true }), historyBefore: data.windowStart, generation: data.generation, ...(data.reset ? { cursor: data.cursor } : {}), historyBrowsing: true }));
      requestAnimationFrame(() => {
        if (selectedRef.current?.id === threadId && viewport) viewport.scrollTop = Math.max(0, previousTop + viewport.scrollHeight - previousHeight);
      });
    } catch (error) { patchRuntime(threadId, { status: toFriendlyFetchError(error) }); }
    finally { patchRuntime(threadId, { loadingHistory: false }); }
  }

  function jumpToLatest() {
    if (activeRuntime.historyBrowsing && selected) {
      patchRuntime(selected.id, { messages: [], historyBrowsing: false, scrollTop: undefined });
      void openThread(selected);
    }
    const viewport = messagesRef.current;
    const question = viewport?.querySelector<HTMLElement>(".user-input-card");
    if (viewport && question && !activeRuntime.historyBrowsing) {
      viewport.scrollTop += question.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12;
      atBottomRef.current = false;
      setHasNewMessages(false);
      return;
    }
    forceBottomRef.current = true;
    scrollMessagesToBottom(true);
    setHasNewMessages(false);
  }

  function beginResize(kind: "side" | "top", event: React.PointerEvent<HTMLDivElement>) {
    const grid = workspaceGridRef.current;
    if (!grid) return;
    event.preventDefault();
    setResizingPane(kind);

    const handleMove = (moveEvent: PointerEvent) => {
      const rect = grid.getBoundingClientRect();
      if (kind === "side") {
        const splitterWidth = 10;
        const minSide = rect.width >= 560 ? 220 : 96;
        const minChat = rect.width >= 560 ? 300 : Math.max(184, Math.min(252, rect.width * 0.58));
        const maxSide = Math.max(minSide, rect.width - minChat - splitterWidth);
        setSidePaneSize(clamp(moveEvent.clientX - rect.left, minSide, maxSide));
        return;
      }

      const splitterHeight = 10;
      const minTop = rect.height >= 620 ? 150 : 110;
      const minChat = rect.height >= 620 ? 360 : Math.max(300, rect.height * 0.58);
      const maxTop = Math.max(minTop, rect.height - minChat - splitterHeight);
      setTopPaneSize(clamp(moveEvent.clientY - rect.top, minTop, maxTop));
    };

    const stopResize = () => {
      setResizingPane(null);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      forceBottomRef.current = true;
      scrollMessagesToBottom(false);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("themeMode", theme);
    if (theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("splitMode", splitMode);
    setSidebarOpen(false);
    window.setTimeout(() => {
      forceBottomRef.current = true;
      scrollMessagesToBottom(false);
    }, 220);
  }, [splitMode]);

  useEffect(() => {
    localStorage.setItem("sidePaneSize", String(Math.round(sidePaneSize)));
  }, [sidePaneSize]);

  useEffect(() => {
    localStorage.setItem("topPaneSize", String(Math.round(topPaneSize)));
  }, [topPaneSize]);

  useEffect(() => {
    localStorage.setItem("approvalPolicy", approvalPolicy);
  }, [approvalPolicy]);

  useEffect(() => {
    localStorage.setItem("sandboxMode", sandboxMode);
  }, [sandboxMode]);

  const cacheStateRef = useRef(threadState);
  const workspaceCacheRef = useRef({ threads, selectedId: selected?.id ?? null, isNewThread });
  workspaceCacheRef.current = { threads, selectedId: selected?.id ?? null, isNewThread };
  const cacheTimerRef = useRef<number | null>(null);
  cacheStateRef.current = threadState;
  useEffect(() => {
    if (cacheTimerRef.current === null) {
      cacheTimerRef.current = window.setTimeout(() => {
        cacheTimerRef.current = null;
        saveThreadRuntimeCache(cacheStateRef.current, scope);
        saveWorkspaceCache(scope, workspaceCacheRef.current);
      }, 700);
    }
  }, [threadState, threads, selected?.id, isNewThread, scope]);
  useEffect(() => {
    const flush = () => {
      if (cacheTimerRef.current !== null) window.clearTimeout(cacheTimerRef.current);
      cacheTimerRef.current = null;
      saveThreadRuntimeCache(cacheStateRef.current, scope);
      saveWorkspaceCache(scope, workspaceCacheRef.current);
    };
    const onHidden = () => { if (document.hidden) flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [scope]);

  useEffect(() => {
    const element = messagesRef.current;
    if (!element) return;
    if (forceBottomRef.current || atBottomRef.current) {
      const question = pendingInputId ? element.querySelector<HTMLElement>(".user-input-card") : null;
      if (question && !activeRuntime.historyBrowsing) {
        element.scrollTop += question.getBoundingClientRect().top - element.getBoundingClientRect().top - 12;
        atBottomRef.current = false;
        forceBottomRef.current = false;
        setHasNewMessages(false);
        return;
      }
      scrollMessagesToBottom(!forceBottomRef.current);
      forceBottomRef.current = false;
      setHasNewMessages(false);
      return;
    }
    setHasNewMessages(visibleMessages.length > 0);
  }, [visibleMessages, selected?.id, isNewThread, pendingInputId]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    activeRuntimeRef.current = activeRuntime;
  }, [activeRuntime]);

  useEffect(() => {
    if (!selected?.id || activeRuntime.loading || activeRuntime.watchMode !== "desktop-tail" || streamState === "online" || streamState === "unauthorized") return;
    let cancelled = false;
    let inFlight = false;
    const threadId = selected.id;
    let timer: number | null = null;
    const schedule = () => {
      if (cancelled || document.hidden) return;
      const runtime = activeRuntimeRef.current;
      const active = runtime.sending || runtime.turnStatus === "starting" || runtime.turnStatus === "inProgress";
      timer = window.setTimeout(() => void tick(), active ? desktopPollActiveMs : desktopPollIdleMs);
    };
    const tick = async () => {
      if (cancelled || selectedRef.current?.id !== threadId) return;
      const runtime = activeRuntimeRef.current;
      if (runtime.watchMode !== "desktop-tail") return;
      if (document.hidden) return;
      if (inFlight) return;
      inFlight = true;
      try {
        await watchDesktopDelta(threadId, runtime.cursor);
      } catch (error) {
        patchRuntime(threadId, { watching: false, status: toFriendlyFetchError(error) });
      } finally {
        inFlight = false;
        schedule();
      }
    };
    const onVisibility = () => {
      if (timer !== null) window.clearTimeout(timer);
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, activeRuntime.loading, activeRuntime.watchMode, streamState, endpoint, token]);

  useEffect(() => {
    if (!selected?.id || activeRuntime.loading || activeRuntime.watchMode !== "desktop-tail" || !canUseEventSource()) return;
    const threadId = selected.id;
    const reduce = createSnapshotReducer<DesktopStreamSnapshot>();
    const unsubscribe = subscribeEvents({
      getToken: (signal) => requestPost(buildUrl(endpoint, `/api/desktop/threads/${encodeURIComponent(threadId)}/stream-token`), token, {}, signal),
      url: (streamToken) => {
        const runtime = activeRuntimeRef.current;
        const params = new URLSearchParams({ streamToken, v: "1", cursor: String(runtime.cursor) });
        if (runtime.generation) params.set("generation", runtime.generation);
        return buildUrl(endpoint, `/api/desktop/threads/${encodeURIComponent(threadId)}/events?${params}`);
      },
      events: {
        desktop: (data) => { const snapshot = reduce(data); if (snapshot.threadId === threadId) applyDesktopStreamSnapshot(threadId, snapshot); },
        delta: (data) => applyDesktopDelta(threadId, data as Parameters<typeof applyDesktopDelta>[1]),
      },
      onState: (state) => {
        setStreamState(state);
        if (state !== "online") updateRuntime(threadId, runtime => ({ ...runtime, ...desktopControlOfflinePatch(runtime) }));
        if (state === "unauthorized") { patchRuntime(threadId, { status: "连接凭证已失效，请在设置中更新", watching: false }); setConnectionState("error"); }
        else if (state === "recovering") patchRuntime(threadId, { status: "正在恢复连接，已有内容已保留" });
      },
    });
    return () => { unsubscribe(); updateRuntime(threadId, runtime => ({ ...runtime, ...desktopControlOfflinePatch(runtime) })); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, activeRuntime.loading, activeRuntime.watchMode, endpoint, token]);

  useEffect(() => {
    if (!activeRuntime.activeTurnId || !activeThreadKey || activeRuntime.watchMode === "desktop-tail") return;
    if (!canUseEventSource()) return;
    let cancelled = false;
    let pendingSnapshot: LiveTurnSnapshot | null = null;
    let snapshotTimer: number | null = null;
    const threadKey = activeThreadKey;
    const turnId = activeRuntime.activeTurnId;
    setLiveStreamFallbackTurnId((current) => (current === turnId ? null : current));
    const flushSnapshot = () => {
      if (!pendingSnapshot) return;
      const snapshot = pendingSnapshot;
      pendingSnapshot = null;
      if (snapshotTimer !== null) {
        window.clearTimeout(snapshotTimer);
        snapshotTimer = null;
      }
      applyLiveTurnSnapshot(threadKey, snapshot);
      if (snapshot.status === "completed") {
        setStatus("Codex 已完成");
        void loadThreads();
      }
      if (snapshot.status === "interrupted") setStatus("Codex 已打断");
      if (snapshot.status === "failed") setStatus(snapshot.error ?? "Codex 运行失败");
    };
    const scheduleSnapshot = (snapshot: LiveTurnSnapshot) => {
      pendingSnapshot = snapshot;
      if (snapshot.status === "completed" || snapshot.status === "interrupted" || snapshot.status === "failed") {
        flushSnapshot();
        return;
      }
      if (snapshotTimer === null) {
        snapshotTimer = window.setTimeout(flushSnapshot, liveSnapshotThrottleMs);
      }
    };

    const reduce = createSnapshotReducer<LiveTurnSnapshot>();
    const unsubscribe = subscribeEvents({
      getToken: (signal) => requestPost(buildUrl(endpoint, `/api/live/turns/${encodeURIComponent(turnId)}/stream-token`), token, {}, signal),
      url: (streamToken) => buildUrl(endpoint, `/api/live/turns/${encodeURIComponent(turnId)}/events?v=1&streamToken=${encodeURIComponent(streamToken)}`),
      events: { turn: (data) => scheduleSnapshot(reduce(data)) },
      onState: (state) => {
        setStreamState(state);
        setLiveStreamFallbackTurnId(state === "online" || state === "unauthorized" || state === "paused" ? null : turnId);
        if (state !== "online") {
          pendingSnapshot = null;
          if (snapshotTimer !== null) window.clearTimeout(snapshotTimer);
          snapshotTimer = null;
          patchRuntime(threadKey, { userInputs: [] });
        }
        if (state === "recovering") patchRuntime(threadKey, { status: "正在恢复连接" });
        if (state === "unauthorized") { patchRuntime(threadKey, { status: "连接凭证已失效，请在设置中更新" }); setConnectionState("error"); }
      },
    });
    return () => {
      cancelled = true;
      if (snapshotTimer !== null) window.clearTimeout(snapshotTimer);
      unsubscribe();
      patchRuntime(threadKey, { userInputs: [] });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadKey, activeRuntime.activeTurnId, activeRuntime.watchMode, endpoint, token]);

  useEffect(() => {
    if (!activeRuntime.activeTurnId || !activeThreadKey || activeRuntime.watchMode === "desktop-tail") return;
    if (canUseEventSource() && liveStreamFallbackTurnId !== activeRuntime.activeTurnId) return;
    let cancelled = false;
    let inFlight = false;
    const threadKey = activeThreadKey;
    const turnId = activeRuntime.activeTurnId;
    let timer: number | null = null;
    const schedule = () => {
      if (!cancelled && !document.hidden) timer = window.setTimeout(() => void tick(), livePollFallbackMs);
    };
    const tick = async () => {
      if (cancelled || document.hidden) return;
      if (inFlight) return;
      inFlight = true;
      try {
        await pollLiveTurn(threadKey, turnId);
      } catch (error) {
        patchRuntime(threadKey, { status: toFriendlyFetchError(error), lastTurnError: toFriendlyFetchError(error) });
      } finally {
        inFlight = false;
        schedule();
      }
    };
    const onVisibility = () => {
      if (timer !== null) window.clearTimeout(timer);
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadKey, activeRuntime.activeTurnId, activeRuntime.watchMode, endpoint, token, liveStreamFallbackTurnId]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let timer: number | null = null;
    const tick = async () => {
      if (cancelled || inFlight || !token.trim() || document.hidden) return;
      inFlight = true;
      try {
        await apiGet<{ ok: boolean }>(buildUrl(endpoint, "/api/connection"), token);
        if (cancelled) return;
        setConnectionState((current) => (current === "testing" ? current : "ok"));
      } catch (error) {
        setConnectionState((current) => (current === "testing" ? current : "error"));
        setStatus(`后台连接检查失败：${toFriendlyFetchError(error)}`);
      } finally {
        inFlight = false;
        if (!cancelled && !document.hidden) timer = window.setTimeout(() => void tick(), statusKeepaliveMs);
      }
    };
    void tick();
    const onVisible = () => {
      if (timer !== null) window.clearTimeout(timer);
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, token]);

  useEffect(() => {
    void refreshRelayStatus().catch(() => undefined);
    if (selected) void openThread(selected);
    void loadThreads({ selectLatest: !selected && !isNewThread });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let failed = false;
    const onError = () => { failed = true; };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);
    const readyTimer = window.setTimeout(() => {
      if (!failed && Capacitor.isNativePlatform()) void NativeHotUpdate.markReady().catch(() => undefined);
    }, 5000);
    void Promise.all([checkForUpdates(false), checkHotUpdate(false)]);
    return () => {
      window.clearTimeout(readyTimer);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className={`codex-shell ${layoutClass} ${resizingPane ? "is-resizing" : ""}`} style={shellStyle}>
      <header className="topbar glass-surface">
        <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="打开线程列表">
          <ChevronLeft size={21} />
        </button>
        <div className="workspace-title">
          <span className={`status-dot ${connectionState === "error" ? "error" : connectionState === "ok" ? "ok" : ""}`} />
          <div>
            <h1>{workspaceTitle}</h1>
            <p>{selected ? shortPath(selected.cwd ?? "") || connection.name : connection.name}</p>
          </div>
        </div>
        <div className="top-actions">
          <button className="icon-button" onClick={onOpenAgents} aria-label="切换 Agent"><Server size={18} /></button>
          <button className="icon-button" onClick={() => void loadThreads()} aria-label="刷新线程">
            <RefreshCcw size={18} className={loading ? "spin" : ""} />
          </button>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="设置">
            <Settings size={18} />
          </button>
        </div>
      </header>

      <section className="workspace-grid" ref={workspaceGridRef}>
        <aside ref={sidebarRef} className={`thread-sidebar glass-surface ${sidebarOpen || (!selected && !isNewThread) ? "open" : ""}`}>
          <div className="sidebar-top">
            <div className="sidebar-title">
              <PanelLeft size={18} />
              <div>
                <strong>线程</strong>
                <span>{status}</span>
              </div>
            </div>
            <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="关闭线程列表">
              <X size={18} />
            </button>
          </div>

          <label className="search-field">
            <Search size={16} />
            <input aria-label="搜索全部会话" value={query} onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void loadThreads({ search: query }); }} placeholder="搜索当前范围，回车查询" />
          </label>

          <div className="sidebar-tools">
            <button className="tool-button primary" onClick={startNewThread}>
              <Sparkles size={16} />
              <span>新线程</span>
            </button>
            <button className="tool-button" onClick={() => void openActiveDesktopThread()}>
              <Monitor size={16} />
              <span>桌面</span>
            </button>
            <button className="tool-button" onClick={() => void testConnection()} disabled={connectionState === "testing"}>
              {connectionState === "testing" ? <Loader2 size={16} className="spin" /> : <Wifi size={16} />}
              <span>检测</span>
            </button>
          </div>

          <div className="host-filter" aria-label="会话来源">
            <button className={sourceFilter === "all" ? "active" : ""} onClick={() => setSourceFilter("all")}>全部</button>
            <button className={sourceFilter === "desktop" ? "active" : ""} onClick={() => setSourceFilter("desktop")}>电脑</button>
            <button className={sourceFilter === "relay" ? "active" : ""} onClick={() => setSourceFilter("relay")}>Relay</button>
          </div>
          <div className="layout-switcher">
            <button className={splitMode === "auto" ? "active" : ""} onClick={() => setSplitMode("auto")}>
              <Monitor size={14} />
              <span>自动</span>
            </button>
            <button className={splitMode === "left" ? "active" : ""} onClick={() => setSplitMode("left")}>
              <Columns3 size={14} />
              <span>左侧</span>
            </button>
            <button className={splitMode === "top" ? "active" : ""} onClick={() => setSplitMode("top")}>
              <Rows3 size={14} />
              <span>顶部</span>
            </button>
            <button className={splitMode === "drawer" ? "active" : ""} onClick={() => setSplitMode("drawer")}>
              <Menu size={14} />
              <span>抽屉</span>
            </button>
          </div>

          <div className="thread-list" aria-label="Codex 线程列表">
            <SessionRangeControl range={threadRange} disabled={loading} onChange={range => { setThreadRange(range); void loadThreads({ range }); }} />
            <ProjectGroups scope={scope} agentId="codex" groups={groupedFiltered} search={query}>
              {thread => {
                  const detail = threadListDetail(thread);
                  return (
                    <button
                      key={thread.id}
                      className={`thread-row ${selected?.id === thread.id ? "active" : ""}`}
                      onClick={() => void openThread(thread, { closeSidebar: true })}
                    >
                      <span className="thread-name">{cleanTitle(thread.threadName)}</span>
                      <span className="thread-time">{formatDate(thread.updatedAt)}</span>
                      <span className={`thread-source ${sourceClass(thread.source)}`}>{sourceLabel(thread.source)}</span>
                      {activeDesktopThreadId === thread.id && <span className="live-chip">当前桌面</span>}
                      {detail && <span className="thread-path">{detail}</span>}
                    </button>
                  );
              }}
            </ProjectGroups>
            {threadPage.hasMore && <button className="history-button" disabled={loading} onClick={() => void loadThreads({ append: true })}>加载更多会话</button>}
            {filtered.length === 0 && (
              <div className="empty-state">
                <MessageSquare size={22} />
                <p>没有匹配的线程</p>
              </div>
            )}
          </div>
        </aside>

        <div
          className={`splitter ${splitMode === "top" ? "horizontal" : "vertical"}`}
          role="separator"
          aria-orientation={splitMode === "top" ? "horizontal" : "vertical"}
          aria-label={splitMode === "top" ? "拖动调整上下分屏" : "拖动调整左右分屏"}
          onPointerDown={(event) => beginResize(splitMode === "top" ? "top" : "side", event)}
        >
          <span />
        </div>

        <section className="chat-workspace glass-surface">
          <div className="chat-heading">
            <div>
              <h2>{workspaceTitle}</h2>
              <p>{chatSubtitle}</p>
              <div className="thread-meta">
                <span className={`thread-source ${sourceClass(selected?.source ?? null)}`}>
                  {isNewThread ? "手机新建" : sourceLabel(selected?.source ?? null)}
                </span>
                {canUseDesktopIpc && <span className="watch-chip">桌面可控</span>}
                {isDesktopHistoryOnly && <span className="watch-chip warn">历史可接管</span>}
                {activeRuntime.watching && <span className="watch-chip live">同步中</span>}
                {isLiveTurnActive && <span className="watch-chip live">运行中</span>}
                {activeRuntime.turnStatus === "interrupted" && <span className="watch-chip warn">已打断</span>}
                {activeRuntime.turnStatus === "failed" && <span className="watch-chip warn">失败</span>}
              </div>
            </div>
            <div className="chat-actions">
              <button className="icon-button" onClick={() => void (selected ? openThread(selected) : loadThreads())} aria-label="重新加载">
                <RefreshCcw size={17} className={loadingMessages ? "spin" : ""} />
              </button>
              <button className="icon-button" onClick={() => copyText(selected?.cwd ?? workspaceTitle, "thread")} aria-label="复制当前信息">
                <Copy size={17} />
              </button>
            </div>
          </div>

          <div className="messages-viewport" ref={messagesRef} onScroll={onMessagesScroll}>
            {isDesktopWatch && Boolean(activeRuntime.historyBefore) && <button className="history-button" onClick={() => void loadEarlierHistory()} disabled={activeRuntime.loadingHistory}>{activeRuntime.loadingHistory ? "读取历史中…" : "加载更早的消息"}</button>}
            {activeRuntime.historyBrowsing && <button className="history-button" onClick={jumpToLatest}>正在浏览历史 · 返回最新</button>}
            {loadingMessages && (
              <div className="inline-loading">
                <Loader2 size={18} className="spin" />
                <span>读取线程</span>
              </div>
            )}
            {!loadingMessages && visibleMessages.length === 0 && !isLiveTurnActive && (
              <div className="empty-chat">
                <Sparkles size={28} />
                <h3>{isNewThread ? "开始一个新线程" : "选择一个 Codex 线程"}</h3>
                <p>{isNewThread ? "输入消息后会在当前电脑上启动 Codex turn。" : "从左侧选择线程，或创建新线程继续工作。"}</p>
              </div>
            )}
            <MessageTimeline key={activeThreadKey} messages={visibleMessages} renderMessage={(message) => (
              <React.Fragment>
                <MessageBubble
                  message={message}
                  smooth={smoothLatestAssistant && message.id === latestAssistantMessageId}
                  smoothPending={smoothPending && message.id === latestAssistantMessageId}
                  onSmoothDone={() => {
                    if (!activeThreadKey || message.id !== activeRuntime.smoothMessageId) return;
                    if (activeRuntime.sending || activeRuntime.turnStatus === "starting" || activeRuntime.turnStatus === "inProgress") return;
                    patchRuntime(activeThreadKey, { smoothMessageId: null });
                  }}
                  onCopy={() => copyText(message.text, message.id)}
                />
                {showInlineTurnIndicator && inlineTurnIndicator?.messageId === message.id && (
                  <GenerationStatus
                    label={inlineTurnIndicator.label}
                    detail={inlineTurnIndicator.detail}
                    tone={inlineTurnIndicator.tone}
                    anchorRole={message.role}
                  />
                )}
              </React.Fragment>
            )} />
            {(activeRuntime.userInputs ?? []).map(request => (
              <UserInputCard key={request.id} request={request} disabled={connectionState !== "ok" || streamState !== "online"} onRespond={answers => respondUserInput(request, answers)} />
            ))}
            {showInlineTurnIndicator && inlineTurnIndicator && !inlineTurnIndicator.messageId && (
              <GenerationStatus label={inlineTurnIndicator.label} detail={inlineTurnIndicator.detail} tone={inlineTurnIndicator.tone} anchorRole="assistant" />
            )}
          </div>

          <footer className="composer-panel">
          {hasNewMessages && (
            <button className="latest-pill" onClick={jumpToLatest}>
              <Activity size={15} />
              <span>{activeRuntime.historyBrowsing ? "返回最新" : "最新消息"}</span>
            </button>
          )}

            {activeRuntime.desktopSubmission && <div className="connection-notice" role="status">提交结果待确认，草稿已保留；请勿重复发送。</div>}
            {!activeRuntime.desktopSubmission && activeRuntime.desktopSendFeedback && <div className="connection-notice" role="status">{activeRuntime.desktopSendFeedback}</div>}
            {activeRuntime.desktopInterrupt && <div className="connection-notice" role="status">打断结果待确认，正在同步会话。</div>}
            {(streamState === "recovering" || streamState === "unauthorized" || connectionState === "error") && <div className="connection-notice" role="status"><span className="status-dot error" />{streamState === "unauthorized" ? "凭证已失效，请重新配对" : streamState === "recovering" ? "正在恢复连接，消息与草稿已保留" : "连接暂时不可用，正在检查"}</div>}
            {isLiveTurnActive && (
              <div className="control-banner live-control compact" role="status" aria-live="polite">
                {activeRuntime.userInputs?.length ? <MessageSquare size={15} aria-hidden="true" /> : <Loader2 size={15} className="spin" aria-hidden="true" />}
                <span>{turnActivity.label}</span>
                <button onClick={() => void interruptActiveTurn()} disabled={!canInterrupt} aria-label="打断">
                  <CircleStop size={14} />
                </button>
              </div>
            )}
            {pendingApprovals.length > 0 && (
              <div className="approval-stack">
                {pendingApprovals.map((approval) => (
                  <ApprovalCard key={approval.id} approval={approval} onRespond={(decision) => void respondApproval(approval, decision)} />
                ))}
              </div>
            )}
            {activeRuntime.lastTurnError && (
              <div className="control-banner error-control">
                <AlertCircle size={15} />
                <span>{activeRuntime.lastTurnError}</span>
              </div>
            )}
            <div className="composer-status">
              <span>{sending ? turnActivity.label : controlText}</span>
              <em>{connectionBadge(connectionState, canUseDesktopIpc ? desktopControlStatus : liveStatus)}</em>
            </div>
            {attachments.length > 0 && <AttachmentTray attachments={attachments} onRemove={removeAttachment} />}
            {desktopQueue.length > 0 && <div className="desktop-queue" aria-label="待发消息" aria-live="polite">
              {desktopQueue.map((item, index) => <div key={item.clientMessageId} className="queued-message">
                <details><summary>{item.status === "waiting" ? `排队 ${index + 1}` : item.status === "paused" ? "任务中断，待发已暂停" : item.status === "sending" ? "正在提交" : "结果待确认，请勿重发"} · {firstLine(item.text)}</summary><p>{item.text}</p></details>
                <button type="button" className="icon-button" aria-label={`取消待发消息 ${index + 1}`} onClick={() => void cancelQueuedMessage(item.clientMessageId)} disabled={queueCancelling !== null || !["waiting", "paused"].includes(item.status) || connectionState !== "ok"}><X size={18} /></button>
              </div>)}
            </div>}
            {isLiveTurnActive && nativeDesktop && <div className="composer-delivery" role="group" aria-label="提交运行中消息">
              <button type="button" onClick={() => void sendMessage("steer")} disabled={!canSubmitMessage}>引导发送</button>
              <button type="button" onClick={() => void sendMessage("queue")} disabled={!canSend}>排队发送</button>
            </div>}
            {isLiveTurnActive && nativeDesktop && <p className="connection-notice">{canQueue ? "引导加入当前任务；排队在任务结束后执行。" : "排队需要更新网关；可使用引导发送。"}</p>}
            <div className="composer">
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                className="hidden-file-input"
                onChange={(event) => void uploadFiles(event.target.files)}
              />
              <button
                className="composer-tool-button"
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploading || !token.trim()}
                aria-label="上传文件"
              >
                {uploading ? <Loader2 size={18} className="spin" /> : <Plus size={21} />}
              </button>
              <textarea
                aria-label="消息"
                rows={2}
                onInput={event => { const element = event.currentTarget; element.style.height = "auto"; element.style.height = `${Math.min(152, element.scrollHeight)}px`; }}
                value={draft}
                onChange={(event) => { if (!activeThreadKey) setIsNewThread(true); patchRuntime(activeThreadKey || newThreadId, { draft: event.target.value, desktopSendFeedback: undefined }); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="向 Codex 发送消息"
                disabled={!canControlSelected}
              />
              <span className="composer-mode">{isDesktopWatch ? "电脑" : "Relay"} · {isLiveTurnActive ? nativeDesktop ? "箭头默认排队" : "运行中" : isDesktopHistoryOnly ? "历史会话" : "当前会话"}</span>
            <VoiceInput key={`${scope}:codex:${activeThreadKey || newThreadId}`} endpoint={endpoint} token={token} draft={draft}
              onDraft={value => { if (!activeThreadKey) setIsNewThread(true); patchRuntime(activeThreadKey || newThreadId, { draft: value, desktopSendFeedback: undefined }); }} />
              {isLiveTurnActive && !draft.trim() && attachments.length === 0 ? <button className="send-button" onClick={() => void interruptActiveTurn()} disabled={!canInterrupt || submittingMessage} aria-label="停止生成"><CircleStop size={22} /></button> : <button className="send-button" onClick={() => void sendMessage()} disabled={!canSend} aria-label={isLiveTurnActive ? nativeDesktop ? "默认排队发送" : "发送引导" : "发送"}>
                {submittingMessage || (sending && !isLiveTurnActive) ? <Loader2 size={18} className="spin" /> : <ArrowUp size={21} />}
              </button>}
            </div>
          </footer>
        </section>
      </section>

      <div className={`mobile-scrim ${sidebarOpen ? "show" : ""}`} onClick={() => setSidebarOpen(false)} />
      <div className={`settings-scrim ${settingsOpen ? "show" : ""}`} onClick={() => setSettingsOpen(false)} />

      <aside className={`settings-sheet glass-surface ${settingsOpen ? "open" : ""}`} aria-label="设置">
        <div className="settings-heading">
          <div>
            <h2>连接与外观</h2>
            <p>{status}</p>
          </div>
          <button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="关闭设置">
            <X size={18} />
          </button>
        </div>

        <PairingPanel endpoint={endpoint} token={token} onPaired={applyPairedConnection} />
        <section className="settings-section">
          <h3>手动连接</h3>
          <div className="profile-row">
            <label className="input-field">
              <Server size={16} />
              <select value={activeProfileId} onChange={(event) => selectConnectionProfile(event.target.value)} aria-label="连接档案">
                {connectionProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="icon-button" onClick={addConnectionProfile} aria-label="新增连接档案">
              <Sparkles size={17} />
            </button>
            <button className="icon-button" onClick={deleteConnectionProfile} aria-label="删除连接档案">
              <X size={17} />
            </button>
          </div>
          <div className="field-row">
            <label className="input-field">
              <Server size={16} />
              <input value={draftEndpoint} onChange={(event) => setDraftEndpoint(event.target.value)} placeholder="Relay endpoint" />
            </label>
            <button className="icon-button" onClick={() => openHealthUrl(endpoint)} aria-label="打开健康检查">
              <ExternalLink size={17} />
            </button>
          </div>
          <div className="field-row">
            <label className="input-field">
              <KeyRound size={16} />
              <input
                value={draftToken}
                onChange={(event) => setDraftToken(event.target.value)}
                placeholder="Token"
                type={showToken ? "text" : "password"}
              />
            </label>
            <button className="icon-button" onClick={() => setShowToken((value) => !value)} aria-label="显示或隐藏 token">
              {showToken ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          <div className="settings-actions">
            <button className="action-button primary" onClick={() => void testConnection()} disabled={connectionState === "testing"}>
              {connectionState === "testing" ? <Loader2 size={16} className="spin" /> : <Wifi size={16} />}
              <span>测试连接</span>
            </button>
            <button className="action-button" onClick={() => void loadThreads()} disabled={loading}>
              <RefreshCcw size={16} className={loading ? "spin" : ""} />
              <span>保存刷新</span>
            </button>
            <button className="action-button" onClick={saveCurrentProfile}>
              <Clipboard size={16} />
              <span>保存档案</span>
            </button>
          </div>
        </section>

        {settingsOpen && <section className="settings-section"><VoiceSettings endpoint={endpoint} token={token} /></section>}
        <section className="settings-section"><details className="settings-disclosure"><summary>版本与更新</summary>
          <div className="version-card">
            <span>手机版本</span>
            <strong>{appVersionLabel}</strong>
            <span>热更新</span>
            <strong>
              {hotUpdateState.checking
                ? "检查中"
                : hotUpdateState.installing
                  ? "安装中"
                  : hotUpdateState.available
                    ? `可更新到 ${hotUpdateState.manifest?.version}`
                    : hotUpdateState.status?.activeVersion
                      ? hotUpdateState.status.activeVersion
                      : !hotUpdateManifestUrl
                        ? "未配置"
                        : hotUpdateState.error
                          ? "不可用"
                          : "内置资源"}
            </strong>
            <span>更新状态</span>
            <strong>
              {apkStatusText(apkUpdate.status) || (updateState.checking
                ? "检查中"
                : updateState.available
                  ? `可升级到 v${updateState.manifest?.versionName}`
                  : !updateManifestUrl
                    ? "未配置更新源"
                  : updateState.error
                    ? "检查失败"
                    : "已是最新")}
            </strong>
          </div>
          {hotUpdateState.manifest?.notes && <p className="update-note">{hotUpdateState.manifest.notes}</p>}
          {updateState.manifest?.notes && <p className="update-note">{updateState.manifest.notes}</p>}
          {updateState.error && <p className="update-note" role="alert">检查更新失败：{updateState.error}</p>}
          <ApkUpdateProgress status={apkUpdate.status} error={apkUpdate.error} />
          {!apkUpdate.supported && updateState.available && <p className="update-note">此环境需在浏览器下载安装包；覆盖安装新版 Android App 后，即可在 App 内完成后续更新。</p>}
          <div className="settings-actions">
            <button
              className="action-button"
              onClick={() => void Promise.all([checkForUpdates(true), checkHotUpdate(true)])}
              disabled={updateState.checking || hotUpdateState.checking || apkUpdating || hotUpdateState.installing}
            >
              {updateState.checking || hotUpdateState.checking ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
              <span>检查更新</span>
            </button>
            <button
              className="action-button primary"
              onClick={() => void applyHotUpdate()}
              disabled={!hotUpdateState.available || hotUpdateState.installing || apkUpdating}
            >
              {hotUpdateState.installing ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
              <span>应用热更新</span>
            </button>
            <button className="action-button primary" onClick={() => void installApkUpdate()} disabled={(!updateState.available && !apkReady) || apkDownloading || apkUpdate.pending || hotUpdateState.installing || updateState.checking}>
              {apkDownloading || apkUpdate.pending ? <Loader2 size={16} className="spin" /> : <ArrowUp size={16} />}
              <span>{apkDownloading ? apkStatusText(apkUpdate.status) : apkReady ? apkUpdate.status?.phase === "permission_required" ? "允许安装并继续" : "继续安装" : apkUpdate.supported ? "下载并安装" : "浏览器下载 APK"}</span>
            </button>
            <button
              className="action-button"
              onClick={() => void rollbackHotUpdate()}
              disabled={!hotUpdateState.status?.activeVersion || hotUpdateState.installing || apkUpdating}
            >
              <CircleStop size={16} />
              <span>回退热更新</span>
            </button>
          </div>
        </details></section>

        <section className="settings-section">
          <h3>电脑状态</h3>
          <div className="status-grid">
            <span>Relay</span>
            <strong>{connectionState === "ok" ? "在线" : connectionState === "testing" ? "检测中" : "待确认"}</strong>
            <span>Live</span>
            <strong>{relayStatus?.live?.ok ? "可用" : relayStatus?.live?.error ?? "未检测"}</strong>
            <span>Desktop</span>
            <strong>{relayStatus?.desktopControl?.ok ? "IPC 可用" : relayStatus?.desktopControl?.error ?? "未检测"}</strong>
            <span>上传目录</span>
            <strong>{relayStatus?.uploadDir ? shortPath(relayStatus.uploadDir) : "未检测"}</strong>
          </div>
          <div className="settings-actions">
            <button className="action-button" onClick={() => void refreshRelayStatus()}>
              <Activity size={16} />
              <span>刷新状态</span>
            </button>
            {relayStatus?.uploadDir && (
              <button className="action-button" onClick={() => copyText(relayStatus.uploadDir, "upload-dir")}>
                <Clipboard size={16} />
                <span>{copied === "upload-dir" ? "已复制" : "复制上传目录"}</span>
              </button>
            )}
          </div>
        </section>

        <section className="settings-section">
          <h3>主题</h3>
          <div className="segmented">
            <button className={theme === "system" ? "active" : ""} onClick={() => setTheme("system")}>
              <Monitor size={15} />
              <span>系统</span>
            </button>
            <button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>
              <Sun size={15} />
              <span>浅色</span>
            </button>
            <button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>
              <Moon size={15} />
              <span>深色</span>
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>运行策略</h3>
          <div className="segmented">
            <button className={approvalPolicy === "never" ? "active" : ""} onClick={() => setApprovalPolicy("never")}>
              <CheckCircle2 size={15} />
              <span>直接执行</span>
            </button>
            <button className={approvalPolicy === "on-request" ? "active" : ""} onClick={() => setApprovalPolicy("on-request")}>
              <AlertCircle size={15} />
              <span>需要审批</span>
            </button>
            <button className={sandboxMode === "read-only" ? "active" : ""} onClick={() => setSandboxMode("read-only")}>
              <Eye size={15} />
              <span>只读</span>
            </button>
          </div>
          <div className="segmented">
            <button className={sandboxMode === "workspace-write" ? "active" : ""} onClick={() => setSandboxMode("workspace-write")}>
              <Terminal size={15} />
              <span>工程写入</span>
            </button>
            <button className={sandboxMode === "danger-full-access" ? "active" : ""} onClick={() => setSandboxMode("danger-full-access")}>
              <KeyRound size={15} />
              <span>完整权限</span>
            </button>
            <button onClick={() => void testConnection()}>
              <Wifi size={15} />
              <span>检测</span>
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>分屏</h3>
          <div className="segmented four">
            <button className={splitMode === "auto" ? "active" : ""} onClick={() => setSplitMode("auto")}>
              <Monitor size={15} />
              <span>自动</span>
            </button>
            <button className={splitMode === "left" ? "active" : ""} onClick={() => setSplitMode("left")}>
              <Columns3 size={15} />
              <span>左侧</span>
            </button>
            <button className={splitMode === "top" ? "active" : ""} onClick={() => setSplitMode("top")}>
              <Rows3 size={15} />
              <span>顶部</span>
            </button>
            <button className={splitMode === "drawer" ? "active" : ""} onClick={() => setSplitMode("drawer")}>
              <Menu size={15} />
              <span>抽屉</span>
            </button>
          </div>
        </section>

        {(diagnostics.length > 0 || diagnosticText) && (
          <section className={`diagnostics ${connectionState}`}>
            <div className="diagnostics-heading">
              <span>
                {connectionState === "ok" ? <CheckCircle2 size={16} /> : connectionState === "error" ? <AlertCircle size={16} /> : <Activity size={16} />}
                {connectionState === "ok" ? "连接可用" : connectionState === "testing" ? "正在检测" : "连接诊断"}
              </span>
              <button className="text-button" onClick={() => copyText(diagnosticText, "diagnostics")}>
                <Clipboard size={15} />
                <span>{copied === "diagnostics" ? "已复制" : "复制"}</span>
              </button>
            </div>
            <div className="diagnostic-list">
              {diagnostics.map((step) => (
                <div key={step.name} className={`diagnostic-step ${step.ok ? "ok" : "fail"}`}>
                  <strong>{step.name}</strong>
                  <span>{step.detail}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </aside>
    </main>
  );

  async function copyText(text: string, key: string) {
    if (!text) return;
    try {
      await writeClipboard(text);
      setCopied(key);
      setStatus("已复制");
      window.setTimeout(() => setCopied(""), 1600);
    } catch (error) {
      setStatus(`复制失败：${toFriendlyFetchError(error)}`);
    }
  }
}

export default App;
