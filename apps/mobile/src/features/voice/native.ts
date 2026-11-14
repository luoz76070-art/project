import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { VoiceRecording } from "./model";

interface VoiceRecorderPlugin {
  // V5: a recorder that can send pieces says so; an older one ignores the options and records up to 2 minutes.
  start(options: { sessionId: string; segmentMs?: number; maxMs?: number }): Promise<{ segmented?: boolean; maxMs?: number } | void>;
  stop(options: { sessionId: string }): Promise<void>;
  cancel(options: { sessionId: string }): Promise<void>;
  addListener(event: "finished", listener: (recording: VoiceRecording) => void): Promise<PluginListenerHandle>;
  addListener(event: "segment", listener: (segment: unknown) => void): Promise<PluginListenerHandle>;
}
export const VoiceRecorder = registerPlugin<VoiceRecorderPlugin>("VoiceRecorder");
export function voiceRecordingSupported() { return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("VoiceRecorder"); }
