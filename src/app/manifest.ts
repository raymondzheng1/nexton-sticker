import type { MetadataRoute } from "next";

/** Installable PWA manifest. Album-paper cream throughout — the Sticker palette. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NextOn — everyone plays, no arguments",
    short_name: "NextOn",
    description:
      "Track every kid's minutes live and know when to sub and who. Football and basketball. No account, works offline.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6edd9",
    theme_color: "#f6edd9",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
