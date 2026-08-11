"use client";
/**
 * Fire-and-forget key-activity pings to the operator (/api/activity → Resend). STRICTLY
 * best-effort: the app is offline-first and telemetry must never block or break a coach's flow, so
 * every failure path is swallowed (the deliberate exception to loud-failures — this is operator
 * telemetry, not user data). No player names, never the capability code.
 */
import type { ActivityType } from "@/server/notify";

export function reportActivity(type: ActivityType, detail: string): void {
  if (typeof fetch === "undefined") return;
  try {
    void fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, detail: detail.slice(0, 300) }),
      keepalive: true, // survives navigation right after the triggering action
    }).catch(() => undefined);
  } catch {
    // Offline / blocked — fine.
  }
}

/**
 * Report a milestone that should fire at most ONCE on this device (e.g. first run). The flag is
 * written before the send so a failed/blocked request can't cause a repeat ping on the next visit —
 * a duplicate operator email is worse than a missed one. Falls through to a plain send when
 * localStorage is unavailable (private mode), which at worst re-sends.
 */
export function reportActivityOnce(type: ActivityType, detail: string): void {
  const key = `nexton:activity:${type}:v1`;
  try {
    if (typeof localStorage === "undefined") {
      reportActivity(type, detail);
      return;
    }
    if (localStorage.getItem(key) !== null) return;
    localStorage.setItem(key, new Date().toISOString());
  } catch {
    // Storage blocked — still send; a rare duplicate is acceptable.
  }
  reportActivity(type, detail);
}
