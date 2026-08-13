"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MatchResultRecord } from "../../lib/persistence";
import type { ReplayBundle, ReplayTransportBundle } from "../../lib/engine/replay-types";
import { firstGameplayReplayFrameIndex } from "../../lib/replay-view";
import { loadLocalReplayWhenReady } from "../../lib/replay-local-store";
import { reconstructLocalReplay, reconstructServerReplay } from "../../lib/replay-playback-client";
import { BakuCoreLayer } from "../game-screen-v2/BakuCoreLayer";
import { CardHandLayer } from "../game-screen-v2/CardHandLayer";
import { GameScreen } from "../game-screen-v2/GameScreen";
import styles from "./ReplayTheatre.module.css";

const SPEEDS = [0.5, 1, 2, 4] as const;

function legacyLabel(record: MatchResultRecord, index: number) {
  return record.log?.[index]?.message ?? "Legacy match event";
}

export function ReplayTheatre({ record, onBack }: { record: MatchResultRecord; onBack: () => void }) {
  const [bundle, setBundle] = useState<ReplayBundle | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [status, setStatus] = useState<"loading" | "ready" | "legacy" | "error">("loading");
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setBundle(null);
    setIndex(0);
    setPlaying(false);
    setError("");
    setStatus("loading");
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
  const seek = useCallback((next: number) => {
    setIndex(Math.max(0, Math.min(Math.max(0, frameCount - 1), next)));
  }, [frameCount]);

  useEffect(() => {
    if (!playing || frameCount < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => {
        if (current >= frameCount - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 900 / speed);
    return () => window.clearInterval(timer);
  }, [frameCount, playing, speed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === "Escape") onBack();
      else if (event.key === " ") { event.preventDefault(); setPlaying((value) => !value); }
      else if (event.key === "ArrowLeft") seek(index - 1);
      else if (event.key === "ArrowRight") seek(index + 1);
      else if (event.key === "Home") seek(0);
      else if (event.key === "End") seek(frameCount - 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [frameCount, index, onBack, seek]);

  const nearbyFrames = useMemo(() => bundle?.frames.slice(Math.max(0, index - 4), index + 5) ?? [], [bundle, index]);

  return (
    <section className={styles.theatre} aria-label={`Replay of ${record.result} against ${record.opponent}`}>
      <div className={styles.board} aria-busy={status === "loading"} aria-live="polite">
        {frame ? (<>
          <GameScreen match={frame.state} playerId={bundle?.perspectivePlayerId} presentationMode="replay" />
          <BakuCoreLayer match={frame.state} playerId={bundle?.perspectivePlayerId} readOnly />
          <CardHandLayer match={frame.state} playerId={bundle?.perspectivePlayerId} />
        </>) : (
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
        <button type="button" onClick={() => seek(index + 1)} disabled={index >= frameCount - 1}>▶</button>
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
