"use client";

import { filterGlossary, glossaryKey, glossaryRuleHref, PRINTED_ICON_RULES } from "../../lib/glossary";
import { OriginalImage } from "../media/OriginalImage";
import { CompendiumSidebar } from "./CompendiumSidebar";
import { ContentsNavigation } from "./ContentsNavigation";
import styles from "./GlossaryScreen.module.css";

type GlossaryProps = {
  query?: string;
  sidebarOpen: boolean;
  desktopSidebarVisible: boolean;
  onSidebarClose: () => void;
};

function RuleLink({ rule, title }: { rule: string; title: string }) {
  return <a className={styles.ruleLink} href={glossaryRuleHref(rule)}
    aria-label={`View rules for ${title}`}>
    View rules <span aria-hidden="true">↗</span>
  </a>;
}

export function GlossaryScreen({ query = "", sidebarOpen, desktopSidebarVisible, onSidebarClose }: GlossaryProps) {
  const { icons, groups } = filterGlossary(query);
  return <div className={styles.layout} data-compendium-reference-layout>
    <CompendiumSidebar as="nav" label="Contents" open={sidebarOpen}
      desktopVisible={desktopSidebarVisible} onClose={onSidebarClose}>
      <ContentsNavigation items={[
        ...(icons.length ? [{ id: "glossary-icons", label: "Printed Icons" }] : []),
        ...groups.map(({ name }) => ({ id: `glossary-category-${glossaryKey(name)}`, label: name })),
      ]} />
    </CompendiumSidebar>

    <main className={styles.main}>
      {icons.length > 0 && <section className={styles.section} id="glossary-icons" aria-labelledby="glossary-icons-heading">
        <div className={styles.sectionHeading}><h2 id="glossary-icons-heading">Printed Icons</h2></div>
        <div className={styles.iconGrid}>
          {icons.map(symbol => <article className={styles.iconEntry} key={symbol.token}
            id={`glossary-icon-${glossaryKey(symbol.name)}`}>
            <div className={styles.iconHeading}>
              <OriginalImage className={styles.iconArtwork} src={symbol.asset} alt="" />
              <h3>{symbol.name}</h3>
            </div>
            <p>{symbol.description}</p>
            <RuleLink title={symbol.name} rule={PRINTED_ICON_RULES[symbol.token]} />
          </article>)}
        </div>
      </section>}

      {groups.map(({ name, items }) => <section className={styles.section}
        id={`glossary-category-${glossaryKey(name)}`} key={name}
        aria-labelledby={`glossary-heading-${glossaryKey(name)}`}>
        <div className={styles.sectionHeading}><h2 id={`glossary-heading-${glossaryKey(name)}`}>{name}</h2></div>
        <div className={styles.entries}>
          {items.map(item => <article className={styles.entry} key={item.key}
            id={`glossary-${item.key}`}>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            <RuleLink rule={item.rule} title={item.title} />
          </article>)}
        </div>
      </section>)}

      {icons.length === 0 && groups.length === 0 && <section className={styles.empty} role="status">
        <h2>No matching glossary entries or printed icons</h2>
        <p>Try a different search.</p>
      </section>}
    </main>
  </div>;
}
