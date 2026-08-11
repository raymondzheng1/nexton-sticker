"use client";
/**
 * Corrections — edit the club details, the roster, and the season fair-play rule.
 *
 * Same form as first run, seeded from the stored team, plus the two things only an existing team
 * has: carry-forward, and the delete. Wiring is the Back Page corrections screen's, 1:1 — including
 * the stored colour carried through untouched (the album has nothing to paint with it, but throwing
 * away a field the record still holds would be a lossy edit) and the played-minutes map, so
 * removing a player who has actually played asks first.
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { Player } from "@/engine";
import { useAppStore } from "@/store/appStore";
import { seasonReport } from "@/store/season";
import { sportOf } from "@/features/sports";
import { SquadEditor } from "@/features/teams/SquadEditor";
import { DEFAULT_TEAM_COLOUR, TeamForm, type TeamBasics } from "@/features/teams/TeamForm";
import { HandNote, HardButton, HardButtonLink, Kicker, Logo, Pill, cx, styles } from "@/ui";
import css from "@/features/teams/teams.module.css";

export default function EditTeamPage() {
  const router = useRouter();
  const params = useParams<{ teamId: string }>();
  const teamId = typeof params.teamId === "string" ? params.teamId : "";
  const ready = useAppStore((s) => s.ready);
  const team = useAppStore((s) => s.teams.find((t) => t.id === teamId));
  const saveTeam = useAppStore((s) => s.saveTeam);
  const deleteTeam = useAppStore((s) => s.deleteTeam);
  const listMatches = useAppStore((s) => s.listMatches);

  const [seeded, setSeeded] = useState(false);
  const [basics, setBasics] = useState<TeamBasics>({
    name: "",
    ageGroup: "",
    sport: "football",
    format: sportOf("football").defaultOnFieldCount,
  });
  const [roster, setRoster] = useState<Player[]>([]);
  const [carryForward, setCarryForward] = useState(false); // absent ⇒ OFF (fair per game)
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Minutes on the books, so removing a player who has actually played asks first. */
  const [played, setPlayed] = useState<Record<string, number>>({});

  useEffect(() => {
    if (team && !seeded) {
      setBasics({
        name: team.name,
        ageGroup: team.ageGroup ?? "",
        sport: team.sport ?? "football",
        format: team.defaultOnFieldCount,
      });
      setRoster(team.roster);
      setCarryForward(team.seasonCarryForward === true);
      setSeeded(true);
    }
  }, [team, seeded]);

  useEffect(() => {
    if (!teamId) return;
    void listMatches(teamId).then((ms) => {
      const totals: Record<string, number> = {};
      for (const row of seasonReport(ms)) totals[row.playerId] = row.totalSecondsOnField;
      setPlayed(totals);
    });
  }, [teamId, listMatches]);

  async function save(): Promise<void> {
    if (!team) return;
    setSaving(true);
    setError(null);
    try {
      await saveTeam({
        id: team.id,
        name: basics.name.trim() || team.name,
        ageGroup: basics.ageGroup.trim() || undefined,
        colour: team.colour || DEFAULT_TEAM_COLOUR,
        sport: basics.sport,
        defaultOnFieldCount: basics.format,
        roster,
        seasonCarryForward: carryForward,
      });
      router.push(`/teams/${team.id}`);
    } catch (e) {
      setSaving(false);
      setError(e instanceof Error ? e.message : "Couldn't save the changes. Try again.");
    }
  }

  async function remove(): Promise<void> {
    if (!team) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${team.name}? Its matches go with it, and this can't be undone here.`)
    ) {
      return;
    }
    try {
      await deleteTeam(team.id);
      router.push("/teams");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the team. Try again.");
    }
  }

  if (!ready) {
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <span className={css.headerLeft}>
            <Link href="/teams" className={styles.backLink} aria-label="Back to your teams">
              ‹
            </Link>
            <Logo href="/teams" />
          </span>
        </header>
        <div className={styles.gutter}>
          <p className={styles.empty}>Opening the album…</p>
        </div>
      </main>
    );
  }

  if (!team) {
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <span className={css.headerLeft}>
            <Link href="/teams" className={styles.backLink} aria-label="Back to your teams">
              ‹
            </Link>
            <Logo href="/teams" />
          </span>
        </header>
        <div className={styles.gutter}>
          <h1 className={css.hed}>No such team.</h1>
          <div className={css.foot}>
            <HardButtonLink href="/teams" variant="green">
              Back to your albums
            </HardButtonLink>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className={css.headerLeft}>
          <Link href={`/teams/${team.id}`} className={styles.backLink} aria-label={`Back to ${team.name}`}>
            ‹
          </Link>
          <Logo href="/teams" />
        </span>
        <Pill tone="neutral">Squad of {roster.length}</Pill>
      </header>

      <div className={styles.gutter}>
        <h1 className={css.hed}>Fix up the album.</h1>
        <p className={styles.body}>
          Nothing here is set in stone. Changes apply to the next match you set up — matches already
          played keep the squad they were played with.
        </p>

        <Kicker>Club details</Kicker>
        <TeamForm value={basics} onChange={(patch) => setBasics((b) => ({ ...b, ...patch }))} />

        <Kicker>Season fair play</Kicker>
        <div className={css.field}>
          <span className={css.fieldLabel}>Carry minutes forward between matches</span>
          <div className={css.chips}>
            {([true, false] as const).map((on) => (
              <button
                key={String(on)}
                type="button"
                className={cx(css.chip, carryForward === on && css.chipOn)}
                aria-pressed={carryForward === on}
                onClick={() => setCarryForward(on)}
              >
                {on ? "On" : "Off"}
              </button>
            ))}
          </div>
          <p className={styles.note}>
            <strong>Off (the default)</strong> — every match is balanced on its own, and season
            minutes are still tracked separately on the season page. <strong>On</strong> — players
            who&apos;ve had less time across the season are favoured to start and play more next
            time out.
          </p>
        </div>

        <Kicker>The roster</Kicker>
        <SquadEditor
          value={roster}
          onChange={setRoster}
          sport={basics.sport}
          playedSecondsById={played}
        />

        <div className={css.foot}>
          <HardButton variant="green" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </HardButton>
          {error ? <p className={css.error}>{error}</p> : null}
          <div style={{ marginTop: 8 }}>
            <HardButton
              variant="outline"
              size="md"
              onClick={() => void remove()}
              style={{ borderColor: "var(--red)", color: "var(--red)" }}
            >
              Delete team
            </HardButton>
          </div>
          <p className={css.footNote}>Saved on this phone · no account</p>
          <p style={{ textAlign: "center", margin: "6px 0 0" }}>
            <HandNote size={18} rotate={-1}>
              past matches keep their minutes ✓
            </HandNote>
          </p>
        </div>
      </div>
    </main>
  );
}
