"use client";

import { LucideIcon } from "../design-system/LucideIcon";
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
          <LucideIcon name={icon} className={styles.icon}/>
          <span className={styles.label}>{label}</span>
        </button>
      ))}
    </nav>
  );
}
