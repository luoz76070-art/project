// Browser-only Capacitor fixture. Never bundled into the app or used against a real gateway.
(() => {
  window.CapacitorCustomPlatform = { name: 'android' };
  const listeners = new Map();
  let nextId = 0, revision = -1, voiceSession;
  const header = (name, methods) => ({ name, methods: methods.map(name => ({ name, rtype: name === 'addListener' ? 'callback' : 'promise' })) });
  const apk = async action => (await fetch(`/fixture/apk${action ? `?action=${action}` : ''}`)).json();
  window.Capacitor = {
    PluginHeaders: [header('SecureCredentials', ['load', 'save']), header('ApkUpdate', ['getStatus', 'downloadAndInstall', 'install', 'addListener', 'removeListener']),
      header('HotUpdate', ['getStatus', 'markReady', 'install', 'rollback']), header('CapacitorHttp', ['request']), header('Clipboard', ['write']),
      ...new URLSearchParams(location.search).has('legacyDiagnostic') ? [] : [header('DiagnosticExport', ['save'])],
      ...(new URLSearchParams(location.search).get('voiceFixture') === '1' ? [header('VoiceRecorder', ['start', 'stop', 'cancel', 'addListener', 'removeListener'])] : [])],
    nativeCallback: async (plugin, method, options, callback) => {
      const id = String(++nextId); listeners.set(id, { plugin, callback }); return id;
    },
    nativePromise: async (plugin, method, options) => {
      if (plugin === 'DiagnosticExport') {
        const response = await fetch('/fixture/diagnostic-file', { method: 'POST', body: JSON.stringify({ text: options.text }) });
        if (!response.ok) throw new Error('Synthetic file save failure');
        return response.json();
      }
      if (plugin === 'Clipboard') {
        const response = await fetch('/fixture/clipboard', { method: 'POST', body: JSON.stringify({ string: options.string }) });
        if (!response.ok) throw new Error('Synthetic clipboard failure');
        return {};
      }
      if (plugin === 'VoiceRecorder') {
        if (method === 'removeListener') { listeners.delete(options.callbackId); return {}; }
        if (method === 'start') {
          const state = await (await fetch('/fixture/voice')).json();
          if (state.denied) throw new Error('voice_microphone_denied');
          voiceSession = options.sessionId; return {};
        }
        if (method === 'stop' && voiceSession === options.sessionId) {
          const sessionId = voiceSession; voiceSession = undefined;
          const dataBase64 = btoa('\xff\xf1\x60\x40\x0f\xff\xfc' + 'x'.repeat(120));
          for (const { plugin: name, callback } of listeners.values()) if (name === 'VoiceRecorder') callback({ sessionId, dataBase64, durationMs: 5000 });
        }
        if (method === 'cancel') voiceSession = undefined;
        return {};
      }
      if (plugin === 'SecureCredentials') {
        if (method === 'load') return { value: sessionStorage.fixtureCredentials || '{}' };
        sessionStorage.fixtureCredentials = options.value; return {};
      }
      if (plugin === 'ApkUpdate') {
        if (method === 'removeListener') { listeners.delete(options.callbackId); return {}; }
        return apk(method === 'downloadAndInstall' ? 'download' : method === 'install' ? 'install' : '');
      }
      if (plugin === 'HotUpdate') {
        const diagnostics = await (await fetch('/fixture/diagnostics')).json();
        return { supported: true, activeVersion: diagnostics.activeVersion, pendingVersion: diagnostics.pendingVersion, previousVersion: 'fixture-web', nativeVersionCode: diagnostics.nativeVersionCode ?? (await apk()).nativeVersionCode };
      }
      if (plugin === 'CapacitorHttp') {
        const url = new URL(options.url);
        if (url.pathname.includes('/releases/android/')) {
          const state = await apk();
          return { status: 200, data: { platform: 'android', versionCode: state.versionCode, versionName: state.versionName, apkUrl: 'https://example.invalid/fixture.apk', size: state.totalBytes, sha256: '0'.repeat(64), notes: '合成更新：用于核验 App 内下载、授权与安装重试界面。' } };
        }
        if (url.pathname.includes('/releases/hot/')) {
          const state = await apk();
          return { status: 200, data: { platform: 'android', channel: 'hot', version: 'fixture-web', minNativeVersionCode: state.nativeVersionCode, maxNativeVersionCode: state.nativeVersionCode, htmlUrl: 'https://example.invalid/fixture.html', sha256: '0'.repeat(64) } };
        }
        if (url.origin !== location.origin) throw new Error('Fixture rejects external requests');
        const response = await fetch(options.url, { method: options.method, headers: options.headers, body: options.data ? JSON.stringify(options.data) : undefined });
        return { status: response.status, data: await response.json() };
      }
      throw new Error('Unsupported fixture plugin');
    },
  };
  const timer = setInterval(async () => {
    const state = await apk();
    if (state.revision <= revision) return;
    revision = state.revision;
    for (const { plugin, callback } of listeners.values()) if (plugin === 'ApkUpdate') callback(state);
  }, 250);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
})();
