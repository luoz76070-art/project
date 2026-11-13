// Only loaded by the disposable UI fixture with ?cacheFixture=1.
// Inject failure into critical-input writes; all data stays on the fixture origin.
(() => {
  const original = Storage.prototype.setItem;
  let failing = true;
  Storage.prototype.setItem = function(key, value) {
    if (failing && key.startsWith('mobileCodexThreadInputCacheV1:')) {
      throw new DOMException('Synthetic input storage unavailable', 'SecurityError');
    }
    return original.call(this, key, value);
  };
  document.addEventListener('DOMContentLoaded', () => {
    const button = document.createElement('button');
    button.textContent = '恢复模拟存储';
    button.style.cssText = 'position:fixed;top:45%;right:6px;z-index:9999;min-height:44px;padding:8px;background:#fee8bc;color:#222;border:1px solid #a97925;border-radius:8px;';
    button.onclick = () => { failing = false; button.remove(); };
    document.body.append(button);
  });
})();
