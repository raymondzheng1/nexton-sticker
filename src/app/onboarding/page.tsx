"use client";
/**
 * First run — two pages of the album: the club details, then "stick your squad in".
 *
 * Wiring is the Back Page onboarding's, 1:1 — the same guided two-step walk, the same first-run
 * activity ping, the same loud failure if the save doesn't land. The album's presentation: each
 * step wears its numbered circle badge from the design's 1-2-3 strip, and the coach's handwriting
 * annotates the margins.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Player } from "@/engine";
import { useAppStore } from "@/store/appStore";
import { sportOf } from "@/features/sports";
import { reportActivityOnce } from "@/store/telemetry";
import { SquadEditor } from "@/features/teams/SquadEditor";
import { DEFAULT_TEAM_COLOUR, TeamForm, type TeamBasics } from "@/features/teams/TeamForm";
import { HandNote, HardButton, HardButtonLink, Logo, cx, styles, tilt } from "@/ui";
import css from "@/features/teams/teams.module.css";

export default function OnboardingPage() {
  const router = useRouter();
  const saveTeam = useAppStore((s) => s.saveTeam);

  const [step, setStep] = useState<0 | 1>(0);
  const [basics, setBasics] = useState<TeamBasics>({
    name: "",
    ageGroup: "",
    sport: "football",
    format: sportOf("football").defaultOnFieldCount,
  });
  const [players, setPlayers] = useState<Player[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cfg = sportOf(basics.sport);
  const named = basics.name.trim().length > 0;

  // Reaching setup is a genuinely new user's first real intent signal (a marketing-page visit
  // isn't). Once per device — a coach adding a second team later won't re-fire it.
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    reportActivityOnce("first_run", `Started setup${tz ? ` · ${tz}` : ""}`);
  }, []);

  async function finish(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const team = await saveTeam({
        name: basics.name.trim(),
        ageGroup: basics.ageGroup.trim() || undefined,
        colour: DEFAULT_TEAM_COLOUR,
        sport: basics.sport,
        defaultOnFieldCount: basics.format,
        roster: players,
      });
      router.push(`/teams/${team.id}`);
    } catch (e) {
      // Loud, never silent (invariant #6): the coach has just typed a squad in and must not be
      // left thinking it saved.
      setSaving(false);
      setError(e instanceof Error ? e.message : "Couldn't save the team. Try again.");
    }
  }

  if (step === 0) {
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <span className={css.headerLeft}>
            <Link href="/teams" className={styles.backLink} aria-label="Back to your teams">
              ‹
            </Link>
            <Logo href="/" />
          </span>
          <HandNote size={20} rotate={2}>
            page 1 of 2
          </HandNote>
        </header>

        <div className={styles.gutter}>
          <div className={css.stepHeadRow}>
            <span
              className={cx(css.stepBadge, css.stepBadgeRed)}
              style={{ ["--tilt" as string]: `${tilt("onboarding-step-1", 3)}deg` }}
              aria-hidden
            >
              1
            </span>
            <h1 style={{ fontSize: 28 }}>Name the club.</h1>
          </div>
          <p className={styles.body}>
            The team, the game, and how many play at once. None of it is final — you can change any
            of it later, and the format again for a single match.
          </p>

          <TeamForm
            value={basics}
            onChange={(patch) => setBasics((b) => ({ ...b, ...patch }))}
            autoFocusName
          />

          <div className={css.foot}>
            <HardButton variant="green" onClick={() => setStep(1)} disabled={!named}>
              Next — the squad →
            </HardButton>
            <p style={{ textAlign: "center", margin: "8px 0 0" }}>
              <HandNote size={18} rotate={-1}>
                takes about a minute ✎
              </HandNote>
            </p>
            <p className={css.footNote}>Saved on this phone · no account</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className={css.headerLeft}>
          <Link href="/teams" className={styles.backLink} aria-label="Back to your teams">
            ‹
          </Link>
          <Logo href="/" />
        </span>
        <HandNote size={20} rotate={2}>
          page 2 of 2
        </HandNote>
      </header>

      <div className={styles.gutter}>
        <div className={css.stepHeadRow}>
          <span
            className={cx(css.stepBadge, css.stepBadgeYellow)}
            style={{ ["--tilt" as string]: `${tilt("onboarding-step-2", 3)}deg` }}
            aria-hidden
          >
            2
          </span>
          <h1 style={{ fontSize: 28 }}>Stick your squad in.</h1>
        </div>
        <p className={styles.body}>
          {basics.name.trim() || "New team"}
          {basics.ageGroup.trim() ? ` · ${basics.ageGroup.trim()}` : ""} — add everyone who might
          turn up{cfg.hasGoalkeeper ? ", keepers included" : ""}.
        </p>
        <p style={{ margin: "4px 0 0" }}>
          <HandNote size={19} rotate={-1}>
            first names are all it needs ↓
          </HandNote>
        </p>

        <SquadEditor value={players} onChange={setPlayers} sport={basics.sport} />

        <div className={css.foot}>
          <HardButton variant="green" onClick={() => void finish()} disabled={saving || !named}>
            {saving ? "Saving…" : "Done — open the album →"}
          </HardButton>
          {error ? <p className={css.error}>{error}</p> : null}
          <div className={css.footRow}>
            <HardButtonLink href="/teams" variant="outline" size="md">
              Cancel
            </HardButtonLink>
            <HardButton variant="outline" size="md" onClick={() => setStep(0)}>
              ← Club details
            </HardButton>
          </div>
          <p className={css.footNote}>Saved on this phone · no account</p>
        </div>
      </div>
    </main>
  );
}
