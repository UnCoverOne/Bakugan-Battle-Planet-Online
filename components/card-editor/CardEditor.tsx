"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CARD_EDITOR_VERSION,
  cardDraftFromCatalogue,
  createCardAuthoringBundle,
  emptyCardDraft,
  normalizeCardDraft,
  parseCardAuthoringBundle,
  serializeCardAuthoringBundle,
  validateCardDraft,
  type CardAuthoringIssue,
  type CardDraft,
} from "../../lib/content/card-authoring";
import { CONTROLLED_CATALOGUE } from "../../lib/content/catalogue";
import styles from "./CardEditor.module.css";

const STORAGE_KEY = "bbp-card-editor-draft-v1";
const FACTIONS = ["Aquos", "Pyrus", "Darkus", "Haos", "Ventus", "Aurelus"] as const;
const CARD_TYPES = ["Action", "Flip", "Flip Hero", "Hero", "Baku-Gear", "Evo", "Character"] as const;
const CORE_TYPES = ["Fist", "Flaming Fist", "Shield", "Magic Shield", "Helix"] as const;
const RARITIES = ["Common", "Rare", "Super Rare", "Awesome Rare", "Bakugan Elite", "N/A"] as const;

type EditorTab = "fields" | "rules" | "export";

type StoredDraft = {
  baseCardId?: string;
  draft: CardDraft;
  updatedAt: number;
};

function download(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copy(value: string) {
  if (!navigator.clipboard) throw new Error("Clipboard access is unavailable in this browser.");
  await navigator.clipboard.writeText(value);
}

function severityRank(issue: CardAuthoringIssue) {
  return issue.severity === "error" ? 0 : issue.severity === "warning" ? 1 : 2;
}

function titleForIssue(issue: CardAuthoringIssue) {
  return `${issue.severity.toUpperCase()} • ${issue.code}`;
}

function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "card-draft";
}

