import { useState } from "react";
import { apiGet, apiPost, assertSecureEndpoint, authHeaders, buildUrl, normalizeEndpoint, requestJson, toFriendlyFetchError } from "./http";

type Device = { id: string; name: string; createdAt: string };

export function PairingPanel({ endpoint, token, onPaired }: { endpoint: string; token: string; onPaired: (endpoint: string, token: string) => Promise<void> }) {
  const [pairingText, setPairingText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [admin, setAdmin] = useState(false);

  async function pair() {
    setBusy(true);
    setStatus("正在配对…");
    try {
      const input = pairingText.trim();
      const payload = input.startsWith("{") ? JSON.parse(input) as { endpoint?: string; code?: string } : { code: input };
      const target = normalizeEndpoint(payload.endpoint ?? endpoint);
      assertSecureEndpoint(target);
      if (typeof payload.code !== "string" || !payload.code.trim()) throw new Error("请粘贴电脑 Relay 的配对信息");
      const result = await apiPost<{ token: string }>(buildUrl(target, "/api/pairing/consume"), "", { code: payload.code, name: "手机" });
      if (!result.token) throw new Error("配对响应缺少设备凭证");
      await onPaired(target, result.token);
      setPairingText("");
      setStatus("已配对，凭证已保存");
    } catch (error) { setStatus(toFriendlyFetchError(error)); }
    finally { setBusy(false); }
  }

  async function loadDevices() {
    setBusy(true);
    try {
      const data = await apiGet<{ devices: Device[]; admin: boolean }>(buildUrl(endpoint, "/api/devices"), token);
      setDevices(data.devices);
      setAdmin(data.admin);
      setStatus(data.admin ? "可撤销已配对设备" : "当前设备凭证");
    } catch (error) { setStatus(toFriendlyFetchError(error)); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await requestJson(buildUrl(endpoint, `/api/devices/${encodeURIComponent(id)}`), { method: "DELETE", headers: authHeaders(token) });
      setDevices(current => current.filter(device => device.id !== id));
      setStatus(admin ? "已撤销设备，连接已关闭" : "当前设备已撤销，请重新配对");
    } catch (error) { setStatus(toFriendlyFetchError(error)); }
    finally { setBusy(false); }
  }

  return <section className="settings-section pairing-section">
    <h3>连接电脑</h3>
    <p className="setting-description">在电脑 Relay 中点击 Pair phone，将配对信息粘贴到这里。配对信息 5 分钟内有效，仅可使用一次。</p>
    <label className="pairing-input"><span>配对信息</span><textarea aria-label="配对信息" value={pairingText} maxLength={4096} placeholder="粘贴电脑配对信息或一次性配对码" onChange={event => setPairingText(event.target.value)} /></label>
    <div className="settings-actions">
      <button className="action-button primary" onClick={() => void pair()} disabled={busy || !pairingText.trim()}>配对连接</button>
      <button className="action-button" onClick={() => void loadDevices()} disabled={busy || !token}>已配对设备</button>
    </div>
    {status && <p className="setting-description" role="status">{status}</p>}
    {devices.map(device => <div className="device-row" key={device.id}><span>{device.name}<small>{new Date(device.createdAt).toLocaleDateString()}</small></span><button className="action-button" disabled={busy} onClick={() => void revoke(device.id)}>撤销</button></div>)}
  </section>;
}
