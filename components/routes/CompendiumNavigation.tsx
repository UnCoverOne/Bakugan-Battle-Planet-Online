"use client";

import type { CompendiumSection } from "../../lib/compendium-navigation";
import styles from "./CompendiumNavigation.module.css";

type Section = {
  id: CompendiumSection;
  label: string;
  accessibleLabel: string;
  icon: "files" | "hexagon" | "book-open" | "scroll-text" | "scale";
};

const sections: readonly Section[] = [
  { id: "cards", label: "Cards", accessibleLabel: "Cards", icon: "files" },
  { id: "cores", label: "Cores", accessibleLabel: "BakuCores", icon: "hexagon" },
  { id: "glossary", label: "Glossary", accessibleLabel: "Glossary", icon: "book-open" },
  { id: "rules", label: "Rules", accessibleLabel: "Rules", icon: "scroll-text" },
  { id: "rulings", label: "Rulings", accessibleLabel: "Rulings", icon: "scale" },
];

function SectionIcon({ name }: { name: Section["icon"] }) {
  const shared = {
    fill: "none", stroke: "currentColor", strokeWidth: 1.8,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  return (
    <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden="true" {...shared}>
      {name === "files" && <>
        <path d="M15 2H6a2 2 0 0 0-2 2v12" />
        <rect x="8" y="6" width="12" height="16" rx="2" />
      </>}
      {name === "hexagon" && <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />}
      {name === "book-open" && <>
        <path d="M12 7v14" />
        <path d="M3 18V5a2 2 0 0 1 2-2h3a4 4 0 0 1 4 4 4 4 0 0 1 4-4h3a2 2 0 0 1 2 2v13a1 1 0 0 1-1 1h-4a4 4 0 0 0-4 2 4 4 0 0 0-4-2H4a1 1 0 0 1-1-1Z" />
      </>}
      {name === "scroll-text" && <>
        <path d="M8 21h12a2 2 0 0 0 2-2V5a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v13a3 3 0 0 0 3 3Z" />
        <path d="M4 17h4a2 2 0 0 1 0 4" />
        <path d="M9 7h8M9 11h8M9 15h5" />
      </>}
      {name === "scale" && <>
        <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1ZM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
        <path d="M7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
      </>}
    </svg>
  );
}

export function CompendiumNavigation({ active, onSelect }: {
  active: CompendiumSection;
  onSelect: (section: CompendiumSection) => void;
}) {
  return (
    <nav className={styles.navigation} aria-label="Compendium sections">
      {sections.map(({ id, label, accessibleLabel, icon }) => (
        <button
          key={id}
          type="button"
          className={styles.button}
          aria-label={accessibleLabel}
          aria-current={active === id ? "page" : undefined}
          onClick={() => onSelect(id)}
        >
          <SectionIcon name={icon} />
          <span className={styles.label}>{label}</span>
        </button>
      ))}
    </nav>
  );
}
