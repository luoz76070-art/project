import { useEffect, useState, type ReactNode } from "react";
import { MessageCircle, Monitor, Settings } from "lucide-react";
import { applyProductAppearance, isKelivoHost, navigateProduct, ProductHost, productAppearanceChanged, productBeforeNavigate, productOpenUpdates, setProductSettingsLaunch, type ProductAppearance } from "./host";
import { ProductUpdatesPage } from "./ProductUpdatesPage";
import type { ProductHandoff } from './handoff';

export function ProductRemoteShell({ children, onComputerSettings, onHandoff }: { children: ReactNode; onComputerSettings: () => void; onHandoff: (value: ProductHandoff | null) => void }) {
  const [ready, setReady] = useState(!isKelivoHost), [error, setError] = useState("");
  const [updates, setUpdates] = useState(false);
  useEffect(() => {
    if (!isKelivoHost) return;
    let active = true;
    let appearanceUpdates = 0;
    const update = (event: Event) => {
      const appearance = (event as CustomEvent<ProductAppearance>).detail;
      if (active && appearance && typeof appearance.dark === 'boolean') {
        appearanceUpdates++;
        applyProductAppearance(appearance);
      }
    };
    window.addEventListener(productAppearanceChanged, update);
    ProductHost.getState().then(state => {
      if (!active) return;
      if (state.revision !== 1) throw new Error("入口版本不匹配，请重新安装整合预览。");
      setProductSettingsLaunch(Boolean(state.openSettings));
      setUpdates(Boolean(state.openUpdates));
      if (state.openSettings) onComputerSettings();
      onHandoff(state.handoff ?? null);
      if (!appearanceUpdates) applyProductAppearance(state.appearance);
      setReady(true);
    }).catch(() => { if (active) setError("电脑入口暂时无法初始化，请返回后重试。"); });
    return () => { active = false; window.removeEventListener(productAppearanceChanged, update); };
  }, [onComputerSettings, onHandoff]);
  useEffect(() => {
    if (!isKelivoHost) return;
    const open = () => {
      if (window.dispatchEvent(new Event(productBeforeNavigate, { cancelable: true }))) setUpdates(true);
    };
    const back = (event: Event) => {
      if (updates) { event.preventDefault(); void navigate("settings"); }
    };
    window.addEventListener(productOpenUpdates, open);
    window.addEventListener("product-back", back);
    return () => { window.removeEventListener(productOpenUpdates, open); window.removeEventListener("product-back", back); };
  }, [updates]);
  if (!isKelivoHost) return children;
  async function navigate(tab: "ai" | "settings") {
    try { setError(""); await navigateProduct(tab); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "切换失败，请重试。"); }
  }
  return <div className="product-remote-shell">
    <div className="product-remote-content">{ready ? updates ? <ProductUpdatesPage onBack={() => void navigate("settings")} /> : children : <p className="inline-loading">正在打开…</p>}</div>
    {error && <p className="product-navigation-error" role="alert">{error}</p>}
    <nav className="product-navigation" aria-label="主导航">
      <button onClick={() => void navigate("ai")}><span><MessageCircle size={24} /></span><label>AI</label></button>
      <button aria-current={updates ? undefined : "page"} onClick={() => { if (updates && window.dispatchEvent(new Event(productBeforeNavigate, { cancelable: true }))) setUpdates(false); }}><span><Monitor size={24} /></span><label>电脑</label></button>
      <button aria-current={updates ? "page" : undefined} onClick={() => void navigate("settings")}><span><Settings size={24} /></span><label>设置</label></button>
    </nav>
  </div>;
}
