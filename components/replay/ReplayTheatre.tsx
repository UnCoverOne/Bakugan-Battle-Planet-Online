"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MatchResultRecord } from "../../lib/persistence";
import type { ReplayBundle, ReplayTransportBundle } from "../../lib/engine/replay-types";
import { accountIsAdministrator } from "../../lib/admin-ai-visibility";
import { buildLocalReplayJournalDiagnostic } from "../../lib/replay-debug-diagnostic";
import { firstGameplayReplayFrameIndex } from "../../lib/replay-view";
import { loadLocalReplayHistory, loadLocalReplayWhenReady } from "../../lib/replay-local-store";
import { reconstructLocalReplay, reconstructServerReplay } from "../../lib/replay-playback-client";
import { flushLocalReplayJournalAndWait } from "../../lib/replay-journal";
import { useApp } from "../application/AppProvider";
import { ReplayBattlefield } from "./ReplayBattlefield";
import styles from "./ReplayTheatre.module.css";

const SPEEDS = [0.5, 1, 2, 4] as const;

function legacyLabel(record: MatchResultRecord, index: number) {
  return record.log?.[index]?.message ?? "Legacy match event";
}

function replayFrameHoldMs(bundle: ReplayBundle | null, index: number) {
  const frame = bundle?.frames[index];
  if (!frame) return 900;
  const previous = index > 0 ? bundle?.frames[index - 1] : undefined;
  let duration = 900;

  switch (frame.commandType) {
    case "CONFIRM_ROLL":
    case "ACTIVATE_REROLL":
      duration = 7000;
      break;
    case "ENERGIZE":
      duration = 1250;
      break;
    case "DRAW_TURN_CARD":
    case "DRAW_PENDING_CARD":
      duration = 950;
      break;
    case "REVEAL_DAMAGE_FLIP":
    case "PLAY_DAMAGE_FLIP":
      duration = 1250;
      break;
    case "PLAY_CARD":
    case "SUBMIT_CARD_CHOICE":
      duration = 1250;
      break;
    case "START_NEXT_SERIES_GAME":
      duration = 1500;
      break;
    default:
      break;
  }

  if (previous && previous.state.gameNumber !== frame.state.gameNumber) {
    duration = Math.max(duration, 1500);
  } else if (previous && previous.state.phase !== frame.state.phase) {
    duration = Math.max(duration, 1100);
  }
  if (frame.state.phase === "result") duration = Math.max(duration, 1800);
  return duration;
}

