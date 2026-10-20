
export function isNearBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 96;
}

export function scrollMessagesToBottom(smooth: boolean) {
  window.requestAnimationFrame(() => {
    const viewport = document.querySelector<HTMLDivElement>(".messages-viewport");
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  });
}
