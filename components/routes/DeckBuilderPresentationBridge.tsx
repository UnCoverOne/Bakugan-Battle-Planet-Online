"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./DeckBuilderPresentationBridge.module.css";

type FeaturedCardOption = {
  key: string;
  name: string;
  meta: string;
  image: string;
  selected: boolean;
  source: HTMLButtonElement;
};

type FeaturedPickerSnapshot = {
  dialog: HTMLElement;
  fieldset: HTMLFieldSetElement;
  options: FeaturedCardOption[];
};

function featuredPickerSnapshot(): FeaturedPickerSnapshot | null {
  const dialog = Array.from(document.querySelectorAll<HTMLElement>('section[role="dialog"]'))
    .find((candidate) => (
      candidate.getAttribute("aria-label")?.trim() === "Save Deck"
      || candidate.querySelector("h2")?.textContent?.trim() === "Save Deck"
    ));
  if (!dialog) return null;

  const fieldset = Array.from(dialog.querySelectorAll<HTMLFieldSetElement>("fieldset"))
    .find((candidate) => candidate.querySelector("legend")?.textContent?.trim() === "Featured Card");
  if (!fieldset) return null;

  if (fieldset.dataset.featuredCardPicker !== "enhanced") {
    fieldset.dataset.featuredCardPicker = "enhanced";
  }

  const options = Array.from(fieldset.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'))
    .map((source, index) => {
      const image = source.querySelector<HTMLImageElement>("img");
      const name = source.querySelector("strong")?.textContent?.trim() || `Featured card ${index + 1}`;
      const meta = source.querySelector("small")?.textContent?.trim() || "Main Deck card";
      return {
        key: `${index}-${name}-${image?.getAttribute("src") ?? "card"}`,
        name,
        meta,
        image: image?.currentSrc || image?.getAttribute("src") || "/assets/cards/card-missing.svg",
        selected: source.getAttribute("aria-pressed") === "true",
        source,
      };
    });

  return { dialog, fieldset, options };
}

export function DeckBuilderPresentationBridge() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<FeaturedCardOption[]>([]);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const sync = () => {
      const snapshot = featuredPickerSnapshot();
      if (!snapshot) {
        setOptions([]);
        setOpen(false);
        return;
      }
      setOptions(snapshot.options);
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const selected = target?.closest<HTMLButtonElement>(
        '[data-featured-card-picker="enhanced"] button[aria-pressed="true"]',
      );
      if (!selected) return;
      const snapshot = featuredPickerSnapshot();
      if (!snapshot?.options.length) return;
      returnFocusRef.current = selected;
      setOptions(snapshot.options);
      setOpen(true);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-pressed"],
    });
    document.addEventListener("click", onClick);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const returnFocus = returnFocusRef.current;
    const focusableSelector = [
      "button:not([disabled])",
      "[href]",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");

    const focusSelected = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const selected = dialog?.querySelector<HTMLElement>('[aria-pressed="true"]');
      (selected ?? dialog?.querySelector<HTMLElement>(focusableSelector))?.focus();
    });

    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onEscape, true);

    return () => {
      window.cancelAnimationFrame(focusSelected);
      window.removeEventListener("keydown", onEscape, true);
      window.requestAnimationFrame(() => {
        if (returnFocus?.isConnected) returnFocus.focus();
      });
    };
  }, [open]);

  const trapFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const candidates = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (!candidates.length) return;
    const first = candidates[0];
    const last = candidates[candidates.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!mounted || !open || !options.length) return null;

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Select Featured Card"
        onKeyDown={trapFocus}
      >
        <header>
          <div><span>Save Deck</span><h2>Select Featured Card</h2></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close Featured Card selection">×</button>
        </header>
        <p>Choose one card from the current Main Deck to represent this deck.</p>
        <div className={styles.grid}>
          {options.map((option) => (
            <button
              type="button"
              className={`${styles.option} ${option.selected ? styles.selected : ""}`}
              aria-pressed={option.selected}
              onClick={() => {
                if (!option.selected && option.source.isConnected) option.source.click();
                setOpen(false);
              }}
              key={option.key}
            >
              <OriginalImage src={option.image} alt="" />
              <span><strong>{option.name}</strong><small>{option.meta}</small></span>
              <i aria-hidden="true">{option.selected ? "✓" : ""}</i>
            </button>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}
