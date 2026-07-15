"use client";

import { useEffect } from "react";
import styles from "./GameScreen.module.css";

/**
 * Standalone replacement game-screen scaffold.
 *
 * The play area is presentation-only for now, keeping the new screen isolated
 * from the existing match state and game engine while the layout is developed.
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

  return (
    <div className={styles.screen}>
      <div className={styles.playArea} aria-label="Experimental game play area" />
    </div>
  );
}