function downloadDebugText(text: string, replayId: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `replay-debug-${replayId.replace(/[^A-Za-z0-9._-]/g, "_")}.txt`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ReplayTheatre({ record, onBack }: { record: MatchResultRecord; onBack: () => void }) {
  const { authUser } = useApp();
  const administrator = accountIsAdministrator(authUser);
  const [bundle, setBundle] = useState<ReplayBundle | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [presentationEpoch, setPresentationEpoch] = useState(0);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "legacy" | "error">("loading");
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [debugDownloading, setDebugDownloading] = useState(false);
  const [debugDownloadError, setDebugDownloadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setBundle(null);
    setIndex(0);
    setPlaying(false);
    setPresentationEpoch(0);
    setError("");
    setStatus("loading");
    setDebugDownloading(false);
    setDebugDownloadError("");
    const load = async () => {
      if (record.replayStorage === "local") {
        const archive = await loadLocalReplayWhenReady(record.replayId ?? record.id);
        if (!archive) throw new Error("This local replay is no longer available on this device.");
        const playerId = archive.recording.genesis.players[0]?.id;
        if (!playerId) throw new Error("This replay has no player perspective.");
        return reconstructLocalReplay(archive, playerId);
      }
      if (record.replayStorage === "server") {
        const response = await fetch(`/api/replays?id=${encodeURIComponent(record.replayId ?? record.id)}`, { cache: "no-store" });
        const data = await response.json() as { bundle?: ReplayTransportBundle; error?: string };
        if (!response.ok || !data.bundle) throw new Error(data.error ?? "Replay could not be loaded.");
        return reconstructServerReplay(data.bundle);
      }
      return null;
    };
    void load().then((next) => {
      if (cancelled) return;
      if (next) {
        if (!next.frames.length) throw new Error("This replay contains no displayable match states.");
        setBundle(next);
        setIndex(firstGameplayReplayFrameIndex(next.frames));
        setStatus("ready");
      } else if (record.log?.length) {
        setIndex(record.log.length - 1);
        setStatus("legacy");
      } else {
        throw new Error("No playable replay data is attached to this record.");
      }
    }).catch((cause) => {
      if (cancelled) return;
      setError(cause instanceof Error ? cause.message : "Replay could not be loaded.");
      setStatus(record.log?.length ? "legacy" : "error");
    });
    return () => { cancelled = true; };
  }, [loadAttempt, record]);

  const frameCount = bundle?.frames.length ?? record.log?.length ?? 0;
  const frame = bundle?.frames[Math.min(index, Math.max(0, frameCount - 1))];
  const currentLabel = frame?.label ?? legacyLabel(record, index);
  const seek = useCallback((next: number, animateAdjacentForward = false) => {
    const clamped = Math.max(0, Math.min(Math.max(0, frameCount - 1), next));
    const animate = animateAdjacentForward && clamped === index + 1;
    if (clamped !== index && !animate) setPresentationEpoch((value) => value + 1);
    setIndex(clamped);
  }, [frameCount, index]);

  const downloadReplayDebugData = useCallback(async () => {
    if (!administrator || debugDownloading) return;
    const replayId = record.replayId ?? record.id;
    setDebugDownloading(true);
    setDebugDownloadError("");
    try {
      if (record.replayStorage === "local") {
        let journalFlushError: string | null = null;
        try {
          await flushLocalReplayJournalAndWait();
        } catch (cause) {
          journalFlushError = cause instanceof Error ? cause.message : String(cause);
        }
        const [archive, localJournal] = await Promise.all([
          loadLocalReplayWhenReady(replayId),
          loadLocalReplayHistory(replayId),
        ]);
        if (!archive) throw new Error("This local replay is no longer available on this device.");
        downloadDebugText(`${JSON.stringify({
          schemaVersion: 2,
          generatedAt: new Date().toISOString(),
          source: "local",
          notice: "Administrator replay diagnostic generated from this device's local replay archive and raw engine-history journal.",
          journalFlushError,
          localJournalSummary: buildLocalReplayJournalDiagnostic(localJournal),
          record,
          archive,
          localJournal,
        }, null, 2)}\n`, replayId);
        return;
      }
      if (record.replayStorage !== "server") {
        throw new Error("No replay archive is available for this record.");
      }
      const response = await fetch(`/api/replays/debug?id=${encodeURIComponent(replayId)}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        let message = "Replay debug data could not be downloaded.";
        try {
          const result = await response.json() as { error?: string };
          if (result.error) message = result.error;
        } catch {}
        throw new Error(message);
      }
      downloadDebugText(await response.text(), replayId);
    } catch (cause) {
      setDebugDownloadError(cause instanceof Error ? cause.message : "Replay debug data could not be downloaded.");
    } finally {
      setDebugDownloading(false);
    }
  }, [administrator, debugDownloading, record]);

  useEffect(() => {
    if (!playing || frameCount < 2) return;
    if (index >= frameCount - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setIndex((current) => {
        if (current >= frameCount - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, replayFrameHoldMs(bundle, index) / speed);
    return () => window.clearTimeout(timer);
  }, [bundle, frameCount, index, playing, speed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === "Escape") onBack();
      else if (event.key === " ") { event.preventDefault(); setPlaying((value) => !value); }
      else if (event.key === "ArrowLeft") seek(index - 1);
      else if (event.key === "ArrowRight") seek(index + 1, true);
      else if (event.key === "Home") seek(0);
      else if (event.key === "End") seek(frameCount - 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [frameCount, index, onBack, seek]);

  const nearbyFrames = useMemo(() => bundle?.frames.slice(Math.max(0, index - 4), index + 5) ?? [], [bundle, index]);
  const debugDownloadAvailable = administrator
    && (record.replayStorage === "server" || record.replayStorage === "local");

  return (
    <section
      ref={setPortalRoot}
      className={styles.theatre}
      aria-label={`Replay of ${record.result} against ${record.opponent}`}
    >
      <div className={styles.board} aria-busy={status === "loading"} aria-live="polite">
        {frame ? (
          <ReplayBattlefield
            match={frame.state}
            playerId={bundle?.perspectivePlayerId}
            playbackRate={speed}
            presentationEpoch={presentationEpoch}
            portalRoot={portalRoot}
          />
        ) : (
          <div className={styles.stageStatus} data-status={status} role={status === "error" ? "alert" : "status"}>
            <span aria-hidden="true">{status === "loading" ? "◌" : status === "legacy" ? "≡" : "!"}</span>
            <strong>{status === "loading"
              ? "Reconstructing battlefield"
              : status === "legacy"
                ? "Event log replay"
                : "Replay could not be displayed"}</strong>
            {status === "loading"
              ? <p>Preparing the saved match states…</p>
              : status === "legacy"
                ? <p>This record contains its verified event log, but no reconstructable board states.</p>
                : <><p>{error || "No displayable replay data is available."}</p><button type="button" onClick={() => setLoadAttempt((value) => value + 1)}>Retry replay</button></>}
          </div>
        )}
      </div>

      <header className={styles.header}>
        <button type="button" onClick={onBack}>← Records</button>
        <div>
          <span>{record.result} · {record.score}</span>
          <strong>vs {record.opponent}</strong>
        </div>
        <span className={styles.mode}>{record.mode ?? "legacy"} · {(record.format ?? "bo1").toUpperCase()}</span>
      </header>

      <aside className={styles.inspector}>
        <span>FRAME {Math.min(index + 1, frameCount)} / {frameCount}</span>
        <h2>{status === "loading" ? "Reconstructing match…" : currentLabel}</h2>
        {frame ? <p>Game {frame.state.gameNumber} · Turn {frame.state.turn} · {frame.state.stepLabel}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
        {status === "legacy" ? <p>This older record predates state reconstruction. Its verified event log remains available.</p> : null}
        {debugDownloadAvailable ? (
          <button
            className={styles.debugDownload}
            type="button"
            onClick={() => void downloadReplayDebugData()}
            disabled={debugDownloading}
          >
            {debugDownloading ? "Preparing Replay Debug Data…" : "Download Replay Debug Data"}
          </button>
        ) : null}
        {debugDownloadError ? <p className={styles.error}>{debugDownloadError}</p> : null}
        {nearbyFrames.length ? <ol>
          {nearbyFrames.map((item) => <li key={item.index} data-active={item.index === index}>
            <button type="button" onClick={() => seek(item.index)}><span>{item.index + 1}</span>{item.label}</button>
          </li>)}
        </ol> : null}
      </aside>

      <footer className={styles.controls}>
        <button type="button" onClick={() => seek(0)} disabled={!index}>|◀</button>
        <button type="button" onClick={() => seek(index - 1)} disabled={!index}>◀</button>
        <button className={styles.play} type="button" onClick={() => setPlaying((value) => !value)} disabled={frameCount < 2} aria-label={playing ? "Pause replay" : "Play replay"}>{playing ? "Ⅱ" : "▶"}</button>
        <button type="button" onClick={() => seek(index + 1, true)} disabled={index >= frameCount - 1}>▶</button>
        <input aria-label="Replay position" type="range" min={0} max={Math.max(0, frameCount - 1)} value={Math.min(index, Math.max(0, frameCount - 1))} onChange={(event) => seek(Number(event.target.value))} />
        <div className={styles.markers} aria-label="Replay markers">
          {bundle?.markers.map((marker) => <button type="button" key={`${marker.index}-${marker.type}`} style={{ left: `${frameCount > 1 ? marker.index / (frameCount - 1) * 100 : 0}%` }} onClick={() => seek(marker.index)} title={marker.label} aria-label={`Jump to ${marker.label}`} />)}
        </div>
        <select aria-label="Playback speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value) as typeof speed)}>
          {SPEEDS.map((value) => <option value={value} key={value}>{value}×</option>)}
        </select>
      </footer>
    </section>
  );
}
