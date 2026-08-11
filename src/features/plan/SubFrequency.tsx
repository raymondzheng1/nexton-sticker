"use client";
/**
 * The rotation dial — how much rotation the coach wants to run to buy fairness — as a row of five
 * sticker chips. The logic is the proven wiring, verbatim: five levels indexed 1..MAX_SUB_LEVEL
 * (SUB_FREQUENCY_LEVELS from the engine), the coach's words for each, and a controlled
 * onChange(level) contract. Both the pre-match line-up screen and the live desk render this; the
 * caller owns what a level change does (local state pre-match, store.setSubFrequency live).
 */
import { SUB_FREQUENCY_LEVELS } from "@/engine";
import { cx, styles } from "@/ui";
import freq from "./subFrequency.module.css";

/** Rotation-dial level names, index = level − 1. The coach's words, not the algorithm's. */
export const SUB_LEVEL_LABELS = ["Fewest changes", "Fewer changes", "Balanced", "More changes", "Most changes"];

/** Chip words — the label's first word, sized for five-in-a-row at 390px. */
const CHIP_WORDS = ["Fewest", "Fewer", "Balanced", "More", "Most"];

export const MAX_SUB_LEVEL = SUB_FREQUENCY_LEVELS.length;

export function subLevelLabel(level: number): string {
  return SUB_LEVEL_LABELS[Math.round(level) - 1] ?? "Balanced";
}

/**
 * What a plan actually does, in a sentence. The average GAP is what a coach reasons in — "a change
 * every eight minutes" is something you can picture; "six windows" is not.
 */
export function cadenceSummary(windowSeconds: number[], totalSeconds: number): string {
  const n = windowSeconds.length;
  if (n === 0) return "No changes planned — the same players all the way through.";
  const gapMinutes = Math.max(1, Math.round(totalSeconds / (n + 1) / 60));
  return `${n} change${n === 1 ? "" : "s"} · roughly one every ${gapMinutes} min`;
}

export interface SubFrequencyProps {
  /** Current level, 1..MAX_SUB_LEVEL (match.config.subFrequency ?? DEFAULT_SUB_FREQUENCY). */
  value: number;
  /** Called with the tapped level. The caller re-plans; this component is fully controlled. */
  onChange: (level: number) => void;
  /** The cadence sentence — cadenceSummary(...) — printed under the chips and read to AT. */
  summary: string;
  /** An extra explanatory line, e.g. "Changes already made stay as they are…". */
  note?: string;
  /** Heading label. */
  label?: string;
}

export function SubFrequency({
  value,
  onChange,
  summary,
  note,
  label = "How often to change players",
}: SubFrequencyProps) {
  const current = Math.min(MAX_SUB_LEVEL, Math.max(1, Math.round(value)));
  return (
    <div>
      <div className={styles.spread}>
        <span className={styles.label}>{label}</span>
        <span className={freq.level}>{subLevelLabel(current)}</span>
      </div>
      <div
        className={freq.chips}
        role="radiogroup"
        aria-label={label}
        aria-description={`${subLevelLabel(current)} — ${summary}`}
      >
        {CHIP_WORDS.map((word, i) => {
          const level = i + 1;
          const active = level === current;
          return (
            <button
              key={word}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={SUB_LEVEL_LABELS[i] ?? word}
              className={cx(freq.chip, active && freq.chipOn)}
              onClick={() => onChange(level)}
            >
              {word}
            </button>
          );
        })}
      </div>
      <div className={freq.ends} aria-hidden>
        <span>Fewer · longer stints</span>
        <span>More · shorter stints</span>
      </div>
      <p className={freq.summary}>{summary}</p>
      {note !== undefined && <p className={styles.note}>{note}</p>}
    </div>
  );
}
