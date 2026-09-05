"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchState } from "../../lib/game";
import { CardArt } from "../cards/CardArt";
import {
  activateCardPreviewTarget,
  cardPreviewRequestIsCurrent,
  clearCardPreviewTarget,
  EMPTY_CARD_PREVIEW_OWNERSHIP,
  type CardPreviewOwnership,
} from "./cardPreviewState";
import {
  decodePreviewArtwork,
  describePreviewElement,
  previewElementFromTarget,
  synchronizeDiscardCardTypes,
  type CardPreviewDescriptor,
  type PreviewElement,
} from "./cardPreviewController";
import styles from "./CardPreviewLayer.module.css";

type PreviewRenderState = {
  status: "idle" | "pending" | "visible" | "fallback";
  descriptor: CardPreviewDescriptor | null;
};

const CARD_PREVIEW_CLEAR_EVENT = "bbp-card-preview-clear";

/**
 * Clicking a hand card gives it DOM focus so it can remain selected. That focus
 * is gameplay state, not inspection intent. Hand previews therefore belong to
 * the live pointer target only; other zones may still use keyboard focus.
 */
export function previewElementFromFocusTarget(target: EventTarget | null): PreviewElement | null {
  const element = previewElementFromTarget(target);
  if (!element || element.closest('[data-zone-kind="hand"]')) return null;
  return element;
}

