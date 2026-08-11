#!/usr/bin/env node
/**
 * onfield-count-check — invariant linter (Harness §4.2; CLAUDE.md invariant #1).
 *
 * `onFieldCount` (players per side) is arbitrary and set per match. Everything — formations, pitch
 * layout, fairness math, bench size, sub plan — must derive from `match.onFieldCount` (the single
 * source of truth, Harness §3.3). This linter fails the build when engine/UI logic hard-codes the
 * on-field player count instead of deriving it.
 *
 * It does TWO things:
 *   1. FORBIDDEN: flag comparisons/assignments that pin a "count" name to a magic squad number
 *      (e.g. `onFieldCount === 7`, `fieldCount = 11`).
 *   2. PRESENCE (drift defence): every file that does fairness/plan/recommend/recalc work MUST
 *      reference `onFieldCount` — proving it derives from the SoT rather than a literal.
 *
 * formations.ts and constants.ts are the SANCTIONED sources of curated shapes / cadences and are
 * exempt from the forbidden-literal scan.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Directories to scan (engine now; app/ + src/store etc. join as they're built). */
const SCAN_DIRS = ["src"];

/** Files exempt from the FORBIDDEN-literal scan (they legitimately hold shapes/cadences). */
const FORBIDDEN_EXEMPT = new Set(["src/engine/formations.ts", "src/engine/constants.ts"]);

/**
 * Files that MUST reference onFieldCount — the modules that do the count-dependent math directly
 * (the derive-from-SoT presence check). recommend.ts / recalc.ts deliberately DELEGATE this math
 * to plan.ts / fairness.ts, so they're not listed (requiring it of them would only invite gaming
 * the linter rather than proving derivation).
 */
const MUST_DERIVE = ["src/engine/fairness.ts", "src/engine/plan.ts"];

// A "count-like" name pinned to a squad magic number is the high-signal violation.
const COUNT_NAME = "(?:onField\\w*|fieldCount|onPitch\\w*|playersPerSide|squadOnField)";
const MAGIC = "(?:3|4|5|6|7|8|9|10|11)";
const FORBIDDEN_PATTERNS = [
  new RegExp(`${COUNT_NAME}\\s*(?:===?|!==?|<=?|>=?)\\s*${MAGIC}\\b`),
  new RegExp(`\\b${MAGIC}\\s*(?:===?|!==?|<=?|>=?)\\s*${COUNT_NAME}`),
  new RegExp(`${COUNT_NAME}\\s*[:=]\\s*${MAGIC}\\b`),
];

function listTsFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === "coverage" || name === ".next") continue;
      out.push(...listTsFiles(full));
    } else if ((extname(name) === ".ts" || extname(name) === ".tsx") && !name.endsWith(".d.ts")) {
      out.push(full); // .tsx included so UI (pitch view etc.) must also derive from onFieldCount
    }
  }
  return out;
}

let failures = 0;
const files = SCAN_DIRS.flatMap((d) => listTsFiles(join(ROOT, d)));

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (FORBIDDEN_EXEMPT.has(rel)) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return; // skip comments
    for (const re of FORBIDDEN_PATTERNS) {
      if (re.test(line)) {
        console.error(`${rel}:${i + 1} — hard-coded on-field count; derive from match.onFieldCount`);
        console.error(`    ${t.slice(0, 160)}`);
        failures++;
      }
    }
  });
}

for (const rel of MUST_DERIVE) {
  const full = join(ROOT, rel);
  let src;
  try {
    src = readFileSync(full, "utf8");
  } catch {
    console.error(`${rel} — expected file is missing (MUST_DERIVE presence check)`);
    failures++;
    continue;
  }
  if (!src.includes("onFieldCount")) {
    console.error(`${rel} — must reference onFieldCount (derive from the SoT, not a literal)`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\nonfield:check — ${failures} violation(s).`);
  process.exit(1);
}
console.log(`onfield:check — OK (${files.length} files scanned, ${MUST_DERIVE.length} derive-checks).`);
