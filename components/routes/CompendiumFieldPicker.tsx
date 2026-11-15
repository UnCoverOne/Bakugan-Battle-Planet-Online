"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { OriginalImage } from "../media/OriginalImage";
import type { CardFilterOption } from "../../lib/card-filters";
import styles from "./CompendiumFieldPicker.module.css";

export function CompendiumFieldPicker({
  label, values, options, onChange, searchable = false, mode = "multi", clearable = true, info,
}: {
  label: string;
  values: readonly string[];
  options: readonly CardFilterOption[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
  mode?: "single" | "multi";
  clearable?: boolean;
  info?: string;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>([]);
  const selected = useMemo(() => values.map(value => options.find(option => option.value === value))
    .filter((option): option is CardFilterOption => Boolean(option)), [values, options]);
  const filtered = useMemo(() => options.filter(option =>
    option.label.toLowerCase().includes(query.trim().toLowerCase())), [options, query]);
  const openPicker = () => { setDraft([...values]); setQuery(""); setTipOpen(false); setOpen(true); };
  const closePicker = () => { setOpen(false); triggerRef.current?.focus(); };
  const apply = () => { onChange(draft); closePicker(); };
  const toggle = (value: string) => setDraft(current => mode === "single" ? [value] :
    current.includes(value) ? current.filter(item => item !== value) : [...current, value]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closePicker(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled])') ?? []).filter(el => el.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", onKeyDown); };
  }, [open]);
  const dialog = open && typeof document !== "undefined" ? createPortal(
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) closePicker(); }}>
      <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className={styles.dialogHeader}>
          <div><h2 id={id}>{label}</h2><span>{draft.length ? `${draft.length} selected` : mode === "single" && !clearable ? "Select one" : "Any"}</span></div>
          <button type="button" ref={closeRef} className={styles.close} aria-label={`Close ${label}`} onClick={closePicker}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>
        {searchable && <label className={styles.search}>
          <span className={styles.srOnly}>Search {label}</span>
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}…`} />
        </label>}
        <div className={styles.options} role={mode === "single" ? "radiogroup" : "group"} aria-label={`${label} choices`}>
          {filtered.map(option => {
            const checked = draft.includes(option.value);
            return <button type="button" key={option.value} className={styles.option}
              role={mode === "single" ? "radio" : "checkbox"} aria-checked={checked}
              onClick={() => toggle(option.value)}>
              <span className={`${styles.check} ${checked ? styles.checked : ""}`} aria-hidden="true">{checked ? "✓" : ""}</span>
              {option.icon && <OriginalImage className={styles.optionIcon} src={option.icon} alt="" width={24} height={24} />}
              <span>{option.label}</span>
            </button>;
          })}
          {!filtered.length && <p className={styles.noResults}>No matching options.</p>}
        </div>
        <footer className={styles.dialogFooter}>
          {clearable ? <button type="button" className={styles.clear} onClick={() => setDraft([])} disabled={!draft.length}>Clear</button> : <span />}
          <button type="button" className={styles.apply} onClick={apply}>Apply{mode === "multi" && draft.length ? ` (${draft.length})` : ""}</button>
        </footer>
      </section>
    </div>, document.body) : null;
  return <div className={styles.field}>
    <button type="button" ref={triggerRef} className={styles.trigger}
      onClick={openPicker} aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}: ${selected.length ? selected.map(option => option.label).join(", ") : clearable ? "Any" : "Default"}`}>
      <span className={styles.name}>{label}</span>
      <span className={styles.summary}>
        {selected.length ? <>
          {selected.slice(0, 2).map(option => <span key={option.value} className={styles.chip}>
            {option.icon && <OriginalImage src={option.icon} alt="" width={16} height={16} />}
            <span>{option.label}</span>
          </span>)}
          {selected.length > 2 && <span className={styles.more}>+{selected.length - 2} more</span>}
        </> : <span className={styles.empty}>Any</span>}
      </span>
      <svg className={styles.chevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
    </button>
    {info && <>
      <button type="button" className={styles.info} aria-label={`About ${label}`}
        aria-expanded={tipOpen} aria-describedby={tipOpen ? `${id}-help` : undefined}
        onClick={() => setTipOpen(current => !current)}
        onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setTipOpen(false); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7h.01"/></svg>
      </button>
      {tipOpen && <div id={`${id}-help`} className={styles.tooltip} role="tooltip">{info}</div>}
    </>}
    {dialog}
  </div>;
}
