import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { VoiceRecording } from "./model";

interface VoiceRecorderPlugin {
  start(options: { sessionId: string }): Promise<void>;
  stop(options: { sessionId: string }): Promise<void>;
  cancel(options: { sessionId: string }): Promise<void>;
  addListener(event: "finished", listener: (recording: VoiceRecording) => void): Promise<PluginListenerHandle>;
}
export const VoiceRecorder = registerPlugin<VoiceRecorderPlugin>("VoiceRecorder");
export function voiceRecordingSupported() { return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("VoiceRecorder"); }
