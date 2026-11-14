import { useEffect, useMemo, useRef } from 'react';
import { createVoiceRecovery, type VoiceRecovery, type VoicePending } from '../voice/recovery';
import { voiceApi } from '../voice/api';
import type { VoiceRecoveryPort } from '../voice/useVoiceRecovery';
import { relayAuthorization } from '../connection/authorization';
/** Online capture recovery is deliberately memory-only and never writes a chat draft. */
export function useCaptureVoice(scope: string, endpoint: string, token: string, recovered: (text: string, record: VoicePending) => void | Promise<void>) {
  const instance = useRef<VoiceRecovery | null>(null), receive = useRef(recovered); receive.current = recovered;
  const port = useMemo<VoiceRecoveryPort>(() => ({ submit: (record, post) => instance.current ? instance.current.submit(record, post) : Promise.reject(new Error('需要连接电脑')),
    cancel: id => instance.current?.cancel(id), detach: id => instance.current?.detach(id) }), []);
  useEffect(() => {
    const memory = new Map<string, string>(), api = voiceApi(endpoint, token);
    const recovery = createVoiceRecovery({ scope, storage: { getItem: k => memory.get(k) ?? null, setItem: (k,v) => { memory.set(k,v); }, removeItem: k => { memory.delete(k); } },
      query: api.result, restore: async (record, text) => receive.current(text, record) });
    instance.current = recovery;
    const auth = relayAuthorization(endpoint, token), stop = () => recovery.stop();
    const detach = auth.subscribe(stop);
    const visibility = () => { if (auth.isRevoked()) stop(); else recovery.setVisible(!document.hidden && navigator.onLine); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('online', visibility); window.addEventListener('offline', visibility); visibility();
    return () => { detach(); stop(); instance.current = null; document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', visibility); window.removeEventListener('offline', visibility); };
  }, [scope, endpoint, token]);
  return port;
}
