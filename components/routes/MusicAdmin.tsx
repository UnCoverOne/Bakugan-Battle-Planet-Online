"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { readJsonResponse } from "../../lib/json-response";
import {
  MUSIC_CATEGORIES,
  MUSIC_CATEGORY_LABELS,
  MUSIC_GAIN_MAX_DB,
  MUSIC_GAIN_MIN_DB,
  MUSIC_LIBRARY_UPDATED_EVENT,
  musicGain,
  type MusicCategory,
  type MusicTrack,
} from "../../lib/music";
import { ActionButton, Field, StatusChip, Surface } from "../design-system/primitives";
import { useApp } from "../application/AppProvider";
import styles from "./MusicAdmin.module.css";

type MusicAdminPayload = {
  tracks: MusicTrack[];
  categories: MusicCategory[];
  maxTrackBytes: number;
  uploadChunkBytes: number;
};

type ErrorPayload = { error?: unknown };

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function trackMetadataFromFile(file: File) {
  const stem = file.name.replace(/\.[^.]+$/, "").trim();
  const parts = stem.split(/\s*[—–]\s*|\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      name: parts[0].slice(0, 120),
      artist: parts.slice(1).join(" — ").slice(0, 120),
    };
  }
  return {
    name: stem.replace(/[_-]+/g, " ").trim().slice(0, 120),
    artist: "",
  };
}

function formatBitrate(bitrate: number) {
  return `${Math.max(1, Math.round(bitrate / 1000))} kbps`;
}

async function musicJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  try {
    const result = await readJsonResponse(response, fallbackMessage) as T & ErrorPayload;
    if (!response.ok) {
      throw new Error(typeof result.error === "string" ? result.error : `${fallbackMessage} (HTTP ${response.status}).`);
    }
    return result;
  } catch (cause) {
    const cloudflareError = response.headers.get("cf-error-type");
    if (cloudflareError) {
      throw new Error(`${fallbackMessage} (Cloudflare ${cloudflareError}, HTTP ${response.status}).`);
    }
    throw cause;
  }
}

