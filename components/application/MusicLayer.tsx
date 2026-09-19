"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  musicCategoryForRoute,
  musicGain,
  weightedMusicTrack,
  type MusicManifest,
  type MusicTrack,
} from "../../lib/music";
import { useApp } from "./AppProvider";

type IdleWindow = typeof window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

export function MusicLayer() {
  const pathname = usePathname();
  const { settings, match, online, playerId } = useApp();
  const [manifest, setManifest] = useState<MusicManifest | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [cycle, setCycle] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentTrackRef = useRef<MusicTrack | null>(null);
  const startTimerRef = useRef<number | null>(null);
  const musicEnabled = settings.musicEnabled !== false;
  const category = useMemo(
    () => pathname.startsWith("/admin")
      ? null
      : musicCategoryForRoute(pathname, match, online, playerId),
    [match, online, pathname, playerId],
  );
  const targetVolume = settings.musicVolume ?? 55;
  const masterVolume = settings.masterVolume ?? 100;

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none";
    audioRef.current = audio;
    const ended = () => setCycle((value) => value + 1);
    audio.addEventListener("ended", ended);
    return () => {
      if (startTimerRef.current != null) window.clearTimeout(startTimerRef.current);
      audio.removeEventListener("ended", ended);
      audio.pause();
      audio.removeAttribute("src");
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const unlock = () => {
      setUnlocked(true);
      const audio = audioRef.current;
      if (audio && currentTrackRef.current && musicEnabled && document.visibilityState !== "hidden") {
        void audio.play().catch(() => undefined);
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [musicEnabled]);

  useEffect(() => {
    if (!musicEnabled || manifest) return;
    let active = true;
    const load = () => {
      fetch("/api/music")
        .then(async (response) => {
          if (!response.ok) throw new Error("Music manifest is unavailable.");
          return await response.json() as MusicManifest;
        })
        .then((value) => { if (active) setManifest(value); })
        .catch(() => undefined);
    };
    const idleWindow = window as IdleWindow;
    const fallback = window.setTimeout(load, 1_500);
    const idle = idleWindow.requestIdleCallback?.(() => {
      window.clearTimeout(fallback);
      load();
    }, { timeout: 3_000 });
    return () => {
      active = false;
      window.clearTimeout(fallback);
      if (idle != null) idleWindow.cancelIdleCallback?.(idle);
    };
  }, [manifest, musicEnabled]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const track = currentTrackRef.current;
    audio.volume = track ? musicGain(targetVolume, masterVolume, track.gainDb) : 0;
    if (!musicEnabled) audio.pause();
  }, [masterVolume, musicEnabled, targetVolume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !manifest || !musicEnabled || !category) {
      audio?.pause();
      return;
    }
    const current = currentTrackRef.current;
    if (
      cycle === 0
      && current
      && current.enabled
      && current.categories.includes(category)
    ) {
      audio.volume = musicGain(targetVolume, masterVolume, current.gainDb);
      if (unlocked && document.visibilityState !== "hidden") void audio.play().catch(() => undefined);
      return;
    }
    const next = weightedMusicTrack(manifest.tracks, category, current?.id ?? "");
    if (!next) {
      audio.pause();
      currentTrackRef.current = null;
      return;
    }

    if (startTimerRef.current != null) window.clearTimeout(startTimerRef.current);
    startTimerRef.current = window.setTimeout(() => {
      audio.pause();
      audio.src = next.url;
      audio.loop = next.loop;
      audio.volume = musicGain(targetVolume, masterVolume, next.gainDb);
      currentTrackRef.current = next;
      if (cycle !== 0) setCycle(0);
      if (unlocked && document.visibilityState !== "hidden") void audio.play().catch(() => undefined);
    }, pathname === "/play/match" ? 900 : 1_400);

    return () => {
      if (startTimerRef.current != null) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
    };
  }, [category, cycle, manifest, masterVolume, musicEnabled, pathname, targetVolume, unlocked]);

  useEffect(() => {
    const resume = () => {
      const audio = audioRef.current;
      if (!audio || !musicEnabled || !unlocked) return;
      if (document.visibilityState === "hidden") audio.pause();
      else if (currentTrackRef.current) void audio.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, [musicEnabled, unlocked]);

  return null;
}