export function CardPreviewLayer({ match }: { match?: MatchState | null }) {
  const [renderState, setRenderState] = useState<PreviewRenderState>({
    status: "idle",
    descriptor: null,
  });
  const matchRef = useRef<MatchState | null>(match ?? null);
  const pointerElement = useRef<PreviewElement | null>(null);
  const focusElement = useRef<PreviewElement | null>(null);
  const elementTokens = useRef(new WeakMap<PreviewElement, string>());
  const nextElementToken = useRef(1);
  const ownership = useRef<CardPreviewOwnership>(EMPTY_CARD_PREVIEW_OWNERSHIP);
  const pendingFrame = useRef<number | null>(null);

  matchRef.current = match ?? null;

  const cancelPendingFrame = useCallback(() => {
    if (pendingFrame.current == null) return;
    window.cancelAnimationFrame(pendingFrame.current);
    pendingFrame.current = null;
  }, []);

  const tokenForElement = useCallback((element: PreviewElement) => {
    const existing = elementTokens.current.get(element);
    if (existing) return existing;
    const token = `preview-target-${nextElementToken.current}`;
    nextElementToken.current += 1;
    elementTokens.current.set(element, token);
    return token;
  }, []);

  const clearPreview = useCallback(() => {
    cancelPendingFrame();
    ownership.current = clearCardPreviewTarget(ownership.current);
    setRenderState((previous) => ({ status: "idle", descriptor: previous.descriptor }));
  }, [cancelPendingFrame]);

  const requestPreview = useCallback((descriptor: CardPreviewDescriptor | null) => {
    if (!descriptor) {
      if (ownership.current.targetId) clearPreview();
      return;
    }
    if (ownership.current.targetId === descriptor.targetId) return;

    cancelPendingFrame();
    const nextOwnership = activateCardPreviewTarget(ownership.current, descriptor.targetId);
    ownership.current = nextOwnership;
    setRenderState({ status: "pending", descriptor });

    pendingFrame.current = window.requestAnimationFrame(() => {
      pendingFrame.current = null;
      void decodePreviewArtwork(descriptor.src).then((loaded) => {
        if (!cardPreviewRequestIsCurrent(
          ownership.current,
          descriptor.targetId,
          nextOwnership.generation,
        )) return;
        setRenderState({
          status: loaded ? "visible" : "fallback",
          descriptor,
        });
      });
    });
  }, [cancelPendingFrame, clearPreview]);

  const reconcileTargets = useCallback(() => {
    if (pointerElement.current && !pointerElement.current.isConnected) pointerElement.current = null;
    if (focusElement.current && !focusElement.current.isConnected) focusElement.current = null;
    const activeElement = pointerElement.current ?? focusElement.current;
    requestPreview(activeElement
      ? describePreviewElement(matchRef.current, activeElement, tokenForElement(activeElement))
      : null);
  }, [requestPreview, tokenForElement]);

  useEffect(() => {
    synchronizeDiscardCardTypes(match ?? null, document);
    reconcileTargets();
  }, [match, reconcileTargets]);

  useEffect(() => {
    const setPointerTarget = (element: PreviewElement | null) => {
      if (pointerElement.current === element) return;
      pointerElement.current = element;
      reconcileTargets();
    };
    const setFocusTarget = (element: PreviewElement | null) => {
      if (focusElement.current === element) return;
      focusElement.current = element;
      reconcileTargets();
    };
    const clearAllTargets = () => {
      pointerElement.current = null;
      focusElement.current = null;
      clearPreview();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      // Touch devices have no persistent hover target. Keep the tapped card as
      // the inspection target until the player taps another card or UI area.
      setPointerTarget(previewElementFromTarget(event.target));
    };
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      setPointerTarget(previewElementFromTarget(event.target));
    };
    const onPointerOut = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const current = previewElementFromTarget(event.target);
      if (!current || pointerElement.current !== current) return;
      const next = previewElementFromTarget(event.relatedTarget);
      if (next !== current) setPointerTarget(next);
    };
    const onFocusIn = (event: FocusEvent) => {
      setFocusTarget(previewElementFromFocusTarget(event.target));
    };
    const onFocusOut = (event: FocusEvent) => {
      const current = previewElementFromFocusTarget(event.target);
      if (!current || focusElement.current !== current) return;
      const next = previewElementFromFocusTarget(event.relatedTarget);
      if (next !== current) setFocusTarget(next);
    };
    const onVisibilityChange = () => {
      if (document.hidden) clearAllTargets();
    };

    let mutationFrame = 0;
    const observer = new MutationObserver(() => {
      if (mutationFrame) return;
      mutationFrame = window.requestAnimationFrame(() => {
        mutationFrame = 0;
        synchronizeDiscardCardTypes(matchRef.current, document);
        if (
          (pointerElement.current && !pointerElement.current.isConnected)
          || (focusElement.current && !focusElement.current.isConnected)
        ) reconcileTargets();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("pointerover", onPointerOver, { passive: true });
    document.addEventListener("pointerout", onPointerOut, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", clearAllTargets);
    window.addEventListener(CARD_PREVIEW_CLEAR_EVENT, clearAllTargets);
    return () => {
      if (mutationFrame) window.cancelAnimationFrame(mutationFrame);
      observer.disconnect();
      cancelPendingFrame();
      ownership.current = clearCardPreviewTarget(ownership.current);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", clearAllTargets);
      window.removeEventListener(CARD_PREVIEW_CLEAR_EVENT, clearAllTargets);
    };
  }, [cancelPendingFrame, clearPreview, reconcileTargets]);

  const descriptor = renderState.descriptor;
  const visible = renderState.status === "visible" || renderState.status === "fallback";
  const fallback = renderState.status === "fallback";

  return (
    <aside
      className={styles.preview}
      aria-hidden={!visible}
      aria-label={visible && descriptor ? `${descriptor.label} enlarged preview` : undefined}
      data-card-preview="true"
      data-card-preview-visible={visible ? "true" : "false"}
      data-card-preview-status={renderState.status}
      data-card-preview-side={descriptor?.side ?? "left"}
      data-card-preview-orientation={descriptor?.orientation ?? "vertical"}
      data-card-preview-kind={descriptor?.previewKind ?? "card"}
      data-card-preview-type={descriptor?.cardType}
    >
      {descriptor && !fallback ? (
        <CardArt
          className={styles.previewImage}
          src={descriptor.src}
          cardType={descriptor.cardType}
          presentation="readable"
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      ) : descriptor ? (
        <article className={styles.placeholder}>
          <span className={styles.placeholderLabel}>ARTWORK UNAVAILABLE</span>
          <header>
            <strong>{descriptor.details.name}</strong>
            <span>{[
              descriptor.details.faction,
              descriptor.details.type,
              descriptor.details.cost,
            ].filter(Boolean).join(" • ")}</span>
          </header>
          {descriptor.details.stats ? <p className={styles.placeholderStats}>{descriptor.details.stats}</p> : null}
          {descriptor.details.cores ? <p className={styles.placeholderCores}>{descriptor.details.cores}</p> : null}
          <p className={styles.placeholderEffect}>{descriptor.details.effect}</p>
          {descriptor.details.mechanics ? <p className={styles.placeholderMechanics}>{descriptor.details.mechanics}</p> : null}
        </article>
      ) : null}
    </aside>
  );
}
