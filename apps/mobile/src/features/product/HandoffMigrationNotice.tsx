import { useState } from 'react';
import { hasLegacyHandoff } from './handoffMigration';

/** Recovery entry for an orphaned Web draft or an import whose native ACK already succeeded. */
export function HandoffMigrationNotice({ migrate }: { migrate: () => Promise<void> }) {
  const [pending, setPending] = useState(() => { try { return hasLegacyHandoff(); } catch { return true; } });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!pending) return null;
  return <div className="connection-notice" role="status">
    <span>{error || '有旧交接草稿可迁移到当前电脑的事项存储。'}</span>
    <button disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await migrate(); setPending(hasLegacyHandoff()); }
      catch (error) { setError(error instanceof Error ? error.message : '迁移失败，旧交接已保留。'); }
      finally { setBusy(false); }
    }}>{busy ? '正在迁移…' : '迁移为事项'}</button>
  </div>;
}
