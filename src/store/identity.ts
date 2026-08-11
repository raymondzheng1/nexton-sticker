/**
 * The single "who is the current user" seam (PRD §12.2 / Harness §18). v1 returns the implicit
 * local owner until the manager activates a capability code (then the code IS the owner id, scoping
 * their data in the cloud KV). Swapping in real auth later is a one-file change here — nothing else
 * in the app reads identity directly.
 */
import { LOCAL_OWNER_ID } from "../engine/index";
import { isValidCapabilityCode } from "./ids";

let currentOwnerId: string = LOCAL_OWNER_ID;

/** The current owner id — the capability code when active, else the implicit local owner. */
export function getOwnerId(): string {
  return currentOwnerId;
}

/** Activate a capability code as the current identity (used after the manager enters/creates one). */
export function setOwnerId(ownerId: string): void {
  if (ownerId !== LOCAL_OWNER_ID && !isValidCapabilityCode(ownerId)) {
    throw new Error(`invalid owner id: ${ownerId}`);
  }
  currentOwnerId = ownerId;
}

/** Reset to the implicit local owner (e.g. on "sign out of this code"). */
export function resetOwnerId(): void {
  currentOwnerId = LOCAL_OWNER_ID;
}
