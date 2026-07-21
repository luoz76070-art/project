import React, { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertCircle,
  Columns3,
  CheckCircle2,
  Clipboard,
  CircleStop,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileUp,
  ImageIcon,
  KeyRound,
  Loader2,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeft,
  Paperclip,
  RefreshCcw,
  Search,
  Send,
  Server,
  Settings,
  Sparkles,
  Sun,
  Terminal,
  Rows3,
  Wifi,
  X,
} from "lucide-react";
import { collapseMirroredMessages, reconcileMessages, stripCodexAppDirectives } from "./messageReconciliation";
import "./styles.css";

type ThreadSummary = {
  id: string;
  threadName: string;
  updatedAt: string;
  cwd: string | null;
  source: string | null;
  originator: string | null;
  rolloutPath?: string | null;
};

type CodexMessage = {
  id: string;
  timestamp: string;
  role: string;
  text: string;
  kind: string;
  attachments?: PendingAttachment[];
};

type DiagnosticStep = {
  name: string;
  ok: boolean;
  detail: string;
};

type RequestJsonOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  connectTimeout?: number;
  readTimeout?: number;
};

type RelayStatus = {
  ok: boolean;
  mode: string;
  codexHome: string;
  defaultCwd: string;
  uploadDir: string;
  codexExecutable?: string;
  live?: { ok: boolean; mode: string; threadCount?: number; error?: string };
  desktopControl?: { ok: boolean; mode: string; error?: string };
  activeDesktopThread?: ThreadSummary | null;
};

type DesktopActiveResponse = {
  thread: ThreadSummary | null;
  mode: string;
  source?: "ipc-stream" | "session-index";
  streamThreadIds?: string[];
};

type UploadResponse = {
  upload: {
    ok: true;
    fileName: string;
    originalName: string;
    path: string;
    relativePath: string;
    size: number;
    createdAt: string;
  };
};

type PendingAttachment = {
  id: string;
  fileName: string;
  path: string;
  relativePath: string;
  size: number;
  createdAt: string;
  mimeType: string;
  previewUrl: string | null;
};

type ThemeMode = "system" | "light" | "dark";
type SplitMode = "auto" | "left" | "top" | "drawer";
type ApprovalPolicy = "never" | "on-request";
type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
type ThreadRuntime = {
  messages: CodexMessage[];
  draft: string;
  sending: boolean;
  loading: boolean;
  status: string;
  loaded: boolean;
  cursor: number;
  watchMode: "none" | "desktop-tail";
  watching: boolean;
  readonlyReason: string;
  activeTurnId: string | null;
  turnStatus: "idle" | "starting" | "inProgress" | "completed" | "interrupted" | "failed";
  lastEventCount: number;
  lastTurnError: string;
  approvals: LiveApproval[];
  smoothMessageId: string | null;
  attachments: PendingAttachment[];
};

type SendRoute = "desktop" | "relay";

type LiveTurnStatus = "starting" | "inProgress" | "completed" | "interrupted" | "failed";
type LiveApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

type LiveApproval = {
  id: string;
  requestId: string | number;
  kind: "command" | "fileChange" | "permissions" | "unsupported";
  status: "pending" | "approved" | "declined" | "cancelled" | "failed";
  title: string;
  detail: string;
  command: string | null;
  cwd: string | null;
  reason: string | null;
  availableDecisions: LiveApprovalDecision[];
  createdAt: string;
  updatedAt: string;
};

type LiveTurnSnapshot = {
  threadId: string;
  turnId: string;
  status: LiveTurnStatus;
  messageCount: number;
  eventCount: number;
  messages: CodexMessage[];
  approvals: LiveApproval[];
  thread: ThreadSummary | null;
  error: string | null;
  updatedAt: string;
};

type DesktopStreamSnapshot = {
  threadId: string;
  status: LiveTurnStatus;
  messages: CodexMessage[];
  messageCount: number;
  eventCount: number;
  updatedAt: string;
  changeType: string | null;
  source: "desktop-ipc";
};

type DesktopControlResponse = {
  ok: boolean;
  mode: "desktop-ipc-follower-control" | "macos-ui-injector-control";
  action: "start-turn" | "steer-turn" | "interrupt-turn" | "ui-submit";
  thread: ThreadSummary | null;
  warning?: string;
  error?: string;
};

type LoadThreadsOptions = {
  selectLatest?: boolean;
};

type ConnectionProfile = {
  id: string;
  name: string;
  endpoint: string;
  token: string;
  updatedAt: string;
};

type AndroidUpdateManifest = {
  platform: "android";
  versionName: string;
  versionCode: number;
  apkUrl: string;
  size?: number;
  sha256?: string;
  mandatory?: boolean;
  notes?: string;
  publishedAt?: string;
};

type UpdateState = {
  checking: boolean;
  manifest: AndroidUpdateManifest | null;
  available: boolean;
  error: string;
  lastCheckedAt: string;
};

type ClipboardPlugin = {
  write(options: { string: string }): Promise<void>;
};

const NativeClipboard = registerPlugin<ClipboardPlugin>("Clipboard");

const savedProfiles = loadConnectionProfiles();
const defaultProfileId = localStorage.getItem("activeConnectionProfileId") ?? savedProfiles[0]?.id ?? "default";
const defaultEndpoint =
  savedProfiles.find((profile) => profile.id === defaultProfileId)?.endpoint ?? localStorage.getItem("relayEndpoint") ?? "http://127.0.0.1:8787";
const defaultToken =
  savedProfiles.find((profile) => profile.id === defaultProfileId)?.token ?? localStorage.getItem("relayToken") ?? "";
const defaultTheme = (localStorage.getItem("themeMode") as ThemeMode | null) ?? "system";
const defaultSplitMode = (localStorage.getItem("splitMode") as SplitMode | null) ?? "auto";
const defaultApprovalPolicy = (localStorage.getItem("approvalPolicy") as ApprovalPolicy | null) ?? "never";
const defaultSandboxMode = (localStorage.getItem("sandboxMode") as SandboxMode | null) ?? "workspace-write";
const defaultSidePaneSize = savedNumber("sidePaneSize", 320, 96, 520);
const defaultTopPaneSize = savedNumber("topPaneSize", 220, 110, 520);
const newThreadId = "__new_thread__";
const maxMessagesPerThread = 240;
const desktopLatestMaxBytes = 65_536;
const desktopLatestMaxMessages = 24;
const desktopPollActiveMs = 300;
const desktopPollIdleMs = 1200;
const livePollFallbackMs = 800;
const liveSnapshotThrottleMs = 80;
const smoothTextFrameMs = 26;
const statusKeepaliveMs = 60_000;
const threadRuntimeCacheKey = "mobileCodexThreadRuntimeCacheV1";
const cachedThreadLimit = 24;
const cachedMessagesPerThread = 120;
const appVersionName = "1.1.13-message-order-fix";
const appVersionCode = 14;
const appVersionLabel = `v${appVersionName}`;
const updateManifestUrl = (import.meta.env.VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL ?? "").trim();