async function uploadMusicChunk(
  uploadId: string,
  index: number,
  body: Blob,
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(
        `/api/admin/music?upload=${encodeURIComponent(uploadId)}&index=${index}`,
        {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body,
        },
      );
      return await musicJson<{ ok: boolean }>(response, "Music upload chunk failed.");
    } catch (cause) {
      lastError = cause;
      if (attempt < 2) {
        await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Music upload chunk failed.");
}

async function readAdminMusic() {
  const response = await fetch("/api/admin/music", { cache: "no-store" });
  return musicJson<MusicAdminPayload>(response, "Music library could not be loaded.");
}

function notifyMusicLibraryUpdated() {
  window.dispatchEvent(new Event(MUSIC_LIBRARY_UPDATED_EVENT));
}

export function MusicAdmin() {
  const { notify } = useApp();
  const [data, setData] = useState<MusicAdminPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [artist, setArtist] = useState("");
  const [categories, setCategories] = useState<MusicCategory[]>(["battle"]);
  const [enabled, setEnabled] = useState(true);
  const [loop, setLoop] = useState(false);
  const [weight, setWeight] = useState(10);
  const [gainDb, setGainDb] = useState(0);
  const [intenseLeadInSeconds, setIntenseLeadInSeconds] = useState(4);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ value: 0, label: "" });

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await readAdminMusic());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Music library could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const toggleCategory = (category: MusicCategory) => {
    setCategories((current) => current.includes(category)
      ? current.filter((item) => item !== category)
      : [...current, category]);
  };

  const importTrack = async () => {
    if (!source || !name.trim() || !categories.length) return;
    let uploadId = "";
    setImporting(true);
    setError("");
    setProgress({ value: .01, label: "Preparing import…" });
    try {
      const { convertMusicFileToOpus } = await import("../../lib/music-import-client");
      const converted = await convertMusicFileToOpus(source, (value, label) => {
        setProgress({ value: .04 + value * .62, label });
      });
      if (data?.maxTrackBytes && converted.blob.size > data.maxTrackBytes) {
        throw new Error(`Converted track is ${formatBytes(converted.blob.size)}; the library limit is ${formatBytes(data.maxTrackBytes)}.`);
      }

      setProgress({ value: .68, label: "Starting optimized upload…" });
      const beginResponse = await fetch("/api/admin/music", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "begin-upload",
          fileName: converted.fileName,
          byteLength: converted.blob.size,
          metadata: {
            name: name.trim(),
            artist: artist.trim(),
            categories,
            enabled,
            loop,
            weight,
            gainDb,
            durationMs: converted.durationMs,
            bitrate: converted.bitrate,
            intenseLeadInMs: Math.round(intenseLeadInSeconds * 1_000),
          },
        }),
      });
      const begun = await musicJson<{ uploadId: string; chunkBytes: number }>(
        beginResponse,
        "Music upload could not be started.",
      );
      uploadId = begun.uploadId;
      const chunkBytes = Math.max(32 * 1024, Number(begun.chunkBytes) || data?.uploadChunkBytes || 64 * 1024);
      const chunkCount = Math.ceil(converted.blob.size / chunkBytes);

      for (let index = 0; index < chunkCount; index += 1) {
        const start = index * chunkBytes;
        const end = Math.min(converted.blob.size, start + chunkBytes);
        await uploadMusicChunk(
          uploadId,
          index,
          converted.blob.slice(start, end),
        );
        setProgress({
          value: .7 + .25 * ((index + 1) / Math.max(1, chunkCount)),
          label: `Uploading optimized track… ${index + 1}/${chunkCount}`,
        });
      }

      setProgress({ value: .97, label: "Finalizing track…" });
      const finalizeResponse = await fetch("/api/admin/music", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "finalize-upload", uploadId }),
      });
      const result = await musicJson<{ track: MusicTrack }>(
        finalizeResponse,
        "Music track could not be finalized.",
      );
      uploadId = "";
      notify(`${result.track.name} imported as Opus and added to the music library.`);
      setSource(null);
      setName("");
      setArtist("");
      setIntenseLeadInSeconds(4);
      setProgress({ value: 0, label: "" });
      notifyMusicLibraryUpdated();
      await refresh();
    } catch (cause) {
      if (uploadId) {
        void fetch(`/api/admin/music?upload=${encodeURIComponent(uploadId)}`, { method: "DELETE" }).catch(() => undefined);
      }
      const message = cause instanceof Error ? cause.message : "Track import failed.";
      setError(message);
      notify(message);
    } finally {
      setImporting(false);
    }
  };

  const sorted = useMemo(
    () => [...(data?.tracks ?? [])].sort((left, right) => right.updatedAt - left.updatedAt),
    [data?.tracks],
  );

  return (
    <section className={styles.section}>
      <div className={styles.heading}>
        <div>
          <span>MUSIC LIBRARY</span>
          <h2>Gameplay soundtrack</h2>
          <p>Import source audio, convert it to efficient 48 kHz Opus in this browser, and control exactly where each track can play.</p>
        </div>
        <StatusChip tone="info">{sorted.filter((track) => track.enabled).length} ENABLED</StatusChip>
      </div>

      <Surface className={styles.importer}>
        <div className={styles.importHeader}>
          <div>
            <h3>Import Track</h3>
            <p>Conversion is administrator-only and never ships work into the gameplay render loop. Existing .opus files are preserved without re-encoding.</p>
          </div>
          <StatusChip tone="neutral">OPUS · 96 KBPS</StatusChip>
        </div>
        <div className={styles.importGrid}>
          <Field label="Source audio" hint="WAV, FLAC, MP3, AAC/M4A, Ogg, or an existing .opus file supported by this browser.">
            <input
              type="file"
              accept="audio/*,.opus,.wav,.flac,.mp3,.m4a,.aac,.ogg"
              disabled={importing}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setSource(file);
                if (file) {
                  const metadata = trackMetadataFromFile(file);
                  if (!name.trim()) setName(metadata.name);
                  if (!artist.trim()) setArtist(metadata.artist);
                }
              }}
            />
          </Field>
          <Field label="Track name">
            <input value={name} maxLength={120} disabled={importing} onChange={(event) => setName(event.target.value)} placeholder="Battle theme" />
          </Field>
          <Field label="Artist">
            <input value={artist} maxLength={120} disabled={importing} onChange={(event) => setArtist(event.target.value)} placeholder="Artist or composer" />
          </Field>
          <Field label="Selection weight" hint="Higher values make the track more likely to be picked.">
            <input type="number" min={1} max={100} value={weight} disabled={importing} onChange={(event) => setWeight(Number(event.target.value))} />
          </Field>
          <Field label="Volume trim" hint={`${MUSIC_GAIN_MIN_DB} dB to +${MUSIC_GAIN_MAX_DB} dB. Preview and gameplay use the same trim curve.`}>
            <input type="number" min={MUSIC_GAIN_MIN_DB} max={MUSIC_GAIN_MAX_DB} step={.5} value={gainDb} disabled={importing} onChange={(event) => setGainDb(Number(event.target.value))} />
          </Field>
          <Field label="Intense lead-in" hint="Seconds the Intense track plays silently before the 6-second crossfade begins.">
            <input type="number" min={0} max={15} step={.5} value={intenseLeadInSeconds} disabled={importing} onChange={(event) => setIntenseLeadInSeconds(Number(event.target.value))} />
          </Field>
        </div>
        <div className={styles.categoryGroup}>
          <strong>Playback categories</strong>
          <div>
            {MUSIC_CATEGORIES.map((category) => (
              <label key={category}>
                <input type="checkbox" checked={categories.includes(category)} disabled={importing} onChange={() => toggleCategory(category)} />
                <span>{MUSIC_CATEGORY_LABELS[category]}</span>
              </label>
            ))}
          </div>
        </div>
        <div className={styles.importOptions}>
          <label><input type="checkbox" checked={enabled} disabled={importing} onChange={(event) => setEnabled(event.target.checked)} /> Enable after import</label>
          <label><input type="checkbox" checked={loop} disabled={importing} onChange={(event) => setLoop(event.target.checked)} /> Loop this track continuously</label>
        </div>
        {importing ? (
          <div className={styles.progress} role="status">
            <div><span style={{ width: `${Math.round(progress.value * 100)}%` }} /></div>
            <p>{progress.label || "Processing…"}</p>
          </div>
        ) : null}
        <div className={styles.importActions}>
          <ActionButton disabled={!source || !name.trim() || !categories.length || importing} onClick={() => void importTrack()}>
            {importing ? "Processing…" : "Convert & Import"}
          </ActionButton>
        </div>
      </Surface>

      {error ? <Surface className={styles.error} role="alert">{error}</Surface> : null}
      {loading ? <Surface className={styles.state} role="status">Loading music library…</Surface> : null}
      {!loading && !sorted.length ? (
        <Surface className={styles.state}>No tracks have been imported yet.</Surface>
      ) : null}
      <div className={styles.trackList}>
        {sorted.map((track) => <TrackEditor track={track} key={track.id} onChanged={refresh} />)}
      </div>
    </section>
  );
}

