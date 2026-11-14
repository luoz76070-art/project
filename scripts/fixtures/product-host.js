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
    // A1 defaults projected from ColorScheme and the existing surface formulas.
    // Static fixture: validate on Flutter before claiming native pixel parity.
    const palettes = {"light":{"background":"#f6f4ef","panel":"#fffffe","fill":"#ebe9e4","text":"#16181d","muted":"#5e6066","primary":"#1f2228","onPrimary":"#f5f1ea","primaryContainer":"#e7e3da","signal":"#b45309","error":"#b42318","userBubble":"#e5e3df","avatar":"#e1dfdb","composer":"#f2f0eb","composerOutline":"#c5c3bf","secondaryText":"#5e6066","messageAuthor":"#595a5c","navigationIndicator":"#ece8df","navigationText":"#16181d","outline":"#dddbd7"},"dark":{"background":"#111317","panel":"#292b2e","fill":"#353739","text":"#f5f1ea","muted":"#b9b6ae","primary":"#f5f1ea","onPrimary":"#16181d","primaryContainer":"#2a2e37","signal":"#f59e0b","error":"#f97066","userBubble":"#333437","avatar":"#28292c","composer":"#212326","composerOutline":"#28292c","secondaryText":"#b9b6ae","messageAuthor":"#b1aeab","navigationIndicator":"#2a2e37","navigationText":"#f5f1ea","outline":"#2e3033"}};
    return { revision: 1, handoff: readHandoff(), openSettings: params.get('openSettings') === '1', openUpdates: params.get('openUpdates') === '1', appearance: { mode, dark, colors: palettes[dark ? 'dark' : 'light'], display: { chatFontScale: Number(params.get('chatFontScale') || 1), showToolCards: params.get('toolCards') !== '0', showToolResultSummary: params.get('toolSummary') === '1' } } };
  };
})();
