
export type ThreadSummary = {
  id: string;
  threadName: string;
  updatedAt: string;
  cwd: string | null;
  source: string | null;
  originator: string | null;
  rolloutPath?: string | null;
};

export type CodexMessage = {
  id: string;
  timestamp: string;
  role: string;
  text: string;
  kind: string;
  attachments?: PendingAttachment[];
};

export type DiagnosticStep = {
  name: string;
  ok: boolean;
  detail: string;
};

export type RequestJsonOptions = {
  method?: "GET" | "POST" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  connectTimeout?: number;
  readTimeout?: number;
  signal?: AbortSignal;
};

export type RelayStatus = {
  ok: boolean;
  mode: string;
  codexHome: string;
  defaultCwd: string;
  uploadDir: string;
  codexExecutable?: string | { executable: string | null; source: string; searched: string[] };
  live?: { ok: boolean; mode: string; threadCount?: number; error?: string };
  desktopControl?: { ok: boolean; mode: string; error?: string };
  activeDesktopThread?: ThreadSummary | null;
};

export type DesktopActiveResponse = {
  thread: ThreadSummary | null;
  mode: string;
  source?: "ipc-stream" | "session-index";
  streamThreadIds?: string[];
};

export type UploadResponse = {
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

export type PendingAttachment = {
  id: string;
  fileName: string;
  path: string;
  relativePath: string;
  size: number;
  createdAt: string;
  mimeType: string;
  previewUrl: string | null;
};

export type ThemeMode = "system" | "light" | "dark";

export type SplitMode = "auto" | "left" | "top" | "drawer";

export type ApprovalPolicy = "never" | "on-request";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type ThreadRuntime = {
  messages: CodexMessage[];
  draft: string;
  sending: boolean;
  loading: boolean;
  status: string;
  loaded: boolean;
  cursor: number;
  generation?: string;
  historyBefore?: number;
  loadingHistory?: boolean;
  historyBrowsing?: boolean;
  scrollTop?: number;
  pendingMessageId?: string;
  pendingMessageText?: string;
  watchMode: "none" | "desktop-tail";
  watching: boolean;
  readonlyReason: string;
  activeTurnId: string | null;
  turnStatus: "idle" | "starting" | "inProgress" | "completed" | "interrupted" | "failed";
  activity?: "thinking" | "working" | "outputting";
  lastEventCount: number;
  lastTurnError: string;
  approvals: LiveApproval[];
  smoothMessageId: string | null;
  attachments: PendingAttachment[];
};

export type SendRoute = "desktop" | "relay";

export type LiveTurnStatus = "starting" | "inProgress" | "completed" | "interrupted" | "failed";

export type LiveApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type LiveApproval = {
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

export type LiveTurnSnapshot = {
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

export type DesktopStreamSnapshot = {
  threadId: string;
  status: LiveTurnStatus;
  messages: CodexMessage[];
  messageCount: number;
  eventCount: number;
  updatedAt: string;
  changeType: string | null;
  source: "desktop-ipc";
};

export type DesktopControlResponse = {
  ok: boolean;
  mode: "desktop-ipc-follower-control" | "macos-ui-injector-control";
  action: "start-turn" | "steer-turn" | "interrupt-turn" | "ui-submit";
  thread: ThreadSummary | null;
  warning?: string;
  error?: string;
};

export type LoadThreadsOptions = {
  selectLatest?: boolean;
  append?: boolean;
  search?: string;
};

export type ConnectionProfile = {
  cacheNamespace?: string;
  id: string;
  name: string;
  endpoint: string;
  token: string;
  updatedAt: string;
};

export type AndroidUpdateManifest = {
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

export type HotUpdateManifest = {
  platform: "android";
  channel: "hot";
  version: string;
  htmlUrl: string;
  sha256: string;
  minNativeVersionCode: number;
  maxNativeVersionCode?: number;
  notes?: string;
  publishedAt?: string;
};

export type HotUpdateStatus = {
  supported: boolean;
  activeVersion: string;
  pendingVersion: string;
  previousVersion: string;
  nativeVersionCode: number;
};

export type UpdateState = {
  checking: boolean;
  manifest: AndroidUpdateManifest | null;
  available: boolean;
  error: string;
  lastCheckedAt: string;
};

export type HotUpdateState = {
  checking: boolean;
  installing: boolean;
  manifest: HotUpdateManifest | null;
  status: HotUpdateStatus | null;
  available: boolean;
  error: string;
};

export type ClipboardPlugin = {
  write(options: { string: string }): Promise<void>;
};

export type HotUpdatePlugin = {
  getStatus(): Promise<HotUpdateStatus>;
  install(options: {
    url: string;
    sha256: string;
    version: string;
    minNativeVersionCode: number;
    maxNativeVersionCode: number;
  }): Promise<{ version: string; path: string; reloading: boolean }>;
  markReady(): Promise<void>;
  rollback(): Promise<{ activeVersion: string; reloading: boolean }>;
  clear(): Promise<void>;
};

export type ToolMessageMeta = {
  text: string;
  tool: string;
  command: string;
  workdir: string;
  args: Record<string, unknown> | null;
  output: string;
  emptyOutput: boolean;
};
