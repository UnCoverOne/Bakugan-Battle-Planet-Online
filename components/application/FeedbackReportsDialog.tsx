"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CARDS } from "../../lib/data";
import { cardSetCode } from "../../lib/content/catalogue";
import styles from "./FeedbackReportsDialog.module.css";

type FeedbackKind = "question" | "suggestion" | "bug" | "issue";
type FeedbackOption = {
  kind: FeedbackKind;
  title: string;
  description: string;
  prompt: string;
  placeholder: string;
};
const OPTIONS: readonly FeedbackOption[] = [
  { kind: "question", title: "Ask a Question", description: "Ask about cards, rules or gameplay.", prompt: "Your question", placeholder: "Describe the card interaction or question you need answered…" },
  { kind: "suggestion", title: "Suggest an Improvement", description: "Share an idea for the website or game.", prompt: "Your suggestion", placeholder: "What would you change, and why would it help?" },
  { kind: "bug", title: "Report a Bug", description: "Tell us what stopped working.", prompt: "Bug details", placeholder: "What happened? What did you expect? How can we reproduce it?" },
  { kind: "issue", title: "Report an Issue", description: "Flag incorrect card data or other concerns.", prompt: "Issue details", placeholder: "Where is the issue, and what needs correcting?" },
];
const SEARCHABLE_CARDS = CARDS.filter((card) => card.fusionFace !== "b")
  .map((card) => ({
    card,
    searchable: `${cardSetCode(card)} ${card.catalogId} ${card.displayName} ${card.name} ${card.faction} ${card.type} ${card.number}`.toLowerCase(),
  }))
  .sort((a, b) => a.card.displayName.localeCompare(b.card.displayName) || a.card.catalogId.localeCompare(b.card.catalogId));

function SearchableCardPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = SEARCHABLE_CARDS.find(({ card }) => card.catalogId === value)?.card;
  const matches = useMemo(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return SEARCHABLE_CARDS.filter(({ searchable }) => terms.every((term) => searchable.includes(term))).slice(0, 60);
  }, [query]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  };
  return <div className={styles.cardField} ref={rootRef}>
    <span className={styles.fieldLabel}>Related card <small>(optional)</small></span>
    <button ref={triggerRef} type="button" className={styles.cardTrigger} aria-haspopup="listbox"
      aria-expanded={open} aria-controls="feedback-card-options" onClick={() => setOpen((previous) => !previous)}>
      <span>{selected ? `${cardSetCode(selected)} · ${selected.displayName}` : "No specific card selected"}</span>
      <span aria-hidden="true">⌄</span>
    </button>
    {open && <div className={styles.cardPopover} onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
    }}>
      <input autoFocus type="search" className={styles.cardSearch} aria-label="Search cards"
        placeholder="Search by name, ID, faction or set…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div id="feedback-card-options" className={styles.cardResults} role="listbox" aria-label="Related card">
        <button type="button" role="option" aria-selected={!value} className={styles.cardOption} onClick={() => choose("")}>No specific card</button>
        {matches.map(({ card }) => <button key={card.catalogId} type="button" role="option"
          aria-selected={value === card.catalogId} className={styles.cardOption} onClick={() => choose(card.catalogId)}>
          <span className={styles.cardName}>{card.displayName}</span>
          <small>{cardSetCode(card)} #{card.number} · {card.faction} · {card.type}</small>
        </button>)}
        {!matches.length && <p className={styles.noCards}>No matching cards. Try a different name or set.</p>}
      </div>
      {matches.length === 60 && <p className={styles.cardHint}>Showing the first 60 matches. Refine your search to narrow the list.</p>}
    </div>}
  </div>;
}

export default function FeedbackReportsDialog({
  signedIn, onSignIn, onClose,
}: {
  signedIn: boolean;
  onSignIn: () => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>("question");
  const [cardId, setCardId] = useState("");
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent">("idle");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const active = OPTIONS.find((option) => option.kind === kind)!;
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);
  const handleKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab") return;
    const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((node) => node.getClientRects().length > 0);
    if (!nodes.length) return;
    if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!signedIn) { onSignIn(); return; }
    if (status === "submitting" || details.trim().length < 20 || details.trim().length > 2000) return;
    setStatus("submitting");
    setError("");
    try {
      const endpoint = kind === "question" ? "/api/rulings" : "/api/feedback";
      const body = kind === "question"
        ? { cardId: cardId || null, question: details.trim(), sourceUrl: window.location.href }
        : { kind, cardId: cardId || null, message: details.trim(), sourceUrl: window.location.href };
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string; id?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not submit your message.");
      setStatus("sent");
    } catch (failure) {
      setStatus("idle");
      setError(failure instanceof Error ? failure.message : "Could not submit your message.");
    }
  };
  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="feedback-title"
      className={styles.dialog} onKeyDown={handleKeys}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>Player support</span><h2 id="feedback-title">Feedback &amp; Reports</h2>
          <p>Help us improve Bakugan Battle Planet Online.</p></div>
        <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label="Close Feedback and Reports">×</button>
      </header>
      {status === "sent" ? <div className={styles.success} role="status">
        <strong>Submission received</strong>
        <p>Thank you! Your {active.title.toLowerCase()} has been sent for review.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => {
            setDetails(""); setCardId(""); setStatus("idle"); setError("");
          }}>Submit another</button>
          <button type="button" className={styles.secondary} onClick={onClose}>Done</button>
        </div>
      </div> : <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <span className={styles.fieldLabel}>What would you like to do?</span>
        <div className={styles.options} role="group" aria-label="Feedback type">
          {OPTIONS.map((option) => <button key={option.kind} type="button" className={styles.option}
            aria-pressed={kind === option.kind} disabled={status === "submitting"} onClick={() => { setKind(option.kind); setError(""); }}>
            <strong>{option.title}</strong><small>{option.description}</small>
          </button>)}
        </div>
        <SearchableCardPicker value={cardId} onChange={setCardId} />
        <label className={styles.details}>
          <span className={styles.fieldLabel}>{active.prompt} <small>(20–2,000 characters)</small></span>
          <textarea required minLength={20} maxLength={2000} rows={5} value={details}
            disabled={status === "submitting"} placeholder={active.placeholder}
            onChange={(event) => setDetails(event.target.value)} />
        </label>
        <div className={styles.counter}>{details.trim().length}/2,000</div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!signedIn && <p className={styles.signInNote}>Sign in to send your feedback. Your draft is not saved when you leave this dialog.</p>}
        <div className={styles.actions}>
          <button type={signedIn ? "submit" : "button"} className={styles.primary}
            disabled={status === "submitting" || (signedIn && details.trim().length < 20)}
            onClick={signedIn ? undefined : onSignIn}>
            {status === "submitting" ? "Submitting…" : signedIn ? "Submit" : "Sign in to submit"}
          </button>
          <button className={styles.secondary} type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>}
    </section>
  </div>;
}
