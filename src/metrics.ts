/** Fire once when the main app loads (counts page views, not sessions). */
export function recordPageView() {
  try {
    void fetch("/__metrics/pageview", { method: "POST", keepalive: true, cache: "no-store" });
  } catch {
    /* ignore */
  }
}
