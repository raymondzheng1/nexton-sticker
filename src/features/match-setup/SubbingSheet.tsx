"use client";
/**
 * The subbing SHEET — the coach's classic paper grid, printed on cream card in receipt type:
 * players down the side, time segments across the top, a filled cell = on the field (with the
 * position), and the totals column doing the adding-up coaches used to do by hand.
 *
 * All derivation lives in the verbatim-core `buildSubbingGrid`; this file only renders the result.
 * The table scrolls sideways inside its own wrapper — the page itself never scrolls horizontally.
 */
import { useMemo } from "react";
import type { LineupAssignment, Match, PlannedWindow, Player } from "@/engine";
import { buildSubbingGrid } from "@/features/plan/subbingGrid";
import { sportOf } from "@/features/sports";
import { Kicker, cx, styles } from "@/ui";
import ms from "./matchSetup.module.css";

export interface SubbingSheetProps {
  /** The match rules (sport, periods, period length are read from here). */
  config: Match;
  players: Player[];
  startingLineup: LineupAssignment[];
  windows: PlannedWindow[];
}

export function SubbingSheet({ config, players, startingLineup, windows }: SubbingSheetProps) {
  const grid = useMemo(
    () => buildSubbingGrid(config, players, startingLineup, windows),
    [config, players, startingLineup, windows],
  );
  const cfg = sportOf(config.sport);

  if (grid.columns.length === 0 || grid.rows.length === 0) return null;

  const periodInitial = cfg.periodLabel.charAt(0);

  return (
    <section>
      <Kicker>The subbing sheet</Kicker>
      <div className={ms.sheetWrap}>
        <table className={ms.sheetTable}>
          <thead className={ms.sheetHead}>
            <tr>
              <th scope="col" className={ms.sheetName}>
                Player
              </th>
              {grid.columns.map((c, i) => (
                <th
                  key={c.startSeconds}
                  scope="col"
                  className={cx(i > 0 && c.isPeriodStart && ms.sheetPeriod)}
                >
                  {c.isPeriodStart ? `${periodInitial}${c.periodIndex + 1} · ` : ""}
                  {Math.round(c.startSeconds / 60)}–{Math.round(c.endSeconds / 60)}′
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={r.playerId}>
                <th scope="row" className={ms.sheetName} title={r.name}>
                  {r.name}
                </th>
                {r.cells.map((cell, i) => {
                  const col = grid.columns[i];
                  return (
                    <td
                      key={i}
                      className={cx(
                        cell !== null && ms.sheetOn,
                        i > 0 && col?.isPeriodStart === true && ms.sheetPeriod,
                      )}
                    >
                      {cell ?? ""}
                    </td>
                  );
                })}
                <td className={ms.sheetTotal}>{Math.round(r.totalSeconds / 60)}′</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>
        Filled cell = {cfg.onSurfaceLabel} (showing the position) · blank = on the bench. The totals
        column does the adding up for you.
      </p>
    </section>
  );
}
