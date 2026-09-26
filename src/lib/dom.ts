/**
 * Scrolls the app's main scroll container (the <main> in App shell) back to
 * the top. Used when switching tabs whose content heights differ wildly, so
 * the user never lands mid-page in the new tab.
 */
export function scrollMainToTop(smooth = false) {
  document
    .getElementById("app-main")
    ?.scrollTo({ top: 0, behavior: smooth ? "smooth" : "instant" });
}
