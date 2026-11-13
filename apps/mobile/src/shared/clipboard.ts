import { registerPlugin, Capacitor } from "@capacitor/core";
import { type ClipboardPlugin } from "../app/types";

export const NativeClipboard = registerPlugin<ClipboardPlugin>("Clipboard");

export async function writeClipboard(text: string) {
  if (Capacitor.isNativePlatform()) {
    await NativeClipboard.write({ string: text });
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) throw new Error("clipboard unavailable");
}
