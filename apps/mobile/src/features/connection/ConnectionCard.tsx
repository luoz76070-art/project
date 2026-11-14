import { useEffect, useRef, useState } from "react";
import { apiGet, buildUrl } from "./http";
import { connectionCardState, connectionCardTitles, friendlyComputerName } from "./connectionStatus";

/** U12: the first thing in settings — is this phone connected, to which computer, how fast. */
export function ConnectionCard({ endpoint, token, connectionState, open }: { endpoint: string; token: string; connectionState: string; open: boolean }) {
  const [latency, setLatency] = useState<number | null>(null), [checking, setChecking] = useState(false), [failed, setFailed] = useState(false);
  const run = useRef(0);
  async function measure() {
    if (!endpoint || !token) return;
    const current = ++run.current; setChecking(true);
    const started = performance.now();
    try { await apiGet(buildUrl(endpoint, "/api/connection"), token); if (current === run.current) { setLatency(Math.round(performance.now() - started)); setFailed(false); } }
    catch { if (current === run.current) { setFailed(true); setLatency(null); } }
    finally { if (current === run.current) setChecking(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) void measure(); }, [open, endpoint, token]);
  const state = connectionCardState({ endpoint, token, checking, failed, latency, connectionState });
  const parts = [friendlyComputerName(endpoint), state === "ok" && latency !== null ? `延迟 ${latency} ms` : ""].filter(Boolean);
  const detail = parts.join(" · ");
  return <section className={`settings-section connection-card ${state}`} aria-label="连接状态">
    <span className="connection-card-dot" aria-hidden="true" />
    <div className="connection-card-text"><strong>{connectionCardTitles[state]}</strong>
      <p className="setting-description">{state === "none" ? "在下面粘贴电脑上的配对码" : state === "error" ? `${detail || "电脑"} 暂时连不上，检查电脑是否开着、网关是否在运行。` : parts.flatMap((part, index) => [...(index ? [" · "] : []), <span key={part}>{part}</span>])}</p></div>
    {state !== "none" && <button type="button" className="action-button" disabled={checking} onClick={() => void measure()}>{checking ? "检测中…" : "重新检测"}</button>}
  </section>;
}
