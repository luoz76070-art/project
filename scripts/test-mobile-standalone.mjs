import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// What Kelivo 0.1.11 actually sent the computer page with its default
// MobiCodex theme (dynamic colour off), read from the emulator's
// product-shell-v1 preferences. The standalone app must paint the same.
const kelivoPalettes = {
  "light": {
    "avatar": "#e1dfdb",
    "background": "#f6f4ef",
    "composer": "#f2f0eb",
    "composerOutline": "#c5c3bf",
    "error": "#b42318",
    "fill": "#ebe9e5",
    "messageAuthor": "#595a5c",
    "muted": "#5e6066",
    "navigationText": "#16181d",
    "onPrimary": "#f5f1ea",
    "outline": "#dddbd7",
    "panel": "#fffffe",
    "primary": "#1f2228",
    "primaryContainer": "#e7e3da",
    "secondaryText": "#5e6066",
    "signal": "#b45309",
    "text": "#16181d",
    "userBubble": "#e5e3df"
  },
  "dark": {
    "avatar": "#28292c",
    "background": "#111317",
    "composer": "#212326",
    "composerOutline": "#28292c",
    "error": "#f97066",
    "fill": "#353739",
    "messageAuthor": "#b1aeab",
    "muted": "#b9b6ae",
    "navigationText": "#f5f1ea",
    "onPrimary": "#16181d",
    "outline": "#2e3033",
    "panel": "#292b2e",
    "primary": "#f5f1ea",
    "primaryContainer": "#2a2e37",
    "secondaryText": "#b9b6ae",
    "signal": "#f59e0b",
    "text": "#f5f1ea",
    "userBubble": "#333437"
  }
};

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'mobile-standalone-'));
const shim = path.join(temp, 'capacitor.mjs');
await writeFile(shim, `
export const Capacitor = { isNativePlatform: () => Boolean(globalThis.__native) };
export const CapacitorHttp = { request: options => globalThis.__http(options) };
export const registerPlugin = name => new Proxy({}, { get: (_, method) => (...args) => globalThis.__plugins[name][method](...args) });
`);
await build({ stdin: { contents: `
export * from './apps/mobile/src/features/product/standalone';
export { parseHotManifest, hotUpdateCompatible, stageHotUpdate } from './apps/mobile/src/features/updates/hotUpdate';
`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: path.join(temp, 'standalone.mjs'),
  alias: { '@capacitor/core': shim }, logLevel: 'error',
  define: { 'import.meta.env': '{"VITE_MOBILE_CODEX_HOT_MANIFEST_URL":"https://updates.example.test/hot/latest.json"}' } });
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
const m = await import(pathToFileURL(path.join(temp, 'standalone.mjs')));
test.after(() => rm(temp, { recursive: true, force: true }));

function page(t, { systemDark = false } = {}) {
  const saved = { window: globalThis.window, document: globalThis.document, CustomEvent: globalThis.CustomEvent };
  storage.clear();
  const properties = new Map(), dataset = {}, query = new EventTarget();
  query.matches = systemDark;
  globalThis.window = Object.assign(new EventTarget(), { matchMedia: () => query });
  globalThis.document = { documentElement: { dataset, style: { setProperty: (name, value) => properties.set(name, value), removeProperty: name => properties.delete(name) } } };
  globalThis.__plugins = {};
  t.after(() => { Object.assign(globalThis, saved); delete globalThis.__native; delete globalThis.__plugins; delete globalThis.__http; });
  return { properties, dataset, query };
}

test('standalone palette is exactly what Kelivo sent for the MobiCodex theme', () => {
  for (const mode of ['light', 'dark']) {
    const mine = m.standalonePalette(mode === 'dark');
    for (const [role, value] of Object.entries(kelivoPalettes[mode])) assert.equal(mine[role], value, `${mode} ${role}`);
  }
});

test('display preferences keep Kelivo defaults and clamp stored values', t => {
  page(t);
  assert.deepEqual(m.loadProductDisplay(), { chatFontScale: 1, showToolCards: true, showToolResultSummary: false });
  storage.set('mobicodexDisplayV1', '{"chatFontScale":9,"showToolCards":false,"showToolResultSummary":true}');
  assert.deepEqual(m.loadProductDisplay(), { chatFontScale: 2, showToolCards: false, showToolResultSummary: true });
  storage.set('mobicodexDisplayV1', 'not json');
  assert.equal(m.loadProductDisplay().chatFontScale, 1);
  storage.set('themeMode', 'sepia');
  assert.equal(m.loadThemeMode(), 'system');
});

test('appearance follows theme, display changes and the system in the browser', t => {
  const { properties, dataset, query } = page(t);
  const stop = m.startStandaloneAppearance();
  assert.equal(dataset.theme, 'light');
  assert.equal(properties.get('--bg-0'), kelivoPalettes.light.background);
  assert.equal(properties.get('--user-bubble'), kelivoPalettes.light.userBubble);
  assert.equal(dataset.showToolCards, 'true');
  assert.equal(dataset.showToolSummary, 'false');
  query.matches = true; query.dispatchEvent(new Event('change'));
  assert.equal(dataset.theme, 'dark');
  assert.equal(properties.get('--bg-0'), kelivoPalettes.dark.background);
  m.saveThemeMode('light');
  assert.equal(dataset.theme, 'light');
  m.saveProductDisplay({ chatFontScale: 1.3, showToolCards: false, showToolResultSummary: true });
  assert.equal(properties.get('--remote-chat-scale'), '1.3');
  assert.equal(dataset.showToolCards, 'false');
  assert.equal(dataset.showToolSummary, 'true');
  stop();
  m.saveThemeMode('dark');
  assert.equal(dataset.theme, 'light', 'stopped appearance ignores later changes');
});

test('the Activity, not the WebView media query, decides system dark mode and paints the bars', async t => {
  const { dataset } = page(t, { systemDark: false });
  globalThis.__native = true;
  const painted = []; let listener;
  globalThis.__plugins.ProductWindow = {
    getState: async () => ({ dark: true }),
    apply: async options => { painted.push(options); },
    addListener: async (_, callback) => { listener = callback; return { remove: async () => {} }; },
  };
  const stop = m.startStandaloneAppearance();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(dataset.theme, 'dark');
  assert.deepEqual(painted.at(-1), { dark: true, background: kelivoPalettes.dark.background });
  listener({ dark: false });
  assert.equal(dataset.theme, 'light');
  assert.deepEqual(painted.at(-1), { dark: false, background: kelivoPalettes.light.background });
  stop();
});

const manifest = { platform: 'android', channel: 'hot', version: '0.2.0-hot.41', htmlUrl: 'https://updates.example.test/hot/b.html', sha256: 'a'.repeat(64), minNativeVersionCode: 40, maxNativeVersionCode: 40 };

test('hot manifests are validated like the native installer', () => {
  assert.equal(m.parseHotManifest(manifest).version, '0.2.0-hot.41');
  assert.ok(m.parseHotManifest({ ...manifest, htmlUrl: 'http://127.0.0.1:18796/hot/b.html' }));
  for (const bad of [{ htmlUrl: 'http://updates.example.test/b.html' }, { sha256: 'xyz' }, { version: '../x' }, { version: 'a..b' }, { channel: 'apk' }, { maxNativeVersionCode: 39 }, { minNativeVersionCode: 1.5 }]) {
    assert.throws(() => m.parseHotManifest({ ...manifest, ...bad }), /界面更新信息无效/, JSON.stringify(bad));
  }
  assert.equal(m.hotUpdateCompatible(manifest, 40), true);
  assert.equal(m.hotUpdateCompatible(manifest, 41), false);
  assert.equal(m.hotUpdateCompatible({ ...manifest, maxNativeVersionCode: undefined }, 99), true);
});

test('background staging downloads only a new compatible bundle the user has not declined', async t => {
  page(t);
  globalThis.__native = true;
  let served = manifest; const staged = [];
  globalThis.__http = async () => ({ status: 200, headers: { 'content-type': 'application/json' }, data: served });
  let status = { supported: true, activeVersion: '', pendingVersion: '', previousVersion: '', stagedVersion: '', nativeVersionCode: 40 };
  globalThis.__plugins.HotUpdate = { getStatus: async () => status, stage: async options => { staged.push(options); return { version: options.version, staged: true }; } };
  assert.equal(await m.stageHotUpdate(40), '0.2.0-hot.41');
  assert.deepEqual(staged.at(-1), { url: manifest.htmlUrl, sha256: manifest.sha256, version: manifest.version, minNativeVersionCode: 40, maxNativeVersionCode: 40 });
  for (const skip of [{ activeVersion: manifest.version }, { stagedVersion: manifest.version }, { previousVersion: manifest.version }, { nativeVersionCode: 39 }, { supported: false }]) {
    status = { supported: true, activeVersion: '', pendingVersion: '', previousVersion: '', stagedVersion: '', nativeVersionCode: 40, ...skip };
    assert.equal(await m.stageHotUpdate(40), null, JSON.stringify(skip));
  }
  status = { supported: true, activeVersion: '', pendingVersion: '', previousVersion: '', stagedVersion: '', nativeVersionCode: 40 };
  storage.set('mobicodexHotUpdateDeclined', manifest.version);
  assert.equal(await m.stageHotUpdate(40), null, 'a rolled-back bundle is not fetched again');
  storage.delete('mobicodexHotUpdateDeclined');
  served = { ...manifest, minNativeVersionCode: 41, maxNativeVersionCode: 41 };
  assert.equal(await m.stageHotUpdate(40), null, 'a bundle for a newer app waits for that app');
  served = { ...manifest, sha256: 'bad' };
  assert.equal(await m.stageHotUpdate(40), null, 'an invalid manifest is ignored');
  assert.equal(staged.length, 1);
});
