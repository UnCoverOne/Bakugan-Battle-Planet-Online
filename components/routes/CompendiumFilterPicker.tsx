"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "./CompendiumFilterPicker.module.css";

export type CompendiumFilterOption = {
  value: string;
  label: string;
  icon?: string;
};

export function CompendiumFilterPicker({
  label,
  values,
  options,
  onChange,
  searchable = false,
}: {
  label: string;
  values: readonly string[];
  options: readonly CompendiumFilterOption[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [anchorStyle, setAnchorStyle] = useState<CSSProperties>({});

  const selectedOptions = useMemo(
    () => values.map((value) => options.find((option) => option.value === value)).filter(Boolean) as CompendiumFilterOption[],
    [options, values],
  );
  const visibleOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? options.filter((option) => option.label.toLowerCase().includes(normalized))
      : options;
  }, [options, query]);

  const updateAnchor = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 280), Math.max(280, window.innerWidth - 16));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const estimatedHeight = Math.min(420, window.innerHeight * 0.72);
    const top = rect.bottom + 8 + estimatedHeight > window.innerHeight && rect.top > estimatedHeight
      ? Math.max(8, rect.top - estimatedHeight - 8)
      : rect.bottom + 8;
    setAnchorStyle({ top, left, width });
  };

  useEffect(() => {
    if (!open) return;
    updateAnchor();
    const close = () => setOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close);
    };
  }, [open]);

  const summary = values.length === 0
    ? "All"
    : values.length <= 2
      ? selectedOptions.map((option) => option.label).join(", ")
      : `${values.length} selected`;

  const toggle = (value: string) => {
    const next = values.includes(value)
      ? values.filter((candidate) => candidate !== value)
      : [...values, value];
    onChange(next);
  };

  const panel = open && typeof document !== "undefined"
    ? createPortal(
      <div className={styles.backdrop} role="presentation" onMouseDown={() => setOpen(false)}>
        <section
          className={styles.panel}
          role="dialog"
          aria-label={`${label} options`}
          style={anchorStyle}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className={styles.panelHeader}>
            <div>
              <span>{label}</span>
              <strong>{values.length ? `${values.length} selected` : "All"}</strong>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label={`Close ${label} options`}>×</button>
          </header>
          {searchable && (
            <label className={styles.search}>
              <span>Search</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
              />
            </label>
          )}
          <div className={styles.options} role="listbox" aria-multiselectable="true">
            {visibleOptions.map((option) => {
              const selected = values.includes(option.value);
              return (
                <button
                  className={selected ? styles.optionSelected : styles.option}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  key={option.value}
                  onClick={() => toggle(option.value)}
                >
                  <span className={styles.selectionMark} aria-hidden="true">{selected ? "◆" : "◇"}</span>
                  {option.icon && (
                    <OriginalImage className={styles.optionIcon} src={option.icon} alt="" width={24} height={24} />
                  )}
                  <span>{option.label}</span>
                </button>
              );
            })}
            {!visibleOptions.length && <p className={styles.empty}>No matching options.</p>}
          </div>
          <footer className={styles.panelFooter}>
            <button type="button" disabled={!values.length} onClick={() => onChange([])}>Clear</button>
            <button type="button" onClick={() => setOpen(false)}>Done</button>
          </footer>
        </section>
      </div>,
      document.body,
    )
    : null;

  return (
    <div className={styles.picker}>
      <span className={styles.label}>{label}</span>
      <button
        ref={triggerRef}
        className={styles.trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${summary}`}
        onClick={() => {
          setQuery("");
          updateAnchor();
          setOpen((current) => !current);
        }}
      >
        <span className={styles.triggerSummary}>
          {values.length === 0 && <span>All</span>}
          {values.length > 0 && values.length <= 2 && selectedOptions.map((option) => (
            <span className={styles.summaryOption} key={option.value}>
              {option.icon && (
                <OriginalImage className={styles.summaryIcon} src={option.icon} alt="" width={20} height={20} />
              )}
              {option.label}
            </span>
          ))}
          {values.length > 2 && <span>{values.length} selected</span>}
        </span>
        <span className={styles.chevron} aria-hidden="true">⌄</span>
      </button>
      {panel}
    </div>
  );
}
