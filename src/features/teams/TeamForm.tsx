"use client";
/**
 * The club-details block — name, age group, sport, and how many play at once. Shared by onboarding
 * and the corrections screen so the two can never drift apart. Wiring is the Back Page's, 1:1; the
 * presentation is album chips: a loose sticker is an option, a stuck-down sticker is the choice.
 */
import type { Sport } from "@/engine";
import { SPORTS, sportOf } from "@/features/sports";
import { cx, styles } from "@/ui";
import css from "./teams.module.css";

/** The formats a grassroots coach reaches for first; the stepper still gets to any number. */
export const FORMAT_PRESETS = [5, 7, 9, 11];

/**
 * The album has no team colours to pick — paper, cream and the six sticker faces are the whole
 * palette — but the stored record still carries a colour. New teams take the album ink; an edited
 * team keeps what it had.
 */
export const DEFAULT_TEAM_COLOUR = "#2b2417";

export interface TeamBasics {
  name: string;
  ageGroup: string;
  sport: Sport;
  /** Players per side / on court. Never assumed — every downstream size derives from it. */
  format: number;
}

interface TeamFormProps {
  value: TeamBasics;
  onChange: (patch: Partial<TeamBasics>) => void;
  autoFocusName?: boolean;
}

const SPORT_ICON: Record<Sport, string> = { football: "⚽", basketball: "🏀" };

export function TeamForm({ value, onChange, autoFocusName = false }: TeamFormProps) {
  const cfg = sportOf(value.sport);

  // Switching sport re-defaults the format to that sport's norm — a coach moving to basketball
  // means 5-on-court, not "7-a-side basketball".
  function pickSport(sport: Sport): void {
    onChange({ sport, format: sportOf(sport).defaultOnFieldCount });
  }

  function step(delta: number): void {
    onChange({ format: Math.max(3, Math.min(16, value.format + delta)) });
  }

  return (
    <>
      <div className={css.field}>
        <label className={css.fieldLabel} htmlFor="team-name">
          Team name
        </label>
        <input
          id="team-name"
          placeholder="e.g. Riverside Lions"
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          autoFocus={autoFocusName}
        />
      </div>

      <div className={css.field}>
        <label className={css.fieldLabel} htmlFor="team-age">
          Age group (optional)
        </label>
        <input
          id="team-age"
          placeholder="e.g. U10"
          value={value.ageGroup}
          onChange={(e) => onChange({ ageGroup: e.target.value })}
        />
      </div>

      <div className={css.field}>
        <span className={css.fieldLabel}>Sport</span>
        <div className={css.chips}>
          {Object.values(SPORTS).map((s) => (
            <button
              key={s.id}
              type="button"
              className={cx(css.chip, s.id === value.sport && css.chipOn)}
              aria-pressed={s.id === value.sport}
              onClick={() => pickSport(s.id)}
            >
              {SPORT_ICON[s.id]} {s.label}
            </button>
          ))}
        </div>
        <p className={styles.note}>
          Football is the default. Basketball plays {SPORTS.basketball.defaultOnFieldCount} on court,
          two {SPORTS.basketball.defaultPeriodLengthMinutes}-minute periods, no keeper.
        </p>
      </div>

      <div className={css.field}>
        <span className={css.fieldLabel}>
          Usual format — players {cfg.hasGoalkeeper ? "per side" : "on court"}
        </span>
        <div className={css.chips}>
          {FORMAT_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              className={cx(css.chip, n === value.format && css.chipOn)}
              aria-pressed={n === value.format}
              onClick={() => onChange({ format: n })}
            >
              {n}
              {cfg.formatSuffix}
            </button>
          ))}
        </div>
        <div className={css.stepCard}>
          <span className={css.fieldLabel}>{cfg.surfaceLabel}</span>
          <div className={css.stepRow}>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="One fewer player"
              onClick={() => step(-1)}
              disabled={value.format <= 3}
            >
              −
            </button>
            <span className={css.stepValue}>
              {value.format}
              {cfg.formatSuffix}
            </span>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="One more player"
              onClick={() => step(1)}
              disabled={value.format >= 16}
            >
              +
            </button>
          </div>
        </div>
        <p className={styles.note}>Any number works, and you can change it for a single match.</p>
      </div>
    </>
  );
}
