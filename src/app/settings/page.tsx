"use client";
/**
 * Settings — the house rules, one sticker card per group.
 *
 * Coach-level defaults (rotation, keeper policy, tolerance, how often to change players), the alert
 * cues, the cross-device sync code, backup and the share link. All device-local except the sync
 * code, which is the app's entire identity system: no accounts, no login, one short bearer code.
 *
 * Because that code IS the credential, it is masked until the coach asks to see it — a settings
 * screen gets handed to another parent, mirrored to a TV, or screenshotted for a bug report, none
 * of which should leak a code that opens the whole season. Wiring is the Back Page settings', 1:1.
 */
import { useRef, useState } from "react";
import Link from "next/link";
import type { GkPolicy, RotationStyle } from "@/engine";
import { useAppStore } from "@/store/appStore";
import { generateCapabilityCode } from "@/store/ids";
import { MAX_SUB_LEVEL, subLevelLabel } from "@/features/plan/SubFrequency";
import { HardButton, Kicker, Logo, Pill, StickerFrame, cx, styles, tilt } from "@/ui";
import teamsCss from "@/features/teams/teams.module.css";
import css from "./settings.module.css";

const ROTATIONS: { label: string; value: RotationStyle }[] = [
  { label: "Continuous", value: "continuous" },
  { label: "Interval", value: "interval" },
  { label: "Period", value: "period" },
];
const GK_POLICIES: { label: string; value: GkPolicy }[] = [
  { label: "Counts", value: "countAsFieldTime" },
  { label: "Rotate", value: "rotateSeparately" },
  { label: "Fixed", value: "fixedGK" },
];

const SHARE_TEXT =
  "NextOn — fair playing time for every player. Free, no accounts, works offline at the pitch.";

