import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPullTracker, pullRefreshThreshold } from "./pullRefresh";

/** U4: refresh moved out of the top bar — pull down at the top of a list to reload it. */
export function PullToRefresh({ className, label, onRefresh, children }: { className: string; label?: string; onRefresh: () => unknown; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null), refresh = useRef(onRefresh);
  const [pull, setPull] = useState(0), [refreshing, setRefreshing] = useState(false);
  refresh.current = onRefresh;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const tracker = createPullTracker();
    let frame = 0;
    const show = (value: number) => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setPull(value)); };
    const down = (event: TouchEvent) => { tracker.start(element.scrollTop, event.touches[0]?.clientY ?? 0, event.touches.length); };
    const move = (event: TouchEvent) => { show(tracker.move(element.scrollTop, event.touches[0]?.clientY ?? 0)); };
    const up = () => {
      show(0);
      if (!tracker.end()) return;
      setRefreshing(true);
      Promise.resolve().then(() => refresh.current()).catch(() => undefined).finally(() => setRefreshing(false));
    };
    const cancel = () => { tracker.cancel(); show(0); };
    element.addEventListener("touchstart", down, { passive: true });
    element.addEventListener("touchmove", move, { passive: true });
    element.addEventListener("touchend", up, { passive: true });
    element.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("touchstart", down);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", up);
      element.removeEventListener("touchcancel", cancel);
    };
  }, []);
  const text = refreshing ? "正在刷新…" : pull >= pullRefreshThreshold ? "松开刷新" : "下拉刷新";
  return <div ref={ref} className={className} aria-label={label} aria-busy={refreshing || undefined}>
    {(pull > 0 || refreshing) && <div className="pull-refresh" role="status" style={pull > 0 ? { height: pull } : undefined}>{text}</div>}
    {children}
  </div>;
}
