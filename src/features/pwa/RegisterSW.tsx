"use client";
/**
 * Registers the service worker (public/sw.js) in production only — dev is left uncached so HMR and
 * fresh builds aren't served stale. Registration runs after `load` so it never contends with the
 * first paint. A failure is logged (never swallowed silently, Harness §7.1) but is non-fatal: the
 * app works fine without the SW, just without offline launch / cached repeat opens.
 */
import { useEffect } from "react";

export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // The effect already runs after the first paint, so register directly (no extra load-event
    // indirection, which raced and could be missed).
    navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
      console.warn("[NextOn] service worker registration failed", err);
    });
  }, []);

  return null;
}
