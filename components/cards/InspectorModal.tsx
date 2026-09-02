"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./InspectorModal.module.css";

type InspectorModalProps = {
  children: ReactNode;
  dataUi: string;
  titleId: string;
  describedBy?: string;
  onClose?: () => void;
  returnFocusRef?: { current: HTMLElement | null };
  className?: string;
};

export function InspectorModal({
  children,
  dataUi,
  titleId,
  describedBy,
  onClose,
  returnFocusRef,
  className,
}: InspectorModalProps) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!mounted) return;
    const panel = panelRef.current;
    const activeElement = document.activeElement;
    const returnFocus = returnFocusRef?.current
      ?? (activeElement instanceof HTMLElement ? activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusableSelector = [
      "button:not([disabled])",
      "[href]",
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
    const frame = window.requestAnimationFrame(() => {
      const first = focusable()[0];
      (first ?? panel)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const candidates = focusable();
      if (!candidates.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
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
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (returnFocus?.isConnected) window.requestAnimationFrame(() => returnFocus.focus());
    };
  }, [mounted, returnFocusRef]);

  if (!mounted) return null;
  return createPortal(
    <div
      data-ui={`${dataUi}-backdrop`}
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current?.();
      }}
    >
      <aside
        ref={panelRef}
        data-ui={dataUi}
        className={[styles.panel, className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {children}
      </aside>
    </div>,
    document.body,
  );
}
