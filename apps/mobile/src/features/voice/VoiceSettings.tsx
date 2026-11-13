import { useEffect, useRef, useState } from "react";
import { voiceApi } from "./api";
import { voiceError, type VoiceConfig } from "./model";

export function VoiceSettings({ endpoint, token }: { endpoint: string; token: string }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<VoiceConfig | null>(null), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [region, setRegion] = useState<"cn" | "sg">("cn"), [workspace, setWorkspace] = useState("");
  const [qwenKey, setQwenKey] = useState(""), [deepseekKey, setDeepseekKey] = useState("");
  const [qwenBaseUrl, setQwenBaseUrl] = useState(""), [qwenModel, setQwenModel] = useState("qwen-audio-3.1-asr-flash");
  const [deepseekBaseUrl, setDeepseekBaseUrl] = useState(""), [deepseekModel, setDeepseekModel] = useState("");
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);
  useEffect(() => { if (!open) { current.current?.abort(); setQwenKey(""); setDeepseekKey(""); } }, [open]);

  async function run(patch?: Parameters<ReturnType<typeof voiceApi>["configure"]>[0]) {
    if (current.current && !current.current.signal.aborted && busy) return;
    const controller = new AbortController(); current.current = controller;
    setBusy(true); setError(""); setNotice("");
    try {
      const api = voiceApi(endpoint, token);
      const next = patch ? await api.configure(patch, controller.signal) : await api.config(controller.signal);
      if (controller.signal.aborted) return;
      setConfig(next); setRegion(next.region); setWorkspace(next.workspace); setQwenKey(""); setDeepseekKey("");
      setQwenBaseUrl(next.qwenBaseUrl); setQwenModel(next.asrModel);
      setDeepseekBaseUrl(next.deepseekBaseUrl); setDeepseekModel(next.promptModel);
      if (patch) setNotice("语音配置已保存。");
    } catch (caught) { if (!controller.signal.aborted) setError(voiceError(caught)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <details className="settings-disclosure voice-settings" open={open} onToggle={event => {
    const expanded = event.currentTarget.open; setOpen(expanded);
    if (expanded) void run(); else { current.current?.abort(); setBusy(false); }
  }}>
    <summary>语音与提示词</summary>
    <p className="setting-description">百炼 Qwen-ASR 转文字，DeepSeek 整理提示词。Key 保存在当前电脑网关，仅此配对设备使用；留空保留已有配置。</p>
    {busy && <p role="status">正在处理配置…</p>}
    {config && <>
      <label>百炼地域<select value={region} onChange={event => {
        const next = event.target.value as "cn" | "sg";
        if (qwenBaseUrl === defaultQwenUrl(region)) setQwenBaseUrl(defaultQwenUrl(next));
        setRegion(next);
      }} disabled={busy}><option value="cn">中国内地（北京）</option><option value="sg">国际（新加坡）</option></select></label>
      <label>百炼 API 地址<input type="url" inputMode="url" autoCapitalize="none" autoComplete="off" spellCheck={false} value={qwenBaseUrl} maxLength={1024} onChange={event => setQwenBaseUrl(event.target.value)} disabled={busy} placeholder="https://工作空间.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" /></label>
      <p className="setting-description">填写百炼控制台的 HTTPS Base URL，支持业务空间专属地址。按模型自动选择兼容或原生协议；修改地址或切换默认地域后，请填写对应 Key。</p>
      <button type="button" className="action-button" disabled={busy} onClick={() => setQwenBaseUrl(defaultQwenUrl(region))}>使用所选地域默认地址</button>
      <label>百炼语音模型<select value={qwenModel} onChange={event => setQwenModel(event.target.value)} disabled={busy}><option value="qwen-audio-3.1-asr-flash">qwen-audio-3.1-asr-flash（原生接口）</option><option value="qwen3-asr-flash">qwen3-asr-flash（兼容接口）</option></select></label>
      <label>百炼工作空间（可选）<input value={workspace} maxLength={100} autoComplete="off" onChange={event => setWorkspace(event.target.value)} disabled={busy} placeholder="默认空间留空" /></label>
      <label>百炼 API Key · {config.qwenConfigured ? "已配置" : "未配置"}<input type="password" autoComplete="new-password" spellCheck={false} value={qwenKey} maxLength={512} onChange={event => setQwenKey(event.target.value)} disabled={busy} placeholder={config.qwenConfigured ? "留空保留，填写可替换" : "填写百炼 API Key"} /></label>
      <label>DeepSeek API 地址<input type="url" inputMode="url" autoCapitalize="none" autoComplete="off" spellCheck={false} value={deepseekBaseUrl} maxLength={1024} onChange={event => setDeepseekBaseUrl(event.target.value)} disabled={busy} placeholder="https://api.example.com/v1" /></label>
      <p className="setting-description">填写服务商提供的 HTTPS Base URL，支持带 /v1 或完整 /chat/completions。修改地址后，请填写该地址对应的 Key。</p>
      <label>DeepSeek 模型名称<input value={deepseekModel} autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={200} onChange={event => setDeepseekModel(event.target.value)} disabled={busy} placeholder="填写服务商的模型 ID" /></label>
      <label>DeepSeek API Key · {config.deepseekConfigured ? "已配置" : "未配置"}<input type="password" autoComplete="new-password" spellCheck={false} value={deepseekKey} maxLength={512} onChange={event => setDeepseekKey(event.target.value)} disabled={busy} placeholder={config.deepseekConfigured ? "留空保留，修改地址时重新填写" : "填写此服务商的 API Key"} /></label>
      <p className="setting-description">模型：{config.asrModel} / {config.promptModel}。两项服务分别计费；仅录音和整理时调用。</p>
      <div className="settings-actions">
        <button type="button" className="action-button" disabled={busy} onClick={() => void run({ region, workspace, qwenBaseUrl: qwenBaseUrl.trim(), qwenModel, deepseekBaseUrl: deepseekBaseUrl.trim(), deepseekModel: deepseekModel.trim(), ...(qwenKey.trim() ? { qwenKey: qwenKey.trim() } : {}), ...(deepseekKey.trim() ? { deepseekKey: deepseekKey.trim() } : {}) })}>保存语音配置</button>
        {config.qwenConfigured && <button type="button" className="action-button" disabled={busy} onClick={() => void run({ qwenKey: null })}>清除百炼 Key</button>}
        {config.deepseekConfigured && <button type="button" className="action-button" disabled={busy} onClick={() => void run({ deepseekKey: null })}>清除 DeepSeek Key</button>}
      </div>
    </>}
    {error && <p className="setting-description" role="alert">{error}</p>}
    {notice && <p className="setting-description" role="status">{notice}</p>}
    {!config && !busy && <button className="action-button" type="button" onClick={() => void run()}>重新读取语音配置</button>}
  </details>;
}

function defaultQwenUrl(region: "cn" | "sg") {
  return `https://${region === "sg" ? "dashscope-intl.aliyuncs.com" : "dashscope.aliyuncs.com"}/compatible-mode/v1`;
}
