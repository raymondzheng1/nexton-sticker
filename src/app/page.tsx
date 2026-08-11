"use client";
/**
 * The front page.
 *
 * A visitor with no teams gets the Sticker Album (the marketing page); a returning coach gets their
 * teams. The album is NOT gated behind `ready`: waiting for the local database would mean a
 * first-time visitor's first painted frame is app furniture and the word "Loading…". A stranger
 * should never see the inside of an app they haven't started using, so while we don't yet know, we
 * show the album — which is also the correct answer for everyone arriving from a shared link.
 */
import { useAppStore } from "@/store/appStore";
import { StickerAlbum } from "@/features/marketing/StickerAlbum";
import { TeamsIndex } from "@/features/teams/TeamsIndex";

export default function HomePage() {
  const ready = useAppStore((s) => s.ready);
  const teams = useAppStore((s) => s.teams);

  if (!ready || teams.length === 0) return <StickerAlbum />;
  return <TeamsIndex />;
}
