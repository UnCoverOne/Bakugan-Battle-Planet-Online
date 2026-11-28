"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CARDS } from "../../lib/data";
import { FEEDBACK_MIN_LENGTH, FEEDBACK_MAX_LENGTH, normalizeFeedbackMessage, type FeedbackKind } from "../../lib/feedback";
import { LucideIcon } from "../design-system/LucideIcon";
import { FeedbackCardSelector, FeedbackCardThumbnail, feedbackCardLabel } from "./FeedbackCardSelector";
import { useAppFields } from "./AppProvider";
import styles from "./FeedbackReportsDialog.module.css";

const OPTIONS = [
  { kind: "issue", title: "Report an issue", action: "Submit report", success: "Report submitted", placeholder: "Describe the issue, what you expected to happen, and how it can be reproduced…" },
  { kind: "suggestion", title: "Request a feature", action: "Submit request", success: "Feature request submitted", placeholder: "Describe the feature you would like to see and how it would benefit players…" },
] as const;
type View = "form" | "card" | "discard" | "sent";

export default function FeedbackReportsDialog({ onClose }: { onClose: () => void }) {
  const { catalogueRevision } = useAppFields(["catalogueRevision"]);
  void catalogueRevision;
  const [kind, setKind] = useState<FeedbackKind>("issue");
  const [cardId, setCardId] = useState("");
  const [details, setDetails] = useState("");
  const [view, setView] = useState<View>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryUntil, setRetryUntil] = useState(0);
  const [now, setNow] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cardTriggerRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusCard = useRef(false);
  const previousView = useRef<View>("form");
  const busyRef = useRef(false);
  const titleId = useId();
  const detailsId = useId();
  const detailsHelpId = useId();
  const active = OPTIONS.find(option => option.kind === kind)!;
  const selectedCard = CARDS.find(card => card.catalogId === cardId);
  const message = normalizeFeedbackMessage(details);
  const valid = message.length >= FEEDBACK_MIN_LENGTH && message.length <= FEEDBACK_MAX_LENGTH && (!cardId || Boolean(selectedCard));
  const remaining = Math.max(0, Math.ceil((retryUntil - now) / 1000));
  const dirty = details.length > 0 || Boolean(cardId);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); document.body.style.overflow = previous; };
  }, []);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (view === "discard") keepRef.current?.focus();
    else if (view === "form" && focusCard.current) {
      focusCard.current = false;
      cardTriggerRef.current?.focus();
    } else headingRef.current?.focus();
  }, [view]);
  useEffect(() => {
    if (!retryUntil) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= retryUntil) setRetryUntil(0);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [retryUntil]);

  const returnFromCard = () => { focusCard.current = true; setView("form"); };
  const requestClose = () => {
    if (busyRef.current) return;
    if (view === "discard") { setView(previousView.current); return; }
    if (view === "sent" || !dirty) { onClose(); return; }
    previousView.current = view;
    setView("discard");
  };
  const reset = () => {
    setDetails(""); setCardId(""); setError(""); setKind("issue"); setView("form");
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || !valid || remaining > 0) return;
    busyRef.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, cardId: cardId || null, message }),
      });
      const result = await response.json().catch(() => null) as { id?: string; error?: string; retryAfter?: number } | null;
      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after") ?? result?.retryAfter ?? 60);
        const current = Date.now();
        setNow(current);
        setRetryUntil(current + (Number.isFinite(seconds) ? Math.max(1, seconds) : 60) * 1000);
        setError("Too many submissions. Please wait before trying again.");
        return;
      }
      if (!response.ok || !result?.id) throw new Error(result?.error || "Could not submit feedback. Please try again.");
      setView("sent");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not submit feedback. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return <dialog ref={dialogRef} className={styles.dialog} data-feedback-menu aria-labelledby={titleId}
    onCancel={event => {
      event.preventDefault();
      if (view === "card") returnFromCard(); else requestClose();
    }}
    onClick={event => {
      if (event.target !== event.currentTarget || window.matchMedia("(max-width: 850px)").matches) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose();
    }}>
    <header className={styles.header}>
      {view === "card" && <button type="button" className={styles.iconButton} aria-label="Back to feedback" onClick={returnFromCard}><LucideIcon name="arrow-left" size={24}/></button>}
      <h2 id={titleId} ref={headingRef} tabIndex={-1}>{view === "card" ? "Select Card" : view === "discard" ? "Discard draft?" : "Feedback & Reports"}</h2>
      <button type="button" className={styles.iconButton} disabled={busy} aria-label="Close Feedback and Reports" onClick={requestClose}><LucideIcon name="x" size={24}/></button>
    </header>
    {view === "form" && <form className={styles.form} onSubmit={event => void submit(event)} aria-busy={busy}>
      <div className={styles.content} ref={scrollRef}>
        <fieldset className={styles.fields} disabled={busy}>
          <label className={styles.field}>
            <span>Submission type</span>
            <select className="bb-field" value={kind} onChange={event => {setKind(event.target.value as FeedbackKind);setError("");}}>
              {OPTIONS.map(option => <option key={option.kind} value={option.kind}>{option.title}</option>)}
            </select>
          </label>
          <div className={styles.field}>
            <span>Related card <small>(optional)</small></span>
            <div className={styles.cardSelection}>
              <button type="button" ref={cardTriggerRef} className={styles.cardTrigger} aria-label={selectedCard ? "Change related card: " + selectedCard.displayName : "Select a related card"} onClick={() => setView("card")}>
                {selectedCard ? <><FeedbackCardThumbnail card={selectedCard}/><span className={styles.cardIdentity}><strong>{selectedCard.displayName}</strong><small>{feedbackCardLabel(selectedCard)}</small></span></>
                  : <><LucideIcon name="files" size={20}/><span className={styles.unselected}>Select a card</span></>}
                <LucideIcon name={selectedCard ? "pencil" : "chevron-right"} size={20}/>
              </button>
              {cardId && <button type="button" className={styles.iconButton} aria-label="Remove related card" onClick={() => {setCardId("");cardTriggerRef.current?.focus();}}><LucideIcon name="x" size={20}/></button>}
            </div>
            {cardId && !selectedCard && <small role="alert">This card is no longer available. Choose another card or remove it.</small>}
          </div>
          <div className={styles.field}>
            <span className={styles.detailsHeading}><label htmlFor={detailsId}>Details</label><span className={styles.counter}>{message.length.toLocaleString()} / {FEEDBACK_MAX_LENGTH.toLocaleString()}</span></span>
            <textarea id={detailsId} className="bb-field" required minLength={FEEDBACK_MIN_LENGTH} maxLength={FEEDBACK_MAX_LENGTH} rows={7}
              value={details} onChange={event => setDetails(event.target.value)} aria-describedby={detailsHelpId} placeholder={active.placeholder}/>
            <small id={detailsHelpId}>Minimum {FEEDBACK_MIN_LENGTH} characters.</small>
          </div>
        </fieldset>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {remaining > 0 && <p className={styles.retry}>Try again in {remaining} seconds.</p>}
      </div>
      <footer className={styles.footer}>
        <button type="button" className="bb-button" disabled={busy} onClick={requestClose}>Cancel</button>
        <button type="submit" className="bb-button bb-button--primary" disabled={busy || !valid || remaining > 0}>{busy ? "Submitting…" : active.action}</button>
      </footer>
    </form>}
    {view === "card" && <>
      <div className={styles.content} ref={scrollRef}><FeedbackCardSelector selectedId={cardId} onSelect={id => {setCardId(id);returnFromCard();}}/></div>
      <footer className={styles.footer}><button type="button" className="bb-button" onClick={returnFromCard}>Back</button></footer>
    </>}
    {view === "discard" && <>
      <div className={styles.content} ref={scrollRef}><p className={styles.confirmText}>Your feedback has not been submitted. Closing this menu will discard your draft.</p></div>
      <footer className={styles.footer}>
        <button type="button" className="bb-button bb-button--danger" onClick={onClose}>Discard</button>
        <button type="button" ref={keepRef} className="bb-button" onClick={() => setView(previousView.current)}>Keep editing</button>
      </footer>
    </>}
    {view === "sent" && <>
      <div className={styles.content} ref={scrollRef}>
        <div className={styles.success} role="status">
          <span className={styles.successIcon}><LucideIcon name="check" size={32}/></span>
          <h3>{active.success}</h3>
          <p>Thank you for helping improve Bakugan Battle Planet Online. Your submission has been sent for review.</p>
        </div>
      </div>
      <footer className={styles.footer}>
        <button type="button" className="bb-button" onClick={reset}>Submit another</button>
        <button type="button" className="bb-button bb-button--primary" onClick={onClose}>Done</button>
      </footer>
    </>}
  </dialog>;
}
