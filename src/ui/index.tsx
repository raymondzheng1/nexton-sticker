"use client";
/**
 * Sticker Album primitives.
 *
 * What earns a component here is anything that must stay physically identical across screens: the
 * logo plate, the pill badge, the sticker frame and its two inhabitants (a player sticker and the
 * MISSING sticker — the signature device), the foil rare card, the hard-shadowed buttons, and the
 * status chip. Everything is deterministic: rotations come from `tilt()` (an id hash), never from
 * Math.random.
 */
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { STATUS_META, type TokenStatus } from "@/features/live/status";
import styles from "./ui.module.css";

export { default as styles } from "./ui.module.css";
export type { TokenStatus } from "@/features/live/status";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ── formatters ───────────────────────────────────────────────────────────── */

/** mm:ss — the live clock. */
export function clockTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Minutes with the prime mark, as every number in this album is written: 24′ */
export function mins(seconds: number): string {
  return `${Math.round(seconds / 60)}′`;
}

/* ── deterministic tilt ───────────────────────────────────────────────────── */

/**
 * The album's rotation, without dice: hash a stable seed (player id, window key) into a lean of
 * ±maxDeg, floored at ±0.6° so nothing sits perfectly square (a straight sticker reads as a
 * rendering bug in this design, not neatness). Same seed → same lean, every render, every device.
 */
export function tilt(seed: string, maxDeg = 2): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (h * 33) ^ seed.charCodeAt(i);
  const unit = ((h >>> 0) % 1000) / 999; // 0..1
  const raw = (unit * 2 - 1) * maxDeg;
  const floor = Math.min(0.6, Math.abs(maxDeg));
  const leaned = Math.abs(raw) < floor ? (raw < 0 ? -floor : floor) : raw;
  return Math.round(leaned * 10) / 10;
}

/** Inline style carrying the tilt custom property the module CSS rotates by. */
function tiltStyle(deg: number, style?: CSSProperties): CSSProperties {
  return { ...style, ["--tilt" as string]: `${deg}deg` };
}

/* ── brand ────────────────────────────────────────────────────────────────── */

interface LogoProps {
  /** Plate edge in px; the chevron and wordmark scale off it. */
  size?: number;
  /** Set false for the bare red plate (tab bars, tight corners). */
  wordmark?: boolean;
  /** Wraps the logo in a home link when given (e.g. "/"). */
  href?: string;
}

/** The red plate + double chevron, with "NextOn" — Archivo 900, "On" in red. */
export function Logo({ size = 30, wordmark = true, href }: LogoProps) {
  const body = (
    <span className={styles.logo}>
      <span className={styles.logoPlate} style={{ width: size, height: size }} aria-hidden>
        <svg
          width={size / 2}
          height={size / 2}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 5l7 7-7 7" />
          <path d="M13 5l7 7-7 7" opacity=".55" />
        </svg>
      </span>
      {wordmark && (
        <span className={styles.logoWord} style={{ fontSize: Math.round(size * 0.63) }}>
          Next<span className={styles.logoOn}>On</span>
        </span>
      )}
    </span>
  );
  return href ? (
    <Link href={href} aria-label="NextOn home" style={{ textDecoration: "none" }}>
      {body}
    </Link>
  ) : (
    body
  );
}

/* ── pill / kicker / handwriting ──────────────────────────────────────────── */

