# CLAUDE.md — NextOn Sticker (operating manual)

> Read this before changing anything.
> Design intent lives in `design/README.md` + the two HTML reference files beside it.

---

## What this is

**NextOn Sticker** is the NextOn substitution-fairness app **restyled as a football sticker album**.
It is a *lift and shift*: the product's behaviour is unchanged, the entire presentation layer is new.

It is a **separate app** from the original NextOn (`../`, deployed at nexton-taupe.vercel.app) and
from NextOn Back Page (`../NextOn-BackPage`, the tabloid re-skin). Those stay exactly as they are.
This one has its own repo: `https://github.com/raymondzheng1/nexton-sticker`.

Same product: a phone-first installable PWA that tracks every youth player's minutes live and tells
a volunteer coach when to substitute and who, so playing time comes out fair. Football and
basketball. No accounts, works offline.

---

## The one rule that matters

**`src/engine/`, `src/store/`, `src/server/`, `src/app/api/` and the pure feature modules were
copied VERBATIM (byte-identical) from NextOn Back Page, and all 278 tests pass unchanged. Do not
restyle them. Do not refactor them. They are the product's correctness.**

That transplant is only possible because the engine is pure — no React, no Next, no IO, no clock
reads, no `Math.random`. Keep it that way. If a UI need ever seems to require touching the engine,
it almost certainly doesn't.

Copied verbatim and off-limits to styling work:

```
src/engine/**                          pure fairness engine, 100% reusable
src/store/**                           repository, sync, live store, schema
src/server/**                          Resend notify + rate limiting
src/app/api/**                         sync · contact · activity · keepwarm
src/features/sports.ts                 sport config
src/features/live/matchFeed.ts         match log derivation
src/features/live/status.ts            fairness status thresholds
src/features/live/surfaceLayout.ts     pitch/court geometry
src/features/live/index.ts             the logic-only live barrel
src/features/plan/subbingGrid.ts       subbing sheet grid
src/features/lineup/lineup.ts          drag/drop lineup logic
tests/**                               the whole regression corpus
```

The presentation layer that IS this app's work: `src/ui/**` (the primitive kit),
`src/features/live/AlbumPitch.tsx`, `src/features/plan/{SubFrequency,ProjectedMinutes,PlanTimeline}.tsx`
and every screen under `src/app/**` (except `api/`). Wiring for the screens is ported 1:1 from Back
Page's browser-proven pages, then presented in the album language.

---

## The design: "Sticker Album"

A football sticker album. Cream paper with a faint grain, white-bordered stickers lying slightly
rotated, handwritten margin notes in Caveat, ONE foil "shiny rare" frame for the suggestion card —
and the signature device: **the player who needs minutes is a MISSING sticker** (3px dashed red
outline, faint red fill). The conceit is load-bearing: an album is a collection you complete, which
is exactly what fair minutes are.

