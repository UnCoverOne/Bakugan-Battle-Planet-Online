"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LucideIcon, type LucideIconName } from "../design-system/LucideIcon";
import { collectionEntry, COLLECTION_FIELDS, type Collection, type CollectionField, type CollectionEntry } from "../../lib/collection";
import type { CollectionPrinting } from "../../lib/collection-catalogue";
import styles from "./CollectionCounters.module.css";

const icons: Record<CollectionField, LucideIconName> = { standard: "layers", foil: "sparkles", wishlist: "star" };
export const quantityLabel = (field: CollectionField) => field[0].toUpperCase() + field.slice(1);
type Props = {
  label: string; totals: CollectionEntry; printings: readonly CollectionPrinting[];
  collection: Collection; onChange: (id: string, field: CollectionField, delta: number) => void;
};

export function CollectionCounters({ label, totals, printings, collection, onChange }: Props) {
  const id = useId();
  const [field, setField] = useState<CollectionField | null>(null);
  const [printing, setPrinting] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const selected = printings.find(item => item.id === printing);
  const count = field && selected ? collectionEntry(collection, selected.id)[field] : 0;
  const clearDraft = useCallback(() => { draftRef.current = null; setDraft(null); }, []);
  const commitDraft = useCallback(() => {
    const value = draftRef.current;
    clearDraft();
    if (field && selected && value !== null && /^\d+$/.test(value)) {
      const next = Math.min(999, Number(value));
      if (Number.isFinite(next) && next !== count) onChange(selected.id, field, next - count);
    }
  }, [clearDraft, field, selected, count, onChange]);
  const close = (restore = false) => { commitDraft(); setField(null); setPosition(null); if (restore) trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!field) return;
    const update = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const box = panel.current;
      if (!anchor || !box || anchor.bottom < 0 || anchor.top > window.innerHeight) { setField(null); setPosition(null); return; }
      const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - box.offsetWidth / 2, window.innerWidth - box.offsetWidth - 8));
      const above = anchor.top - box.offsetHeight - 6;
      const below = anchor.bottom + 6;
      const top = above >= 8 ? above : below + box.offsetHeight <= window.innerHeight - 8 ? below : Math.max(8, window.innerHeight - box.offsetHeight - 8);
      setPosition({ left, top });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer = new ResizeObserver(update);
    if (panel.current) observer.observe(panel.current);
    if (trigger.current) observer.observe(trigger.current);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [field, printing]);
  useEffect(() => {
    if (!field) return;
    (panel.current?.querySelector<HTMLElement>("select") ?? panel.current?.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
  }, [field]);
  useEffect(() => {
    if (!field) return;
    const outside = (event: PointerEvent) => {
      if (panel.current?.contains(event.target as Node) || trigger.current?.contains(event.target as Node)) return;
      commitDraft(); setField(null); setPosition(null);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); clearDraft(); setField(null); setPosition(null); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", keydown); };
  }, [field, commitDraft, clearDraft]);
  const change = (delta: number) => { if (field && selected) { commitDraft(); onChange(selected.id, field, delta); } };
  return <div className={styles.row} data-collection-counters data-owned={totals.standard + totals.foil > 0} data-wishlisted={totals.wishlist > 0}>
    {COLLECTION_FIELDS.map(kind => <button key={kind} type="button" className={styles.counter}
      data-zero={totals[kind] === 0} aria-label={label + ": " + totals[kind] + " " + kind + " copies. Edit quantity"}
      title={quantityLabel(kind) + ": " + totals[kind]} aria-haspopup="dialog" aria-expanded={field === kind} aria-controls={field === kind ? id : undefined}
      onClick={event => {
        if (field === kind) { close(true); return; }
        trigger.current = event.currentTarget; setPrinting(printings.length === 1 ? printings[0].id : "");
        clearDraft(); setPosition(null); setField(kind);
      }}><LucideIcon name={icons[kind]} size={14}/><span>{totals[kind]}</span></button>)}
    {field && createPortal(<div ref={panel} id={id} role="dialog" aria-label={label + " " + quantityLabel(field) + " copies"}
      className={styles.editor} style={position ?? { top: 0, left: 0, visibility: "hidden" }}
      onBlur={event => {
        const next = event.relatedTarget as Node | null;
        if (next && !panel.current?.contains(next) && next !== trigger.current) close();
      }}>
      <header className={styles.header}><strong>{quantityLabel(field)} copies</strong><button type="button" aria-label="Close quantity editor" onClick={() => close(true)}><LucideIcon name="x" size={16}/></button></header>
      {printings.length > 1 && <label className={styles.printing}>Printing
        <select value={printing} onChange={event => { commitDraft(); setPrinting(event.target.value); }}>
          <option value="">Choose a printing</option>
          {printings.map(item => <option key={item.id} value={item.id}>{item.label} ({collectionEntry(collection, item.id)[field]})</option>)}
        </select>
      </label>}
      <div className={styles.stepper}>
        <button type="button" aria-label={"Decrease " + field + " copies"} disabled={!selected || count === 0} onClick={() => change(-1)}><LucideIcon name="minus"/></button>
        <input aria-label={quantityLabel(field) + " quantity"} type="text" inputMode="numeric" pattern="[0-9]*" disabled={!selected}
          value={selected ? draft ?? String(count) : ""} onChange={event => { if (/^\d{0,3}$/.test(event.target.value)) { draftRef.current = event.target.value; setDraft(event.target.value); } }}
          onBlur={commitDraft} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commitDraft(); } }}/>
        <button type="button" aria-label={"Increase " + field + " copies"} disabled={!selected || count === 999} onClick={() => change(1)}><LucideIcon name="plus"/></button>
      </div>
      {printings.length > 1 && <small>{totals[field]} across {printings.length} printings</small>}
    </div>, document.body)}
  </div>;
}
