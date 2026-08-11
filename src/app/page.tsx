/**
 * PLACEHOLDER home page — replaced by the marketing "Sticker Album" page. Exists so the app builds
 * end to end while the screens are drawn; keep it boring.
 */
import { HandNote, Logo, styles } from "@/ui";

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Logo />
        <HandNote size={20} rotate={2}>
          season 2026 ✦
        </HandNote>
      </header>
      <div className={styles.gutter}>
        <p className={styles.body}>The album is being assembled…</p>
      </div>
    </main>
  );
}
