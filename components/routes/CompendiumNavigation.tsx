"use client";

import type { CompendiumSection } from "../../lib/compendium-navigation";
import styles from "./CompendiumNavigation.module.css";

type Section = {
  id: CompendiumSection;
  label: string;
  accessibleLabel: string;
  icon: "cards" | "cores" | "glossary" | "rules" | "rulings";
};

const sections: readonly Section[] = [
  { id: "cards", label: "Cards", accessibleLabel: "Cards", icon: "cards" },
  { id: "cores", label: "Cores", accessibleLabel: "BakuCores", icon: "cores" },
  { id: "glossary", label: "Glossary", accessibleLabel: "Glossary", icon: "glossary" },
  { id: "rules", label: "Rules", accessibleLabel: "Rules", icon: "rules" },
  { id: "rulings", label: "Rulings", accessibleLabel: "Rulings", icon: "rulings" },
];

function SectionIcon({ name }: { name: Section["icon"] }) {
  const shared = {
    fill: "none", stroke: "currentColor", strokeWidth: 1.8,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  return (
    <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden="true" {...shared}>
      {name === "cards" && <><rect x="5" y="3" width="14" height="17" rx="1" /><path d="M8 7h8M8 11h8M8 15h5M3 7v14h14" /></>}
      {name === "cores" && <><path d="M8 3h8l5 9-5 9H8l-5-9 5-9Z" /><path d="m8 3 4 9-4 9m8-18-4 9 4 9M3 12h18" /></>}
      {name === "glossary" && <><path d="M12 6.5a7 7 0 0 0-9-1.5v14a7 7 0 0 1 9 1.5 7 7 0 0 1 9-1.5V5a7 7 0 0 0-9 1.5ZM12 6.5v14" /></>}
      {name === "rules" && <><path d="M7 3h11a3 3 0 0 1 3 3v13H7a4 4 0 0 1 0-8h14M7 3a4 4 0 0 0 0 8M7 3a4 4 0 0 0 0 8v8" /><path d="M11 7h6M11 15h6" /></>}
      {name === "rulings" && <><path d="M12 3v17M5 7h14M5 7l-3 6h6L5 7Zm14 0-3 6h6l-3-6ZM8 20h8M10 3h4" /></>}
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
