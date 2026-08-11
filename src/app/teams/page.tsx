/**
 * /teams — the teams index ("your albums") on a permanent URL.
 *
 * `/` shows the album pitch to a stranger; this route always shows the index, which is what the
 * marketing page's "open the app" link and every in-app back link need.
 */
import { TeamsIndex } from "@/features/teams/TeamsIndex";

export default function TeamsPage() {
  return <TeamsIndex />;
}
