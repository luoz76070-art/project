import { fileURLToPath } from "node:url";
import path from "node:path";

const keys = ["VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL", "VITE_MOBILE_CODEX_HOT_MANIFEST_URL"];

export function validateUpdateSources(env, allowEmpty = false) {
  const sources = Object.fromEntries(keys.map(key => [key, String(env[key] ?? "").trim()]));
  if (allowEmpty && keys.every(key => !sources[key])) return sources;
  for (const key of keys) {
    if (!sources[key]) throw new Error(`${key} is missing. Configure apps/mobile/.env.production.local before packaging an APK.`);
    let url;
    try { url = new URL(sources[key]); }
    catch { throw new Error(`${key} must be a valid HTTPS manifest URL.`); }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password) {
      throw new Error(`${key} requires HTTPS (HTTP is allowed only for localhost fixtures).`);
    }
  }
  return sources;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { loadEnv } = await import("vite");
  const env = loadEnv("production", fileURLToPath(new URL("../", import.meta.url)), "VITE_");
  validateUpdateSources(env, process.argv.includes("--allow-empty"));
  console.log("Android update source configuration checked.");
}
