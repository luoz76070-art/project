import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mic, X, Square, Loader2, Copy } from "lucide-react";
import { VoiceRecorder, voiceRecordingSupported } from "./native";
import { voiceApi } from "./api";
import { mergeVoiceDraft, voiceError, type VoiceRecording } from "./model";
import { writeClipboard } from "../../shared/clipboard";

type Phase = "idle" | "starting" | "recording" | "transcribing" | "refining" | "preview";
export function VoiceInput({ endpoint, token, draft, onDraft }: { endpoint: string; token: string; draft: string; onDraft: (value: string) => void }) {
  const [open, setOpen] = useState(false), [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<"text" | "prompt">("prompt"), [seconds, setSeconds] = useState(0);
  const [original, setOriginal] = useState(""), [prompt, setPrompt] = useState(""), [error, setError] = useState("");
  const sheet = useRef<HTMLElement | null>(null);
  const session = useRef<{ id: string; base: string; conflict: boolean; mode: "text" | "prompt"; abort: AbortController; requestId?: string; finished?: boolean; recordingReceived?: boolean } | null>(null);
  const latest = useRef({ draft, onDraft }); latest.current = { draft, onDraft };
  if (session.current && draft !== session.current.base) session.current.conflict = true;
  const api = voiceApi(endpoint, token);
  const available = voiceRecordingSupported();
  const busy = ["starting", "recording", "transcribing", "refining"].includes(phase);

  function cancel() {
    const active = session.current; session.current = null;
    if (active) {
      active.abort.abort();
      void VoiceRecorder.cancel({ sessionId: active.id }).catch(() => {});
      if (active.requestId) void api.cancel(active.requestId).catch(() => {});
    }
  }
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    sheet.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [open]);
  useEffect(() => {
    const hide = () => { if (document.hidden) {
      const active = session.current;
      if (active && !active.finished) { cancel(); setPhase("idle"); setError("录音或处理已中断，请保持应用在前台后重试。"); }
    } };
    document.addEventListener("visibilitychange", hide);
    return () => { cancel(); document.removeEventListener("visibilitychange", hide); };
  }, [endpoint, token]);
  useEffect(() => {
    if (phase !== "recording") return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.min(120, Math.floor((Date.now() - started) / 1000))), 250);
    return () => clearInterval(timer);
  }, [phase]);

  async function refine(text: string, active: NonNullable<typeof session.current>) {
    if (session.current !== active || active.abort.signal.aborted) return;
    setPhase("refining"); setError(""); setPrompt(""); active.finished = false;
    const requestId = crypto.randomUUID(); active.requestId = requestId;
    try {
      const result = await api.refine(requestId, text, active.abort.signal);
      if (session.current === active) setPrompt(result);
    } catch (caught) { if (session.current === active) setError(voiceError(caught)); }
    finally { if (session.current === active) { active.requestId = undefined; active.finished = true; setPhase("preview"); } }
  }

  async function finished(recording: VoiceRecording, active: NonNullable<typeof session.current>) {
    if (session.current !== active || recording.sessionId !== active.id || active.recordingReceived) return;
    active.recordingReceived = true; active.finished = true;
    if (recording.error || !recording.dataBase64 || !recording.durationMs) { setPhase("idle"); setError(voiceError(new Error(recording.error || "voice_recording_failed"))); return; }
    active.finished = false; setPhase("transcribing");
    const requestId = crypto.randomUUID(); active.requestId = requestId;
    try {
      const text = await api.transcribe(requestId, recording.dataBase64, recording.durationMs, active.abort.signal);
      if (session.current !== active) return;
      active.requestId = undefined; setOriginal(text);
      if (active.mode === "prompt") await refine(text, active);
      else { active.finished = true; setPhase("preview"); }
    } catch (caught) {
      if (session.current === active) { active.requestId = undefined; active.finished = true; setPhase("idle"); setError(voiceError(caught)); }
    }
  }

  async function start() {
    if (session.current && !session.current.finished) return;
    cancel(); setError(""); setPrompt(""); setOriginal(""); setSeconds(0); setPhase("starting");
    const active = { id: crypto.randomUUID(), base: latest.current.draft, conflict: false, mode, abort: new AbortController() } as NonNullable<typeof session.current>;
    session.current = active;
    let listener: Awaited<ReturnType<typeof VoiceRecorder.addListener>> | undefined;
    try {
      listener = await VoiceRecorder.addListener("finished", recording => {
        if (recording.sessionId !== active.id) return;
        void listener?.remove();
        void finished(recording, active);
      });
      active.abort.signal.addEventListener("abort", () => { void listener?.remove(); }, { once: true });
      if (session.current !== active) { await listener.remove(); return; }
      // Verify configuration before requesting the microphone; no paid request here.
      const config = await api.config(active.abort.signal);
      if (!config.qwenConfigured || (mode === "prompt" && !config.deepseekConfigured)) throw new Error("语音服务尚未配置，请到设置 → 语音与提示词填写所需 Key。");
      await VoiceRecorder.start({ sessionId: active.id });
      if (session.current === active && !active.recordingReceived) setPhase("recording");
    } catch (caught) {
      await listener?.remove();
      if (session.current === active) { active.finished = true; setPhase("idle"); setError(voiceError(caught)); }
    }
  }

  function adopt(text: string) {
    const active = session.current;
    if (!active) return;
    try {
      if (active.conflict) throw new Error("输入框内容已变化，请复制所需文字后自行粘贴");
      const next = mergeVoiceDraft(active.base, latest.current.draft, text);
      latest.current.onDraft(next); cancel(); setOpen(false); setPhase("idle");
    } catch (caught) { setError(voiceError(caught)); }
  }

  return <>
    <button type="button" className="voice-entry" aria-label="语音输入" title="语音输入" disabled={!token || !endpoint} onClick={() => { setOpen(true); setOriginal(""); setPrompt(""); setError(""); }}><Mic size={20} aria-hidden="true" /></button>
    {open && createPortal(<div className="voice-scrim" onClick={event => { if (event.target === event.currentTarget) { cancel(); setOpen(false); setPhase("idle"); } }}>
      <section ref={sheet} className="voice-sheet" role="dialog" aria-modal="true" aria-label="语音输入与提示词整理" onKeyDown={event => {
        if (event.key === "Escape") { cancel(); setOpen(false); setPhase("idle"); }
        if (event.key === "Tab") {
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled)"));
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <header><strong>语音输入</strong><button type="button" className="icon-button" aria-label="关闭语音输入" onClick={() => { cancel(); setOpen(false); setPhase("idle"); }}><X size={20} /></button></header>
        <p className="setting-description">录音最长2分钟。预览后回填草稿，再由你发送。</p>
        <div className="voice-modes" aria-label="语音处理方式">{(["text", "prompt"] as const).map(value => <button type="button" key={value} aria-pressed={mode === value} disabled={busy} onClick={() => setMode(value)}>{value === "text" ? "仅转文字" : "整理提示词"}</button>)}</div>
        {!available && <p role="status">录音需要安装支持语音的新版 Android APK。</p>}
        {phase === "recording" ? <button type="button" className="action-button voice-recording" onClick={() => void VoiceRecorder.stop({ sessionId: session.current!.id }).catch(caught => { cancel(); setPhase("idle"); setError(voiceError(caught)); })}><Square size={17} />结束录音 · {seconds}s / 120s</button>
          : <button type="button" className="action-button" disabled={!available || busy} onClick={() => void start()}><Mic size={17} />{original ? "重新录音" : "开始录音"}</button>}
        {busy && phase !== "recording" && <p className="voice-stage" role="status"><Loader2 size={16} className="spin" />{phase === "starting" ? "正在准备麦克风…" : phase === "transcribing" ? "百炼正在转文字…" : "DeepSeek 正在整理…"}</p>}
        {original && <label>识别原文<textarea aria-label="语音识别原文" value={original} maxLength={20_000} disabled={busy} rows={4} onChange={event => { setOriginal(event.target.value); setPrompt(""); }} /></label>}
        {prompt && <label>整理后的提示词<textarea aria-label="整理后的提示词" value={prompt} maxLength={20_000} disabled={busy} rows={6} onChange={event => setPrompt(event.target.value)} /></label>}
        {error && <p className="voice-error" role="alert">{error}</p>}
        {session.current?.conflict && <p role="status">输入框已有新内容。请复制所需文字后自行粘贴。</p>}
        {original && <div className="voice-actions">
          <button type="button" className="action-button" disabled={busy || !original.trim() || session.current?.conflict} onClick={() => adopt(original)}>采用原文</button>
          <button type="button" className="action-button" disabled={busy || !original.trim()} onClick={() => { if (session.current) void refine(original, session.current); }}>重新整理</button>
          {prompt && <button type="button" className="action-button" disabled={busy || !prompt.trim() || session.current?.conflict} onClick={() => adopt(prompt)}>采用提示词</button>}
          <button type="button" className="action-button" disabled={busy} onClick={() => void writeClipboard(prompt || original).catch(() => setError("复制失败，请手动选择文字复制。"))}><Copy size={15} />复制</button>
        </div>}
      </section>
    </div>, document.body)}
  </>;
}