function App() {
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>(savedProfiles);
  const [activeProfileId, setActiveProfileId] = useState(defaultProfileId);
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  const [token, setToken] = useState(defaultToken);
  const [theme, setTheme] = useState<ThemeMode>(defaultTheme);
  const [splitMode, setSplitMode] = useState<SplitMode>(defaultSplitMode);
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(defaultApprovalPolicy);
  const [sandboxMode, setSandboxMode] = useState<SandboxMode>(defaultSandboxMode);
  const [sidePaneSize, setSidePaneSize] = useState(defaultSidePaneSize);
  const [topPaneSize, setTopPaneSize] = useState(defaultTopPaneSize);
  const [resizingPane, setResizingPane] = useState<"side" | "top" | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadState, setThreadState] = useState<Record<string, ThreadRuntime>>(() => loadThreadRuntimeCache());
  const [selected, setSelected] = useState<ThreadSummary | null>(null);
  const [isNewThread, setIsNewThread] = useState(false);
  const [query, setQuery] = useState("");
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
  const [activeDesktopThreadId, setActiveDesktopThreadId] = useState<string | null>(null);
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

  const messagesRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceGridRef = useRef<HTMLElement | null>(null);
  const selectedRef = useRef<ThreadSummary | null>(null);
  const activeRuntimeRef = useRef<ThreadRuntime>(defaultRuntime());
  const sendLockRef = useRef(false);
  const forceBottomRef = useRef(false);
  const atBottomRef = useRef(true);
  const activeThreadKey = selected?.id ?? (isNewThread ? newThreadId : "");
  const activeRuntime = getRuntime(threadState, activeThreadKey);
  const messages = activeRuntime.messages;
  const visibleMessages = useMemo(() => messagesForRender(messages), [messages]);
  const draft = activeRuntime.draft;
  const attachments = activeRuntime.attachments;
  const sending = activeRuntime.sending;
  const loadingMessages = activeRuntime.loading;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter((thread) =>
      [thread.threadName, thread.cwd, thread.originator, thread.source]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [threads, query]);
  const groupedFiltered = useMemo(() => groupThreadsByProject(filtered), [filtered]);

  const workspaceTitle = selected?.threadName || (isNewThread ? "新线程" : "Mobile Codex");
  const workspaceSubtitle =
    selected?.cwd ||
    (connectionState === "ok" ? "Relay 已连接" : connectionState === "testing" ? "检测连接中" : "打开设置配置 Endpoint 和 Token");
  const chatSubtitle = selected?.cwd || (isNewThread ? "准备创建新的 Codex 线程" : workspaceSubtitle);
  const isDesktopWatch = activeRuntime.watchMode === "desktop-tail";
  const canUseDesktopIpc = Boolean(isDesktopWatch && selected?.id && activeDesktopThreadId === selected.id);
  const isDesktopHistoryOnly = Boolean(isDesktopWatch && selected?.id && !canUseDesktopIpc);
  const isLiveTurnActive = activeRuntime.turnStatus === "starting" || activeRuntime.turnStatus === "inProgress";
  const latestAssistantMessage = [...visibleMessages].reverse().find((message) => message.role === "assistant");
  const latestAssistantMessageId = latestAssistantMessage?.id ?? "";
  const latestAssistantHasText = Boolean(latestAssistantMessage?.text.trim());
  const smoothLatestAssistant = Boolean(latestAssistantMessageId && activeRuntime.smoothMessageId === latestAssistantMessageId);
  const smoothPending = Boolean(smoothLatestAssistant && (activeRuntime.sending || isLiveTurnActive));
  const pendingApprovals = activeRuntime.approvals.filter((approval) => approval.status === "pending");
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
  const canSend = Boolean(draft.trim() || attachments.length > 0) && canControlSelected && (!sending || isLiveTurnActive);
  const controlText = canUseDesktopIpc
    ? activeRuntime.sending
      ? "运行中，可继续引导或打断"
      : "发送到电脑当前线程"
    : isDesktopHistoryOnly
      ? "发送会尝试接管桌面线程"
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
    setLoading(true);
    setStatus("同步线程中");
    try {
      saveConnectionSettings(endpoint, token);
      const data = await loadThreadList(endpoint, token);
      const activeTurns = await loadActiveTurns(endpoint, token).catch(() => []);
      const retainedThreads = threads.filter((thread) => {
        const runtime = getRuntime(threadState, thread.id);
        return thread.id === selected?.id || runtime.loaded || runtime.messages.length > 0;
      });
      const mergedThreads = mergeThreads(
        activeTurns.map((turn) => threadFromLiveTurn(turn)).filter((thread): thread is ThreadSummary => Boolean(thread)),
        data.threads,
        retainedThreads,
      ).slice(0, 12);
      setThreads(mergedThreads);
      setStatus(`已同步 ${mergedThreads.length} 个线程`);
      void refreshActiveDesktopThread();
      for (const turn of activeTurns) {
        applyLiveTurnSnapshot(turn.threadId, turn);
      }

      const current = selected ? mergedThreads.find((thread) => thread.id === selected.id) : null;
      if (current) setSelected(current);

      if (mergedThreads.length > 0 && (options.selectLatest || (!selected && !isNewThread))) {
        await openThread(mergedThreads[0], { closeSidebar: true });
      }
      await checkLiveStatus();
    } catch (error) {
      setStatus(toFriendlyFetchError(error));
    } finally {
      setLoading(false);
    }
  }

  async function testConnection() {
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
        const data = await apiGet<{ ok: boolean; codexExecutable?: string }>(buildUrl(endpoint, "/health"));
        if (!data.ok) throw new Error("Relay health returned ok=false");
        return data.codexExecutable ? `ok, codex=${shortPath(data.codexExecutable)}` : "ok";
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
        return `ok, upload=${shortPath(data.uploadDir)}, cwd=${shortPath(data.defaultCwd)}`;
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
    forceBottomRef.current = true;
    patchRuntime(thread.id, { loading: true, status: "读取线程中" });
    try {
      const shouldUseDesktopTail = isDesktopSource(thread);
      if (!getRuntime(threadState, thread.id).loaded || shouldUseDesktopTail) {
        const data = await readThread(endpoint, token, thread);
        updateRuntime(thread.id, (runtime) => {
          const mergedMessages = capMessages(mergeMessages(runtime.messages, data.messages));
          return {
            ...runtime,
            messages: mergedMessages,
            loaded: true,
            cursor: data.cursor ?? runtime.cursor,
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
      } else {
        setStatus("已切换线程");
      }
      if (options.closeSidebar) setSidebarOpen(false);
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
    setUpdateState((current) => ({ ...current, checking: true, error: "" }));
    try {
      const manifest = await apiGet<AndroidUpdateManifest>(`${updateManifestUrl}?t=${Date.now()}`);
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
        error: detail,
        lastCheckedAt: new Date().toISOString(),
      }));
      if (manual) setStatus(`检查更新失败：${detail}`);
    }
  }

  function openUpdateDownload() {
    const url = updateState.manifest?.apkUrl;
    if (!url) {
      setStatus("没有可下载的更新包");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    setStatus("已打开 APK 下载地址");
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

  function saveCurrentProfile() {
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    const now = new Date().toISOString();
    const nextProfile: ConnectionProfile = {
      id: activeProfileId || `profile-${Date.now()}`,
      name: profileNameFromEndpoint(normalizedEndpoint),
      endpoint: normalizedEndpoint,
      token,
      updatedAt: now,
    };
    const next = upsertConnectionProfile(connectionProfiles, nextProfile);
    setConnectionProfiles(next);
    setActiveProfileId(nextProfile.id);
    saveConnectionProfiles(next, nextProfile.id);
    saveConnectionSettings(normalizedEndpoint, token);
    setEndpoint(normalizedEndpoint);
    setStatus("连接档案已保存");
  }

  function addConnectionProfile() {
    const id = `profile-${Date.now()}`;
    const nextProfile: ConnectionProfile = {
      id,
      name: "新连接",
      endpoint: "http://127.0.0.1:8787",
      token: "",
      updatedAt: new Date().toISOString(),
    };
    const next = upsertConnectionProfile(connectionProfiles, nextProfile);
    setConnectionProfiles(next);
    setActiveProfileId(id);
    setEndpoint(nextProfile.endpoint);
    setToken(nextProfile.token);
    saveConnectionProfiles(next, id);
    setStatus("已新建连接档案");
  }

  function selectConnectionProfile(profileId: string) {
    const profile = connectionProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    setActiveProfileId(profile.id);
    setEndpoint(profile.endpoint);
    setToken(profile.token);
    saveConnectionProfiles(connectionProfiles, profile.id);
    saveConnectionSettings(profile.endpoint, profile.token);
    setStatus(`已切换到 ${profile.name}`);
  }

  function deleteConnectionProfile() {
    if (connectionProfiles.length <= 1) {
      setStatus("至少保留一个连接档案");
      return;
    }
    const next = connectionProfiles.filter((profile) => profile.id !== activeProfileId);
    const fallback = next[0];
    setConnectionProfiles(next);
    setActiveProfileId(fallback.id);
    setEndpoint(fallback.endpoint);
    setToken(fallback.token);
    saveConnectionProfiles(next, fallback.id);
    saveConnectionSettings(fallback.endpoint, fallback.token);
    setStatus("连接档案已删除");
  }

  async function sendMessage() {
    if (sendLockRef.current) return;
    const threadKey = activeThreadKey;
    const runtime = getRuntime(threadState, threadKey);
    const userText = runtime.draft.trim();
    const pendingAttachments = runtime.attachments;
    const message = composeMessageWithAttachments(userText, pendingAttachments);
    if (!threadKey || !message) return;
    sendLockRef.current = true;
    const sendRoute = await resolveSendRoute();
    if (sendRoute === "desktop") {
      const result = await sendDesktopMessage(threadKey, message, userText, pendingAttachments);
      if (result === "sent") {
        sendLockRef.current = false;
        return;
      }
    }
    if (sending && activeRuntime.activeTurnId && selected?.id) {
      try {
        await steerActiveTurn(threadKey, selected.id, activeRuntime.activeTurnId, message, userText, pendingAttachments);
      } finally {
        sendLockRef.current = false;
      }
      return;
    }
    if (sending) {
      sendLockRef.current = false;
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
    } finally {
      sendLockRef.current = false;
    }
  }

  async function resolveSendRoute(): Promise<SendRoute> {
    if (!selected?.id || !isDesktopSource(selected)) return "relay";
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
      return canUseDesktopIpc ? "desktop" : "relay";
    }
  }

  async function sendDesktopMessage(
    threadKey: string,
    message: string,
    restoreDraft: string,
    pendingAttachments: PendingAttachment[],
  ): Promise<"sent" | "fallback"> {
    if (!selected?.id) return "fallback";
    if (sending && !activeRuntime.sending) return "fallback";
    const mode = "auto";
    patchRuntime(threadKey, {
      sending: true,
      draft: "",
      attachments: [],
      status: "发送到桌面 Codex",
      turnStatus: "inProgress",
      lastTurnError: "",
    });
    forceBottomRef.current = true;
    setStatus("发送到桌面 Codex");

    try {
      const data = await apiPost<DesktopControlResponse>(
        buildUrl(endpoint, `/api/desktop/control/threads/${encodeURIComponent(selected.id)}/messages`),
        token,
        {
          message,
          cwd: selected.cwd,
          mode,
        },
      );
      if (!data.ok) throw new Error(data.error ?? "Desktop 控制请求失败");
      const optimistic: CodexMessage = {
        id: `desktop-local-${Date.now()}`,
        timestamp: new Date().toISOString(),
        role: "user",
        text: message,
        kind: "local",
        attachments: pendingAttachments,
      };
      updateRuntime(threadKey, (runtime) => ({ ...runtime, messages: [...runtime.messages, optimistic] }));
      const statusText = data.warning ? "已提交到桌面 Codex，等待同步确认" : desktopActionText(data.action);
      patchRuntime(threadKey, {
        status: statusText,
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
      if (shouldFallbackToRelay(error)) {
        patchRuntime(threadKey, {
          sending: false,
          draft: "",
          attachments: [],
          status: "桌面未实时接管，已切换到手机 Relay",
          turnStatus: "idle",
          lastTurnError: "",
        });
        setStatus("桌面未实时接管，已切换到手机 Relay");
        return "fallback";
      }
      patchRuntime(threadKey, {
        sending: false,
        draft: restoreDraft,
        attachments: pendingAttachments,
        status: detail,
        turnStatus: "failed",
        lastTurnError: detail,
      });
      setStatus(detail);
      return "sent";
    }
  }

  async function steerActiveTurn(
    threadKey: string,
    threadId: string,
    turnId: string,
    message: string,
    restoreDraft: string,
    pendingAttachments: PendingAttachment[],
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
        message,
      });
      applyLiveTurnSnapshot(threadKey, data.turn);
      setStatus("已发送引导");
    } catch (error) {
      const detail = toFriendlyFetchError(error);
      patchRuntime(threadKey, { draft: restoreDraft, attachments: pendingAttachments, status: detail, lastTurnError: detail });
      setStatus(detail);
    }
  }

  async function interruptActiveTurn() {
    const threadKey = activeThreadKey;
    if (!threadKey || !selected?.id) return;
    patchRuntime(threadKey, { status: "发送打断请求" });
    setStatus("发送打断请求");
    if (canUseDesktopIpc) {
      try {
        const data = await apiPost<DesktopControlResponse>(
          buildUrl(endpoint, `/api/desktop/control/threads/${encodeURIComponent(selected.id)}/interrupt`),
          token,
          {},
        );
        if (!data.ok) throw new Error(data.error ?? "Desktop 打断失败");
        patchRuntime(threadKey, {
          sending: false,
          status: "已向桌面 Codex 发送打断",
          turnStatus: "interrupted",
          lastTurnError: "",
        });
        setStatus("已向桌面 Codex 发送打断");
      } catch (error) {
        const detail = toFriendlyFetchError(error);
        patchRuntime(threadKey, { status: detail, lastTurnError: detail });
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
      const messages = capMessages(mergeMessagesById(runtime.messages, turn.messages));
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
        smoothMessageId: nextSmoothMessageId(runtime, messages),
      };
    });
  }

  function applyDesktopStreamSnapshot(threadKey: string, snapshot: DesktopStreamSnapshot) {
    updateRuntime(threadKey, (runtime) => {
      const messages = capMessages(mergeMessagesById(runtime.messages, snapshot.messages));
      const snapshotActive = snapshot.status === "starting" || snapshot.status === "inProgress";
      const pendingDesktopOutput = runtime.sending || runtime.turnStatus === "starting" || runtime.turnStatus === "inProgress";
      const keepWaitingForText = pendingDesktopOutput && snapshot.status === "completed" && !hasAssistantOutputAfterLatestUser(messages);
      const isActive = snapshotActive || keepWaitingForText;
      return {
        ...runtime,
        messages,
        loaded: true,
        status: isActive ? "桌面实时同步中" : "桌面同步完成",
        sending: isActive,
        watching: true,
        activeTurnId: null,
        turnStatus: isActive ? "inProgress" : snapshot.status,
        lastEventCount: snapshot.eventCount,
        lastTurnError: "",
        smoothMessageId: nextSmoothMessageId(runtime, messages),
      };
    });
  }

  async function respondApproval(approval: LiveApproval, decision: LiveApprovalDecision) {
    const threadKey = activeThreadKey;
    if (!threadKey || !activeRuntime.activeTurnId) return;
    patchRuntime(threadKey, { status: approvalDecisionText(decision) });
    try {
      const data = await apiPost<{ turn: LiveTurnSnapshot }>(
        buildUrl(
          endpoint,
          `/api/live/turns/${encodeURIComponent(activeRuntime.activeTurnId)}/approvals/${encodeURIComponent(approval.id)}/respond`,
        ),
        token,
        { decision },
      );
      applyLiveTurnSnapshot(threadKey, data.turn);
      setStatus(approvalDecisionText(decision));
    } catch (error) {
      const detail = toFriendlyFetchError(error);
      patchRuntime(threadKey, { status: detail, lastTurnError: detail });
      setStatus(detail);
    }
  }

  async function watchDesktopDelta(threadId: string, cursor: number) {
    const data = await apiGet<{ messages: CodexMessage[]; cursor: number; fileSize: number; truncated: boolean }>(
      buildUrl(endpoint, `/api/desktop/threads/${encodeURIComponent(threadId)}/delta?cursor=${cursor}`),
      token,
    );
    if (data.cursor === cursor && data.messages.length === 0) return;
    updateRuntime(threadId, (runtime) => {
      const nextMessages = capMessages(mergeMessages(runtime.messages, data.messages));
      const hasAssistantOutput = data.messages.some((message) => message.role === "assistant" && message.kind !== "tool" && message.text.trim().length > 0);
      return {
        ...runtime,
        cursor: data.cursor,
        messages: nextMessages,
        status: hasAssistantOutput ? "桌面同步完成" : data.messages.length > 0 ? `桌面同步 +${data.messages.length}` : runtime.status,
        watching: true,
        sending: hasAssistantOutput ? false : runtime.sending,
        activeTurnId: hasAssistantOutput ? null : runtime.activeTurnId,
        turnStatus: hasAssistantOutput ? "completed" : runtime.turnStatus,
        smoothMessageId: hasAssistantOutput ? nextSmoothMessageId(runtime, nextMessages) : runtime.smoothMessageId,
      };
    });
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
    atBottomRef.current = bottom;
    if (bottom) setHasNewMessages(false);
  }

  function jumpToLatest() {
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

  useEffect(() => {
    saveThreadRuntimeCache(threadState);
  }, [threadState]);

  useEffect(() => {
    const element = messagesRef.current;
    if (!element) return;
    if (forceBottomRef.current || atBottomRef.current) {
      scrollMessagesToBottom(!forceBottomRef.current);
      forceBottomRef.current = false;
      setHasNewMessages(false);
      return;
    }
    setHasNewMessages(visibleMessages.length > 0);
  }, [visibleMessages, selected?.id, isNewThread]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    activeRuntimeRef.current = activeRuntime;
  }, [activeRuntime]);

  useEffect(() => {
    if (!selected?.id || activeRuntime.watchMode !== "desktop-tail") return;
    let cancelled = false;
    const threadId = selected.id;
    let timer: number | null = null;
    const schedule = () => {
      if (cancelled) return;
      const runtime = activeRuntimeRef.current;
      const active = runtime.sending || runtime.turnStatus === "starting" || runtime.turnStatus === "inProgress";
      timer = window.setTimeout(() => void tick(), active ? desktopPollActiveMs : desktopPollIdleMs);
    };
    const tick = async () => {
      if (cancelled || selectedRef.current?.id !== threadId) return;
      const runtime = activeRuntimeRef.current;
      if (runtime.watchMode !== "desktop-tail") return;
      if (document.hidden) {
        schedule();
        return;
      }
      try {
        await watchDesktopDelta(threadId, runtime.cursor);
      } catch (error) {
        patchRuntime(threadId, { watching: false, status: toFriendlyFetchError(error) });
      } finally {
        schedule();
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, activeRuntime.watchMode]);

  useEffect(() => {
    if (!selected?.id || activeRuntime.watchMode !== "desktop-tail") return;
    if (!canUseEventSource()) return;
    let source: EventSource | null = null;
    let cancelled = false;
    const threadId = selected.id;

    const connect = async () => {
      try {
        const tokenResponse = await apiPost<{ streamToken: string | null; expiresAt?: string; error?: string }>(
          buildUrl(endpoint, `/api/desktop/threads/${encodeURIComponent(threadId)}/stream-token`),
          token,
          {},
        );
        if (cancelled || !tokenResponse.streamToken) throw new Error(tokenResponse.error ?? "desktop stream token not available");
        const url = buildUrl(
          endpoint,
          `/api/desktop/threads/${encodeURIComponent(threadId)}/events?streamToken=${encodeURIComponent(tokenResponse.streamToken)}`,
        );
        source = new EventSource(url);
        source.addEventListener("desktop", (event) => {
          try {
            const snapshot = JSON.parse((event as MessageEvent).data) as DesktopStreamSnapshot;
            if (snapshot.threadId === threadId) applyDesktopStreamSnapshot(threadId, snapshot);
          } catch {
            // Ignore malformed stream frames and let rollout polling repair state.
          }
        });
        source.onerror = () => {
          source?.close();
          patchRuntime(threadId, { status: "桌面实时流断开，继续日志同步" });
        };
      } catch {
        patchRuntime(threadId, { status: "桌面实时流不可用，继续日志同步" });
      }
    };

    void connect();
    return () => {
      cancelled = true;
      source?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, activeRuntime.watchMode, endpoint, token]);

  useEffect(() => {
    if (!activeRuntime.activeTurnId || !activeThreadKey || activeRuntime.watchMode === "desktop-tail") return;
    if (!canUseEventSource()) return;
    let source: EventSource | null = null;
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

    const connect = async () => {
      try {
        const tokenResponse = await apiPost<{ streamToken: string | null; expiresAt?: string; error?: string }>(
          buildUrl(endpoint, `/api/live/turns/${encodeURIComponent(turnId)}/stream-token`),
          token,
          {},
        );
        if (cancelled || !tokenResponse.streamToken) throw new Error(tokenResponse.error ?? "stream token not available");
        const url = buildUrl(endpoint, `/api/live/turns/${encodeURIComponent(turnId)}/events?streamToken=${encodeURIComponent(tokenResponse.streamToken)}`);
        source = new EventSource(url);
        source.addEventListener("turn", (event) => {
          try {
            const snapshot = JSON.parse((event as MessageEvent).data) as LiveTurnSnapshot;
            scheduleSnapshot(snapshot);
          } catch {
            // Ignore malformed stream frames and let the next snapshot repair state.
          }
        });
        source.onerror = () => {
          source?.close();
          setLiveStreamFallbackTurnId(turnId);
          patchRuntime(threadKey, { status: "推送连接断开，切换轮询" });
        };
      } catch {
        setLiveStreamFallbackTurnId(turnId);
        patchRuntime(threadKey, { status: "推送连接不可用，切换轮询" });
      }
    };

    void connect();
    return () => {
      cancelled = true;
      if (snapshotTimer !== null) window.clearTimeout(snapshotTimer);
      source?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadKey, activeRuntime.activeTurnId, activeRuntime.watchMode, endpoint, token]);

  useEffect(() => {
    if (!activeRuntime.activeTurnId || !activeThreadKey || activeRuntime.watchMode === "desktop-tail") return;
    if (canUseEventSource() && liveStreamFallbackTurnId !== activeRuntime.activeTurnId) return;
    let cancelled = false;
    const threadKey = activeThreadKey;
    const turnId = activeRuntime.activeTurnId;
    let timer: number | null = null;
    const schedule = () => {
      if (!cancelled) timer = window.setTimeout(() => void tick(), livePollFallbackMs);
    };
    const tick = async () => {
      if (cancelled) return;
      if (document.hidden) {
        schedule();
        return;
      }
      try {
        await pollLiveTurn(threadKey, turnId);
      } catch (error) {
        patchRuntime(threadKey, { status: toFriendlyFetchError(error), lastTurnError: toFriendlyFetchError(error) });
      } finally {
        schedule();
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadKey, activeRuntime.activeTurnId, activeRuntime.watchMode, endpoint, token, liveStreamFallbackTurnId]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      if (cancelled || !token.trim()) return;
      try {
        await apiGet<{ ok: boolean }>(buildUrl(endpoint, "/health"));
        setConnectionState((current) => (current === "testing" ? current : "ok"));
      } catch (error) {
        setConnectionState((current) => (current === "testing" ? current : "error"));
        setStatus(`后台连接检查失败：${toFriendlyFetchError(error)}`);
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void tick(), statusKeepaliveMs);
      }
    };
    void tick();
    const onVisible = () => {
      if (!document.hidden) void refreshRelayStatus().catch(() => void tick());
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
    void loadThreads({ selectLatest: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void checkForUpdates(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className={`codex-shell ${layoutClass} ${resizingPane ? "is-resizing" : ""}`} style={shellStyle}>
      <header className="topbar glass-surface">
        <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="打开线程列表">
          <Menu size={19} />
        </button>
        <div className="workspace-title">
          <span className={`status-dot ${connectionState === "error" ? "error" : connectionState === "ok" ? "ok" : ""}`} />
          <div>
            <h1>{workspaceTitle}</h1>
            <p>{workspaceSubtitle}</p>
          </div>
        </div>
        <div className="top-actions">
          <button className="icon-button" onClick={() => void loadThreads()} aria-label="刷新线程">
            <RefreshCcw size={18} className={loading ? "spin" : ""} />
          </button>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="设置">
            <Settings size={18} />
          </button>
        </div>
      </header>

      <section className="workspace-grid" ref={workspaceGridRef}>
        <aside className={`thread-sidebar glass-surface ${sidebarOpen || (!selected && !isNewThread) ? "open" : ""}`}>
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
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索线程、项目、路径" />
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
            {groupedFiltered.map((group) => (
              <section className="thread-group" key={group.key}>
                <div className="thread-group-label">
                  <span>{group.label}</span>
                  <em>{group.threads.length}</em>
                </div>
                {group.threads.map((thread) => {
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
                })}
              </section>
            ))}
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
            {loadingMessages && (
              <div className="inline-loading">
                <Loader2 size={18} className="spin" />
                <span>读取线程</span>
              </div>
            )}
            {!loadingMessages && visibleMessages.length === 0 && (
              <div className="empty-chat">
                <Sparkles size={28} />
                <h3>{isNewThread ? "开始一个新线程" : "选择一个 Codex 线程"}</h3>
                <p>{isNewThread ? "输入消息后会在当前电脑上启动 Codex turn。" : "从左侧选择线程，或创建新线程继续工作。"}</p>
              </div>
            )}
            {visibleMessages.map((message) => (
              <React.Fragment key={message.id}>
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
            ))}
          </div>

          {hasNewMessages && (
            <button className="latest-pill" onClick={jumpToLatest}>
              <Activity size={15} />
              <span>最新消息</span>
            </button>
          )}

          <footer className="composer-panel">
            {canUseDesktopIpc && !isLiveTurnActive && (
              <div className="control-banner live-control compact">
                <Monitor size={15} />
                <span>桌面已连接</span>
                <button onClick={() => void interruptActiveTurn()} aria-label="打断">
                  <CircleStop size={14} />
                </button>
              </div>
            )}
            {isDesktopHistoryOnly && !isLiveTurnActive && (
              <div className="control-banner live-control compact">
                <Monitor size={15} />
                <span>历史线程可查看；发送时会先尝试桌面实时同步</span>
              </div>
            )}
            {isLiveTurnActive && (
              <div className="control-banner live-control compact">
                <Activity size={15} />
                <span>{turnActivity.label}</span>
                <button onClick={() => void interruptActiveTurn()} aria-label="打断">
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
                {uploading ? <Loader2 size={18} className="spin" /> : <FileUp size={18} />}
              </button>
              <textarea
                value={draft}
                onChange={(event) => patchRuntime(activeThreadKey || newThreadId, { draft: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="向 Codex 发送消息"
                disabled={!canControlSelected}
              />
              <button className="send-button" onClick={() => void sendMessage()} disabled={!canSend} aria-label={isLiveTurnActive ? "发送引导" : "发送"}>
                {canUseDesktopIpc ? <Send size={18} /> : isLiveTurnActive ? <MessageSquare size={18} /> : sending ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
              </button>
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

        <section className="settings-section">
          <h3>Relay</h3>
          <div className="version-card">
            <span>手机版本</span>
            <strong>{appVersionLabel}</strong>
            <span>更新状态</span>
            <strong>
              {updateState.checking
                ? "检查中"
                : updateState.available
                  ? `可升级到 v${updateState.manifest?.versionName}`
                  : !updateManifestUrl
                    ? "未配置更新源"
                  : updateState.error
                    ? "检查失败"
                    : "已是最新"}
            </strong>
          </div>
          {updateState.manifest?.notes && <p className="update-note">{updateState.manifest.notes}</p>}
          <div className="settings-actions">
            <button className="action-button" onClick={() => void checkForUpdates(true)} disabled={updateState.checking || !updateManifestUrl}>
              {updateState.checking ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
              <span>检查更新</span>
            </button>
            <button className="action-button primary" onClick={openUpdateDownload} disabled={!updateState.available}>
              <ExternalLink size={16} />
              <span>下载新版</span>
            </button>
          </div>
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
              <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="Relay endpoint" />
            </label>
            <button className="icon-button" onClick={() => openHealthUrl(endpoint)} aria-label="打开健康检查">
              <ExternalLink size={17} />
            </button>
          </div>
          <div className="field-row">
            <label className="input-field">
              <KeyRound size={16} />
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
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

async function writeClipboard(text: string) {
  if (Capacitor.isNativePlatform()) {
    await NativeClipboard.write({ string: text });
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) throw new Error("clipboard unavailable");
}

function SmoothText({ text, active, pending, onDone }: { text: string; active: boolean; pending: boolean; onDone?: () => void }) {
  const targetRef = useRef(text);
  const [displayed, setDisplayed] = useState(active ? "" : text);

  useEffect(() => {
    targetRef.current = text;
    if (!active) {
      setDisplayed(text);
      return;
    }
    setDisplayed((current) => (text.startsWith(current) ? current : ""));
  }, [text, active]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      setDisplayed((current) => {
        const target = targetRef.current;
        if (current === target) return current;
        if (!target.startsWith(current)) return target;
        const remaining = target.slice(current.length);
        return current + takeSmoothChunk(remaining);
      });
    }, smoothTextFrameMs);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (active && !pending && displayed === text) onDone?.();
  }, [active, pending, displayed, text, onDone]);

  return (
    <>
      {displayed}
      {active && (pending || displayed !== text) && <span className="smooth-text-cursor" aria-hidden="true" />}
    </>
  );
}

function GenerationStatus({
  label,
  detail,
  tone,
  anchorRole,
}: {
  label: string;
  detail: string;
  tone: "thinking" | "outputting" | "approval";
  anchorRole: string;
}) {
  return (
    <div className={`generation-status ${tone} ${roleClass(anchorRole)}`} role="status" aria-live="polite">
      <span className="generation-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        <strong>{label}</strong>
        {detail && <em>{detail}</em>}
      </span>
    </div>
  );
}

function AttachmentTray({ attachments, onRemove }: { attachments: PendingAttachment[]; onRemove: (id: string) => void }) {
  return (
    <div className="attachment-tray" aria-label="待发送附件">
      {attachments.map((attachment) => (
        <div className="attachment-chip" key={attachment.id}>
          <AttachmentPreview attachment={attachment} />
          <span>
            <strong>{attachment.fileName}</strong>
            <em>{formatFileSize(attachment.size)}</em>
          </span>
          <button onClick={() => onRemove(attachment.id)} aria-label={`移除 ${attachment.fileName}`}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function MessageAttachments({ attachments }: { attachments: PendingAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="message-attachments" aria-label="消息附件">
      {attachments.map((attachment) => (
        <div className="message-attachment" key={`${attachment.path}-${attachment.fileName}`}>
          <AttachmentPreview attachment={attachment} />
          <span>
            <strong>{attachment.fileName}</strong>
            <em>{formatFileSize(attachment.size)}</em>
          </span>
        </div>
      ))}
    </div>
  );
}

function AttachmentPreview({ attachment }: { attachment: PendingAttachment }) {
  if (isImageAttachment(attachment) && attachment.previewUrl) {
    return <img className="attachment-thumb" src={attachment.previewUrl} alt={attachment.fileName} />;
  }
  return (
    <span className="attachment-thumb file">
      {isImageAttachment(attachment) ? <ImageIcon size={18} /> : <Paperclip size={18} />}
    </span>
  );
}

function MessageBubble({
  message,
  smooth,
  smoothPending,
  onSmoothDone,
  onCopy,
}: {
  message: CodexMessage;
  smooth: boolean;
  smoothPending: boolean;
  onSmoothDone: () => void;
  onCopy: () => void;
}) {
  if (isToolMessage(message)) return <ToolMessageBubble message={message} onCopy={onCopy} />;
  const parsed = parseMessageAttachments(message);

  return (
    <article className={`message-bubble ${roleClass(message.role)}`}>
      <header>
        <span>{roleLabel(message.role)}</span>
        <div>
          <time>{formatTime(message.timestamp)}</time>
          <button className="copy-icon" onClick={onCopy} aria-label="复制消息">
            <Copy size={14} />
          </button>
        </div>
      </header>
      {parsed.text && (
        <pre>
          {message.role === "assistant" ? <SmoothText text={parsed.text} active={smooth} pending={smoothPending} onDone={onSmoothDone} /> : parsed.text}
        </pre>
      )}
      <MessageAttachments attachments={parsed.attachments} />
    </article>
  );
}

function ToolMessageBubble({ message, onCopy }: { message: CodexMessage; onCopy: () => void }) {
  const summary = summarizeToolMessage(message);
  const rawText = toolRawText(message);
  const hasRawText = rawText.trim().length > 0;
  return (
    <details className={`tool-message ${summary.failed ? "failed" : ""} ${hasRawText ? "" : "no-raw"}`} open={summary.failed || !hasRawText}>
      <summary>
        <span>
          {summary.failed ? <AlertCircle size={15} /> : <Terminal size={15} />}
          <strong>{summary.title}</strong>
          <em>{summary.action}</em>
        </span>
        <time>{formatTime(message.timestamp)}</time>
      </summary>
      <div className="tool-summary">
        <strong>{summary.action}</strong>
        <span>{summary.detail || "没有可展示的原始输出"}</span>
      </div>
      {hasRawText && <pre>{rawText}</pre>}
      {hasRawText && (
        <button className="copy-mini" onClick={onCopy}>
          <Copy size={14} />
          <span>复制原始输出</span>
        </button>
      )}
    </details>
  );
}

function ApprovalCard({ approval, onRespond }: { approval: LiveApproval; onRespond: (decision: LiveApprovalDecision) => void }) {
  const allowSession = approval.availableDecisions.includes("acceptForSession");
  return (
    <article className={`approval-card ${approval.kind}`}>
      <header>
        <span>
          <AlertCircle size={15} />
          {approval.title}
        </span>
        <em>{formatTime(approval.createdAt)}</em>
      </header>
      <p>{approval.detail}</p>
      {approval.command && <pre>{approval.command}</pre>}
      {approval.cwd && <small>{approval.cwd}</small>}
      <div className="approval-actions">
        {approval.availableDecisions.includes("accept") && (
          <button className="accept" onClick={() => onRespond("accept")}>
            <CheckCircle2 size={14} />
            <span>允许一次</span>
          </button>
        )}
        {allowSession && (
          <button className="accept" onClick={() => onRespond("acceptForSession")}>
            <CheckCircle2 size={14} />
            <span>本会话允许</span>
          </button>
        )}
        {approval.availableDecisions.includes("decline") && (
          <button onClick={() => onRespond("decline")}>
            <X size={14} />
            <span>拒绝</span>
          </button>
        )}
        {approval.availableDecisions.includes("cancel") && (
          <button onClick={() => onRespond("cancel")}>
            <CircleStop size={14} />
            <span>取消</span>
          </button>
        )}
      </div>
    </article>
  );
}

function defaultRuntime(): ThreadRuntime {
  return {
    messages: [],
    draft: "",
    sending: false,
    loading: false,
    status: "",
    loaded: false,
    cursor: 0,
    watchMode: "none",
    watching: false,
    readonlyReason: "",
    activeTurnId: null,
    turnStatus: "idle",
    lastEventCount: 0,
    lastTurnError: "",
    approvals: [],
    smoothMessageId: null,
    attachments: [],
  };
}

function getRuntime(state: Record<string, ThreadRuntime>, key: string): ThreadRuntime {
  if (!key) return defaultRuntime();
  return state[key] ?? defaultRuntime();
}

function savedNumber(key: string, fallback: number, min: number, max: number) {
  const value = Number(localStorage.getItem(key));
  if (!Number.isFinite(value)) return fallback;
  return clamp(value, min, max);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

async function loadThreadList(endpoint: string, token: string): Promise<{ threads: ThreadSummary[] }> {
  try {
    return await apiGet<{ threads: ThreadSummary[] }>(buildUrl(endpoint, "/api/threads?limit=120"), token);
  } catch {
    return await apiGet<{ threads: ThreadSummary[] }>(buildUrl(endpoint, "/api/live/threads?limit=120"), token);
  }
}

async function loadActiveTurns(endpoint: string, token: string): Promise<LiveTurnSnapshot[]> {
  const data = await apiGet<{ turns: LiveTurnSnapshot[] }>(buildUrl(endpoint, "/api/live/turns"), token);
  return data.turns;
}

function threadFromLiveTurn(turn: LiveTurnSnapshot): ThreadSummary | null {
  if (turn.thread) return turn.thread;
  return {
    id: turn.threadId,
    threadName: `手机: ${turnStatusText(turn.status) || "运行中"}`,
    updatedAt: turn.updatedAt,
    cwd: null,
    source: "appServer",
    originator: "Codex app-server",
    rolloutPath: null,
  };
}

function mergeThreads(...groups: ThreadSummary[][]) {
  const seen = new Set<string>();
  const result: ThreadSummary[] = [];
  for (const thread of groups.flat()) {
    if (seen.has(thread.id)) continue;
    seen.add(thread.id);
    result.push(thread);
  }
  return result;
}

async function readThread(endpoint: string, token: string, thread: ThreadSummary): Promise<{ messages: CodexMessage[]; cursor?: number }> {
  if (isDesktopSource(thread)) {
    return await apiGet<{ messages: CodexMessage[]; cursor: number }>(
      buildUrl(
        endpoint,
        `/api/desktop/threads/${encodeURIComponent(thread.id)}?latest=true&maxBytes=${desktopLatestMaxBytes}&maxMessages=${desktopLatestMaxMessages}`,
      ),
      token,
    );
  }
  try {
    return await apiGet<{ messages: CodexMessage[]; cursor?: number }>(buildUrl(endpoint, `/api/live/threads/${encodeURIComponent(thread.id)}`), token);
  } catch {
    return await apiGet<{ messages: CodexMessage[] }>(buildUrl(endpoint, `/api/threads/${encodeURIComponent(thread.id)}`), token);
  }
}

async function apiGet<T>(url: string, token?: string): Promise<T> {
  return requestJson<T>(url, {
    headers: token ? authHeaders(token) : undefined,
    connectTimeout: 8000,
    readTimeout: 60000,
  });
}

async function apiPost<T>(url: string, token: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body,
    connectTimeout: 8000,
    readTimeout: 180000,
  });
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function composeMessageWithAttachments(text: string, attachments: PendingAttachment[]) {
  const body = text.trim();
  if (attachments.length === 0) return body;
  const attachmentBlock = ["已上传附件：", ...attachments.map((attachment) => `- ${attachment.fileName} | ${attachment.path}`)].join("\n");
  return [body, attachmentBlock].filter(Boolean).join("\n\n");
}

function attachmentSummaryText(attachments: PendingAttachment[]) {
  if (attachments.length === 0) return "";
  if (attachments.length === 1) return `已上传 ${attachments[0].fileName}`;
  return `已上传 ${attachments.length} 个附件`;
}

function parseMessageAttachments(message: CodexMessage) {
  const parsed: PendingAttachment[] = [];
  let text = message.text;
  const modernBlock = text.match(/(?:^|\n)已上传附件：\n((?:- .+(?:\n|$))+)\s*$/);
  if (modernBlock) {
    text = text.slice(0, modernBlock.index ?? 0).trim();
    for (const line of modernBlock[1].split(/\r?\n/)) {
      const attachment = attachmentFromModernLine(line);
      if (attachment) parsed.push(attachment);
    }
  }

  const remainingLines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const legacyPath = line.match(/^\s*已上传文件：(.+?)\s*$/)?.[1];
    if (legacyPath) {
      parsed.push(attachmentFromPath(legacyPath));
      continue;
    }
    remainingLines.push(line);
  }

  return {
    text: remainingLines.join("\n").trim(),
    attachments: mergeAttachments(parsed, message.attachments ?? []),
  };
}

function attachmentFromModernLine(line: string): PendingAttachment | null {
  const body = line.replace(/^\s*-\s*/, "").trim();
  if (!body) return null;
  const separator = body.lastIndexOf(" | ");
  if (separator < 0) return attachmentFromPath(body);
  const fileName = body.slice(0, separator).trim();
  const path = body.slice(separator + 3).trim();
  return attachmentFromPath(path, fileName);
}

function attachmentFromPath(path: string, fileName?: string): PendingAttachment {
  const cleanPath = path.replace(/^["'`]+|["'`]+$/g, "").trim();
  const resolvedName = fileName?.trim() || cleanPath.split(/[\\/]+/).filter(Boolean).pop() || "附件";
  return {
    id: `parsed-${cleanPath}-${resolvedName}`,
    fileName: resolvedName,
    path: cleanPath,
    relativePath: "",
    size: 0,
    createdAt: "",
    mimeType: mimeTypeFromName(resolvedName),
    previewUrl: null,
  };
}

function mergeAttachments(parsed: PendingAttachment[], provided: PendingAttachment[]) {
  const byKey = new Map<string, PendingAttachment>();
  for (const attachment of [...parsed, ...provided]) {
    byKey.set(`${attachment.path}:${attachment.fileName}`, attachment);
  }
  return Array.from(byKey.values());
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || isImageName(file.name);
}

function isImageAttachment(attachment: PendingAttachment) {
  return attachment.mimeType.startsWith("image/") || isImageName(attachment.fileName) || isImageName(attachment.path);
}

function isImageName(value: string) {
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i.test(value);
}

function mimeTypeFromName(value: string) {
  if (/\.png$/i.test(value)) return "image/png";
  if (/\.jpe?g$/i.test(value)) return "image/jpeg";
  if (/\.gif$/i.test(value)) return "image/gif";
  if (/\.webp$/i.test(value)) return "image/webp";
  if (/\.heic$/i.test(value)) return "image/heic";
  if (/\.heif$/i.test(value)) return "image/heif";
  if (/\.avif$/i.test(value)) return "image/avif";
  return "application/octet-stream";
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "已上传";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 100 * 1024 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function revokeAttachmentPreviews(attachments: PendingAttachment[]) {
  for (const attachment of attachments) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }
}

async function requestJson<T>(url: string, options: RequestJsonOptions = {}): Promise<T> {
  const normalizedUrl = normalizeUrl(url);
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({
      url: normalizedUrl,
      method: options.method ?? "GET",
      headers: options.headers,
      data: options.body,
      connectTimeout: options.connectTimeout,
      readTimeout: options.readTimeout,
      responseType: "json",
    });
    ensureHttpOk(response.status);
    return parseJsonData<T>(response.data);
  }

  const response = await fetch(normalizedUrl, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  ensureHttpOk(response.status);
  return (await response.json()) as T;
}

function parseJsonData<T>(data: unknown): T {
  if (typeof data === "string") {
    return JSON.parse(data) as T;
  }
  return data as T;
}

function ensureHttpOk(status: number) {
  if (status >= 200 && status < 300) return;
  throw new Error(status === 401 ? "HTTP 401 token 不正确" : `HTTP ${status}`);
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

function buildUrl(endpoint: string, path: string) {
  return `${normalizeEndpoint(endpoint)}${path}`;
}

function normalizeEndpoint(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function normalizeUrl(value: string) {
  return value.trim();
}

function saveConnectionSettings(endpoint: string, token: string) {
  localStorage.setItem("relayEndpoint", normalizeEndpoint(endpoint));
  localStorage.setItem("relayToken", token);
}

function loadConnectionProfiles(): ConnectionProfile[] {
  const raw = localStorage.getItem("connectionProfiles");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ConnectionProfile[];
      const valid = parsed.filter((profile) => profile.id && profile.endpoint);
      if (valid.length > 0) return valid;
    } catch {
      // Fall through to legacy single-profile storage.
    }
  }
  return [
    {
      id: "default",
      name: "本机 Relay",
      endpoint: normalizeEndpoint(localStorage.getItem("relayEndpoint") ?? "http://127.0.0.1:8787"),
      token: localStorage.getItem("relayToken") ?? "",
      updatedAt: new Date().toISOString(),
    },
  ];
}

function saveConnectionProfiles(profiles: ConnectionProfile[], activeProfileId: string) {
  localStorage.setItem("connectionProfiles", JSON.stringify(profiles));
  localStorage.setItem("activeConnectionProfileId", activeProfileId);
}

function upsertConnectionProfile(profiles: ConnectionProfile[], profile: ConnectionProfile) {
  const next = profiles.filter((item) => item.id !== profile.id);
  return [profile, ...next].slice(0, 12);
}

function profileNameFromEndpoint(endpoint: string) {
  try {
    const url = new URL(normalizeEndpoint(endpoint));
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return "本机 Relay";
    return `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return "Relay";
  }
}

function openHealthUrl(endpoint: string) {
  window.open(buildUrl(endpoint, "/health"), "_blank", "noopener,noreferrer");
}

function makeDiagnosticText(startedAt: string, endpoint: string, steps: DiagnosticStep[]) {
  return [
    `time=${startedAt}`,
    `endpoint=${normalizeEndpoint(endpoint)}`,
    ...steps.map((step) => `${step.ok ? "OK" : "FAIL"} ${step.name}: ${step.detail}`),
  ].join("\n");
}

function shortPath(value: string) {
  if (value.length <= 44) return value;
  return `...${value.slice(-41)}`;
}

function cleanTitle(value: string) {
  const title = value.replace(/\s+/g, " ").trim();
  return title || "Untitled";
}

function threadListDetail(thread: ThreadSummary) {
  const detail = pathTail(thread.cwd) || cleanThreadOriginator(thread.originator);
  return isUsefulThreadDetail(detail) ? detail : "";
}

function groupThreadsByProject(threads: ThreadSummary[]) {
  const groups = new Map<string, { key: string; label: string; threads: ThreadSummary[] }>();
  for (const thread of threads) {
    const key = projectGroupKey(thread.cwd);
    const group = groups.get(key) ?? { key, label: projectGroupLabel(thread.cwd), threads: [] };
    group.threads.push(thread);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function projectGroupKey(cwd: string | null | undefined) {
  const normalized = normalizePathText(cwd);
  return normalized || "__uncategorized__";
}

function projectGroupLabel(cwd: string | null | undefined) {
  const normalized = normalizePathText(cwd);
  if (!normalized) return "未分类项目";
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || normalized;
}

function cleanThreadOriginator(value: string | null | undefined) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (/^codex\s+desktop$/i.test(text)) return "";
  return isUsefulThreadDetail(text) ? text : "";
}

function firstLine(value: string) {
  return value.split(/\r?\n/).find(Boolean)?.trim().slice(0, 80) ?? "";
}

function pathTail(value: string | null | undefined) {
  const normalized = normalizePathText(value);
  if (!isUsefulThreadDetail(normalized) || normalized === "." || normalized === "~") return "";
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  const tail = parts.slice(-2).join("\\");
  return isUsefulThreadDetail(tail) ? tail : "";
}

function normalizePathText(value: string | null | undefined) {
  return String(value || "").replace(/^["'`]+|["'`]+$/g, "").trim();
}

function loadThreadRuntimeCache(): Record<string, ThreadRuntime> {
  try {
    const parsed = JSON.parse(localStorage.getItem(threadRuntimeCacheKey) ?? "{}") as Record<string, { messages?: CodexMessage[]; cursor?: number }>;
    const result: Record<string, ThreadRuntime> = {};
    for (const [threadId, item] of Object.entries(parsed)) {
      const messages = Array.isArray(item.messages) ? item.messages.slice(-cachedMessagesPerThread) : [];
      if (messages.length === 0) continue;
      result[threadId] = {
        ...defaultRuntime(),
        messages,
        loaded: true,
        cursor: Number.isFinite(item.cursor) ? Number(item.cursor) : 0,
        status: `已载入最近 ${messages.length} 条缓存`,
      };
    }
    return result;
  } catch {
    return {};
  }
}

function saveThreadRuntimeCache(state: Record<string, ThreadRuntime>) {
  try {
    const entries = Object.entries(state)
      .filter(([, runtime]) => runtime.messages.length > 0)
      .sort(([, left], [, right]) => Date.parse(right.messages.at(-1)?.timestamp ?? "") - Date.parse(left.messages.at(-1)?.timestamp ?? ""))
      .slice(0, cachedThreadLimit);
    const payload = Object.fromEntries(
      entries.map(([threadId, runtime]) => [
        threadId,
        {
          cursor: runtime.cursor,
          messages: runtime.messages.slice(-cachedMessagesPerThread),
        },
      ]),
    );
    localStorage.setItem(threadRuntimeCacheKey, JSON.stringify(payload));
  } catch {
    // Cache is a best-effort mobile UX layer.
  }
}

function isUsefulThreadDetail(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return false;
  return text.replace(/[`'".,，。·•_\-\s\\/]/g, "").length > 1;
}

function formatDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

function formatTime(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function isToolMessage(message: CodexMessage) {
  return message.role === "tool" || (message.role !== "user" && message.role !== "assistant" && isToolKind(message.kind));
}

function isToolKind(kind: string) {
  return /tool|command|exec|function|mcp|filechange|patch|plan|task|approval|shell|terminal|output/i.test(kind);
}

function summarizeToolMessage(message: CodexMessage) {
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

function toolRawText(message: CodexMessage) {
  const text = message.text.trim();
  if (!text) return "";
  if (isEmptySuccessfulToolOutput(message)) return "";
  if (isThinToolText(text)) return "";
  return text;
}

function isThinToolText(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return true;
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return true;
  return lines.every((line) => /^Tool:\s*[\w@./:-]+$/i.test(line) || /^Codex turn started$/i.test(line));
}

function toolAction(text: string, source: string) {
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

function toolActionFromMeta(meta: ToolMessageMeta, source: string) {
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

function commandAction(command: string) {
  return toolAction(command, "commandExecution");
}

function toolDetail(text: string) {
  const command = text.match(/^Command:\s*(.+)$/im)?.[1];
  const tool = text.match(/^Tool:\s*(.+)$/im)?.[1];
  const workdir = text.match(/^Workdir:\s*(.+)$/im)?.[1];
  return [tool && `工具 ${clip(tool, 32)}`, command && clip(command, 80), workdir && pathTail(workdir)].filter(Boolean).join(" · ");
}

type ToolMessageMeta = {
  text: string;
  tool: string;
  command: string;
  workdir: string;
  args: Record<string, unknown> | null;
  output: string;
  emptyOutput: boolean;
};

function parseToolMessageMeta(message: CodexMessage): ToolMessageMeta {
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

function parseToolArgs(text: string): Record<string, unknown> | null {
  const withoutToolLine = text.replace(/^Tool:\s*.+$/im, "").trim();
  if (!withoutToolLine.startsWith("{")) return null;
  return parseJsonRecord(withoutToolLine);
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringArg(args: Record<string, unknown> | null, key: string) {
  const value = args?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function toolTitle(tool: string, kind: string) {
  if (tool === "exec_command" || /command|exec|shell|terminal/i.test(kind)) return "运行命令";
  if (tool === "write_stdin") return "继续命令";
  if (tool === "apply_patch" || /filechange|patch/i.test(kind)) return "修改文件";
  if (/approval/i.test(kind)) return "权限请求";
  return "工具调用";
}

function friendlyToolName(tool: string) {
  const labels: Record<string, string> = {
    exec_command: "运行命令",
    write_stdin: "继续运行中的命令",
    apply_patch: "修改文件",
    "multi_tool_use.parallel": "并行调用工具",
  };
  return labels[tool] ?? `调用 ${clip(tool, 42)}`;
}

function toolDetailFromMeta(meta: ToolMessageMeta) {
  const details = [
    meta.tool && `工具 ${clip(meta.tool, 36)}`,
    meta.command && clip(shellSnippet(meta.command), 90),
    meta.workdir && pathTail(meta.workdir),
    sessionDetail(meta.args),
    parallelDetail(meta.args),
  ];
  return details.filter(Boolean).join(" · ");
}

function sessionDetail(args: Record<string, unknown> | null) {
  const sessionId = args?.session_id;
  return typeof sessionId === "number" || typeof sessionId === "string" ? `会话 ${sessionId}` : "";
}

function parallelDetail(args: Record<string, unknown> | null) {
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

function firstMeaningfulLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^Tool:|^Command:|^Workdir:/i.test(line)) ?? "";
}

function firstMeaningfulToolOutputLine(value: string) {
  return toolOutputBody(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function toolOutputBody(value: string) {
  const match = String(value || "").match(/(?:^|\n)Output:\n?([\s\S]*)$/);
  return match ? match[1].trim() : "";
}

function isToolOutputKind(kind: string) {
  return /output|result/i.test(kind);
}

function isToolFailed(text: string) {
  const value = String(text || "");
  return (
    /(?:process exited with code|exit code)\s+[1-9]\d*/i.test(value) ||
    /(?:^|\n)\s*(?:error|failed|failure|exception|traceback)\b[:\s]/i.test(value) ||
    /status[=:]\s*(failed|error)/i.test(value)
  );
}

function isEmptySuccessfulToolOutput(message: CodexMessage) {
  return isToolOutputKind(message.kind) && toolOutputBody(message.text).length === 0 && !isToolFailed(message.text);
}

function shellSnippet(value: string) {
  const raw = String(value || "").trim();
  const command = raw.match(/^Command:\s*([\s\S]+)/im)?.[1]?.trim();
  const match = (command || raw).match(/-lc\s+["']([\s\S]*)["']\s*$/);
  return (match ? match[1] : command || raw).replace(/\\n/g, " ").replace(/\\(["'])/g, "$1");
}

function pathName(value: string) {
  const match = String(value || "").match(
    /(?:^|\s)(?:["'])?((?:\.{0,2}\/|~\/|\/)[^\s"'|;&)]+|[\w.-]+\.(?:mjs|js|ts|tsx|json|md|css|html|sh|py|swift|toml|ya?ml))(?:["'])?/,
  );
  if (!match) return "";
  return match[1].replace(/\/+$|["']/g, "").split("/").filter(Boolean).pop() || "";
}

function clip(text: string, max = 110) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1).trimEnd()}...` : normalized;
}

function takeSmoothChunk(buffer: string) {
  const length = buffer.length;
  const base = length > 5000 ? 18 : length > 2600 ? 14 : length > 1200 ? 10 : length > 520 ? 7 : length > 180 ? 4 : 2;
  let end = Math.min(length, base);
  while (end < length && end < base + 4 && /[\s，。！？、；：,.!?;:]/.test(buffer[end])) end += 1;
  return buffer.slice(0, end);
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    user: "你",
    assistant: "Codex",
    developer: "规则",
    system: "系统",
    tool: "工具",
  };
  return labels[role] ?? role;
}

function roleClass(role: string) {
  if (role === "user") return "from-user";
  if (role === "assistant") return "from-assistant";
  return "from-system";
}

function sourceLabel(source: string | null | undefined) {
  if (source === "vscode") return "桌面";
  if (source === "appServer") return "手机";
  if (source === "cli") return "CLI";
  if (source === "exec") return "Exec";
  return "未知";
}

function sourceClass(source: string | null | undefined) {
  if (source === "vscode") return "desktop";
  if (source === "appServer") return "mobile";
  if (source === "cli" || source === "exec") return "cli";
  return "unknown";
}

function isDesktopSource(thread: ThreadSummary | null | undefined) {
  return thread?.source === "vscode" || thread?.originator?.toLowerCase().includes("desktop") === true;
}

function shouldFallbackToRelay(error: unknown) {
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

function messagesForRender(messages: CodexMessage[]) {
  return collapseMirroredMessages(
    messages.flatMap((message) => {
      if (!isTextConversationMessage(message) || isEmptyChatMessage(message) || isGeneratedContextMessage(message)) return [];
      if (message.role !== "assistant") return [message];
      const text = stripCodexAppDirectives(message.text);
      return text ? [{ ...message, text }] : [];
    }),
  );
}

function isTextConversationMessage(message: CodexMessage) {
  return (message.role === "user" || message.role === "assistant") && !isToolMessage(message);
}

function isEmptyChatMessage(message: CodexMessage) {
  return !isToolMessage(message) && message.text.trim().length === 0;
}

function isGeneratedContextMessage(message: CodexMessage) {
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

function isEmptyToolMessage(message: CodexMessage) {
  if (!isToolMessage(message)) return false;
  if (message.kind === "task_started") return false;
  if (isEmptySuccessfulToolOutput(message)) return true;
  return message.text.trim().length === 0;
}

function latestAssistantFromMessages(messages: CodexMessage[]) {
  return [...messages].reverse().find((message) => message.role === "assistant" && message.text.trim().length > 0) ?? null;
}

function hasAssistantOutputAfterLatestUser(messages: CodexMessage[]) {
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

function latestAssistantIdFromMessages(messages: CodexMessage[]) {
  return latestAssistantFromMessages(messages)?.id ?? null;
}

function nextSmoothMessageId(runtime: ThreadRuntime, messages: CodexMessage[]) {
  const latest = latestAssistantFromMessages(messages);
  if (!latest) return runtime.smoothMessageId;
  if (runtime.smoothMessageId === latest.id) return latest.id;
  const previous = runtime.messages.find((message) => message.id === latest.id);
  return !previous || previous.text !== latest.text ? latest.id : runtime.smoothMessageId;
}

function turnInlineIndicator(
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
    return target ? { messageId: target.id, label: "等待审批", detail: "确认后继续执行", tone: "approval" } : null;
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
  return target
    ? {
        messageId: target.id,
        label: "正在思考",
        detail: options.desktop ? "等待桌面响应" : "等待 Codex 回复",
        tone: "thinking",
      }
    : null;
}

function isRuntimeTurnActive(runtime: ThreadRuntime) {
  if (runtime.lastTurnError) return false;
  if (runtime.turnStatus === "starting" || runtime.turnStatus === "inProgress") return true;
  if (runtime.turnStatus === "completed" || runtime.turnStatus === "interrupted" || runtime.turnStatus === "failed") return false;
  return runtime.sending;
}

function mergeMessages(current: CodexMessage[], incoming: CodexMessage[]) {
  return reconcileMessages(current, incoming);
}

function mergeMessagesById(current: CodexMessage[], incoming: CodexMessage[]) {
  return reconcileMessages(current, incoming);
}

function capMessages(messages: CodexMessage[]) {
  if (messages.length <= maxMessagesPerThread) return messages;
  return messages.slice(-maxMessagesPerThread);
}

function canUseEventSource() {
  return typeof EventSource !== "undefined";
}

function turnStatusText(status: LiveTurnStatus | "idle") {
  if (status === "starting") return "Codex 启动中";
  if (status === "inProgress") return "Codex 正在处理";
  if (status === "completed") return "Codex 已完成";
  if (status === "interrupted") return "Codex 已打断";
  if (status === "failed") return "Codex 运行失败";
  return "";
}

function activeTurnActivity(
  runtime: ThreadRuntime,
  options: { desktop: boolean; hasAssistantOutput: boolean; pendingApproval: boolean },
) {
  if (options.pendingApproval) return { label: "等待审批", detail: "确认后继续执行" };
  if (runtime.turnStatus === "starting") {
    return { label: "正在思考", detail: options.desktop ? "等待桌面响应" : "等待 Codex 回复" };
  }
  if (options.hasAssistantOutput) {
    return { label: "正在输出", detail: options.desktop || runtime.watchMode === "desktop-tail" ? "同步桌面输出" : "实时接收输出" };
  }
  return { label: "正在思考", detail: options.desktop || runtime.watchMode === "desktop-tail" ? "等待桌面响应" : "等待 Codex 回复" };
}

function connectionBadge(connectionState: "idle" | "testing" | "ok" | "error", detail: string) {
  if (connectionState === "testing") return "检测中";
  if (connectionState === "error") return "连接异常";
  if (/不可用|失败|断开|错误|timeout|timed out/i.test(detail)) return "需检查";
  if (connectionState === "ok" || /已连接|可用/i.test(detail)) return "已连接";
  return "未检测";
}

function desktopActionText(action: DesktopControlResponse["action"]) {
  if (action === "ui-submit") return "已提交到电脑 Codex";
  if (action === "steer-turn") return "已向桌面 Codex 发送引导";
  if (action === "interrupt-turn") return "已向桌面 Codex 发送打断";
  return "已在桌面 Codex 启动 turn";
}

function approvalDecisionText(decision: LiveApprovalDecision) {
  if (decision === "accept") return "已允许一次";
  if (decision === "acceptForSession") return "已允许本会话";
  if (decision === "decline") return "已拒绝审批";
  return "已取消审批";
}

function isNearBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 96;
}

function scrollMessagesToBottom(smooth: boolean) {
  window.requestAnimationFrame(() => {
    const viewport = document.querySelector<HTMLDivElement>(".messages-viewport");
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  });
}

function applyTheme(theme: ThemeMode) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function toFriendlyFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "Failed to fetch" || message.includes("ConnectException") || message.includes("ECONNREFUSED")) {
    return "连接失败：确认电脑 Relay 正在运行，手机和电脑同一网络，防火墙放行 8787";
  }
  if (message.includes("timeout") || message.includes("Timed out")) {
    return "连接超时：Relay 或 Codex app-server 响应太慢，请重试";
  }
  return message;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
