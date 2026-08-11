# Handoff: NextOn Marketing Page — "Sticker Album" direction (4b)

## Overview
A phone-first marketing/home page for **NextOn** (live site: https://nexton-taupe.vercel.app/), a free, offline-first PWA that tracks every youth player's minutes live and suggests substitutions so every kid gets fair game time. This direction styles the page as a **football sticker album**: cream paper, rotated sticker cards with white borders, handwritten margin notes, a foil "shiny rare" card for the suggestion panel — and the key storytelling device: **the player who needs minutes is a missing-sticker slot** (dashed outline).

## About the Design Files
`sticker-album-design.html` in this bundle is a **design reference created in HTML** — a prototype showing intended look, not production code to copy directly. The task is to **recreate this design in the target codebase's existing environment** (the live site is a Next.js/React app on Vercel) using its established patterns. If no environment exists, choose an appropriate framework and implement there.

## Fidelity
**High-fidelity.** Colors, typography, spacing, rotations, and copy are final intent — recreate pixel-perfectly at 390px, then adapt responsively (see Responsive behavior).

## Product rules (apply regardless of styling)
- Copy is honest: no invented testimonials, user counts, or logos.
- Players are neutral first names (Ava, Sam, Leo, Maya, Noah, Kit, Zara).
- Status system is always glyph + label + color (never color alone): ▲ needs minutes, ✓ on target/played, ▼ earned a rest.
- All numerals use `font-variant-numeric: tabular-nums`. Minutes use the prime mark (24′).
- Tap targets ≥ 44px; body text ≥ 12px.

## Screen: Marketing page (single scroll, 390px design width)
Page background cream `#f6edd9` with a faint paper-grain dot pattern (`radial-gradient(rgba(43,36,23,.05) 1px, transparent 1.2px)`, size 14px). Ink `#2b2417`.

1. **Header** — flex space-between, padding 16px 20px. Left: logo — 30px red `#e0452c` rounded square (radius 8, rotated −4°, hard shadow `0 2px 0 rgba(43,36,23,.25)`) containing white double-chevron SVG, next to "NextOn" Archivo 900 19px ("On" in red). Right: "season 2026 ✦" in Caveat 20px, tan `#8a7a55`, rotated 2°.
2. **Hero** — kicker "THE SQUAD ALBUM" 12px/800 uppercase tan. H1 Archivo 900, 44px/1.0: "Got it. Got it. **Needs minutes.**" (last phrase red). Sub 17px/1.55 `#5c5138`. CTA: green `#2b8a4b`, white, 52px, radius 14, weight 900, hard offset shadow `0 4px 0 rgba(43,36,23,.3)` (sticker-like, not blur). Trust row: "No account · Works offline · Free", 14px/700, separators `#c9b98e`.
3. **Sticker grid** — 3×2 CSS grid, gap 10px, padding 28px 16px 0. Five stickers: white frame (bg #fff, radius 8, padding 6px, soft shadow `0 3px 8px rgba(43,36,23,.18)`), each rotated alternately (−2°, 1.5°, −1°, 2°, 1°); inner face = vertical gradient panel (Sam green `#2b8a4b→#237a40` with 🧤; Maya blue `#2f6fbf→#275ea6`; Leo yellow `#e0a52c→#c98f1d`; Noah purple `#7a4fb3→#68409e`; Kit teal `#3aa08a→#2f8a76`; ⚽ emoji 22px + name 15px/900 white), footer strip on white: minutes + status 13.5px/800 (e.g. "18′ ✓", Leo reads "21′ ▼ rest"). **Sixth slot = Ava, the missing sticker**: 3px dashed `#c9553d` border, radius 8, faint red fill `rgba(224,69,44,.06)`, rotated −1.5°, min-height 104px, centered: "Ava" 15px/900 red + Caveat 19px "needs minutes! ▲ on next". Handwritten caption under grid: Caveat 21px tan, "the app fills the gaps before full time ↑", rotated −1°.
4. **Foil "shiny rare" suggestion card** — outer frame: diagonal pastel foil gradient `linear-gradient(115deg,#e9d8ff 0%,#ffe9c7 30%,#d2f4e0 62%,#cfe6ff 100%)`, radius 14, padding 7px, rotated .8°, shadow `0 6px 16px rgba(43,36,23,.22)`; badge pinned top-left (−11px): red pill "★ SHINY — RARE" 11.5px/900 uppercase. Inner white card radius 9, padding 14: header row "⇄ Next suggested change" 13.5px/800 tan vs countdown "3:50" Archivo 900 21px; progress bar 6px, track `#f0e6cf`, fill 72% green; suggestion row on `#faf5e8` radius 10: "Leo ▼ off" red `#c9553d` → "Ava ▲ on" green, position tag "left mid" tan 13px; buttons: "Confirm sub" green 44px radius 10 weight 900 with hard shadow, "⏱ Snooze" outlined 2px `#d9cba6`. Caption below, centered 15px: "**It suggests, you decide** — nothing happens until you tap."
5. **Steps 1-2-3** — three rows, gap 10: 34px circle badges (red / yellow / green, rotated −3°/2°/−2°, hard shadows, white 15px/900 numerals) + 15.5px text: "Stick your squad in once — first names only." / "Kick off — the sub plan's ready before the whistle." / "Tap to confirm subs — album complete at full time."
6. **"Swapsies note" receipt** — white card radius 12, soft shadow, rotated −.6°. Caveat 22px green title "swapsies note for the parents' chat:", then monospace 13px/1.65 tabular receipt: team, minutes per player, scorers, spread, "— via NextOn" in tan.
7. **Offline card** — 3px dashed `#c9b98e` border, radius 12, centered: "No wifi at the pitch? Perfect." 16.5px/900; body 14.5px `#5c5138` with red "Privacy →" link.
8. **Footer CTA** — red `#e0452c` CTA 52px radius 14 weight 900 hard shadow "Create your team"; Caveat 22px tan "free · no accounts · works offline".

## App screen: Live Game — "The Album Page"
In `live-game-design.html`. The during-play screen in the same album language. Layout top to bottom (390px):

1. **Header** — logo (30px rotated red plate + "NextOn" Archivo 900 18px) vs a red LIVE pill (`#e0452c`, radius 999, white 7px dot + "LIVE · P2 OF 4" 12px/900, hard shadow `0 2px 0 rgba(43,36,23,.25)`).
2. **Clock row** — match clock Archivo 900 44px tabular ("07:14"); under it a Caveat 19px tan note ("Riverside Lions · 2–1 up"). Right: "⏸ Hold" button, 84×48px white card, radius 12, hard shadow.
3. **Formation pitch (the album page)** — white sticker frame (radius 12, padding 7px, soft shadow, rotated −.5°) around a 330px portrait pitch: green vertical gradient `#3a9c5c→#2f8a4e`, mowing stripes (repeating-linear-gradient, 24px bands), white SVG pitch lines at `rgba(255,255,255,.55)` (border, halfway line, center circle, both boxes). **Players on = mini stickers positioned in formation** (2-2 + keeper for 5v5): white frame radius 7, padding 4px, drop shadow, rotated ±1–2°; face = player's gradient panel (name 13.5px/900 white; Leo carries ⚽ scorer mark); footer strip = live minutes + status, 12.5px/800 tabular, colored by state: "21′ ▼ rest" `#c9553d`, "17′ ✓" `#2b8a4b`. Positions: Leo 30%/22%, Kit 70%/22%, Maya 26%/55%, Noah 74%/55%, Sam (🧤, green) 50%/82%. Caption row below: Caveat "tap a sticker to swap ↑" left; legend right 12.5px/800: "▲ needs (`#2f6fbf`) · ✓ on target (`#2b8a4b`) · ▼ rest (`#c9553d`)".
4. **The bench** — kicker "THE BENCH" 12px/800 uppercase tan; two slots side by side: Ava = missing-sticker slot (3px dashed `#c9553d`, faint red fill, "8′ ▲ needs" blue, Caveat "on next!"); Zara = normal sticker (pink gradient `#c95f8e→#b34d7c`) with "10′ ▲ needs".
5. **Next-change foil card** — compact variant of the marketing card: foil gradient frame, red pill badge now reads "⇄ NEXT CHANGE"; inner white card holds swap row ("Leo ▼ off → Ava ▲ on") + countdown Archivo 900 20px right-aligned, 6px progress bar (72%, green on `#f0e6cf`), then "Confirm sub" (green, hard shadow) + "⏱ Snooze" (outlined, white bg), both 44px.
6. **Action bar** — two white sticker buttons 50px, radius 12, hard shadows: "⚽ Goal", "⇄ Sub now".

### Live-game behavior
- Clock counts up per period; Hold pauses (state persists offline).
- Minutes on every sticker tick live; status glyph+word+color updates as fair-share drift changes (never color alone).
- Tap an on-pitch sticker or bench sticker → swap picker (peel-off animation ≤300ms is acceptable); confirmed swaps move the sticker between pitch and bench and log the change.
- Countdown reaching 0:00 keeps the suggestion visible (it never auto-subs); Confirm executes the swap; Snooze +1:00; the suggestion row is editable by tapping it.
- ⚽ Goal → tap the scorer's sticker (adds ⚽ to its face); Sub now opens a manual swap immediately.
- Formation adapts to the on-pitch count (e.g. 1-2-2 at 5v5); stickers keep ≥44px tap targets.

## Interactions & Behavior
- CTAs → the app's create-team flow. "Privacy →" → privacy anchor/page.
- Hover (desktop): sticker cards straighten to rotate(0) and lift (shadow deepens) over 150ms ease-out; CTAs translateY(1px) with shadow shrinking to `0 2px 0` (pressed sticker feel); links underline.
- Optional delight (keep subtle): the Ava dashed slot can "fill in" (sticker fades/scales in) when it scrolls into view once, 300ms — do not loop.
- Links: default `a` color `#e0452c`, hover `#c9553d`.

## State Management
None — static marketing page.

## Design Tokens
- Cream paper `#f6edd9` · Ink `#2b2417` · Body `#5c5138` · Tan (handwriting/muted) `#8a7a55` · Red `#e0452c` (slot/deep red `#c9553d`) · Green `#2b8a4b` (dark `#237a40`) · Yellow `#e0a52c` · Blue `#2f6fbf` · Purple `#7a4fb3` · Teal `#3aa08a` · Border tan `#c9b98e` / `#d9cba6` · Card cream `#faf5e8` · Track `#f0e6cf` · Foil gradient `#e9d8ff / #ffe9c7 / #d2f4e0 / #cfe6ff`
- Type: **Archivo 800–900** (display, UI), **Caveat 600** (handwritten annotations), system sans body, ui-monospace for the receipt. Google Fonts: `family=Archivo:wght@800;900&family=Caveat:wght@600`.
- Shadows: hard offset `0 2–4px 0 rgba(43,36,23,.25–.3)` for sticker/CTA chrome; soft `0 3px 8px rgba(43,36,23,.18)` for cards.
- Radii: 14 (CTAs, foil), 12 (cards), 8 (stickers), 999 (badge pill). Rotations: ±0.6–4°.
- Text sizes: 44 / 22 / 21 / 20 / 19 / 17 / 16.5 / 15.5 / 15 / 14.5 / 13.5 / 13 / 12 / 11.5 (px).

## Responsive behavior
390px-first. ≥768px: max-width ~560px centered; sticker grid may go 3 columns wider with bigger stickers; keep rotations subtle at scale. The album texture (paper dots) tiles at any size.

## Assets
- No raster images. Logo chevrons are inline SVG; textures/gradients are CSS.
- Fonts: Archivo + Caveat via Google Fonts.
- Emoji used as sticker art: ⚽ 🧤 (plus ✦ ★ dingbats). Status glyphs ▲▼✓ are text.

## Files
- `sticker-album-design.html` — marketing page design reference; open in a browser at 390–430px width.
- `live-game-design.html` — the live game screen: formation pitch, live minutes per sticker, bench, next-change card.
