"use client";

import { useEffect } from "react";
import styles from "./GameScreen.module.css";

/**
 * Standalone replacement game-screen scaffold.
 *
 * This component is intentionally empty. Future interface work can be built
 * here without touching the existing match screen or game engine.
 */
export function GameScreen({ onExit }: { onExit?: () => void }) {
  useEffect(() => {
    if (!onExit) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onExit();
    };
    window.addEventListener("keydown", exitOnEscape);
    return () => window.removeEventListener("keydown", exitOnEscape);
  }, [onExit]);

  return <div className={styles.screen} />;
}
