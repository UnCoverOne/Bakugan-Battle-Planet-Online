"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BATTLE_TO_INTENSE_CROSSFADE_MS,
  DEFAULT_INTENSE_LEAD_IN_MS,
  INTENSE_TO_BATTLE_CROSSFADE_MS,
  STANDARD_MUSIC_CROSSFADE_MS,
  musicBattleIntensity,
  musicCategoryForRoute,
  musicGain,
  weightedMusicTrack,
  type MusicCategory,
  type MusicManifest,
  type MusicTrack,
} from "../../lib/music";
import { useApp } from "./AppProvider";

type IdleWindow = typeof window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

type MusicTransition = {
  fromIndex: 0 | 1;
  toIndex: 0 | 1;
  fromCategory: MusicCategory | null;
  toCategory: MusicCategory;
  phase: "lead" | "fade";
  fadeStartedAt: number;
  fadeDurationMs: number;
};

const clampVolume = (value: number) => Math.min(1, Math.max(0, value));

export function MusicLayer() {
  const pathname = usePathname();
  const { settings, match, online, playerId } = useApp();
  const [manifest, setManifest] = useState<MusicManifest | null>(null);
  const [cycle, setCycle] = useState(0);
  const [intenseThroughTurn, setIntenseThroughTurn] = useState<number | null>(null);
  const audiosRef = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);
  const tracksRef = useRef<[MusicTrack | null, MusicTrack | null]>([null, null]);
  const activeIndexRef = useRef<0 | 1>(0);
  const activeCategoryRef = useRef<MusicCategory | null>(null);
  const transitionRef = useRef<MusicTransition | null>(null);
  const startTimerRef = useRef<number | null>(null);
  const leadTimerRef = useRef<number | null>(null);
  const fadeFrameRef = useRef<number | null>(null);
  const nearEndTriggeredRef = useRef(false);
  const unlockedRef = useRef(false);
  const musicEnabledRef = useRef(true);
  const targetVolumeRef = useRef(55);
  const masterVolumeRef = useRef(100);

  const musicEnabled = settings.musicEnabled !== false;
  const targetVolume = settings.musicVolume ?? 55;
  const masterVolume = settings.masterVolume ?? 100;
  musicEnabledRef.current = musicEnabled;
  targetVolumeRef.current = targetVolume;
  masterVolumeRef.current = masterVolume;

  const intensity = useMemo(
    () => pathname === "/play/match" ? musicBattleIntensity(match) : null,
    [match, pathname],
  );
  const baseCategory = useMemo(
    () => pathname.startsWith("/admin")
      ? null
      : musicCategoryForRoute(pathname, match, online, playerId),
    [match, online, pathname, playerId],
  );

  useEffect(() => {
    if (pathname !== "/play/match" || !match || match.phase === "result") {
      if (intenseThroughTurn != null) setIntenseThroughTurn(null);
      return;
    }
    if (intensity === "lethal-pressure") {
      if (intenseThroughTurn !== match.turn) setIntenseThroughTurn(match.turn);
      return;
    }
    if (intenseThroughTurn != null && intenseThroughTurn !== match.turn) {
      setIntenseThroughTurn(null);
    }
  }, [intenseThroughTurn, intensity, match, pathname]);

  const category = useMemo<MusicCategory | null>(() => {
    if (baseCategory === "battle" && match && intenseThroughTurn === match.turn) {
      return "battle-intense";
    }
    return baseCategory;
  }, [baseCategory, intenseThroughTurn, match]);

  const gainForTrack = useCallback((track: MusicTrack | null) => (
    track ? musicGain(targetVolumeRef.current, masterVolumeRef.current, track.gainDb) : 0
  ), []);

  const applyVolumes = useCallback(() => {
    const audios = audiosRef.current;
    const tracks = tracksRef.current;
    const transition = transitionRef.current;
    if (!transition) {
      const active = activeIndexRef.current;
      for (const index of [0, 1] as const) {
        const audio = audios[index];
        if (audio) audio.volume = index === active ? gainForTrack(tracks[index]) : 0;
      }
      return;
    }
    const fromAudio = audios[transition.fromIndex];
    const toAudio = audios[transition.toIndex];
    if (!fromAudio || !toAudio) return;
    if (transition.phase === "lead") {
      fromAudio.volume = gainForTrack(tracks[transition.fromIndex]);
      toAudio.volume = 0;
      return;
    }
    const progress = transition.fadeDurationMs <= 0
      ? 1
      : Math.min(1, Math.max(0, (performance.now() - transition.fadeStartedAt) / transition.fadeDurationMs));
    fromAudio.volume = clampVolume(gainForTrack(tracks[transition.fromIndex]) * (1 - progress));
    toAudio.volume = clampVolume(gainForTrack(tracks[transition.toIndex]) * progress);
  }, [gainForTrack]);

  const clearTransitionTimers = useCallback(() => {
    if (leadTimerRef.current != null) {
      window.clearTimeout(leadTimerRef.current);
      leadTimerRef.current = null;
    }
    if (fadeFrameRef.current != null) {
      window.cancelAnimationFrame(fadeFrameRef.current);
      fadeFrameRef.current = null;
    }
  }, []);

  const finishTransition = useCallback((transition: MusicTransition) => {
    if (transitionRef.current !== transition) return;
    clearTransitionTimers();
    const fromAudio = audiosRef.current[transition.fromIndex];
    if (fromAudio) {
      fromAudio.pause();
      fromAudio.removeAttribute("src");
      fromAudio.load();
    }
    tracksRef.current[transition.fromIndex] = null;
    activeIndexRef.current = transition.toIndex;
    activeCategoryRef.current = transition.toCategory;
    transitionRef.current = null;
    nearEndTriggeredRef.current = false;
    applyVolumes();
  }, [applyVolumes, clearTransitionTimers]);

  const cancelTransition = useCallback(() => {
    const transition = transitionRef.current;
    if (!transition) return;
    clearTransitionTimers();
    let keepIndex = transition.fromIndex;
    let keepCategory = transition.fromCategory;
    if (transition.phase === "fade") {
      const progress = transition.fadeDurationMs <= 0
        ? 1
        : Math.min(1, Math.max(0, (performance.now() - transition.fadeStartedAt) / transition.fadeDurationMs));
      if (progress >= .5) {
        keepIndex = transition.toIndex;
        keepCategory = transition.toCategory;
      }
    }
    const dropIndex = keepIndex === 0 ? 1 : 0;
    const dropAudio = audiosRef.current[dropIndex];
    if (dropAudio) {
      dropAudio.pause();
      dropAudio.removeAttribute("src");
      dropAudio.load();
    }
    tracksRef.current[dropIndex] = null;
    activeIndexRef.current = keepIndex;
    activeCategoryRef.current = keepCategory;
    transitionRef.current = null;
    nearEndTriggeredRef.current = false;
    applyVolumes();
  }, [applyVolumes, clearTransitionTimers]);

  const startTransition = useCallback((
    next: MusicTrack,
    toCategory: MusicCategory,
    leadInMs: number,
    fadeDurationMs: number,
  ) => {
    cancelTransition();
    const fromIndex = activeIndexRef.current;
    const toIndex = (fromIndex === 0 ? 1 : 0) as 0 | 1;
    const fromAudio = audiosRef.current[fromIndex];
    const toAudio = audiosRef.current[toIndex];
    if (!fromAudio || !toAudio) return;

    toAudio.pause();
    toAudio.src = next.url;
    toAudio.currentTime = 0;
    toAudio.loop = next.loop;
    toAudio.preload = "none";
    toAudio.volume = 0;
    tracksRef.current[toIndex] = next;

    const transition: MusicTransition = {
      fromIndex,
      toIndex,
      fromCategory: activeCategoryRef.current,
      toCategory,
      phase: "lead",
      fadeStartedAt: 0,
      fadeDurationMs,
    };
    transitionRef.current = transition;
    nearEndTriggeredRef.current = false;
    setCycle(0);

    if (unlockedRef.current && musicEnabledRef.current && document.visibilityState !== "hidden") {
      void toAudio.play().catch(() => undefined);
      void fromAudio.play().catch(() => undefined);
    }
    applyVolumes();

    const startFade = () => {
      if (transitionRef.current !== transition) return;
      transition.phase = "fade";
      transition.fadeStartedAt = performance.now();
      const frame = () => {
        if (transitionRef.current !== transition) return;
        applyVolumes();
        const progress = transition.fadeDurationMs <= 0
          ? 1
          : (performance.now() - transition.fadeStartedAt) / transition.fadeDurationMs;
        if (progress >= 1) {
          finishTransition(transition);
          return;
        }
        fadeFrameRef.current = window.requestAnimationFrame(frame);
      };
      frame();
    };

    const fromTrack = tracksRef.current[fromIndex];
    const outgoingRemainingMs = fromTrack?.loop
      ? Number.POSITIVE_INFINITY
      : Math.max(0, (fromTrack?.durationMs ?? 0) - fromAudio.currentTime * 1_000);
    const safeLeadIn = Math.min(
      Math.max(0, leadInMs),
      Math.max(0, next.durationMs - 1_000),
      Math.max(0, outgoingRemainingMs - fadeDurationMs),
    );
    if (safeLeadIn > 0) {
      leadTimerRef.current = window.setTimeout(startFade, safeLeadIn);
    } else {
      startFade();
    }
  }, [applyVolumes, cancelTransition, finishTransition]);

  useEffect(() => {
    const audios = [new Audio(), new Audio()] as [HTMLAudioElement, HTMLAudioElement];
    audiosRef.current = audios;
    const cleanups: Array<() => void> = [];
    audios.forEach((audio, indexValue) => {
      const index = indexValue as 0 | 1;
      audio.preload = "none";
      const ended = () => {
        if (transitionRef.current || activeIndexRef.current !== index) return;
        const track = tracksRef.current[index];
        if (!track || track.loop || nearEndTriggeredRef.current) return;
        setCycle((value) => value + 1);
      };
      const timeupdate = () => {
        if (transitionRef.current || activeIndexRef.current !== index || nearEndTriggeredRef.current) return;
        const track = tracksRef.current[index];
        if (!track || track.loop) return;
        const remainingMs = track.durationMs - audio.currentTime * 1_000;
        if (remainingMs > 0 && remainingMs <= STANDARD_MUSIC_CROSSFADE_MS) {
          nearEndTriggeredRef.current = true;
          setCycle((value) => value + 1);
        }
      };
      audio.addEventListener("ended", ended);
      audio.addEventListener("timeupdate", timeupdate);
      cleanups.push(() => {
        audio.removeEventListener("ended", ended);
        audio.removeEventListener("timeupdate", timeupdate);
        audio.pause();
        audio.removeAttribute("src");
      });
    });
    return () => {
      if (startTimerRef.current != null) window.clearTimeout(startTimerRef.current);
      clearTransitionTimers();
      for (const cleanup of cleanups) cleanup();
      tracksRef.current = [null, null];
      audiosRef.current = [null, null];
    };
  }, [clearTransitionTimers]);

  useEffect(() => {
    const unlock = () => {
      unlockedRef.current = true;
      if (!musicEnabledRef.current || document.visibilityState === "hidden") return;
      for (const index of [0, 1] as const) {
        if (tracksRef.current[index]) {
          void audiosRef.current[index]?.play().catch(() => undefined);
        }
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

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
    applyVolumes();
    if (!musicEnabled) {
      for (const audio of audiosRef.current) audio?.pause();
    } else if (unlockedRef.current && document.visibilityState !== "hidden") {
      for (const index of [0, 1] as const) {
        if (tracksRef.current[index]) void audiosRef.current[index]?.play().catch(() => undefined);
      }
    }
  }, [applyVolumes, masterVolume, musicEnabled, targetVolume]);

  useEffect(() => {
    if (!manifest || !musicEnabled || !category) {
      if (startTimerRef.current != null) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
      cancelTransition();
      for (const audio of audiosRef.current) audio?.pause();
      return;
    }

    if (transitionRef.current?.toCategory === category && cycle === 0) return;
    if (transitionRef.current) cancelTransition();

    const activeIndex = activeIndexRef.current;
    const audio = audiosRef.current[activeIndex];
    const current = tracksRef.current[activeIndex];
    const currentCategory = activeCategoryRef.current;
    if (!audio) return;

    if (
      cycle === 0
      && current
      && current.enabled
      && currentCategory === category
      && current.categories.includes(category)
    ) {
      applyVolumes();
      if (unlockedRef.current && document.visibilityState !== "hidden") {
        void audio.play().catch(() => undefined);
      }
      return;
    }

    const next = weightedMusicTrack(manifest.tracks, category, current?.id ?? "");
    if (!next) {
      audio.pause();
      tracksRef.current[activeIndex] = null;
      activeCategoryRef.current = null;
      return;
    }

    if (cycle === 0 && current?.id === next.id && currentCategory !== category) {
      activeCategoryRef.current = category;
      applyVolumes();
      return;
    }

    if (startTimerRef.current != null) {
      window.clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }

    if (current) {
      const battleToIntense = currentCategory === "battle" && category === "battle-intense";
      const intenseToBattle = currentCategory === "battle-intense" && category === "battle";
      const leadInMs = battleToIntense
        ? Number.isFinite(next.intenseLeadInMs) ? next.intenseLeadInMs : DEFAULT_INTENSE_LEAD_IN_MS
        : 0;
      const fadeDurationMs = battleToIntense
        ? BATTLE_TO_INTENSE_CROSSFADE_MS
        : intenseToBattle
          ? INTENSE_TO_BATTLE_CROSSFADE_MS
          : STANDARD_MUSIC_CROSSFADE_MS;
      startTransition(next, category, leadInMs, fadeDurationMs);
      return;
    }

    startTimerRef.current = window.setTimeout(() => {
      audio.pause();
      audio.src = next.url;
      audio.currentTime = 0;
      audio.loop = next.loop;
      audio.preload = "none";
      tracksRef.current[activeIndex] = next;
      activeCategoryRef.current = category;
      nearEndTriggeredRef.current = false;
      setCycle(0);
      applyVolumes();
      if (unlockedRef.current && document.visibilityState !== "hidden") {
        void audio.play().catch(() => undefined);
      }
    }, pathname === "/play/match" ? 900 : 1_400);

    return () => {
      if (startTimerRef.current != null) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
    };
  }, [applyVolumes, cancelTransition, category, cycle, manifest, musicEnabled, pathname, startTransition]);

  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === "hidden") {
        for (const audio of audiosRef.current) audio?.pause();
        return;
      }
      if (!musicEnabledRef.current || !unlockedRef.current) return;
      for (const index of [0, 1] as const) {
        if (tracksRef.current[index]) void audiosRef.current[index]?.play().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, []);

  return null;
}
