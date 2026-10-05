// fitd's cookieless analytics: sends anonymous events to our own server
// (/api/t). Nothing is stored in the browser. Importing this module records a
// page view; call track() for anything else.

export function track(event, props = {}) {
  const body = JSON.stringify({ e: event, p: props, r: event === "pageview" ? document.referrer : undefined });
  try {
    // sendBeacon survives the page closing; fall back to fetch if it's refused.
    if (!navigator.sendBeacon?.("/api/t", body)) {
      fetch("/api/t", { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* analytics must never break the page */
  }
}

track("pageview", { path: location.pathname });
