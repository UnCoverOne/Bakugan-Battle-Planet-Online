"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CARD_BY_ID, type DeckRecord } from "../../lib/data";
import { cardArtSource } from "../../lib/content/card-art";
import { deckConstructionIdentity, type DeckValidationResult } from "../../lib/deck-validation";
import type { GameCard } from "../../lib/game";
import { CardArt } from "../cards/CardArt";
import { ActionButton } from "../design-system/primitives";
import { LucideIcon } from "../design-system/LucideIcon";
import { DeckPreview } from "./DeckGalleryCard";
import styles from "./DeckSaveDialog.module.css";

const visibilityOptions: { value: DeckRecord["visibility"]; description: string; icon: "file-pen-line" | "link" | "globe" }[] = [
  { value: "Draft", description: "Only visible to you.", icon: "file-pen-line" },
  { value: "Private", description: "Only visible through its link.", icon: "link" },
  { value: "Public", description: "Visible in the Public Deck library.", icon: "globe" },
];

type DeckSaveDialogProps = {
  deck: DeckRecord;
  report: DeckValidationResult;
  requiredCardCount: number;
  cards: readonly { card: GameCard; count: number }[];
  name: string;
  onNameChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  visibility: DeckRecord["visibility"];
  onVisibilityChange: (value: DeckRecord["visibility"]) => void;
  featuredCardId: string;
  onFeaturedCardChange: (id: string) => void;
  fixedVisibility: boolean;
  saveDisabled: boolean;
  onSave: () => void;
  onClose: () => void;
};

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function DeckSaveDialog({
  deck, report, requiredCardCount, cards, name, onNameChange, description, onDescriptionChange,
  visibility, onVisibilityChange, featuredCardId, onFeaturedCardChange,
  fixedVisibility, saveDisabled, onSave, onClose,
}: DeckSaveDialogProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cardQuery, setCardQuery] = useState("");
  const saveDialogRef = useRef<HTMLElement>(null);
  const pickerDialogRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const pickerVisited = useRef(false);

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nameRef.current?.focus();
    return () => { returnFocus?.focus(); };
  }, []);

  useEffect(() => {
    if (pickerOpen) {
      pickerVisited.current = true;
      searchRef.current?.focus();
    } else if (pickerVisited.current) {
      changeRef.current?.focus();
    }
  }, [pickerOpen]);

  const requestedCard = CARD_BY_ID.get(featuredCardId);
  const matchingId = requestedCard && deck.cardIds.find(id => {
    const candidate = CARD_BY_ID.get(id);
    return candidate && deckConstructionIdentity(candidate) === deckConstructionIdentity(requestedCard);
  });
  const actualFeaturedId = matchingId ?? deck.cardIds[0];
  const actualFeaturedCard = actualFeaturedId ? CARD_BY_ID.get(actualFeaturedId) : undefined;
  const featured = cards.find(item => actualFeaturedCard
    && deckConstructionIdentity(item.card) === deckConstructionIdentity(actualFeaturedCard))?.card ?? actualFeaturedCard;
  const previewDeck: DeckRecord = {
    ...deck,
    name: name.trim() || "Untitled Deck",
    leadCardId: actualFeaturedId,
  };
  const visibleCards = cards.filter(item => item.card.displayName.toLowerCase().includes(cardQuery.trim().toLowerCase()));

  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (pickerOpen) setPickerOpen(false);
      else onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = (pickerOpen ? pickerDialogRef : saveDialogRef).current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)]
      .filter(element => !element.hidden && element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!dialog.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return <>
    <div className={styles.backdrop} onMouseDown={event => {
      if (event.target === event.currentTarget && !pickerOpen) onClose();
    }}>
      <section ref={saveDialogRef} className={styles.dialog} role="dialog" aria-modal={!pickerOpen}
        aria-label="Save Deck" aria-hidden={pickerOpen} inert={pickerOpen}
        onKeyDown={onDialogKeyDown} data-ui="deck-save-dialog">
        <header className={styles.header}>
          <h2>Save Deck</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close Save Deck">
            <LucideIcon name="x" />
          </button>
        </header>
        <div className={styles.body}>
          <div className={styles.topGrid}>
            <div className={styles.previewSection}>
              <h3>Deck Preview</h3>
              <div className={styles.preview}><DeckPreview deck={previewDeck} /></div>
              <p className={report.isLegal ? styles.valid : styles.invalid} role="status">
                <LucideIcon name={report.isLegal ? "check" : "circle-alert"} size={15} />
                {report.isLegal ? "Legal deck" : report.issues.length + " legality " + (report.issues.length === 1 ? "issue" : "issues")}
                <span className={styles.format}>· {deck.format === "competitive" ? "Competitive" : deck.format === "singleton" ? "Singleton" : "Standard"}</span>
              </p>
              <p className={styles.counts}>{deck.bakuganIds.length}/3 Characters · {deck.coreIds.length}/6 BakuCores · {deck.cardIds.length}/{requiredCardCount} Cards</p>
            </div>

            <div className={styles.metadata}>
              <label className={styles.field}>
                <span>Deck Name</span>
                <input ref={nameRef} value={name} maxLength={60} required onChange={event => onNameChange(event.target.value)}
                  placeholder="Name your deck" />
              </label>
              <label className={styles.field}>
                <span>Description <small>Optional</small></span>
                <textarea value={description} maxLength={500} rows={4}
                  onChange={event => onDescriptionChange(event.target.value)}
                  placeholder="Describe your deck's strategy or playstyle…" />
                <small className={styles.characterCount}>{description.length}/500</small>
              </label>
              <div className={styles.featuredSection}>
                <h3>Featured Card</h3>
                <button type="button" ref={changeRef} className={styles.featuredChoice}
                  onClick={() => { setCardQuery(""); setPickerOpen(true); }} disabled={!cards.length}
                  aria-label={featured ? "Change featured card: " + featured.displayName : "Choose featured card"}>
                  {featured
                    ? <span className={styles.featuredThumb}><CardArt src={cardArtSource(featured, "thumbnail")} cardType={featured.type} presentation="readable" alt="" /></span>
                    : <span className={styles.emptyThumb}><LucideIcon name="image" /></span>}
                  <span className={styles.featuredText}>
                    <strong>{featured?.displayName ?? "No cards available"}</strong>
                    <small>{featured ? "Shown in your deck preview" : "Add a Main Deck card to choose one"}</small>
                  </span>
                  <span className={styles.changeLabel}>{featured ? "Change" : "Choose"} <LucideIcon name="chevron-right" size={15} /></span>
                </button>
              </div>
            </div>
          </div>

          <fieldset className={styles.visibility}>
            <legend>Visibility</legend>
            <div className={styles.visibilityOptions}>
              {visibilityOptions.filter(option => !fixedVisibility || option.value === visibility).map(option => {
                const unavailable = option.value === "Public" && !report.isLegal;
                return <label key={option.value} className={styles.visibilityOption + (visibility === option.value ? " " + styles.visibilitySelected : "") + (unavailable ? " " + styles.visibilityUnavailable : "")}>
                  <input type="radio" name="save-deck-visibility" value={option.value}
                    checked={visibility === option.value}
                    disabled={fixedVisibility || unavailable}
                    onChange={() => onVisibilityChange(option.value)} />
                  <LucideIcon name={option.icon} size={20} />
                  <span><strong>{option.value}</strong><small>{option.description}</small></span>
                </label>;
              })}
            </div>
            {!report.isLegal && <p className={styles.publicNotice} role="note">
              <LucideIcon name="circle-alert" size={16} />
              {fixedVisibility && visibility === "Private" ? "This managed deck must be legal before saving." : "Public decks must be legal."} {report.issues[0]?.message ?? "Check your deck construction."}
            </p>}
          </fieldset>
        </div>
        <footer className={styles.footer}>
          <ActionButton type="button" tone="quiet" onClick={onClose}>Cancel</ActionButton>
          <ActionButton type="button" disabled={saveDisabled} onClick={onSave}>
            {visibility === "Public" ? "Publish Deck" : visibility === "Draft" ? "Save Draft" : "Save Deck"}
          </ActionButton>
        </footer>
      </section>
    </div>

    {pickerOpen && <div className={styles.pickerBackdrop} onMouseDown={event => {
      if (event.target === event.currentTarget) setPickerOpen(false);
    }}>
      <section ref={pickerDialogRef} className={styles.pickerDialog} role="dialog" aria-modal="true"
        aria-label="Choose Featured Card" onKeyDown={onDialogKeyDown} data-ui="featured-card-picker">
        <header className={styles.header}>
          <div><h2>Choose Featured Card</h2><p>Select a card from your Main Deck.</p></div>
          <button type="button" className={styles.close} onClick={() => setPickerOpen(false)} aria-label="Close featured card picker">
            <LucideIcon name="x" />
          </button>
        </header>
        <div className={styles.pickerTools}>
          <label className={styles.searchField}>
            <LucideIcon name="search" size={17} />
            <span className={styles.srOnly}>Search Main Deck cards</span>
            <input ref={searchRef} type="search" value={cardQuery} onChange={event => setCardQuery(event.target.value)} placeholder="Search Main Deck cards…" />
          </label>
          <span>{visibleCards.length} cards</span>
        </div>
        <div className={styles.pickerBody}>
          <div className={styles.cardGrid}>
            {visibleCards.map(({ card, count }) => {
              const selected = actualFeaturedCard
                && deckConstructionIdentity(card) === deckConstructionIdentity(actualFeaturedCard);
              return <button type="button" className={styles.pickerCard + (selected ? " " + styles.pickerCardSelected : "")}
                key={card.catalogId} aria-pressed={Boolean(selected)}
                onClick={() => { onFeaturedCardChange(card.catalogId); setPickerOpen(false); }}>
                <span className={styles.pickerCardArt}>
                  <CardArt src={cardArtSource(card, "thumbnail")} cardType={card.type} presentation="readable" alt="" />
                </span>
                <span className={styles.pickerCardInfo}>
                  <strong>{card.displayName}</strong>
                  <small>{count} {count === 1 ? "copy" : "copies"}</small>
                </span>
                {selected && <span className={styles.selectedIcon}><LucideIcon name="check" size={16} /></span>}
              </button>;
            })}
          </div>
          {!visibleCards.length && <p className={styles.noResults}>No cards match your search.</p>}
        </div>
        <footer className={styles.footer}><ActionButton tone="quiet" onClick={() => setPickerOpen(false)}>Back to Save Deck</ActionButton></footer>
      </section>
    </div>}
  </>;
}
