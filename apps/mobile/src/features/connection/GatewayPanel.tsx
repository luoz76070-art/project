import { useEffect, useRef, useState } from "react";
import { apiGet, buildUrl, toFriendlyFetchError } from "./http";

type Capabilities = { gateway: string; agents: string[] };
type GatewayInfo = { gateway: { kind: string; desktopTransport: string; tunnel: { enabled: boolean; state: string } } };
type AgentsInfo = { agents: { label: string; state: string }[] };
const tunnelLabels: Record<string, string> = { connecting: "正在连接", connected: "已连接", reconnecting: "正在重连", stopped: "已停止" };
const agentLabels: Record<string, string> = { unprobed: "尚未探测", probing: "正在探测", connected: "已连接", failed: "连接失败" };

export function GatewayPanel({ endpoint, token }: { endpoint: string; token: string }) {
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Capabilities | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    request.current?.abort(); setResult(null); setError(""); setBusy(false);
    return () => request.current?.abort();
  }, [endpoint, token]);

  async function inspect() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setResult(null);
    try {
      const [gateway, agents] = await Promise.allSettled([
        apiGet<GatewayInfo>(buildUrl(endpoint, "/api/gateway"), token, controller.signal),
        apiGet<AgentsInfo>(buildUrl(endpoint, "/api/agents"), token, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      const legacy = gateway.status === "rejected" && gateway.reason?.status === 404;
      if (gateway.status === "rejected" && !legacy) throw gateway.reason;
      const legacyAgents = agents.status === "rejected" && agents.reason?.status === 404;
      if (agents.status === "rejected" && !legacyAgents) throw agents.reason;
      let gatewayText = "当前使用旧版 Relay，未提供网关管理状态。";
      if (gateway.status === "fulfilled") {
        const data = gateway.value.gateway;
        if (data?.kind !== "mobile-codex-gateway" || !data.tunnel || data.desktopTransport !== "native") throw new Error("无法识别网关状态，请更新电脑端");
        gatewayText = `输入方式：原生连接；公网隧道：${data.tunnel.enabled ? tunnelLabels[data.tunnel.state] ?? "状态未知" : "未配置"}。原会话控制仍待实测，具体操作以会话内按钮为准。`;
      }
      const list = agents.status === "fulfilled" ? agents.value.agents : [];
      if (!Array.isArray(list)) throw new Error("无法识别电脑端能力信息");
      setResult({ gateway: gatewayText, agents: list.map(agent => `${agent.label}：${agentLabels[agent.state] ?? "状态未知"}`) });
    } catch (caught) { if (!controller.signal.aborted) setError(toFriendlyFetchError(caught)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <details className="settings-disclosure gateway-capabilities">
    <summary>连接能力</summary>
    <p className="setting-description">查看电脑端模式与服务接入状态。仅查看现有状态，不发起探测或运行任务。</p>
    <button className="action-button" disabled={busy || !endpoint || !token} onClick={() => void inspect()}>{busy ? "正在读取…" : "查看连接能力"}</button>
    {error && <p className="setting-description" role="status">{error}</p>}
    {result && <div role="status"><p className="setting-description">{result.gateway}</p>{result.agents.map((line, index) => <p className="setting-description" key={index}>{line}</p>)}<p className="setting-description">服务接入状态不代表已获得当前会话的控制权限。</p></div>}
  </details>;
}
