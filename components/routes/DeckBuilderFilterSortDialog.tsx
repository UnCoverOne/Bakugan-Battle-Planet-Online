"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { OriginalImage } from "../media/OriginalImage";
import { LucideIcon } from "../design-system/LucideIcon";
import {
  activeCardFilterCount, CARD_FILTER_LABELS, clearCardFilterFacets,
  createEmptyCardFilters, type CardFilterFacet, type CardFilterOption,
  type CardFilterOptionCatalogue, type CardFilterState,
} from "../../lib/card-filters";
import { builderSortOptions, type BuilderCategory, type BuilderSort } from "../../lib/builder-sorting";
import compendium from "./CompendiumFieldPicker.module.css";
import styles from "./DeckBuilderFilterSortDialog.module.css";

type FilterField = CardFilterFacet | "sort" | "fusions";

type Field = {
  key: FilterField;
  label: string;
  options: readonly CardFilterOption[];
  searchable?: boolean;
  info?: string;
  single?: boolean;
  clearable?: boolean;
};

type ApplyValue = { filters: CardFilterState; sort: BuilderSort; fusionOnly: boolean };

function fieldDefinitions(category: BuilderCategory, filters: CardFilterState, options: CardFilterOptionCatalogue): Field[] {
  const field = (key: CardFilterFacet, overrides: Partial<Field> = {}): Field => ({
    key, label: CARD_FILTER_LABELS[key], options: options[key],
    searchable: ["set", "bPower", "damage", "keyword"].includes(key), ...overrides,
  });
  const sort: Field = {
    key: "sort", label: "Sort By", single: true, clearable: false,
    options: builderSortOptions(category).map(([value, label]) => ({ value, label })),
  };
  if (category === "cores") return [
    field("coreType", { label: "Core Type" }), sort,
    field("set"), field("keyword", { label: "Effects", searchable: true,
      info: "Match any selected BakuCore effect. All effects have equal weight." }),
    field("bPower", { label: "B Power", info: "Printed base B-Power, excluding conditional and Fusion bonuses." }),
    field("damage", { info: "Printed base Damage, excluding conditional and Fusion bonuses." }),
    field("faction", { label: "Conditional Factions", info: "Cores with a bonus applying to any selected faction." }),
  ];
  if (category === "characters") return [
    sort,
    { key: "fusions", label: "Fusions", single: true, options: [{ value: "fused", label: "Fusion Bakugan only" }],
      info: "Show Fusion Bakugan using their deck-selectable base Character cards." },
    field("set"), field("faction"), field("coreType", { label: "BakuCores" }),
    field("bPower"), field("damage"), field("keyword"),
  ];
  return [
    field("type", { label: "Card Type", info: "Choose Evo to reveal B Power and Damage filters." }),
    sort, field("faction"), field("set"), field("rarity"), field("cost", { label: "Cost" }),
    ...(filters.type.includes("Evo") ? [field("bPower"), field("damage")] : []),
    field("keyword"),
  ];
}

function valuesFor(field: FilterField, filters: CardFilterState, sort: BuilderSort, fusionOnly: boolean): string[] {
  if (field === "sort") return [sort];
  if (field === "fusions") return fusionOnly ? ["fused"] : [];
  return filters[field];
}

