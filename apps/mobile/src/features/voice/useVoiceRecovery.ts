import { useEffect, useMemo, useRef, useState } from "react";
import { voiceApi } from "./api";
import { createVoiceRecovery, recoveredVoiceDraft, type VoicePending, type VoiceRecovery } from "./recovery";
import { readVoiceAgentDraft, writeVoiceAgentDraft, readVoiceCodexDraft, writeVoiceCodexDraft } from "./draftRecovery";

export type VoiceRecoveryPort = Pick<VoiceRecovery, "submit" | "cancel" | "detach">;
export function useVoiceRecovery(scope: string, endpoint: string, token: string) {
  const instance = useRef<VoiceRecovery | null>(null);
  const [notices, setNotices] = useState<Array<{ scope: string; text: string; message: string }>>([]);
  const notice = notices.find(item => item.scope === scope) ?? null;
  const port = useMemo<VoiceRecoveryPort>(() => ({
    submit: (record, post) => instance.current ? instance.current.submit(record, post) : Promise.reject(new Error("语音恢复尚未就绪")),
    cancel: id => instance.current?.cancel(id),
    detach: id => instance.current?.detach(id),
  }), []);
  useEffect(() => {
    const api = voiceApi(endpoint, token);
    const setNotice = (value: { text: string; message: string }) => setNotices(current => [...current, { ...value, scope }]);
    let active = true;
    async function restore(record: VoicePending, text: string) {
      const codex = record.thread.startsWith("codex:"), thread = codex ? record.thread.slice(6) : record.thread;
      const current = codex ? readVoiceCodexDraft(scope, thread) : readVoiceAgentDraft(scope, thread);
      try {
        const next = await recoveredVoiceDraft(record, current, text);
        if (!active) return;
        const saved = codex ? writeVoiceCodexDraft(scope, thread, current, next) : writeVoiceAgentDraft(scope, thread, current, next);
        if (!saved) throw new Error("输入框已变化或保存失败");
        setNotice({ text: "", message: "已取回语音结果并写回原会话草稿，请核对后发送。" });
      } catch {
        if (active) setNotice({ text, message: "原会话草稿已变化或保存失败，未覆盖；请复制取回的语音结果。" });
      }
    }
    let storage: Storage;
    try { storage = localStorage; } catch { setNotice({ text: "", message: "语音恢复存储不可用，请检查应用存储权限。" }); return; }
    const recovery = createVoiceRecovery({ scope, storage, query: api.result, restore });
    instance.current = recovery;
    const visibility = () => recovery.setVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", visibility);
    visibility();
    return () => {
      active = false; recovery.stop(); if (instance.current === recovery) instance.current = null;
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("online", visibility);
    };
  }, [scope, endpoint, token]);
  return { recovery: port, notice, dismiss: () => setNotices(current => current.filter(item => item !== notice)) };
}
