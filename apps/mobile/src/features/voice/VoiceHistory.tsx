import { useState } from "react";
import { writeClipboard } from "../../shared/clipboard";
import { formatDate } from "../../shared/format";
import { clearVoiceHistory, readVoiceHistory, removeVoiceHistory, setVoiceHistorySettings, voiceHistorySettings, type VoiceHistorySettings } from "./history";

/** V6 settings: keep transcripts for 7/30/90 days or not at all; audio is never stored. */
export function VoiceHistory() {
  const [settings, setSettings] = useState(voiceHistorySettings), [entries, setEntries] = useState(() => readVoiceHistory());
  const [notice, setNotice] = useState("");
  function update(next: VoiceHistorySettings) { setVoiceHistorySettings(next); setSettings(next); setEntries(readVoiceHistory()); }
  return <section className="voice-history" aria-label="语音记录">
    <label>保存语音转写记录
      <button type="button" className="action-button" role="switch" aria-label="保存语音转写记录" aria-checked={settings.enabled}
        onClick={() => { if (settings.enabled && entries.length && !window.confirm("关闭后会删除这台手机上已保存的语音记录，确定吗？")) return; update({ ...settings, enabled: !settings.enabled }); }}>
        {settings.enabled ? "已开启" : "已关闭"}</button>
    </label>
    <p className="setting-description">只在这台手机上保存转写出的文字，不保存录音；到期自动删除。</p>
    {settings.enabled && <label>保留时间<select value={settings.days} onChange={event => update({ ...settings, days: Number(event.target.value) as VoiceHistorySettings["days"] })}>
      <option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option></select></label>}
    {settings.enabled && (entries.length ? <>
      <ul className="voice-history-list">{entries.slice(0, 20).map(entry => <li key={entry.id}>
        <time dateTime={entry.at}>{formatDate(entry.at)}</time><p>{entry.text}</p>
        <div className="settings-actions">
          <button type="button" className="action-button" onClick={() => void writeClipboard(entry.text).then(() => setNotice("已复制"), () => setNotice("复制失败，请重试"))}>复制</button>
          <button type="button" className="action-button" onClick={() => { removeVoiceHistory(entry.id); setEntries(readVoiceHistory()); }}>删除</button>
        </div>
      </li>)}</ul>
      {entries.length > 20 && <p className="setting-description">只显示最近 20 条，共 {entries.length} 条。</p>}
      <button type="button" className="action-button" onClick={() => { if (window.confirm("删除全部语音记录？")) { clearVoiceHistory(); setEntries([]); } }}>全部清除</button>
    </> : <p className="setting-description">还没有语音记录。</p>)}
    {notice && <p className="setting-description" role="status">{notice}</p>}
  </section>;
}
