/**
 * The shareable front page. Always the album, even for a coach who already has teams (the album
 * itself swaps its margin note for an "Open the app →" link for them) — a link someone forwards
 * must land on the sticker album, not inside a stranger's app.
 */
import { StickerAlbum } from "@/features/marketing/StickerAlbum";

export default function WelcomePage() {
  return <StickerAlbum />;
}