function TrackEditor({ track, onChanged }: { track: MusicTrack; onChanged: () => Promise<void> }) {
  const { notify, settings } = useApp();
  const [draft, setDraft] = useState(track);
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const previewVolume = musicGain(
    settings.musicVolume ?? 55,
    settings.masterVolume ?? 100,
    draft.gainDb,
  );
  useEffect(() => setDraft(track), [track]);
  useEffect(() => {
    if (previewRef.current) previewRef.current.volume = previewVolume;
  }, [previewVolume]);

  const changed = JSON.stringify({
    name: draft.name,
    artist: draft.artist,
    enabled: draft.enabled,
    categories: draft.categories,
    weight: draft.weight,
    loop: draft.loop,
    gainDb: draft.gainDb,
    intenseLeadInMs: draft.intenseLeadInMs,
  }) !== JSON.stringify({
    name: track.name,
    artist: track.artist,
    enabled: track.enabled,
    categories: track.categories,
    weight: track.weight,
    loop: track.loop,
    gainDb: track.gainDb,
    intenseLeadInMs: track.intenseLeadInMs,
  });

  const patch = <K extends keyof MusicTrack>(key: K, value: MusicTrack[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/music", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: track.id,
          name: draft.name,
          artist: draft.artist,
          enabled: draft.enabled,
          categories: draft.categories,
          weight: draft.weight,
          loop: draft.loop,
          gainDb: draft.gainDb,
          intenseLeadInMs: draft.intenseLeadInMs,
        }),
      });
      const result = await musicJson<{ track: MusicTrack }>(response, "Track could not be updated.");
      notify(`${result.track.name} updated.`);
      notifyMusicLibraryUpdated();
      await onChanged();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Track could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Permanently delete "${track.name}" and its stored audio?`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/music?id=${encodeURIComponent(track.id)}`, { method: "DELETE" });
      await musicJson<{ ok: boolean }>(response, "Track could not be deleted.");
      notify(`${track.name} deleted from the music library.`);
      notifyMusicLibraryUpdated();
      await onChanged();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Track could not be deleted.");
    } finally {
      setBusy(false);
    }
  };

  const toggleCategory = (category: MusicCategory) => {
    patch("categories", draft.categories.includes(category)
      ? draft.categories.filter((item) => item !== category)
      : [...draft.categories, category]);
  };

  return (
    <Surface className={`${styles.track} ${draft.enabled ? "" : styles.disabledTrack}`}>
      <div className={styles.trackTop}>
        <div>
          <div className={styles.trackTitle}>
            <input aria-label="Track name" maxLength={120} value={draft.name} onChange={(event) => patch("name", event.target.value)} />
          </div>
          <p>{draft.artist ? `${draft.artist} · ` : ""}{formatDuration(track.durationMs)} · Opus {formatBitrate(track.bitrate)} · {formatBytes(track.bytes)}</p>
        </div>
        <label className={styles.enabledToggle}>
          <input type="checkbox" checked={draft.enabled} onChange={(event) => patch("enabled", event.target.checked)} />
          <span>Enabled</span>
        </label>
      </div>

      <audio
        ref={previewRef}
        className={styles.preview}
        controls
        preload="none"
        src={track.url}
        title={`Preview at in-game volume: ${Math.round(previewVolume * 100)}%`}
      >
        Your browser does not support audio preview.
      </audio>

      <div className={styles.categoryGroup}>
        <strong>Categories</strong>
        <div>
          {MUSIC_CATEGORIES.map((category) => (
            <label key={category}>
              <input type="checkbox" checked={draft.categories.includes(category)} onChange={() => toggleCategory(category)} />
              <span>{MUSIC_CATEGORY_LABELS[category]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className={styles.trackControls}>
        <Field label="Artist">
          <input maxLength={120} value={draft.artist} onChange={(event) => patch("artist", event.target.value)} placeholder="Artist or composer" />
        </Field>
        <Field label="Weight">
          <input type="number" min={1} max={100} value={draft.weight} onChange={(event) => patch("weight", Number(event.target.value))} />
        </Field>
        <Field label="Volume trim" hint={`Preview uses current Music (${settings.musicVolume ?? 55}%) and Master (${settings.masterVolume ?? 100}%) volume settings.`}>
          <input type="number" min={MUSIC_GAIN_MIN_DB} max={MUSIC_GAIN_MAX_DB} step={.5} value={draft.gainDb} onChange={(event) => patch("gainDb", Number(event.target.value))} />
        </Field>
        <Field label="Intense lead-in" hint="Silent buildup before the Battle → Intense crossfade.">
          <input type="number" min={0} max={15} step={.5} value={draft.intenseLeadInMs / 1000} onChange={(event) => patch("intenseLeadInMs", Math.round(Number(event.target.value) * 1000))} />
        </Field>
        <label className={styles.loopToggle}><input type="checkbox" checked={draft.loop} onChange={(event) => patch("loop", event.target.checked)} /> Loop continuously</label>
      </div>

      <div className={styles.actions}>
        <button className={styles.delete} disabled={busy} onClick={() => void remove()}>Delete</button>
        <ActionButton tone="secondary" disabled={busy || !changed || !draft.name.trim() || !draft.categories.length} onClick={() => void save()}>
          {busy ? "Saving…" : "Save Changes"}
        </ActionButton>
      </div>
    </Surface>
  );
}
