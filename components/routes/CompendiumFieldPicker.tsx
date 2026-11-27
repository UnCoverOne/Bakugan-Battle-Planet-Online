"use client";

import { LucideIcon } from "../design-system/LucideIcon";
import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  const summaryRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const measureMoreRef = useRef<HTMLSpanElement>(null);
  const infoRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>([]);
  const [visibleChipCount, setVisibleChipCount] = useState(1);
  const selected = useMemo(() => values.map(value => options.find(option => option.value === value))
    .filter((option): option is CardFilterOption => Boolean(option)), [values, options]);
  const filtered = useMemo(() => options.filter(option =>
    option.label.toLowerCase().includes(query.trim().toLowerCase())), [options, query]);
  // Fit complete chips into the entire second row. Reserve room for the
  // actual "+N more" label; recompute whenever selections or width change.
  useLayoutEffect(() => {
    const summary = summaryRef.current;
    const measure = measureRef.current;
    const more = measureMoreRef.current;
    if (!summary || !measure || !more) return;
    const calculate = () => {
      const width = summary.clientWidth;
      const chipWidths = Array.from(measure.children).slice(0, selected.length)
        .map((element) => (element as HTMLElement).getBoundingClientRect().width);
      const gap = 4;
      let fit = selected.length;
      for (let count = selected.length; count >= 1; count--) {
        const used = chipWidths.slice(0, count).reduce((sum, value) => sum + value, 0);
        const hidden = selected.length - count;
        more.textContent = hidden ? `+${hidden} more` : "";
        const moreWidth = hidden ? more.getBoundingClientRect().width : 0;
        if (used + gap * (count - 1 + (hidden ? 1 : 0)) + moreWidth <= width) {
          fit = count;
          break;
        }
        // At least one chip remains visible and truncates if necessary.
        fit = 1;
      }
      setVisibleChipCount((current) => current === fit ? current : fit);
    };
    calculate();
    const observer = new ResizeObserver(calculate);
    observer.observe(summary);
    return () => observer.disconnect();
  }, [selected]);
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
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePicker(); return; }
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
  // Render help outside the scrolling sidebar so it cannot be clipped by overflow.
  useLayoutEffect(() => {
    if (!tipOpen || !info) return;
    const anchor = infoRef.current?.getBoundingClientRect();
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;
    const width = Math.min(260, window.innerWidth - 24);
    const left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12));
    const top = anchor.bottom + 8 + tooltip.offsetHeight <= window.innerHeight - 12
      ? anchor.bottom + 8
      : Math.max(12, anchor.top - tooltip.offsetHeight - 8);
    setTooltipPosition({ top, left, width });
  }, [tipOpen, info]);
  useEffect(() => {
    if (!tipOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (infoRef.current?.contains(event.target as Node) ||
          tooltipRef.current?.contains(event.target as Node)) return;
      setTipOpen(false);
    };
    const onScroll = () => setTipOpen(false);
    const onResize = () => setTipOpen(false);
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [tipOpen]);
  const dialog = open && typeof document !== "undefined" ? createPortal(
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) closePicker(); }}>
      <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className={styles.dialogHeader}>
          <div><h2 id={id}>{label}</h2><span>{draft.length ? `${draft.length} selected` : mode === "single" && !clearable ? "Select one" : "Any"}</span></div>
          <button type="button" ref={closeRef} className={styles.close} aria-label={`Close ${label}`} onClick={closePicker}>
            <LucideIcon name="x"/>
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
              <span className={`${styles.check} ${checked ? styles.checked : ""}`} aria-hidden="true">{checked ? <LucideIcon name="check" size={14}/> : null}</span>
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
      <span className={`${styles.headerLine} ${info ? styles.hasInfo : ""}`}>
        <span className={styles.name}>{label}</span>
        <LucideIcon name="chevron-right" className={styles.chevron}/>
      </span>
      <span className={styles.summary} ref={summaryRef}>
        {selected.length ? <>
          {selected.slice(0, visibleChipCount).map(option => <span key={option.value} className={styles.chip}>
            {option.icon && <OriginalImage src={option.icon} alt="" width={16} height={16} />}
            <span>{option.label}</span>
          </span>)}
          {selected.length > visibleChipCount && <span className={styles.more}>+{selected.length - visibleChipCount} more</span>}
        </> : <span className={styles.empty}>Any</span>}
      </span>
      <span className={styles.measure} ref={measureRef} aria-hidden="true">
        {selected.map(option => <span key={option.value} className={styles.chip}>
          {option.icon && <OriginalImage src={option.icon} alt="" width={16} height={16} />}
          <span>{option.label}</span>
        </span>)}
        <span className={styles.more} ref={measureMoreRef} />
      </span>
    </button>
    {info && <>
      <button type="button" ref={infoRef} className={styles.info} aria-label={`About ${label}`}
        aria-expanded={tipOpen} aria-describedby={tipOpen ? `${id}-help` : undefined}
        onClick={(event) => {
          if (event.detail > 0 && window.matchMedia("(hover: hover) and (pointer: fine)").matches) setTipOpen(true);
          else setTipOpen(current => !current);
        }}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") setTipOpen(true); }}
        onPointerLeave={(event) => { if (event.pointerType === "mouse") setTipOpen(false); }}
        onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) setTipOpen(true); }}
        onBlur={() => setTipOpen(false)}>
        <LucideIcon name="info"/>
      </button>
      {tipOpen && typeof document !== "undefined" && createPortal(
        <div ref={tooltipRef} id={`${id}-help`} className={styles.tooltip} role="tooltip"
          style={tooltipPosition ?? { visibility: "hidden" }}>{info}</div>, document.body)}
    </>}
    {dialog}
  </div>;
}