/** Loose sticker = option, stuck-down sticker = choice. `aria-pressed` carries the state. */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className={teamsCss.field}>
      <span className={teamsCss.fieldLabel}>{label}</span>
      <div className={css.segGrid} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx(teamsCss.chip, value === o.value && teamsCss.chipOn)}
            style={{ padding: "0 6px", fontSize: 13.5 }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stepper({
  value,
  onChange,
  min,
  max,
  ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  ariaLabel: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        className={styles.iconBtn}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`${ariaLabel}: one less`}
      >
        −
      </button>
      <span
        style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 22, minWidth: 32, textAlign: "center" }}
        aria-live="polite"
      >
        {value}
      </span>
      <button
        type="button"
        className={styles.iconBtn}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`${ariaLabel}: one more`}
      >
        +
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const code = useAppStore((s) => s.code);
  const syncStatus = useAppStore((s) => s.syncStatus);
  const setCode = useAppStore((s) => s.setCode);
  const clearCode = useAppStore((s) => s.clearCode);
  const syncCloud = useAppStore((s) => s.syncCloud);
  const exportData = useAppStore((s) => s.exportData);
  const importData = useAppStore((s) => s.importData);
  const prefs = useAppStore((s) => s.prefs);
  const setPrefs = useAppStore((s) => s.setPrefs);

  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [shareNote, setShareNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  /** `created` = we just minted this code here; otherwise the coach typed an existing one (a second
   *  device linking in). The two are different operator signals. */
  async function activate(value: string, created = false): Promise<void> {
    setError("");
    try {
      await setCode(value, { created });
      setCodeInput("");
      setRevealed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't activate that code.");
    }
  }

  async function onExport(): Promise<void> {
    const json = await exportData();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nexton-backup.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onImportFile(file: File): Promise<void> {
    setError("");
    try {
      await importData(await file.text());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    }
  }

  /** Native share sheet on a phone, clipboard on a desktop, visible link if both are blocked. */
  async function onShare(): Promise<void> {
    // /welcome, not the origin: the permanent marketing URL, so the recipient lands on the pitch
    // rather than whatever `/` resolves to for them (same call the Back Page settings made).
    const url = `${window.location.origin}/welcome`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "NextOn", text: SHARE_TEXT, url });
        return;
      } catch (e) {
        // Closing the share sheet is a choice, not an error; anything else falls back to copy.
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareNote("Link copied — paste it to another coach.");
    } catch {
      setShareNote(`Copy this link: ${url}`);
    }
  }

  const level = Math.min(MAX_SUB_LEVEL, Math.max(1, Math.round(prefs.subFrequency)));

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className={teamsCss.headerLeft}>
          <Link href="/teams" className={styles.backLink} aria-label="Back to your teams">
            ‹
          </Link>
          <Logo href="/teams" />
        </span>
        <Pill tone="neutral">House rules</Pill>
      </header>

      <div className={styles.gutter}>
        {/* ── Sync ── */}
        <Kicker>Sync across devices</Kicker>
        <StickerFrame tiltDeg={tilt("settings-sync", 1)} className={css.group}>
          <p className={styles.note} style={{ marginTop: 0 }}>
            No account needed. Use one code on every device — phone, tablet — to carry your teams
            and history between them. Anyone who has the code can read your data, so keep it off
            group chats.
          </p>

          {code ? (
            <div style={{ marginTop: 12 }}>
              <div className={styles.cardInset}>
                <span className={styles.label}>Your code</span>
                <div className={styles.spread} style={{ marginTop: 6 }}>
                  <strong className={css.codeValue}>{revealed ? code : "•••-•••"}</strong>
                  <button
                    type="button"
                    className={cx(teamsCss.chip)}
                    aria-pressed={revealed}
                    onClick={() => setRevealed((r) => !r)}
                    style={{ fontSize: 13.5 }}
                  >
                    {revealed ? "Hide" : "Reveal"}
                  </button>
                </div>
              </div>
              <p className={styles.note}>Status: {syncStatus}</p>
              <div className={css.btnRow}>
                <HardButton variant="outline" size="md" onClick={() => void syncCloud()}>
                  Sync now
                </HardButton>
                <HardButton variant="outline" size="md" onClick={() => void clearCode()}>
                  Stop on this device
                </HardButton>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  placeholder="ABC-DEF"
                  aria-label="Capability code"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  style={{ flex: 1, letterSpacing: "0.1em", fontWeight: 800 }}
                />
                <HardButton
                  variant="green"
                  size="md"
                  auto
                  onClick={() => void activate(codeInput)}
                  disabled={codeInput.trim().length === 0}
                >
                  Use code
                </HardButton>
              </div>
              <HardButton
                variant="outline"
                size="md"
                onClick={() => void activate(generateCapabilityCode(), true)}
                style={{ marginTop: 8 }}
              >
                Create a new code
              </HardButton>
            </div>
          )}
        </StickerFrame>

        {/* ── Match defaults ── */}
        <Kicker>Match defaults</Kicker>
        <StickerFrame tiltDeg={tilt("settings-defaults", 1)} className={css.group}>
          <p className={styles.note} style={{ marginTop: 0 }}>
            Every new match starts here. You can still change any of it per match.
          </p>

          <Segmented
            label="Rotation style"
            options={ROTATIONS}
            value={prefs.rotationStyle}
            onChange={(v) => setPrefs({ rotationStyle: v })}
          />
          <Segmented
            label="Goalkeeper"
            options={GK_POLICIES}
            value={prefs.gkPolicy}
            onChange={(v) => setPrefs({ gkPolicy: v })}
          />

          <div className={styles.spread} style={{ marginTop: 16 }}>
            <span className={teamsCss.fieldLabel} style={{ flex: 1, marginBottom: 0 }}>
              Fairness tolerance (min)
            </span>
            <Stepper
              value={prefs.fairnessToleranceMinutes}
              onChange={(v) => setPrefs({ fairnessToleranceMinutes: v })}
              min={1}
              max={6}
              ariaLabel="Default fairness tolerance"
            />
          </div>

          {/* The rotation dial. Fairness can be bought with a few long stints or many short ones;
              the engine prices it either way, and this is where the coach says which they want. */}
          <div style={{ marginTop: 18 }}>
            <div className={styles.spread}>
              <span className={teamsCss.fieldLabel} style={{ marginBottom: 0 }}>
                How often to change players
              </span>
              <span className={css.sliderName}>{subLevelLabel(level)}</span>
            </div>
            <input
              type="range"
              min={1}
              max={MAX_SUB_LEVEL}
              step={1}
              value={level}
              aria-label="How often to change players"
              aria-valuetext={subLevelLabel(level)}
              onChange={(e) => setPrefs({ subFrequency: Number(e.target.value) })}
              className={css.slider}
            />
            <div className={styles.spread} style={{ marginTop: -4 }}>
              <span className={styles.note} style={{ marginTop: 0 }}>
                Fewer · longer stints
              </span>
              <span className={styles.note} style={{ marginTop: 0 }}>
                More · shorter stints
              </span>
            </div>
          </div>
        </StickerFrame>

        {/* ── Alerts ── */}
        <Kicker>Alerts</Kicker>
        <StickerFrame tiltDeg={tilt("settings-alerts", 1)} className={css.group}>
          <p className={styles.note} style={{ marginTop: 0 }}>
            Cues when a change is due, while the app is open. The app holds the screen awake during
            a match so they keep firing.
          </p>
          <div className={css.segGrid} style={{ gridTemplateColumns: "1fr 1fr", marginTop: 12 }}>
            <button
              type="button"
              aria-pressed={prefs.sound}
              onClick={() => setPrefs({ sound: !prefs.sound })}
              className={cx(teamsCss.chip, prefs.sound && teamsCss.chipOn)}
            >
              🔊 Sound {prefs.sound ? "on" : "off"}
            </button>
            <button
              type="button"
              aria-pressed={prefs.vibrate}
              onClick={() => setPrefs({ vibrate: !prefs.vibrate })}
              className={cx(teamsCss.chip, prefs.vibrate && teamsCss.chipOn)}
            >
              📳 Buzz {prefs.vibrate ? "on" : "off"}
            </button>
          </div>
        </StickerFrame>

        {/* ── Backup ── */}
        <Kicker>Backup</Kicker>
        <StickerFrame tiltDeg={tilt("settings-backup", 1)} className={css.group}>
          <p className={styles.note} style={{ marginTop: 0 }}>
            Export a JSON file of everything, or restore one. Also the simplest way onto a new
            device.
          </p>
          <div className={css.btnRow}>
            <HardButton variant="outline" size="md" onClick={() => void onExport()}>
              Export data
            </HardButton>
            <HardButton variant="outline" size="md" onClick={() => fileRef.current?.click()}>
              Import data
            </HardButton>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onImportFile(file);
                e.target.value = "";
              }}
            />
          </div>
        </StickerFrame>

        {/* ── Share ── */}
        <Kicker>Share NextOn</Kicker>
        <StickerFrame tiltDeg={tilt("settings-share", 1)} className={css.group}>
          <p className={styles.note} style={{ marginTop: 0 }}>
            Know another coach? It&apos;s free — send the link and they can name a squad in minutes.
          </p>
          <div className={css.btnRow}>
            <HardButton variant="outline" size="md" onClick={() => void onShare()}>
              📤 Share the app
            </HardButton>
          </div>
          {shareNote && (
            <p className={styles.note} role="status">
              {shareNote}
            </p>
          )}
        </StickerFrame>

        {error && (
          <div className={css.errorBox} role="alert">
            {error}
          </div>
        )}

        <p className={teamsCss.deadline}>
          NextOn — local-first, no account. Made for the touchline.
          <br />
          <Link href="/contact">Drop us a note →</Link>
        </p>
      </div>
    </main>
  );
}
