"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BATTLE_TO_INTENSE_CROSSFADE_MS,
  DEFAULT_INTENSE_LEAD_IN_MS,
  DEFAULT_MUSIC_LEAD_IN_FADE_MS,
  INTENSE_TO_BATTLE_CROSSFADE_MS,
  MUSIC_LIBRARY_UPDATED_EVENT,
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
  fadeStartedAt: number;
  fadeDurationMs: number;
};

type MusicFadeIn = {
  index: 0 | 1;
  startedAt: number;
  durationMs: number;
};

type PendingMusicFadeIn = {
  index: 0 | 1;
  durationMs: number;
};

type AudioContextWindow = typeof window & {
  webkitAudioContext?: typeof AudioContext;
};

type NavigatorWithAudioSession = Navigator & {
  audioSession?: {
    type: "auto" | "ambient" | "playback" | "transient" | "transient-solo" | "play-and-record";
  };
};

const clampVolume = (value: number) => Math.min(1, Math.max(0, value));

const configureAmbientAudioSession = () => {
  const session = (navigator as NavigatorWithAudioSession).audioSession;
  if (!session) return;
  try {
    session.type = "ambient";
  } catch {
    // Audio Session is progressive enhancement; unsupported values must not block playback.
  }
};

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
  const fadeInRef = useRef<MusicFadeIn | null>(null);
  const pendingFadeInRef = useRef<PendingMusicFadeIn | null>(null);
  const fadeInTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaSourcesRef = useRef<[MediaElementAudioSourceNode | null, MediaElementAudioSourceNode | null]>([null, null]);
  const gainNodesRef = useRef<[GainNode | null, GainNode | null]>([null, null]);
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

  const ensureAudioGraph = useCallback(() => {
    const audios = audiosRef.current;
    if (!audios[0] || !audios[1]) return null;

    let context = audioContextRef.current;
    if (!context) {
      const AudioContextApi = window.AudioContext
        ?? (window as AudioContextWindow).webkitAudioContext;
      if (!AudioContextApi) return null;
      context = new AudioContextApi();
      audioContextRef.current = context;
    }

    for (const index of [0, 1] as const) {
      if (mediaSourcesRef.current[index] && gainNodesRef.current[index]) continue;
      const source = context.createMediaElementSource(audios[index]);
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(context.destination);
      mediaSourcesRef.current[index] = source;
      gainNodesRef.current[index] = gain;
      audios[index].volume = 1;
    }

    return context;
  }, []);

  const scheduleChannelGain = useCallback((
    index: 0 | 1,
    fromValue: number,
    toValue: number,
    delayMs = 0,
    durationMs = 0,
  ) => {
    const audio = audiosRef.current[index];
    if (!audio) return;
    const context = audioContextRef.current;
    const gain = gainNodesRef.current[index];
    const from = clampVolume(fromValue);
    const to = clampVolume(toValue);

    if (!context || !gain) {
      audio.volume = to;
      return;
    }

    audio.volume = 1;
    const now = context.currentTime;
    const rampStart = now + Math.max(0, delayMs) / 1_000;
    const rampEnd = rampStart + Math.max(0, durationMs) / 1_000;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(from, now);
    if (rampStart > now) gain.gain.setValueAtTime(from, rampStart);
    if (rampEnd > rampStart) gain.gain.linearRampToValueAtTime(to, rampEnd);
    else gain.gain.setValueAtTime(to, rampStart);
  }, []);

  const applyVolumes = useCallback(() => {
    const tracks = tracksRef.current;
    const transition = transitionRef.current;
    if (!transition) {
      const active = activeIndexRef.current;
      const fadeIn = fadeInRef.current;
      const pendingFadeIn = pendingFadeInRef.current;
      for (const index of [0, 1] as const) {
        if (!audiosRef.current[index]) continue;
        if (index !== active || pendingFadeIn?.index === index) {
          scheduleChannelGain(index, 0, 0);
          continue;
        }
        const target = gainForTrack(tracks[index]);
        if (fadeIn?.index === index) {
          const elapsedMs = Math.max(0, performance.now() - fadeIn.startedAt);
          const progress = fadeIn.durationMs <= 0
            ? 1
            : Math.min(1, elapsedMs / fadeIn.durationMs);
          const current = target * progress;
          scheduleChannelGain(
            index,
            current,
            target,
            0,
            Math.max(0, fadeIn.durationMs - elapsedMs),
          );
        } else {
          scheduleChannelGain(index, target, target);
        }
      }
      return;
    }

    const now = performance.now();
    const delayMs = Math.max(0, transition.fadeStartedAt - now);
    const elapsedMs = Math.max(0, now - transition.fadeStartedAt);
    const progress = transition.fadeDurationMs <= 0
      ? 1
      : Math.min(1, elapsedMs / transition.fadeDurationMs);
    const remainingMs = Math.max(0, transition.fadeDurationMs - elapsedMs);
    const fromTarget = gainForTrack(tracks[transition.fromIndex]);
    const toTarget = gainForTrack(tracks[transition.toIndex]);
    scheduleChannelGain(
      transition.fromIndex,
      fromTarget * (1 - progress),
      0,
      delayMs,
      remainingMs,
    );
    scheduleChannelGain(
      transition.toIndex,
      toTarget * progress,
      toTarget,
      delayMs,
      remainingMs,
    );
  }, [gainForTrack, scheduleChannelGain]);

  const clearTransitionTimers = useCallback(() => {
    if (leadTimerRef.current != null) {
      window.clearTimeout(leadTimerRef.current);
      leadTimerRef.current = null;
    }
  }, []);

  const clearLeadInFade = useCallback((preservePending = false) => {
    if (fadeInTimerRef.current != null) {
      window.clearTimeout(fadeInTimerRef.current);
      fadeInTimerRef.current = null;
    }
    fadeInRef.current = null;
    if (!preservePending) pendingFadeInRef.current = null;
  }, []);

  const beginLeadInFade = useCallback((index: 0 | 1) => {
    const pending = pendingFadeInRef.current;
    const audio = audiosRef.current[index];
    if (
      !pending
      || pending.index !== index
      || !audio
      || !tracksRef.current[index]
      || transitionRef.current
      || !unlockedRef.current
      || !musicEnabledRef.current
    ) return;
    void audio.play().then(() => {
      if (
        pendingFadeInRef.current !== pending
        || activeIndexRef.current !== index
        || transitionRef.current
        || !musicEnabledRef.current
      ) return;
      pendingFadeInRef.current = null;
      if (pending.durationMs <= 0) {
        applyVolumes();
        return;
      }
      const fadeIn: MusicFadeIn = {
        index,
        startedAt: performance.now(),
        durationMs: pending.durationMs,
      };
      fadeInRef.current = fadeIn;
      applyVolumes();
      fadeInTimerRef.current = window.setTimeout(() => {
        if (fadeInRef.current !== fadeIn) return;
        fadeInRef.current = null;
        fadeInTimerRef.current = null;
        applyVolumes();
      }, pending.durationMs);
    }).catch(() => undefined);
  }, [applyVolumes]);

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
    const progress = transition.fadeDurationMs <= 0
      ? 1
      : Math.min(1, Math.max(0, (performance.now() - transition.fadeStartedAt) / transition.fadeDurationMs));
    if (progress >= .5) {
      keepIndex = transition.toIndex;
      keepCategory = transition.toCategory;
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
    clearLeadInFade();
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

    const fromTrack = tracksRef.current[fromIndex];
    const outgoingRemainingMs = fromTrack?.loop
      ? Number.POSITIVE_INFINITY
      : Math.max(0, (fromTrack?.durationMs ?? 0) - fromAudio.currentTime * 1_000);
    const safeLeadIn = Math.min(
      Math.max(0, leadInMs),
      Math.max(0, next.durationMs - 1_000),
      Math.max(0, outgoingRemainingMs - fadeDurationMs),
    );
    const transition: MusicTransition = {
      fromIndex,
      toIndex,
      fromCategory: activeCategoryRef.current,
      toCategory,
      fadeStartedAt: performance.now() + safeLeadIn,
      fadeDurationMs,
    };
    transitionRef.current = transition;
    nearEndTriggeredRef.current = false;
    setCycle(0);

    if (unlockedRef.current && musicEnabledRef.current) {
      void toAudio.play().catch(() => undefined);
      void fromAudio.play().catch(() => undefined);
    }
    applyVolumes();

    leadTimerRef.current = window.setTimeout(
      () => finishTransition(transition),
      safeLeadIn + fadeDurationMs,
    );
  }, [applyVolumes, cancelTransition, clearLeadInFade, finishTransition]);

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
    configureAmbientAudioSession();
    return () => {
      if (startTimerRef.current != null) window.clearTimeout(startTimerRef.current);
      clearTransitionTimers();
      clearLeadInFade();
      for (const cleanup of cleanups) cleanup();
      mediaSourcesRef.current.forEach((source) => source?.disconnect());
      gainNodesRef.current.forEach((gain) => gain?.disconnect());
      mediaSourcesRef.current = [null, null];
      gainNodesRef.current = [null, null];
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") void context.close().catch(() => undefined);
      tracksRef.current = [null, null];
      audiosRef.current = [null, null];
    };
  }, [clearLeadInFade, clearTransitionTimers]);

  useEffect(() => {
    const unlock = () => {
      unlockedRef.current = true;
      configureAmbientAudioSession();
      const context = ensureAudioGraph();
      if (context?.state === "suspended") void context.resume().catch(() => undefined);
      if (!musicEnabledRef.current) return;
      applyVolumes();
      for (const index of [0, 1] as const) {
        if (tracksRef.current[index]) {
          if (pendingFadeInRef.current?.index === index) beginLeadInFade(index);
          else void audiosRef.current[index]?.play().catch(() => undefined);
        }
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [applyVolumes, beginLeadInFade, ensureAudioGraph]);

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
    let active = true;
    const refreshManifest = () => {
      fetch("/api/music", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Music manifest is unavailable.");
          return await response.json() as MusicManifest;
        })
        .then((value) => {
          if (!active) return;
          const currentById = new Map(value.tracks.map((track) => [track.id, track]));
          let activeTrackRemoved = false;
          for (const index of [0, 1] as const) {
            const current = tracksRef.current[index];
            if (!current) continue;
            const replacement = currentById.get(current.id);
            if (replacement) {
              tracksRef.current[index] = replacement;
              const audio = audiosRef.current[index];
              if (audio) audio.loop = replacement.loop;
              continue;
            }
            const audio = audiosRef.current[index];
            audio?.pause();
            if (audio) {
              audio.removeAttribute("src");
              audio.load();
            }
            tracksRef.current[index] = null;
            if (index === activeIndexRef.current) activeTrackRemoved = true;
          }
          if (
            transitionRef.current
            && (
              !tracksRef.current[transitionRef.current.fromIndex]
              || !tracksRef.current[transitionRef.current.toIndex]
            )
          ) {
            clearTransitionTimers();
            transitionRef.current = null;
          }
          if (activeTrackRemoved) {
            clearLeadInFade();
            activeCategoryRef.current = null;
            nearEndTriggeredRef.current = false;
            setCycle((value) => value + 1);
          }
          setManifest(value);
          applyVolumes();
        })
        .catch(() => undefined);
    };
    window.addEventListener(MUSIC_LIBRARY_UPDATED_EVENT, refreshManifest);
    return () => {
      active = false;
      window.removeEventListener(MUSIC_LIBRARY_UPDATED_EVENT, refreshManifest);
    };
  }, [applyVolumes, clearLeadInFade, clearTransitionTimers]);

  useEffect(() => {
    applyVolumes();
    if (!musicEnabled) {
      clearLeadInFade(Boolean(pendingFadeInRef.current));
      for (const audio of audiosRef.current) audio?.pause();
    } else if (unlockedRef.current) {
      configureAmbientAudioSession();
      const context = ensureAudioGraph();
      if (context?.state === "suspended") void context.resume().catch(() => undefined);
      for (const index of [0, 1] as const) {
        if (!tracksRef.current[index]) continue;
        if (pendingFadeInRef.current?.index === index) beginLeadInFade(index);
        else void audiosRef.current[index]?.play().catch(() => undefined);
      }
    }
  }, [applyVolumes, beginLeadInFade, clearLeadInFade, ensureAudioGraph, masterVolume, musicEnabled, targetVolume]);

  useEffect(() => {
    if (!manifest || !musicEnabled || !category) {
      if (startTimerRef.current != null) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
      cancelTransition();
      clearLeadInFade();
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
      if (unlockedRef.current) {
        if (pendingFadeInRef.current?.index === activeIndex) beginLeadInFade(activeIndex);
        else void audio.play().catch(() => undefined);
      }
      return;
    }

    const next = weightedMusicTrack(manifest.tracks, category, current?.id ?? "");
    if (!next) {
      clearLeadInFade();
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

    if (current && pendingFadeInRef.current?.index !== activeIndex) {
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

    if (current) {
      clearLeadInFade();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      tracksRef.current[activeIndex] = null;
      activeCategoryRef.current = null;
    }

    startTimerRef.current = window.setTimeout(() => {
      clearLeadInFade();
      audio.pause();
      audio.src = next.url;
      audio.currentTime = 0;
      audio.loop = next.loop;
      audio.preload = "none";
      tracksRef.current[activeIndex] = next;
      activeCategoryRef.current = category;
      nearEndTriggeredRef.current = false;
      pendingFadeInRef.current = {
        index: activeIndex,
        durationMs: manifest.settings?.leadInFadeMs ?? DEFAULT_MUSIC_LEAD_IN_FADE_MS,
      };
      setCycle(0);
      applyVolumes();
      beginLeadInFade(activeIndex);
    }, pathname === "/play/match" ? 900 : 1_400);

    return () => {
      if (startTimerRef.current != null) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
    };
  }, [applyVolumes, beginLeadInFade, cancelTransition, category, clearLeadInFade, cycle, manifest, musicEnabled, pathname, startTransition]);

  useEffect(() => {
    const recover = () => {
      if (document.visibilityState !== "visible" || !musicEnabledRef.current || !unlockedRef.current) return;

      const transition = transitionRef.current;
      if (
        transition
        && performance.now() >= transition.fadeStartedAt + transition.fadeDurationMs
      ) {
        finishTransition(transition);
      }

      const fadeIn = fadeInRef.current;
      if (fadeIn && performance.now() >= fadeIn.startedAt + fadeIn.durationMs) {
        clearLeadInFade(true);
      }

      configureAmbientAudioSession();
      const context = ensureAudioGraph();
      if (context?.state === "suspended") void context.resume().catch(() => undefined);
      applyVolumes();
      for (const index of [0, 1] as const) {
        if (!tracksRef.current[index]) continue;
        if (pendingFadeInRef.current?.index === index) beginLeadInFade(index);
        else void audiosRef.current[index]?.play().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", recover);
    return () => document.removeEventListener("visibilitychange", recover);
  }, [applyVolumes, beginLeadInFade, clearLeadInFade, ensureAudioGraph, finishTransition]);

  return null;
}
