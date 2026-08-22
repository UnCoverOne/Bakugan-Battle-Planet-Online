"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

type BakuCorePresentationValue = {
  rollResultOpen: boolean;
  rollPresentationPending: boolean;
  deferredCoreCells: readonly string[];
  transferringCoreCells: readonly string[];
  hiddenCoreCells: ReadonlySet<string>;
  dismissRollResult: () => void;
};

const EMPTY_SET = new Set<string>();
const EMPTY_PRESENTATION: BakuCorePresentationValue = {
  rollResultOpen: false,
  rollPresentationPending: false,
  deferredCoreCells: [],
  transferringCoreCells: [],
  hiddenCoreCells: EMPTY_SET,
  dismissRollResult: () => undefined,
};

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

export function BakuCorePresentationProvider({ children }: { children: ReactNode }) {
  const stored = useMatchSelector((state): StoredPresentationMatch => ({ match: state.match, playerId: state.playerId }));
  const [record, setRecord] = useState<RollPresentationRecord | null>(null);
  const [rollResultOpen, setRollResultOpen] = useState(false);
  const [deferredCoreCells, setDeferredCoreCells] = useState<readonly string[]>([]);
  const [transferringCoreCells, setTransferringCoreCells] = useState<readonly string[]>([]);

  const signature = rollResultSignature(stored.match);
  const cellsKey = rollResultCells(stored.match).join("|");
  const storageKey = stored.match?.id
    ? rollPresentationStorageKey(stored.match.id, stored.playerId)
    : "";

  useEffect(() => {
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
  }, [signature, storageKey]);

  useEffect(() => {
    let delayTimer = 0;
    let endTimer = 0;
    let disposed = false;

    const synchronize = () => {
      if (disposed) return;
      window.clearTimeout(delayTimer);
      window.clearTimeout(endTimer);
      const cells = cellsKey ? cellsKey.split("|") : [];
      const stage = rollPresentationStage(signature, cells, record, Date.now());
      setRollResultOpen(stage.open);
      setDeferredCoreCells(stage.deferredCoreCells);
      setTransferringCoreCells(stage.transferringCoreCells);
      if (stage.transferDelayMs != null) {
        delayTimer = window.setTimeout(synchronize, Math.max(0, stage.transferDelayMs));
      } else if (stage.transferEndMs != null) {
        endTimer = window.setTimeout(synchronize, Math.max(0, stage.transferEndMs));
      }
    };

    synchronize();
    return () => {
      disposed = true;
      window.clearTimeout(delayTimer);
      window.clearTimeout(endTimer);
    };
  }, [signature, cellsKey, record]);

  const dismissRollResult = useCallback(() => {
    if (!signature || !storageKey) {
      setRollResultOpen(false);
      return;
    }
    const next: RollPresentationRecord = {
      signature,
      dismissedAt: Date.now(),
    };
    writePresentationRecord(storageKey, next);
    setRecord(next);
  }, [signature, storageKey]);

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
    rollResultOpen,
    rollPresentationPending,
    deferredCoreCells,
    transferringCoreCells,
    hiddenCoreCells,
    dismissRollResult,
  }), [
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