export function CardEditor() {
  const initialCard = CONTROLLED_CATALOGUE[0];
  const [baseCardId, setBaseCardId] = useState<string | undefined>(initialCard.id);
  const [draft, setDraft] = useState<CardDraft>(() => cardDraftFromCatalogue(initialCard));
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<EditorTab>("fields");
  const [status, setStatus] = useState(`Ready • ${CARD_EDITOR_VERSION}`);
  const [hydrated, setHydrated] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as StoredDraft;
        setDraft(normalizeCardDraft(stored.draft));
        setBaseCardId(stored.baseCardId);
        setStatus(`Restored local draft from ${new Date(stored.updatedAt).toLocaleString()}.`);
      }
    } catch {
      setStatus("The previous local card-editor draft could not be restored.");
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseCardId, draft, updatedAt: Date.now() } satisfies StoredDraft));
    } catch {
      setStatus("Browser storage rejected the latest draft. Export it before leaving this page.");
    }
  }, [baseCardId, draft, hydrated]);

  const validation = useMemo(() => validateCardDraft(draft, { baseCardId }), [baseCardId, draft]);
  const bundle = useMemo(() => createCardAuthoringBundle(validation.draft, baseCardId), [baseCardId, validation.draft]);
  const issues = useMemo(() => [...validation.issues].sort((left, right) => severityRank(left) - severityRank(right) || left.field.localeCompare(right.field)), [validation.issues]);
  const errors = issues.filter((item) => item.severity === "error");
  const warnings = issues.filter((item) => item.severity === "warning");
  const filteredCards = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return CONTROLLED_CATALOGUE;
    return CONTROLLED_CATALOGUE.filter((card) => `${card.id} ${card.number} ${card.displayName} ${card.type} ${card.faction} ${card.effect}`.toLocaleLowerCase().includes(normalized));
  }, [query]);

  const update = <K extends keyof CardDraft>(key: K, value: CardDraft[K]) => {
    setDraft((current) => normalizeCardDraft({ ...current, [key]: value }));
  };

  const loadCard = (cardId: string) => {
    const card = CONTROLLED_CATALOGUE.find((candidate) => candidate.id === cardId);
    if (!card) return;
    setBaseCardId(card.id);
    setDraft(cardDraftFromCatalogue(card));
    setStatus(`Loaded ${card.displayName} (${card.id}) from the controlled catalogue.`);
    setTab("fields");
  };

  const createBlank = () => {
    const currentNumber = Math.min(374, Math.max(1, draft.number));
    setBaseCardId(undefined);
    setDraft(emptyCardDraft(currentNumber));
    setStatus("Created an unbound draft. Duplicate catalogue IDs remain blocking until a base record is selected.");
    setTab("fields");
  };

  const reset = () => {
    if (baseCardId) loadCard(baseCardId);
    else {
      setDraft(emptyCardDraft(draft.number));
      setStatus("Reset the unbound draft.");
    }
  };

  const toggleFaction = (faction: typeof FACTIONS[number]) => {
    const next = draft.factions.includes(faction)
      ? draft.factions.filter((candidate) => candidate !== faction)
      : [...draft.factions, faction];
    update("factions", next.length ? next : [draft.faction]);
  };

  const toggleCoreType = (coreType: typeof CORE_TYPES[number]) => {
    const next = draft.coreTypes.includes(coreType)
      ? draft.coreTypes.filter((candidate) => candidate !== coreType)
      : [...draft.coreTypes, coreType];
    update("coreTypes", next);
  };

  const importFile = async (file: File) => {
    try {
      const imported = parseCardAuthoringBundle(await file.text());
      setDraft(imported.card);
      setBaseCardId(imported.baseCardId);
      setStatus(`Imported ${file.name}. Revalidated against the current catalogue and rules profile.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The selected file is not a valid card-authoring document.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const copyWithStatus = async (value: string, message: string) => {
    try {
      await copy(value);
      setStatus(message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Clipboard operation failed.");
    }
  };

  const exported = serializeCardAuthoringBundle(bundle);
  const patchText = `${JSON.stringify(bundle.patch, null, 2)}\n`;
  const ruleText = bundle.generatedDefinition ? `${JSON.stringify(bundle.generatedDefinition, null, 2)}\n` : "Rule compilation is blocked until schema errors are fixed.\n";

  return (
    <div className={styles.editor}>
      <aside className={styles.catalogue} aria-label="Controlled card catalogue">
        <div className={styles.catalogueHeading}>
          <span>CONTROLLED CATALOGUE</span>
          <strong>{CONTROLLED_CATALOGUE.length} CARDS</strong>
        </div>
        <label className={styles.search}>
          <span>Search cards</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, ID, effect…" />
        </label>
        <div className={styles.cardList}>
          {filteredCards.map((card) => (
            <button
              key={card.id}
              className={baseCardId === card.id ? styles.selectedCard : undefined}
              onClick={() => loadCard(card.id)}
              aria-current={baseCardId === card.id ? "true" : undefined}
            >
              <b>{String(card.number).padStart(3, "0")}</b>
              <span><strong>{card.displayName}</strong><small>{card.type} • {card.faction}</small></span>
            </button>
          ))}
          {!filteredCards.length && <p className={styles.empty}>No catalogue card matches this search.</p>}
        </div>
      </aside>

      <main className={styles.workspace}>
        <header className={styles.toolbar}>
          <div>
            <span className={styles.eyebrow}>CARD AUTHORING WORKBENCH</span>
            <h1>{draft.displayName || "Untitled Card"}</h1>
            <p>{baseCardId ? `Editing a review candidate for ${baseCardId}.` : "Unbound draft; select a canonical base record before preparing a replacement patch."}</p>
          </div>
          <div className={styles.toolbarActions}>
            <button onClick={createBlank}>NEW DRAFT</button>
            <button onClick={reset}>RESET</button>
            <button onClick={() => fileRef.current?.click()}>IMPORT JSON</button>
            <button className={styles.primaryAction} onClick={() => download(`${safeFilename(draft.displayName)}-${draft.id}-authoring.json`, exported)}>EXPORT REVIEW BUNDLE</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => event.target.files?.[0] && void importFile(event.target.files[0])} />
          </div>
        </header>

        <section className={`${styles.validationBanner} ${errors.length ? styles.invalid : warnings.length ? styles.warning : styles.valid}`} aria-live="polite">
          <div>
            <strong>{errors.length ? "BLOCKED" : warnings.length ? "REVIEW REQUIRED" : "SCHEMA READY"}</strong>
            <span>{errors.length} errors • {warnings.length} warnings • {issues.filter((item) => item.severity === "info").length} notices</span>
          </div>
          <p>This tool produces review artifacts only. It never writes to the production catalogue, content lock, or typed rules registry.</p>
        </section>

        <nav className={styles.tabs} aria-label="Card editor sections">
          {(["fields", "rules", "export"] as const).map((value) => (
            <button key={value} onClick={() => setTab(value)} aria-current={tab === value ? "page" : undefined} className={tab === value ? styles.activeTab : undefined}>
              {value === "fields" ? "CARD FIELDS" : value === "rules" ? "RULE AST & PROVENANCE" : "PATCH & TEST OUTPUT"}
            </button>
          ))}
        </nav>

        <div className={styles.contentGrid}>
          <section className={styles.editorPanel}>
            {tab === "fields" && (
              <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
                <fieldset>
                  <legend>Identity</legend>
                  <label>Catalogue ID<input value={draft.id} onChange={(event) => update("id", event.target.value)} /></label>
                  <label>Collector number<input type="number" min="1" max="374" value={draft.number} onChange={(event) => update("number", Number(event.target.value))} /></label>
                  <label>Internal name<input value={draft.name} onChange={(event) => update("name", event.target.value)} /></label>
                  <label>Display name<input value={draft.displayName} onChange={(event) => update("displayName", event.target.value)} /></label>
                  <label>Stable slug<input value={draft.slug ?? ""} onChange={(event) => update("slug", event.target.value)} /></label>
                  <label>Source<input value={draft.source ?? ""} onChange={(event) => update("source", event.target.value)} /></label>
                </fieldset>

                <fieldset>
                  <legend>Characteristics</legend>
                  <label>Card type<select value={draft.type} onChange={(event) => update("type", event.target.value as CardDraft["type"])}>{CARD_TYPES.map((item) => <option key={item}>{item}</option>)}</select></label>
                  <label>Primary faction<select value={draft.faction} onChange={(event) => update("faction", event.target.value as CardDraft["faction"])}>{FACTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
                  <label>Energy cost<input value={draft.cost} onChange={(event) => update("cost", event.target.value.toUpperCase() === "X" ? "X" : Math.max(0, Number(event.target.value) || 0))} /></label>
                  <label>Rarity<select value={draft.rarity} onChange={(event) => update("rarity", event.target.value)}>{RARITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
                  <label>B-Power<input type="number" min="0" value={draft.bPower ?? ""} onChange={(event) => update("bPower", event.target.value === "" ? null : Number(event.target.value))} /></label>
                  <label>Damage Rating<input type="number" min="0" value={draft.damage ?? ""} onChange={(event) => update("damage", event.target.value === "" ? null : Number(event.target.value))} /></label>
                  <label className={styles.fullWidth}>Evolves from<input value={draft.evolvesFrom ?? ""} onChange={(event) => update("evolvesFrom", event.target.value || null)} placeholder="Canonical Character display name" /></label>
                </fieldset>

                <fieldset>
                  <legend>Faction identity</legend>
                  <div className={styles.checkboxGrid}>{FACTIONS.map((faction) => <label key={faction}><input type="checkbox" checked={draft.factions.includes(faction)} onChange={() => toggleFaction(faction)} /><span>{faction}</span></label>)}</div>
                </fieldset>

                <fieldset>
                  <legend>BakuCore indicators</legend>
                  <div className={styles.checkboxGrid}>{CORE_TYPES.map((coreType) => <label key={coreType}><input type="checkbox" checked={draft.coreTypes.includes(coreType)} onChange={() => toggleCoreType(coreType)} /><span>{coreType}</span></label>)}</div>
                </fieldset>

                <fieldset>
                  <legend>Printed text and metadata</legend>
                  <label className={styles.fullWidth}>Effect text<textarea rows={8} value={draft.effect} onChange={(event) => update("effect", event.target.value)} placeholder="Use canonical bracket tokens such as [B], [Damage Rating], [FrostStrike], and [Stop]." /></label>
                  <label className={styles.fullWidth}>Mechanics<input value={draft.mechanics.join(", ")} onChange={(event) => update("mechanics", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} placeholder="Draw, Fury, Victor…" /></label>
                  <label className={styles.fullWidth}>Artwork path<input value={draft.art} onChange={(event) => update("art", event.target.value)} /></label>
                  <label className={styles.scanToggle}><input type="checkbox" checked={Boolean(draft.hasProvidedScan)} onChange={(event) => update("hasProvidedScan", event.target.checked)} /><span>Provided scan exists</span></label>
                </fieldset>
              </form>
            )}

            {tab === "rules" && (
              <div className={styles.rulesPanel}>
                <div className={styles.metrics}>
                  <article><span>Abilities</span><strong>{bundle.generatedDefinition?.abilities.length ?? 0}</strong></article>
                  <article><span>Instructions</span><strong>{bundle.generatedDefinition?.abilities.reduce((sum, ability) => sum + ability.instructions.length, 0) ?? 0}</strong></article>
                  <article><span>Choices</span><strong>{bundle.generatedDefinition?.play.choices.length ?? 0}</strong></article>
                  <article><span>Sources</span><strong>{bundle.generatedDefinition?.provenance.citations.length ?? 0}</strong></article>
                </div>
                {bundle.generatedDefinition?.abilities.map((ability) => (
                  <article className={styles.ability} key={ability.id}>
                    <header><strong>{ability.kind.toUpperCase()}</strong><code>{ability.id}</code></header>
                    {ability.instructions.map((instruction) => (
                      <div key={instruction.id}>
                        <p>{instruction.sourceText || "(No printed effect text)"}</p>
                        <div className={styles.actionKinds}>{instruction.effects.map((action, index) => <span key={`${action.kind}-${index}`}>{action.kind}</span>)}</div>
                        {instruction.choices.length > 0 && <small>Resolution choices: {instruction.choices.map((choice) => `${choice.id} (${choice.timing})`).join(", ")}</small>}
                      </div>
                    ))}
                  </article>
                ))}
                <section className={styles.provenance}>
                  <h2>Generated provenance</h2>
                  {bundle.generatedDefinition?.provenance.citations.map((citation) => <article key={`${citation.sourceId}-${citation.locator}`}><strong>{citation.sourceId}</strong><span>{citation.locator}</span><small>{citation.note}</small></article>)}
                </section>
                <details><summary>Complete generated draft definition</summary><pre>{ruleText}</pre></details>
              </div>
            )}

            {tab === "export" && (
              <div className={styles.exportPanel}>
                <section>
                  <div><h2>Catalogue patch</h2><button onClick={() => void copyWithStatus(patchText, "Catalogue patch copied.")}>COPY PATCH</button></div>
                  <pre>{patchText}</pre>
                </section>
                <section>
                  <div><h2>Golden-test scaffold</h2><button onClick={() => void copyWithStatus(bundle.goldenTestTemplate, "Golden-test scaffold copied.")}>COPY TEST</button></div>
                  <pre>{bundle.goldenTestTemplate}</pre>
                </section>
                <section>
                  <div><h2>Review bundle</h2><button onClick={() => void copyWithStatus(exported, "Complete review bundle copied.")}>COPY JSON</button></div>
                  <textarea readOnly rows={18} value={exported} aria-label="Complete card authoring review bundle" />
                </section>
              </div>
            )}
          </section>

          <aside className={styles.previewColumn}>
            <article className={styles.cardPreview} data-faction={draft.faction.toLowerCase()}>
              <header><span>{draft.type}</span><b>{draft.cost}</b></header>
              <div className={styles.previewArt}><span>{draft.art}</span></div>
              <section>
                <small>{draft.id} • {draft.rarity}</small>
                <h2>{draft.displayName || "Untitled Card"}</h2>
                {draft.factions.length > 1 && <p className={styles.factionLine}>{draft.factions.join(" / ")}</p>}
                <p className={styles.effectText}>{draft.effect || "No printed effect text."}</p>
                {(draft.bPower != null || draft.damage != null) && <div className={styles.combatStats}><strong>{draft.bPower ?? "—"} B</strong><strong>{draft.damage ?? "—"} D</strong></div>}
                {draft.coreTypes.length > 0 && <p className={styles.coreLine}>{draft.coreTypes.join(" • ")}</p>}
              </section>
            </article>

            <section className={styles.issuePanel} aria-label="Validation results">
              <header><h2>Validation</h2><span>{issues.length}</span></header>
              {issues.map((item) => <article className={styles[item.severity]} key={`${item.code}-${item.field}-${item.message}`}><strong>{titleForIssue(item)}</strong><code>{item.field}</code><p>{item.message}</p></article>)}
              {!issues.length && <p className={styles.noIssues}>No issues found. The artifact is ready for human rules review and source-control validation.</p>}
            </section>
          </aside>
        </div>

        <footer className={styles.statusBar} role="status">
          <span>{status}</span>
          <code>{bundle.fingerprint}</code>
        </footer>
      </main>
    </div>
  );
}
