"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./ReferenceContentsDrawer.module.css";

const MOBILE_QUERY = "(max-width: 900px)";

export function ReferenceContentsDrawer({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const media = window.matchMedia(MOBILE_QUERY);
    if (!media.matches) {
      setOpen(false);
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      } else if (event.key === "Tab") {
        const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), summary'
        ) ?? []).filter((element) => element.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const onMediaChange = () => { if (!media.matches) setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    media.addEventListener("change", onMediaChange);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      media.removeEventListener("change", onMediaChange);
    };
  }, [open]);

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={styles.tab}
      aria-controls={id}
      aria-expanded={open}
      aria-label="Open contents"
      data-open={open}
      onClick={() => setOpen(true)}
    >Contents</button>
    {open && <div className={styles.scrim} role="presentation" onClick={close} data-reference-contents-backdrop />}
    <nav
      id={id}
      ref={panelRef}
      data-reference-contents
      data-open={open}
      className={`${className} ${styles.panel}`}
      aria-label={label}
      onClickCapture={(event) => {
        if (window.matchMedia(MOBILE_QUERY).matches && event.target instanceof Element && event.target.closest("a[href], button")) close();
      }}
    >
      <button ref={closeRef} type="button" className={styles.close} aria-label="Close contents" onClick={close}>×</button>
      {children}
    </nav>
  </>;
}
