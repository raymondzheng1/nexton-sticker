/**
 * GET /api/keepwarm — a cheap endpoint a Vercel cron pings to keep the serverless function warm,
 * trimming the ~1s cold-start on the first hit after the lambda idles (Harness §7.10). Does no work
 * beyond returning OK; warming the instance is the point.
 *
 * Guarded by CRON_SECRET when set (Vercel cron sends `Authorization: Bearer <CRON_SECRET>`), so it
 * can't be spammed; if no secret is configured it stays open (harmless no-op). Cron schedule lives
 * in vercel.json. (Note: Vercel Hobby effectively caps cron frequency to ~daily; the sub-hourly
 * schedule takes full effect on Pro.)
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // always execute (no caching) so the instance actually warms

export function GET(req: Request): NextResponse {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
