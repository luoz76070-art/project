import { Capacitor, registerPlugin } from "@capacitor/core";
import { normalizeEndpoint } from "./http";
import { type ConnectionProfile } from "../../app/types";

const native = Capacitor.isNativePlatform();
const vault = registerPlugin<{ load(): Promise<{ value: string }>; save(options: { value: string }): Promise<void> }>("SecureCredentials");
let credentials: Record<string, string> = {};
let writes: Promise<void> = Promise.resolve();

export async function initializeCredentials() {
  if (!native) return;
  const loaded = JSON.parse((await vault.load()).value) as Record<string, unknown>;
  credentials = Object.fromEntries(Object.entries(loaded).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const profiles = loadConnectionProfiles();
  // Successful encryption must precede removal of any legacy plaintext.
  await saveConnectionProfiles(profiles, localStorage.getItem("activeConnectionProfileId") ?? profiles[0].id);
  localStorage.removeItem("relayToken");
}

export function saveConnectionSettings(endpoint: string, token: string) {
  localStorage.setItem("relayEndpoint", normalizeEndpoint(endpoint));
  if (native) localStorage.removeItem("relayToken");
  else localStorage.setItem("relayToken", token);
}

export function loadConnectionProfiles(): ConnectionProfile[] {
  const raw = localStorage.getItem("connectionProfiles");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ConnectionProfile[];
      const valid = parsed.filter((profile) => profile.id && profile.endpoint);
      if (valid.length > 0) return valid.map(profile => ({ ...profile, token: credentials[profile.id] ?? profile.token ?? "" }));
    } catch {
      // Fall through to legacy single-profile storage.
    }
  }
  return [
    {
      id: "default",
      name: "本机 Relay",
      endpoint: normalizeEndpoint(localStorage.getItem("relayEndpoint") ?? "http://127.0.0.1:8787"),
      token: credentials.default ?? localStorage.getItem("relayToken") ?? "",
      updatedAt: new Date().toISOString(),
    },
  ];
}

export async function saveConnectionProfiles(profiles: ConnectionProfile[], activeProfileId: string) {
  const snapshot = profiles.map(profile => ({ ...profile }));
  const save = async () => {
    if (native) {
      const next = Object.fromEntries(snapshot.map(profile => [profile.id, profile.token]));
      await vault.save({ value: JSON.stringify(next) });
      credentials = next;
    }
    localStorage.setItem("connectionProfiles", JSON.stringify(native ? snapshot.map(({ token: _token, ...profile }) => profile) : snapshot));
    localStorage.setItem("activeConnectionProfileId", activeProfileId);
  };
  const pending = writes.then(save, save);
  writes = pending.catch(() => undefined);
  return pending;
}

export function upsertConnectionProfile(profiles: ConnectionProfile[], profile: ConnectionProfile) {
  const next = profiles.filter((item) => item.id !== profile.id);
  return [profile, ...next].slice(0, 12);
}

export function profileNameFromEndpoint(endpoint: string) {
  try {
    const url = new URL(normalizeEndpoint(endpoint));
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return "本机 Relay";
    return `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return "Relay";
  }
}
