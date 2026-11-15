"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./CompendiumSidebar.module.css";

export function CompendiumSidebar({ label, open, desktopVisible, onClose, children, footer, as = "aside", className = "" }: {
  label: string; open: boolean; desktopVisible: boolean; onClose: () => void;
  children: ReactNode; footer?: ReactNode; as?: "aside" | "nav"; className?: string;
}) {
  const id = useId();
  const [mobile, setMobile] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => setMobile(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!open || !mobile) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),summary'
      ) ?? []).filter((el) => el.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = oldOverflow; window.removeEventListener("keydown", onKey); };
  }, [open, mobile, onClose]);
  const Element = as;
  return <Element ref={panelRef as never} id={id} className={`${styles.panel} ${className}`} data-compendium-sidebar
    data-open={open} data-desktop-visible={desktopVisible} aria-label={label}
    role={mobile && open ? "dialog" : undefined} aria-modal={mobile && open ? true : undefined}
    onClickCapture={(event) => {
      if (mobile && event.target instanceof Element &&
        event.target.closest('a[href],button[data-sidebar-select]')) onClose();
    }}>
    <div className={styles.header}><strong>{label}</strong><button type="button" ref={closeRef} aria-label="Close panel" onClick={onClose}>×</button></div>
    <div className={styles.body}>{children}</div>
    {footer && <div className={styles.footer}>{footer}</div>}
  </Element>;
}