**Tokens** (`src/app/globals.css` — the single source of truth, don't hard-code these):

| | |
|---|---|
| Paper | `#f6edd9` + grain dots (radial-gradient, 14px tile) |
| Ink | `#2b2417` · body `#5c5138` · tan (handwriting/muted) `#8a7a55` |
| Red | `#e0452c` (deep `#c9553d`) |
| Faces | green `#2b8a4b` · blue `#2f6fbf` · yellow `#e0a52c` · purple `#7a4fb3` · teal `#3aa08a` · pink `#c95f8e` (each with its dark stop) |
| Borders | tan `#c9b98e` / `#d9cba6` · card cream `#faf5e8` · track `#f0e6cf` |
| Foil | `linear-gradient(115deg,#e9d8ff,#ffe9c7,#d2f4e0,#cfe6ff)` |
| Status | ▲ needs `#2f6fbf` · ✓ on target `#2b8a4b` · ▼ rest `#c9553d` |

**Shadows** — hard offset (`0 2–4px 0 rgba(43,36,23,.25–.3)`) for sticker/CTA chrome: a sticker is
a physical thing with an edge, not a glow. Soft (`0 3px 8px rgba(43,36,23,.18)`) for cards only.
Pressed = `translateY(1px)` with the shadow shrinking to `0 2px 0`.

**Radii are fixed** — 14 CTA/foil · 12 cards · 8 stickers · 999 pills. Nothing else.

**Rotations** — ±0.6–4°, ALWAYS deterministic via `tilt(seed, maxDeg)` (an id hash). No
`Math.random` anywhere, ever — same rule as the engine, applied to the paper.

**Type** — Archivo 800/900 for display and UI labels, Caveat 600 for handwriting, system sans for
body copy, ui-monospace for the receipt. Self-hosted via `next/font` (offline-safe). Every numeral
tabular; minutes take the prime mark (`24′`).

**No dark mode.** A sticker album is paper. `color-scheme: light` is set deliberately — the same
call the newspaper app made. Revisit only if the owner asks.

---

## Non-negotiable invariants (unchanged from the original)

1. **No hard-coded `onFieldCount`.** Players-per-side is arbitrary (3–11+). Everything derives from
   `match.onFieldCount`; positions come from `surfaceLayout`'s `pitchLayout()`/`courtLayout()` —
   the mockup's fixed 5v5 coordinates are illustration, not spec. Enforced by
   `scripts/onfield-count-check.mjs`.
2. **Advisory only.** The app never auto-subs. Every suggestion is confirm/edit/snooze/dismiss.
3. **Keep-on is a hard constraint.** A locked player is never suggested off.
4. **Multi-substitution is first-class.** Confirm-all with per-line edit and remove.
5. **Determinism.** No `Math.random`, no wall-clock reads inside the engine. Time is injected.
   The album's rotations obey the same law via `tilt()`.
6. **Loud failures.** No empty `catch`. Sync and email failures surface; they never vanish.
7. **Pure engine.** `src/engine/**` imports nothing from Next, React, the store, or any IO.
8. **Offline-first.** Every core flow works against IndexedDB with no network.
9. **Colour is never the only signal.** Status is glyph + word + colour, always all three.
10. **≥44px tap targets. Body copy ≥12px.** The floor is on BODY COPY. Uppercase micro-labels —
    pills, chip words, table column heads — sit at 11.5px, which the design specifies explicitly.
    Don't "fix" those to 12px; do hold the line on anything a coach reads as a sentence.
11. **Reduced motion is honoured.** Hover straighten/lift, the flash pop and the missing-slot
    fill-in delight are all disabled under `prefers-reduced-motion`.
12. **Copy is honest.** No invented testimonials or user counts. Neutral first names.

---

## The gate

```
npm run verify   # onfield:check → eslint + tsc --noEmit → vitest (278 tests)
```

Run it before every push. It also runs in CI on push and PR (`.github/workflows/verify.yml`).
`npx next build` must also pass. Never run `next build` and `next dev` against the same `.next` —
delete `.next` when switching.

---

## Environment

- **Local:** `npm run dev`. With no KV configured, `/api/sync` uses an in-memory store so everything
  works offline.
- **Production (Vercel):** needs `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or the `UPSTASH_*` pair)
  or `/api/sync` fails closed with 503. Optional: `RESEND_API_KEY` (+ `RESEND_FROM`,
  `CONTACT_TO_EMAIL`) for the contact form and activity pings, and `CRON_SECRET` to guard
  `/api/keepwarm`.
- **`RESEND_FROM` must be an address on a domain verified in Resend.** The sandbox sender
  `onboarding@resend.dev` only delivers to the Resend account owner and is not production-safe.

---

## Do / Don't

**Do** — derive everything on-field from `match.onFieldCount` · keep the engine pure · use the
tokens and the `src/ui` primitives rather than inventing colours · seed every rotation through
`tilt()` · keep status as glyph + word + colour · land a regression test named after the symptom
with every bug fix.

**Don't** — restyle or refactor the copied core · hard-code a players-per-side number · auto-apply
a suggestion · use `any` or non-null assertions · use `Math.random` for a tilt · add a radius
outside the fixed four · add a dark theme · invent testimonials or counts.
