export type SubscriptionState = "connecting" | "online" | "recovering" | "paused" | "unauthorized";

/** One owner for token refresh, transport loss, heartbeat and foreground recovery. */
export function subscribeEvents(options: {
  getToken: (signal: AbortSignal) => Promise<{ streamToken: string | null }>;
  url: (token: string) => string;
  events: Record<string, (data: unknown) => void>;
  onState: (state: SubscriptionState) => void;
  retryBaseMs?: number;
  heartbeatMs?: number;
}) {
  let disposed = false;
  let unauthorized = false;
  let attempt = 0;
  let generation = 0;
  let source: EventSource | null = null;
  let request: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    ++generation;
    clearTimeout(retry);
    clearTimeout(heartbeat);
    source?.close();
    source = null;
    request?.abort();
    request = null;
  };
  const failed = () => {
    close();
    if (disposed || unauthorized || document.hidden) return;
    options.onState("recovering");
    const budget = Math.min(15000, (options.retryBaseMs ?? 500) * 2 ** Math.min(attempt++, 6));
    retry = setTimeout(() => void connect(), budget * (0.5 + Math.random() * 0.5));
  };
  const touch = () => {
    clearTimeout(heartbeat);
    heartbeat = setTimeout(failed, options.heartbeatMs ?? 45000);
  };
  const connect = async () => {
    close();
    if (disposed || unauthorized) return;
    if (document.hidden) { options.onState("paused"); return; }
    const current = generation;
    const controller = new AbortController();
    request = controller;
    options.onState(attempt ? "recovering" : "connecting");
    // Token requests and an EventSource handshake also have a deadline.
    touch();
    try {
      const response = await options.getToken(controller.signal);
      if (disposed || current !== generation || controller.signal.aborted) return;
      if (!response.streamToken) throw new Error("stream token unavailable");
      const stream = new EventSource(options.url(response.streamToken));
      source = stream;
      stream.onopen = () => {
        if (disposed || current !== generation) return;
        attempt = 0;
        touch();
        options.onState("online");
      };
      stream.addEventListener("ping", touch);
      for (const [event, apply] of Object.entries(options.events)) {
        stream.addEventListener(event, (message) => {
          if (disposed || current !== generation) return;
          touch();
          try { apply(JSON.parse((message as MessageEvent).data)); } catch { failed(); }
        });
      }
      stream.onerror = () => { if (current === generation && !disposed) failed(); };
    } catch (error) {
      if (disposed || current !== generation || controller.signal.aborted) return;
      const status = (error as { status?: number })?.status;
      if (status === 401 || status === 403) {
        close(); unauthorized = true; options.onState("unauthorized");
      } else failed();
    }
  };
  const visible = () => {
    if (document.hidden) { close(); options.onState("paused"); }
    else if (!source && !request) void connect();
  };
  const online = () => { if (!document.hidden && !source) void connect(); };
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("online", online);
  window.addEventListener("focus", visible);
  void connect();
  return () => {
    disposed = true;
    close();
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("online", online);
    window.removeEventListener("focus", visible);
  };
}
