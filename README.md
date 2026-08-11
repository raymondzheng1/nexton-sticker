# NextOn Sticker

The NextOn substitution-fairness app restyled as a **football sticker album**: cream paper, rotated
white-bordered stickers, handwritten margin notes, a foil "shiny rare" suggestion card — and the
player who needs minutes shown as a **missing sticker** (dashed outline).

Same product underneath: a phone-first installable PWA that tracks every youth player's minutes
live and tells the coach when to sub and who, so playing time comes out fair. Football and
basketball. No accounts, works offline. The engine/store/server core is copied **verbatim** from
the sibling apps (278 shared regression tests) — see `CLAUDE.md` for the one rule that matters.

## Stack

Next.js (App Router) · TypeScript strict (no `any`) · Zustand + append-only event log · IndexedDB
local + Vercel KV (Upstash) sync via capability code · zod at every IO boundary · Vitest.

## Develop

```
npm ci
npm run dev       # no KV needed locally — /api/sync uses an in-memory store
```

## Verify (run before every push)

```
npm run verify    # onfield:check → eslint + tsc --noEmit → vitest (278 tests)
npx next build
```

## Deploy (Vercel)

Set `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` +
`UPSTASH_REDIS_REST_TOKEN`) — without them `/api/sync` fails closed (503). Optional:
`RESEND_API_KEY`, `RESEND_FROM` (must be on a Resend-verified domain), `CONTACT_TO_EMAIL`,
`CRON_SECRET` for `/api/keepwarm`.
