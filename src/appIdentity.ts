/**
 * The ONE deliberate per-app file the shared core is allowed to import. Three sibling apps share
 * a byte-identical `src/server` (and engine/store/tests); the operator runs all of them into a
 * single inbox, so outbound email must say WHICH app it came from — From display name and every
 * subject line carry this. Keep all per-app identity HERE so the shared files never fork: the
 * sibling repos each hold their own copy of this file with only the name changed.
 */
export const APP_FULL_NAME = "NextOn Sticker";
