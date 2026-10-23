
export function isNearBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 96;
}

export function scrollMessagesToBottom(smooth: boolean) {
  window.requestAnimationFrame(() => {
    const viewport = document.querySelector<HTMLDivElement>(".messages-viewport");
    if (!viewport) return;
    const question = viewport.querySelector<HTMLElement>(".user-input-card");
    const top = question ? viewport.scrollTop + question.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12 : viewport.scrollHeight;
    viewport.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  });
}