export function DeckBuilderFilterSortDialog({
  category, context, filters, sort, options, fusionOnly = false,
  onClose, onApply,
}: {
  category: BuilderCategory;
  context: string;
  filters: CardFilterState;
  sort: BuilderSort;
  options: CardFilterOptionCatalogue;
  fusionOnly?: boolean;
  onClose: () => void;
  onApply: (value: ApplyValue) => void;
}) {
  const dialogId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const returnToField = useRef<HTMLButtonElement | null>(null);
  const [draftFilters, setDraftFilters] = useState(() => createEmptyCardFilters(filters));
  const [draftSort, setDraftSort] = useState(sort);
  const [draftFusion, setDraftFusion] = useState(fusionOnly);
  const [openField, setOpenField] = useState<FilterField | null>(null);
  const [fieldDraft, setFieldDraft] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [helpField, setHelpField] = useState<FilterField | null>(null);
  const facets: readonly CardFilterFacet[] = category === "cores"
    ? ["set", "coreType", "keyword", "bPower", "damage", "faction"]
    : category === "characters"
      ? ["set", "faction", "coreType", "bPower", "damage", "keyword"]
      : ["type", "set", "faction", "cost", "rarity", "bPower", "damage", "keyword"];
  const activeCount = activeCardFilterCount(draftFilters, facets) + (category === "characters" && draftFusion ? 1 : 0);
  const fields = fieldDefinitions(category, draftFilters, options);
  const selectedField = fields.find(field => field.key === openField);
  const filteredOptions = selectedField?.options.filter(option =>
    option.label.toLowerCase().includes(query.trim().toLowerCase())) ?? [];

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (openField) {
      (selectedField?.searchable ? searchRef.current : backRef.current)?.focus();
    } else {
      (returnToField.current?.isConnected ? returnToField.current : closeRef.current)?.focus();
    }
  }, [openField, selectedField?.searchable]);

  const chooseField = (field: Field, target: HTMLButtonElement) => {
    returnToField.current = target;
    setFieldDraft(valuesFor(field.key, draftFilters, draftSort, draftFusion));
    setQuery("");
    setHelpField(null);
    setOpenField(field.key);
  };
  const goBack = () => {
    setOpenField(null);
    setQuery("");
  };
  const applyField = () => {
    if (!selectedField) return;
    if (selectedField.key === "sort") setDraftSort(fieldDraft[0] as BuilderSort);
    else if (selectedField.key === "fusions") setDraftFusion(fieldDraft.includes("fused"));
    else {
      const key = selectedField.key;
      setDraftFilters(current => ({
        ...current,
        [key]: fieldDraft,
        ...(key === "type" && !fieldDraft.includes("Evo") ? { bPower: [], damage: [] } : {}),
      }));
    }
    goBack();
  };
  const toggle = (value: string) => {
    setFieldDraft(current => selectedField?.single
      ? current.includes(value) && selectedField.clearable !== false ? [] : [value]
      : current.includes(value) ? current.filter(item => item !== value) : [...current, value]);
  };
  const showResults = () => {
    onApply({ filters: draftFilters, sort: draftSort, fusionOnly: draftFusion });
  };
  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (openField) goBack(); else onClose();
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),input:not([disabled])') ?? [])
      .filter(el => el.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return <div className={styles.backdrop} onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={dialogId}
      data-ui="builder-filters-sort" className={styles.dialog} onKeyDown={onDialogKeyDown}>
      <header className={styles.header}>
        {openField && <button type="button" ref={backRef} className={styles.back} onClick={goBack} aria-label="Back to Filters & Sort">
          <LucideIcon name="chevron-left" size={20} />
        </button>}
        <div className={styles.heading}>
          <h2 id={dialogId}>{selectedField?.label ?? "Filters & Sort"}</h2>
          <span>{selectedField ? (fieldDraft.length ? String(fieldDraft.length) + " selected" : "Any") : context}</span>
        </div>
        <button ref={closeRef} type="button" className={styles.close} aria-label="Close Filters & Sort" onClick={onClose}>
          <LucideIcon name="x" size={20} />
        </button>
      </header>
      {!selectedField ? <>
        <div className={styles.clearRow}>
          <span>{activeCount} active {activeCount === 1 ? "filter" : "filters"}</span>
          <button type="button" disabled={activeCount === 0} onClick={() => {
            setDraftFilters(current => clearCardFilterFacets(current, facets));
            setDraftFusion(false);
          }}>Clear all</button>
        </div>
        <div className={styles.fieldList}>
          {fields.map(field => {
            const selectedValues = valuesFor(field.key, draftFilters, draftSort, draftFusion)
              .map(value => field.options.find(option => option.value === value))
              .filter((option): option is CardFilterOption => Boolean(option));
            return <div key={field.key} className={compendium.field}>
              <button type="button" className={compendium.trigger} onClick={event => chooseField(field, event.currentTarget)}
                aria-label={field.label + ": " + (selectedValues.length ? selectedValues.map(option => option.label).join(", ") : "Any")}>
                <span className={compendium.headerLine + " " + (field.info ? compendium.hasInfo : "")}>
                  <span className={compendium.name}>{field.label}</span>
                  <LucideIcon name="chevron-right" size={16} />
                </span>
                <span className={compendium.summary + " " + styles.selectionSummary}>
                  {selectedValues.length ? <>
                    {selectedValues.slice(0, 1).map(option => <span key={option.value} className={compendium.chip + (selectedValues.length > 1 ? " " + styles.selectionChip : "")}>
                      {option.icon && <OriginalImage src={option.icon} alt="" width={16} height={16} />}
                      <span>{option.label}</span>
                    </span>)}
                    {selectedValues.length > 1 && <span className={compendium.more}>+{selectedValues.length - 1} more</span>}
                  </> : <span className={compendium.empty}>Any</span>}
                </span>
              </button>
              {field.info && <button type="button" className={compendium.info}
                aria-label={"About " + field.label} aria-expanded={helpField === field.key}
                onClick={() => setHelpField(current => current === field.key ? null : field.key)}>
                <LucideIcon name="info" size={16}/>
              </button>}
              {helpField === field.key && field.info && <p className={styles.fieldHelp}>{field.info}</p>}
            </div>;
          })}
        </div>
        <footer className={styles.footer}>
          <button type="button" className="bb-button" onClick={onClose}>Cancel</button>
          <button type="button" className="bb-button bb-button--primary" onClick={showResults}>Show results</button>
        </footer>
      </> : <>
        {selectedField.searchable && <label className={compendium.search}>
          <span className={compendium.srOnly}>Search {selectedField.label}</span>
          <input type="search" ref={searchRef} value={query}
            onChange={event => setQuery(event.target.value)} placeholder={"Search " + selectedField.label.toLowerCase() + "…"} />
        </label>}
        <div className={styles.options} role={selectedField.single ? "radiogroup" : "group"}
          aria-label={selectedField.label + " choices"}>
          {filteredOptions.map(option => {
            const checked = fieldDraft.includes(option.value);
            return <button type="button" key={option.value} className={compendium.option}
              role={selectedField.single ? "radio" : "checkbox"} aria-checked={checked}
              onClick={() => toggle(option.value)}>
              <span className={compendium.check + " " + (checked ? compendium.checked : "")} aria-hidden="true">
                {checked && <LucideIcon name="check" size={14} />}
              </span>
              {option.icon && <OriginalImage className={compendium.optionIcon} src={option.icon} alt="" width={24} height={24} />}
              <span>{option.label}</span>
            </button>;
          })}
          {!filteredOptions.length && <p className={compendium.noResults}>No matching options.</p>}
        </div>
        <footer className={styles.footer}>
          <button type="button" className="bb-button" onClick={() => setFieldDraft([])}
            disabled={selectedField.clearable === false || fieldDraft.length === 0}>Clear</button>
          <button type="button" className="bb-button bb-button--primary" onClick={applyField}>Apply</button>
        </footer>
      </>}
    </section>
  </div>;
}
