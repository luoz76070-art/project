// Browser fixture for the local shell bridge. Never packaged in the APK.
(() => {
  const params = new URLSearchParams(location.search);
  const handoffKey = 'fixtureProductHandoff';
  const readHandoff = () => JSON.parse(localStorage.getItem(handoffKey) || 'null');
  if (params.get('handoff') === '1' && !readHandoff()) localStorage.setItem(handoffKey, JSON.stringify({
    revision: 1, id: crypto.randomUUID(), status: 'draft', text: '只交接这条合成说明，不转发其他历史。', createdAt: Date.now(),
  }));
  if (params.get('handoffStorage') === 'fail') {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'mobileCodexProductHandoffV1') throw new DOMException('Synthetic handoff storage failure', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  }
  if (new URLSearchParams(location.search).get('agentStorage') === 'fail') {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('mobile-codex:agent-drafts:')) throw new DOMException('Synthetic Agent storage failure', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  }
  window.Capacitor.PluginHeaders.push({ name: 'ProductHost', methods: ['getState', 'navigate', 'handoff'].map(name => ({ name, rtype: 'promise' })) });
  const original = window.Capacitor.nativePromise;
  window.fixtureProductNavigation = [];
  window.Capacitor.nativePromise = async (plugin, method, options) => {
    if (plugin !== 'ProductHost') return original(plugin, method, options);
    if (method === 'navigate') { window.fixtureProductNavigation.push(options.tab); return {}; }
    if (method === 'handoff') {
      let value = readHandoff();
      if (!value || value.id !== options.id) throw new Error('Synthetic handoff identity changed');
      if (options.action === 'submit') {
        if (value.status !== 'draft') throw new Error('Synthetic handoff already submitted');
        value = { ...value, status: 'uncertain', message: options.message, clientMessageId: value.id, target: options.target };
      } else if (options.action === 'confirm') {
        if (value.status === 'draft' || options.clientMessageId !== value.id) throw new Error('Synthetic receipt mismatch');
        value = { ...value, status: 'confirmed', acceptance: options.acceptance };
      } else if (options.action === 'close') {
        if (value.status === 'uncertain') throw new Error('Synthetic handoff outcome unknown');
        value = null;
      } else throw new Error('Unknown synthetic handoff action');
      localStorage.setItem(handoffKey, JSON.stringify(value));
      return { handoff: value };
    }
    const mode = new URLSearchParams(location.search).get('theme') || 'light';
    const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    // Resolved Flutter default palettes; captured by the product palette probe.
    const palettes = {"light":{"background":"#f7f7f7","panel":"#ffffff","fill":"#ececec","text":"#202020","muted":"#646464","primary":"#4d5c92","onPrimary":"#ffffff","primaryContainer":"#dce1ff","userBubble":"#e9ebef","avatar":"#e6e8ed","composer":"#f4f4f5","composerOutline":"#c6c6c6","secondaryText":"#8c8c8c","messageAuthor":"#616161","navigationIndicator":"#dee1f9","navigationText":"#202020","outline":"#e8e8e8"},"dark":{"background":"#121213","panel":"#2a2a2b","fill":"#373738","text":"#f9f9f9","muted":"#cecece","primary":"#b6c4ff","onPrimary":"#1d2d61","primaryContainer":"#354479","userBubble":"#2b2d36","avatar":"#22242b","composer":"#222223","composerOutline":"#29292a","secondaryText":"#868686","messageAuthor":"#b4b4b4","navigationIndicator":"#424659","navigationText":"#f9f9f9","outline":"#252526"}};
    return { revision: 1, handoff: readHandoff(), openSettings: params.get('openSettings') === '1', openUpdates: params.get('openUpdates') === '1', appearance: { mode, dark, colors: palettes[dark ? 'dark' : 'light'], display: { chatFontScale: Number(params.get('chatFontScale') || 1), showToolCards: params.get('toolCards') !== '0', showToolResultSummary: params.get('toolSummary') === '1' } } };
  };
})();
