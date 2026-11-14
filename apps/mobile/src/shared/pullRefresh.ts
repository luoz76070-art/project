/** U4: pull-to-refresh gesture model, kept free of DOM so it can be tested directly. */
export const pullRefreshThreshold = 56;
const maxPull = 96;

export function createPullTracker(threshold = pullRefreshThreshold) {
  let start: number | null = null, distance = 0;
  return {
    /** A pull only starts at the very top of the list with a single finger. */
    start(scrollTop: number, y: number, touches = 1) { start = scrollTop <= 0 && touches === 1 ? y : null; distance = 0; return distance; },
    /** Half-speed resistance; scrolling the list away from the top abandons the pull. */
    move(scrollTop: number, y: number) {
      if (start === null) return 0;
      if (scrollTop > 0) { start = null; distance = 0; return 0; }
      distance = Math.min(maxPull, Math.max(0, (y - start) / 2));
      return distance;
    },
    /** True when the finger is released past the threshold. */
    end() { const fire = start !== null && distance >= threshold; start = null; distance = 0; return fire; },
    cancel() { start = null; distance = 0; },
  };
}
