"use client";
/**
 * One-time app-store initialisation: loads local data and restores the sync code.
 *
 * No ThemeProvider here, unlike the original app. The Back Page is a fixed newsprint palette —
 * paper, ink, one red — so there is nothing to switch. See globals.css.
 */
import { useEffect } from "react";
import type { ReactNode } from "react";
import { useAppStore } from "@/store/appStore";

export function Providers({ children }: { children: ReactNode }) {
  const init = useAppStore((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);
  return <>{children}</>;
}