interface PillProps {
  children: ReactNode;
  /** red = the loud badge (LIVE, SHINY RARE); neutral = white sticker chip. */
  tone?: "red" | "neutral";
  /** Leading 7px dot (the LIVE pulse). */
  dot?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Radius-999 badge; 11.5px/900 uppercase — the sanctioned micro-label. */
export function Pill({ children, tone = "red", dot = false, className, style }: PillProps) {
  return (
    <span
      className={cx(styles.pill, tone === "red" ? styles.pillRed : styles.pillNeutral, className)}
      style={style}
    >
      {dot && <span className={styles.pillDot} aria-hidden />}
      {children}
    </span>
  );
}

/** 12px/800 uppercase tan section label — the album's section head. */
export function Kicker({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <h2 className={styles.kicker} style={style}>
      {children}
    </h2>
  );
}

interface HandNoteProps {
  children: ReactNode;
  /** Caveat px size. The margins write at 17–22. */
  size?: number;
  /** Degrees; handwriting is rarely level. */
  rotate?: number;
  /** Any token colour; tan by default. */
  color?: string;
  style?: CSSProperties;
}

/** The coach's handwriting in the margins — Caveat 600, tan, slightly rotated. */
export function HandNote({ children, size = 19, rotate = 0, color, style }: HandNoteProps) {
  return (
    <span
      className={styles.hand}
      style={{
        fontSize: size,
        color,
        transform: rotate === 0 ? undefined : `rotate(${rotate}deg)`,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/* ── sticker frame ────────────────────────────────────────────────────────── */

interface StickerFrameProps {
  children: ReactNode;
  /** Degrees of lean. Compute with tilt(seed, maxDeg); default 0 sits square. */
  tiltDeg?: number;
  className?: string;
  style?: CSSProperties;
}

/** White border stock, radius 8, padding 6, soft shadow — everything stuck in is framed by this. */
export function StickerFrame({ children, tiltDeg = 0, className, style }: StickerFrameProps) {
  return (
    <div className={cx(styles.stickerFrame, className)} style={tiltStyle(tiltDeg, style)}>
      {children}
    </div>
  );
}

/* ── player sticker ───────────────────────────────────────────────────────── */

/** The six face gradients, top→bottom. Assignment is a stable hash of the player id. */
const FACES: readonly { a: string; b: string }[] = [
  { a: "#2b8a4b", b: "#237a40" }, // green
  { a: "#2f6fbf", b: "#275ea6" }, // blue
  { a: "#e0a52c", b: "#c98f1d" }, // yellow
  { a: "#7a4fb3", b: "#68409e" }, // purple
  { a: "#3aa08a", b: "#2f8a76" }, // teal
  { a: "#c95f8e", b: "#b34d7c" }, // pink
];

/** Which of the six gradient faces a player wears — stable across screens and sessions. */
export function faceOf(playerId: string): { a: string; b: string } {
  let h = 5381;
  for (let i = 0; i < playerId.length; i++) h = (h * 33) ^ playerId.charCodeAt(i);
  return FACES[(h >>> 0) % FACES.length] ?? { a: "#2b8a4b", b: "#237a40" };
}

const STATUS_CLASS: Record<TokenStatus, string> = {
  on: styles.statusOn ?? "",
  under: styles.statusUnder ?? "",
  over: styles.statusOver ?? "",
};

/** "21′ ▼ rest" — minutes then glyph then word, never colour alone. */
function footLine(seconds: number, status: TokenStatus | null | undefined): ReactNode {
  if (status === null || status === undefined) return mins(seconds);
  const meta = STATUS_META[status];
  return (
    <span className={STATUS_CLASS[status]} title={meta.label}>
      {mins(seconds)} {meta.glyph} {meta.short.toLowerCase()}
    </span>
  );
}

export interface PlayerStickerProps {
  /** Seeds the face gradient and the default tilt. */
  playerId: string;
  name: string;
  /** Footer minutes. Omit (with `footer`) when the strip says something else. */
  seconds?: number;
  /** Colours + glyphs the footer; null/undefined prints plain minutes. */
  status?: TokenStatus | null;
  /** 🧤 keeper — swaps the default ⚽ art and prefixes the mini face. */
  gk?: boolean;
  /**
   * grid — the album cell: emoji art above the name, 15px face, 13.5px footer.
   * mini — the on-pitch sticker: name-only face at 13.5px, 12.5px footer.
   */
  size?: "grid" | "mini";
  /** Override the art emoji (grid size only; ⚽/🧤 by default). Empty string hides it. */
  emoji?: string;
  /** Scorer's mark etc., appended to the face name: "⚽", "⚽ 2". */
  scoreMark?: string;
  /** Keep-on lock — 🔒 rides on the face so the constraint is visible on the sticker itself. */
  locked?: boolean;
  /** Replaces the minutes/status strip entirely (e.g. a position label pre-match). */
  footer?: ReactNode;
  /** Degrees; defaults to tilt(playerId, 2). Pass 0 to sit square. */
  tiltDeg?: number;
  selected?: boolean;
  /** Renders the sticker as a ≥44px button. */
  onClick?: () => void;
  disabled?: boolean;
  /** Voice-over text for the button form; defaults to the visible content. */
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * A player as a sticker: white frame, gradient face with their name (and art at grid size), and a
 * white footer strip carrying live minutes + fairness status — glyph + word + colour, all three.
 */
export function PlayerSticker({
  playerId,
  name,
  seconds,
  status,
  gk = false,
  size = "grid",
  emoji,
  scoreMark,
  locked = false,
  footer,
  tiltDeg,
  selected = false,
  onClick,
  disabled = false,
  ariaLabel,
  className,
  style,
}: PlayerStickerProps) {
  const face = faceOf(playerId);
  const lean = tiltDeg ?? tilt(playerId, 2);
  const mini = size === "mini";
  const art = emoji ?? (gk ? "🧤" : "⚽");

  const inner = (
    <>
      <span
        className={cx(styles.psFace, mini ? styles.psFaceMini : styles.psFaceGrid)}
        style={{ display: "block", ["--face-a" as string]: face.a, ["--face-b" as string]: face.b }}
      >
        {!mini && art !== "" && (
          <span className={styles.psArt} aria-hidden>
            {art}
          </span>
        )}
        <span className={cx(styles.psName, mini && styles.psNameMini)}>
          {mini && gk ? "🧤 " : ""}
          {name}
          {scoreMark ? ` ${scoreMark}` : ""}
          {locked ? " 🔒" : ""}
        </span>
      </span>
      <span className={cx(styles.psFoot, mini && styles.psFootMini)}>
        {footer !== undefined ? footer : footLine(seconds ?? 0, status)}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={selected}
        aria-label={ariaLabel}
        className={cx(styles.stickerFrame, styles.ps, styles.psTappable, selected && styles.psSelected, className)}
        style={tiltStyle(lean, style)}
      >
        {inner}
      </button>
    );
  }
  return (
    <div
      className={cx(styles.stickerFrame, styles.ps, selected && styles.psSelected, className)}
      style={tiltStyle(lean, style)}
    >
      {inner}
    </div>
  );
}

/* ── missing slot ─────────────────────────────────────────────────────────── */

export interface MissingSlotProps {
  name: string;
  /** The handwritten annotation: "needs minutes! ▲ on next", "on next!". */
  note?: ReactNode;
  /** An extra printed line — compose minutes + StatusChip here ("8′ ▲ needs"). */
  detail?: ReactNode;
  /** Degrees; defaults to tilt(name, 1.5). */
  tiltDeg?: number;
  /** The album cell reserves 104px; bench slots may pass less. */
  minHeight?: number;
  selected?: boolean;
  /** Renders the slot as a ≥44px button (bench slots are tappable live). */
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * THE signature device: the sticker that isn't there yet. A dashed red outline where a player
 * should be — the album showing, not telling, who needs minutes.
 */
export function MissingSlot({
  name,
  note,
  detail,
  tiltDeg,
  minHeight = 104,
  selected = false,
  onClick,
  disabled = false,
  ariaLabel,
  className,
  style,
}: MissingSlotProps) {
  const lean = tiltDeg ?? tilt(name, 1.5);
  const body = (
    <>
      <span className={styles.missingName}>{name}</span>
      {detail !== undefined && <span className={styles.missingDetail}>{detail}</span>}
      {note !== undefined && <span className={styles.missingNote}>{note}</span>}
    </>
  );
  const styleAll = tiltStyle(lean, { minHeight, ...style });
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={selected}
        aria-label={ariaLabel}
        className={cx(styles.missing, styles.missingTappable, selected && styles.missingSelected, className)}
        style={styleAll}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={cx(styles.missing, className)} style={styleAll}>
      {body}
    </div>
  );
}

/* ── foil card ────────────────────────────────────────────────────────────── */

export interface FoilCardProps {
  /** Content of the pinned red pill: "★ SHINY — RARE", "⇄ NEXT CHANGE". */
  badge: ReactNode;
  children: ReactNode;
  /** Degrees; the rare card leans a stock 0.8° unless told otherwise. */
  tiltDeg?: number;
  className?: string;
  style?: CSSProperties;
}

/** The shiny rare: pastel foil frame, radius 14, badge pinned over the top-left corner. */
export function FoilCard({ badge, children, tiltDeg = 0.8, className, style }: FoilCardProps) {
  return (
    <div className={cx(styles.foil, className)} style={tiltStyle(tiltDeg, style)}>
      <span className={styles.foilBadge}>
        <Pill tone="red">{badge}</Pill>
      </span>
      <div className={styles.foilInner}>{children}</div>
    </div>
  );
}

/* ── hard buttons ─────────────────────────────────────────────────────────── */

type HardVariant = "green" | "red" | "outline";

const HARD_CLASS: Record<HardVariant, string> = {
  green: styles.hardGreen ?? "",
  red: styles.hardRed ?? "",
  outline: styles.hardOutline ?? "",
};

interface HardButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: HardVariant;
  /** lg = 52px radius 14 (the CTA); md = 44px radius 10 (in-card actions). */
  size?: "lg" | "md";
  /** Shrink-to-fit instead of full width. */
  auto?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  ariaLabel?: string;
  style?: CSSProperties;
}

/** The CTA chrome: hard offset shadow, pressed-flat :active. Green confirms, red commits, outline declines. */
export function HardButton({
  children,
  onClick,
  variant = "green",
  size = "lg",
  auto = false,
  disabled = false,
  type = "button",
  ariaLabel,
  style,
}: HardButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={style}
      className={cx(styles.hardBtn, HARD_CLASS[variant], size === "md" && styles.hardMd, auto && styles.hardAuto)}
    >
      {children}
    </button>
  );
}

/** Same chrome as HardButton, but a link — every CTA that navigates. */
export function HardButtonLink({
  href,
  children,
  variant = "green",
  size = "lg",
  auto = false,
  style,
}: {
  href: string;
  children: ReactNode;
  variant?: HardVariant;
  size?: "lg" | "md";
  auto?: boolean;
  style?: CSSProperties;
}) {
  return (
    <Link
      href={href}
      style={style}
      className={cx(styles.hardBtn, HARD_CLASS[variant], size === "md" && styles.hardMd, auto && styles.hardAuto)}
    >
      {children}
    </Link>
  );
}

/* ── progress track ───────────────────────────────────────────────────────── */

/** 6px track (#f0e6cf) with the green fill; optional red tick (the fair-share mark). */
export function ProgressTrack({ pct, tickPct }: { pct: number; tickPct?: number }) {
  return (
    <span className={styles.progress} aria-hidden>
      <span className={styles.progressFill} style={{ width: `${Math.max(0, Math.min(100, pct))}%`, display: "block" }} />
      {tickPct !== undefined && (
        <span className={styles.progressTick} style={{ left: `${Math.max(0, Math.min(100, tickPct))}%` }} />
      )}
    </span>
  );
}

/* ── status chip ──────────────────────────────────────────────────────────── */

/** The three words the album uses beside the glyphs. */
const STATUS_WORD: Record<TokenStatus, string> = {
  under: "needs",
  on: "on target",
  over: "rest",
};

/** Glyph + word + colour, always all three — a coach who can't see red still reads "rest". */
export function StatusChip({ kind, wordless = false }: { kind: TokenStatus; wordless?: boolean }) {
  const meta = STATUS_META[kind];
  return (
    <span className={cx(styles.status, STATUS_CLASS[kind])} title={meta.label}>
      {wordless ? meta.glyph : `${meta.glyph} ${STATUS_WORD[kind]}`}
      {wordless && <span className={styles.srOnly}> {meta.label}</span>}
    </span>
  );
}

/* ── sheet + toast ────────────────────────────────────────────────────────── */

export function Toast({ message }: { message: string }) {
  return (
    <div className={styles.toast} role="status">
      {message}
    </div>
  );
}

/** Bottom sheet — a card peeled up from the album page. */
export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={styles.sheet} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
