"use client";
/**
 * The team hub — one club's page of the album: the squad as a grid of collected stickers, and the
 * fixture list as dateline rows.
 *
 * Wiring is the Back Page team sheet's, 1:1 — including the matchRev-driven re-fetch so the list is
 * never stale after the router restores this screen from its cache, and the honest score: NextOn
 * logs who scored for us and nothing about the opposition, so it prints "3 ⚽" and never "3–2".
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAppStore } from "@/store/appStore";
import { sportOf } from "@/features/sports";
import type { SavedMatch } from "@/store/schema";
import {
  HandNote,
  HardButtonLink,
  Kicker,
  Logo,
  Pill,
  PlayerSticker,
  cx,
  styles,
  tilt,
} from "@/ui";
import { dateline, pointsOf, positionTag, statusWord } from "@/features/teams/presenters";
import css from "@/features/teams/teams.module.css";

export default function TeamPage() {
  const params = useParams<{ teamId: string }>();
  const teamId = typeof params.teamId === "string" ? params.teamId : "";
  const ready = useAppStore((s) => s.ready);
  const team = useAppStore((s) => s.teams.find((t) => t.id === teamId));
  const listMatches = useAppStore((s) => s.listMatches);
  const deleteMatch = useAppStore((s) => s.deleteMatch);
  // Re-fetch whenever match data changes (create/delete/kickoff/end) so the fixture list is never
  // stale after the router restores this screen from its cache.
  const matchRev = useAppStore((s) => s.matchRev);
  const [matches, setMatches] = useState<SavedMatch[]>([]);

  useEffect(() => {
    if (teamId) void listMatches(teamId).then(setMatches);
  }, [teamId, listMatches, team, matchRev]);

  async function removeMatch(m: SavedMatch): Promise<void> {
    if (typeof window !== "undefined" && !window.confirm(`Delete ${m.name}? This can't be undone.`))
      return;
    await deleteMatch(m.id);
    setMatches(await listMatches(teamId));
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
          <p className={styles.body}>
            It may have been deleted on this device, or the link is for a squad that lives under a
            different sync code.
          </p>
          <div className={css.foot}>
            <HardButtonLink href="/teams" variant="green">
              Back to your albums
            </HardButtonLink>
          </div>
        </div>
      </main>
    );
  }

  const cfg = sportOf(team.sport);
  const keepers = team.roster.filter((p) => p.canPlayGK).length;
  const fixtures = matches.slice().reverse(); // newest first, as a results column reads

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className={css.headerLeft}>
          <Link href="/teams" className={styles.backLink} aria-label="Back to your teams">
            ‹
          </Link>
          <Logo href="/teams" />
        </span>
        <Pill tone="neutral">Squad of {team.roster.length}</Pill>
      </header>

      <div className={styles.gutter}>
        <h1 className={css.hed}>{team.name}</h1>
        <p className={styles.body}>
          {team.ageGroup ? `${team.ageGroup} · ` : ""}
          {cfg.label} · {team.defaultOnFieldCount}
          {cfg.formatSuffix}
          {cfg.hasGoalkeeper ? ` · ${keepers} keeper${keepers === 1 ? "" : "s"}` : ""}
          {team.seasonCarryForward ? " · season fair play on" : ""}
        </p>

        <div className={css.statStrip}>
          <div className={css.statCell}>
            <div className={css.statValue}>{team.roster.length}</div>
            <span className={styles.label}>Squad</span>
          </div>
          <div className={css.statCell}>
            <div className={css.statValue}>{team.defaultOnFieldCount}</div>
            <span className={styles.label}>{cfg.onSurfaceLabel}</span>
          </div>
          <div className={css.statCell}>
            <div className={cx(css.statValue, css.statRed)}>{matches.length}</div>
            <span className={styles.label}>Matches</span>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <HardButtonLink href={`/teams/${team.id}/new`} variant="red">
            Start a match ▶
          </HardButtonLink>
          <div className={css.footRow}>
            <HardButtonLink href={`/teams/${team.id}/season`} variant="outline" size="md">
              Season minutes
            </HardButtonLink>
            <HardButtonLink href={`/teams/${team.id}/edit`} variant="outline" size="md">
              Edit team
            </HardButtonLink>
          </div>
        </div>

        <Kicker>The squad</Kicker>
        {team.roster.length === 0 ? (
          <p className={styles.note} style={{ padding: "8px 0" }}>
            No stickers in this album yet. Edit the team to add your squad.
          </p>
        ) : (
          <div className={css.squadGrid}>
            {team.roster.map((p) => {
              const gk = cfg.hasGoalkeeper && p.canPlayGK;
              return (
                <PlayerSticker
                  key={p.id}
                  playerId={p.id}
                  name={p.name}
                  gk={gk}
                  emoji={gk ? undefined : cfg.scoreIcon}
                  footer={<span>{positionTag(p, cfg)}</span>}
                />
              );
            })}
          </div>
        )}

        <Kicker>Matches</Kicker>
        {fixtures.length === 0 ? (
          <div className={css.emptyBlock}>
            <div className={css.emptyHed}>No matches on file.</div>
            <p className={styles.note}>
              Set one up and you get a recommended line-up, a sub plan, and a fair-minutes report at
              full time.
            </p>
            <HandNote size={19} rotate={tilt(team.id, 1.5)}>
              the next page of the album ↑
            </HandNote>
          </div>
        ) : (
          <div className={cx(styles.cardInset, css.mList)}>
            {fixtures.map((m) => {
              const points = pointsOf(m);
              const when = dateline(m.startedAtISO ?? m.createdAt);
              return (
                <div key={m.id} className={css.mItem}>
                  <Link
                    href={
                      m.status === "completed"
                        ? `/teams/${team.id}/match/${m.id}/review`
                        : `/teams/${team.id}/match/${m.id}`
                    }
                    className={css.mLink}
                  >
                    <span className={css.matchMain}>
                      <span className={css.mName}>{m.name}</span>
                      <span className={css.matchSub}>
                        {when}
                        {m.status === "setup" ? "" : ` · ${points} ${cfg.scoreIcon}`}
                      </span>
                    </span>
                    {m.status === "live" ? (
                      <Pill tone="red" dot>
                        Live
                      </Pill>
                    ) : (
                      <span
                        className={cx(css.mState, m.status === "completed" ? css.mDone : css.mSetup)}
                      >
                        {statusWord(m.status, cfg)}
                      </span>
                    )}
                  </Link>
                  <button
                    type="button"
                    className={css.bareBtn}
                    aria-label={`Delete ${m.name}`}
                    onClick={() => void removeMatch(m)}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
