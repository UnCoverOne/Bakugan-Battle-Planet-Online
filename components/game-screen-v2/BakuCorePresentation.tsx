"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { MatchState } from "../../lib/game";
import { rollResultCells, rollResultSignature } from "../../lib/rolling";
import {
  rollPresentationIsPending,
  rollPresentationStage,
  rollPresentationStorageKey,
  type RollPresentationRecord,
} from "./bakuCorePresentationState";
import { useMatchSelector } from "./matchStore";

type StoredPresentationMatch = {
  match: MatchState | null;
  playerId?: string;
};

type PresentationMode = "live" | "replay";

type BakuCorePresentationProviderProps = {
  children: ReactNode;
  match?: MatchState | null;
  playerId?: string;
  presentationMode?: PresentationMode;
  playbackRate?: number;
  onReplayRollResultOpen?: () => void;
  onReplayRollResultDismiss?: () => void;
};

type BakuCorePresentationValue = {
  presentationMode: PresentationMode;
  rollResultOpen: boolean;
  rollPresentationPending: boolean;
  deferredCoreCells: readonly string[];
  transferringCoreCells: readonly string[];
  hiddenCoreCells: ReadonlySet<string>;
  dismissRollResult: () => void;
};

const EMPTY_SET = new Set<string>();
const EMPTY_PRESENTATION: BakuCorePresentationValue = {
  presentationMode: "live",
  rollResultOpen: false,
  rollPresentationPending: false,
  deferredCoreCells: [],
  transferringCoreCells: [],
  hiddenCoreCells: EMPTY_SET,
  dismissRollResult: () => undefined,
};
const REPLAY_INITIAL_PRESENTATION_AGE_MS = 10_000;

const BakuCorePresentationContext = createContext<BakuCorePresentationValue>(EMPTY_PRESENTATION);

function parseStoredValue<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function readPresentationRecord(key: string): RollPresentationRecord | null {
  return parseStoredValue<RollPresentationRecord | null>(localStorage.getItem(key), null);
}

function writePresentationRecord(key: string, record: RollPresentationRecord) {
  localStorage.setItem(key, JSON.stringify(record));
}

export function BakuCorePresentationProvider({
  children,
  match: replayMatch,
  playerId: replayPlayerId,
  presentationMode = "live",
  playbackRate = 1,
  onReplayRollResultOpen,
  onReplayRollResultDismiss,
}: BakuCorePresentationProviderProps) {
  const liveStored = useMatchSelector((state): StoredPresentationMatch => ({ match: state.match, playerId: state.playerId }));
  const stored: StoredPresentationMatch = presentationMode === "replay"
    ? { match: replayMatch ?? null, playerId: replayPlayerId }
    : liveStored;
  const rate = presentationMode === "replay"
    ? Math.max(0.25, Math.min(4, playbackRate || 1))
    : 1;
  const signature = rollResultSignature(stored.match);
  const cellsKey = rollResultCells(stored.match).join("|");
  const storageKey = presentationMode === "live" && stored.match?.id
    ? rollPresentationStorageKey(stored.match.id, stored.playerId)
    : "";
  const replaySignature = useRef(presentationMode === "replay" ? signature : "");
  const replayOpenNotified = useRef(false);
  const [record, setRecord] = useState<RollPresentationRecord | null>(() => (
    presentationMode === "replay" && signature
      ? { signature, dismissedAt: Date.now() - REPLAY_INITIAL_PRESENTATION_AGE_MS }
      : null
  ));
  const [rollResultOpen, setRollResultOpen] = useState(false);
  const [deferredCoreCells, setDeferredCoreCells] = useState<readonly string[]>([]);
  const [transferringCoreCells, setTransferringCoreCells] = useState<readonly string[]>([]);

  useEffect(() => {
    if (presentationMode === "replay") {
      if (replaySignature.current === signature) return;
      replaySignature.current = signature;
      setRecord(signature ? { signature, dismissedAt: null } : null);
      return;
    }
    if (!signature || !storageKey) {
      setRecord(null);
      return;
    }
    const persisted = readPresentationRecord(storageKey);
    if (persisted?.signature === signature) {
      setRecord(persisted);
      return;
    }
    const next: RollPresentationRecord = { signature, dismissedAt: null };
    writePresentationRecord(storageKey, next);
    setRecord(next);
  }, [presentationMode, signature, storageKey]);

  useEffect(() => {
    let delayTimer = 0;
    let endTimer = 0;
    let disposed = false;

    const synchronize = () => {
      if (disposed) return;
      window.clearTimeout(delayTimer);
      window.clearTimeout(endTimer);
      const cells = cellsKey ? cellsKey.split("|") : [];
      const now = Date.now();
      const stageNow = presentationMode === "replay" && record?.dismissedAt != null
        ? record.dismissedAt + (now - record.dismissedAt) * rate
        : now;
      const stage = rollPresentationStage(signature, cells, record, stageNow);
      setRollResultOpen(stage.open);
      setDeferredCoreCells(stage.deferredCoreCells);
      setTransferringCoreCells(stage.transferringCoreCells);
      if (stage.transferDelayMs != null) {
        delayTimer = window.setTimeout(synchronize, Math.max(0, stage.transferDelayMs / rate));
      } else if (stage.transferEndMs != null) {
        endTimer = window.setTimeout(synchronize, Math.max(0, stage.transferEndMs / rate));
      }
    };

    synchronize();
    return () => {
      disposed = true;
      window.clearTimeout(delayTimer);
      window.clearTimeout(endTimer);
    };
  }, [signature, cellsKey, record, presentationMode, rate]);

  useEffect(() => {
    if (presentationMode !== "replay") {
      replayOpenNotified.current = false;
      return;
    }
    if (!rollResultOpen) {
      replayOpenNotified.current = false;
      return;
    }
    if (replayOpenNotified.current) return;
    replayOpenNotified.current = true;
    onReplayRollResultOpen?.();
  }, [onReplayRollResultOpen, presentationMode, rollResultOpen]);

  const dismissRollResult = useCallback(() => {
    if (!signature) {
      setRollResultOpen(false);
      return;
    }
    const next: RollPresentationRecord = {
      signature,
      dismissedAt: Date.now(),
    };
    if (presentationMode === "live" && storageKey) writePresentationRecord(storageKey, next);
    setRecord(next);
    if (presentationMode === "replay") onReplayRollResultDismiss?.();
  }, [onReplayRollResultDismiss, presentationMode, signature, storageKey]);

  const hiddenCoreCells = useMemo(
    () => new Set([...deferredCoreCells, ...transferringCoreCells]),
    [deferredCoreCells, transferringCoreCells],
  );
  const rollPresentationPending = rollPresentationIsPending(signature, record, {
    open: rollResultOpen,
    deferredCoreCells,
    transferringCoreCells,
  });

  const value = useMemo<BakuCorePresentationValue>(() => ({
    presentationMode,
    rollResultOpen,
    rollPresentationPending,
    deferredCoreCells,
    transferringCoreCells,
    hiddenCoreCells,
    dismissRollResult,
  }), [
    presentationMode,
    rollResultOpen,
    rollPresentationPending,
    deferredCoreCells,
    transferringCoreCells,
    hiddenCoreCells,
    dismissRollResult,
  ]);

  return (
    <BakuCorePresentationContext.Provider value={value}>
      {children}
    </BakuCorePresentationContext.Provider>
  );
}

export function useBakuCorePresentation() {
  return useContext(BakuCorePresentationContext);
}
