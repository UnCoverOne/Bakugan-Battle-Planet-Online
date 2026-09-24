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

type AudioContextWindow = typeof window & {
  webkitAudioContext?: typeof AudioContext;
};

type NavigatorWithAudioSession = Navigator & {
  audioSession?: {
    type: "auto" | "ambient" | "playback" | "transient" | "transient-solo" | "play-and-record";
  };
};

type MusicTransition = {
  fromIndex: 0 | 1;
  toIndex: 0 | 1;
  fromCategory: MusicCategory | null;
  toCategory: MusicCategory;
  fadeStartedAt: number;
  fadeDurationSeconds: number;
};

type MusicFadeIn = {
  index: 0 | 1;
  startedAt: number;
  durationSeconds: number;
};

type PendingMusicFadeIn = {
  index: 0 | 1;
  durationMs: number;
};

type PrefetchedTrack = {
  index: 0 | 1;
  category: MusicCategory;
  previousId: string;
  trackId: string;
  revision: number;
};

const clampVolume = (value: number) => Math.min(1, Math.max(0, value));
const trackBufferKey = (track: MusicTrack) => `${track.id}:${track.revision}`;

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

  const manifestRef = useRef<MusicManifest | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodesRef = useRef<[GainNode | null, GainNode | null]>([null, null]);
  const buffersRef = useRef<[AudioBuffer | null, AudioBuffer | null]>([null, null]);
  const bufferKeysRef = useRef<[string | null, string | null]>([null, null]);
  const sourcesRef = useRef<[AudioBufferSourceNode | null, AudioBufferSourceNode | null]>([null, null]);
  const tracksRef = useRef<[MusicTrack | null, MusicTrack | null]>([null, null]);
  const sourceStartedAtRef = useRef<[number, number]>([0, 0]);
  const sourceOffsetRef = useRef<[number, number]>([0, 0]);
  const loadControllersRef = useRef<[AbortController | null, AbortController | null]>([null, null]);
  const loadVersionsRef = useRef<[number, number]>([0, 0]);
  const nearEndTimersRef = useRef<[number | null, number | null]>([null, null]);

  const activeIndexRef = useRef<0 | 1>(0);
  const activeCategoryRef = useRef<MusicCategory | null>(null);
  const transitionRef = useRef<MusicTransition | null>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const startTimerRef = useRef<number | null>(null);
  const fadeInRef = useRef<MusicFadeIn | null>(null);
  const pendingFadeInRef = useRef<PendingMusicFadeIn | null>(null);
  const fadeInTimerRef = useRef<number | null>(null);
  const prefetchedRef = useRef<PrefetchedTrack | null>(null);
  const nearEndTriggeredRef = useRef(false);
  const selectionGenerationRef = useRef(0);
  const unlockedRef = useRef(false);
  const musicEnabledRef = useRef(true);
  const targetVolumeRef = useRef(55);
  const masterVolumeRef = useRef(100);

  const musicEnabled = settings.musicEnabled !== false;
  const targetVolume = settings.musicVolume ?? 55;
  const masterVolume = settings.masterVolume ?? 100;
  manifestRef.current = manifest;
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

  const ensureAudioGraph = useCallback(() => {
    let context = audioContextRef.current;
    if (!context) {
      const AudioContextApi = window.AudioContext
        ?? (window as AudioContextWindow).webkitAudioContext;
      if (!AudioContextApi) return null;
      context = new AudioContextApi();
      audioContextRef.current = context;
    }
    for (const index of [0, 1] as const) {
      if (gainNodesRef.current[index]) continue;
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(context.destination);
      gainNodesRef.current[index] = gain;
    }
    return context;
  }, []);

  const resumeAudioContext = useCallback(() => {
    configureAmbientAudioSession();
    const context = ensureAudioGraph();
    if (context && context.state !== "running" && context.state !== "closed") {
      void context.resume().catch(() => undefined);
    }
    return context;
  }, [ensureAudioGraph]);

  const clearNearEndTimer = useCallback((index: 0 | 1) => {
    const timer = nearEndTimersRef.current[index];
    if (timer != null) {
      window.clearTimeout(timer);
      nearEndTimersRef.current[index] = null;
    }
  }, []);

  const currentPositionSeconds = useCallback((index: 0 | 1) => {
    const context = audioContextRef.current;
    const buffer = buffersRef.current[index];
    const track = tracksRef.current[index];
    if (!buffer || !track) return 0;

    let position = sourceOffsetRef.current[index];
    if (context && sourcesRef.current[index]) {
      position += Math.max(0, context.currentTime - sourceStartedAtRef.current[index]);
    }
    if (track.loop && buffer.duration > 0) return position % buffer.duration;
    return Math.min(buffer.duration, Math.max(0, position));
  }, []);

  const stopSource = useCallback((index: 0 | 1, preservePosition = false) => {
    clearNearEndTimer(index);
    const source = sourcesRef.current[index];
    if (source && preservePosition) sourceOffsetRef.current[index] = currentPositionSeconds(index);
    sourcesRef.current[index] = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
      source.disconnect();
    }
    if (!preservePosition) sourceOffsetRef.current[index] = 0;
  }, [clearNearEndTimer, currentPositionSeconds]);

  const silenceChannel = useCallback((index: 0 | 1) => {
    const context = audioContextRef.current;
    const gain = gainNodesRef.current[index];
    if (!context || !gain) return;
    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setValueAtTime(0, context.currentTime);
  }, []);

  const releaseSlot = useCallback((index: 0 | 1) => {
    loadVersionsRef.current[index] += 1;
    loadControllersRef.current[index]?.abort();
    loadControllersRef.current[index] = null;
    stopSource(index);
    silenceChannel(index);
    buffersRef.current[index] = null;
    bufferKeysRef.current[index] = null;
    tracksRef.current[index] = null;
    if (prefetchedRef.current?.index === index) prefetchedRef.current = null;
  }, [silenceChannel, stopSource]);

  const loadTrackBuffer = useCallback(async (index: 0 | 1, track: MusicTrack) => {
    const key = trackBufferKey(track);
    if (buffersRef.current[index] && bufferKeysRef.current[index] === key) {
      tracksRef.current[index] = track;
      return true;
    }

    for (const otherIndex of [0, 1] as const) {
      if (
        otherIndex !== index
        && buffersRef.current[otherIndex]
        && bufferKeysRef.current[otherIndex] === key
      ) {
        releaseSlot(index);
        buffersRef.current[index] = buffersRef.current[otherIndex];
        bufferKeysRef.current[index] = key;
        tracksRef.current[index] = track;
        return true;
      }
    }

    releaseSlot(index);
    const context = ensureAudioGraph();
    if (!context) return false;

    const controller = new AbortController();
    const version = loadVersionsRef.current[index] + 1;
    loadVersionsRef.current[index] = version;
    loadControllersRef.current[index] = controller;

    try {
      const response = await fetch(track.url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Music track request failed with ${response.status}.`);
      const encoded = await response.arrayBuffer();
      const buffer = await context.decodeAudioData(encoded);
      if (
        controller.signal.aborted
        || loadVersionsRef.current[index] !== version
      ) return false;
      loadControllersRef.current[index] = null;
      buffersRef.current[index] = buffer;
      bufferKeysRef.current[index] = key;
      tracksRef.current[index] = track;
      sourceOffsetRef.current[index] = 0;
      return true;
    } catch {
      if (loadVersionsRef.current[index] === version) {
        loadControllersRef.current[index] = null;
        buffersRef.current[index] = null;
        bufferKeysRef.current[index] = null;
        tracksRef.current[index] = null;
      }
      return false;
    }
  }, [ensureAudioGraph, releaseSlot]);

  const gainForTrack = useCallback((track: MusicTrack | null) => (
    track ? musicGain(targetVolumeRef.current, masterVolumeRef.current, track.gainDb) : 0
  ), []);

  const scheduleChannelGain = useCallback((
    index: 0 | 1,
    fromValue: number,
    toValue: number,
    delaySeconds = 0,
    durationSeconds = 0,
  ) => {
    const context = audioContextRef.current;
    const gain = gainNodesRef.current[index];
    if (!context || !gain) return;

    const from = clampVolume(fromValue);
    const to = clampVolume(toValue);
    const now = context.currentTime;
    const rampStart = now + Math.max(0, delaySeconds);
    const rampEnd = rampStart + Math.max(0, durationSeconds);
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(from, now);
    if (rampStart > now) gain.gain.setValueAtTime(from, rampStart);
    if (rampEnd > rampStart) gain.gain.linearRampToValueAtTime(to, rampEnd);
    else gain.gain.setValueAtTime(to, rampStart);
  }, []);

  const applyVolumes = useCallback(() => {
    const context = audioContextRef.current;
    if (!context) return;
    const tracks = tracksRef.current;
    const transition = transitionRef.current;

    if (!transition) {
      const active = activeIndexRef.current;
      const fadeIn = fadeInRef.current;
      const pendingFadeIn = pendingFadeInRef.current;
      for (const index of [0, 1] as const) {
        if (index !== active || pendingFadeIn?.index === index) {
          scheduleChannelGain(index, 0, 0);
          continue;
        }
        const target = gainForTrack(tracks[index]);
        if (fadeIn?.index === index) {
          const elapsed = Math.max(0, context.currentTime - fadeIn.startedAt);
          const progress = fadeIn.durationSeconds <= 0
            ? 1
            : Math.min(1, elapsed / fadeIn.durationSeconds);
          scheduleChannelGain(
            index,
            target * progress,
            target,
            0,
            Math.max(0, fadeIn.durationSeconds - elapsed),
          );
        } else {
          scheduleChannelGain(index, target, target);
        }
      }
      return;
    }

    const delay = Math.max(0, transition.fadeStartedAt - context.currentTime);
    const elapsed = Math.max(0, context.currentTime - transition.fadeStartedAt);
    const progress = transition.fadeDurationSeconds <= 0
      ? 1
      : Math.min(1, elapsed / transition.fadeDurationSeconds);
    const remaining = Math.max(0, transition.fadeDurationSeconds - elapsed);
    const fromTarget = gainForTrack(tracks[transition.fromIndex]);
    const toTarget = gainForTrack(tracks[transition.toIndex]);
    scheduleChannelGain(
      transition.fromIndex,
      fromTarget * (1 - progress),
      0,
      delay,
      remaining,
    );
    scheduleChannelGain(
      transition.toIndex,
      toTarget * progress,
      toTarget,
      delay,
      remaining,
    );
  }, [gainForTrack, scheduleChannelGain]);

  const clearTransitionTimer = useCallback(() => {
    if (transitionTimerRef.current != null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
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

  const scheduleNearEnd = useCallback((index: 0 | 1) => {
    clearNearEndTimer(index);
    const track = tracksRef.current[index];
    const buffer = buffersRef.current[index];
    if (!track || !buffer || track.loop) return;

    const remainingMs = Math.max(0, (buffer.duration - currentPositionSeconds(index)) * 1_000);
    const triggerAfterMs = Math.max(0, remainingMs - STANDARD_MUSIC_CROSSFADE_MS);
    nearEndTimersRef.current[index] = window.setTimeout(() => {
      nearEndTimersRef.current[index] = null;
      if (
        activeIndexRef.current !== index
        || transitionRef.current
        || nearEndTriggeredRef.current
        || !musicEnabledRef.current
      ) return;
      nearEndTriggeredRef.current = true;
      setCycle((value) => value + 1);
    }, triggerAfterMs);
  }, [clearNearEndTimer, currentPositionSeconds]);

  const startSource = useCallback((index: 0 | 1) => {
    if (sourcesRef.current[index]) return true;
    const context = ensureAudioGraph();
    const gain = gainNodesRef.current[index];
    const buffer = buffersRef.current[index];
    const track = tracksRef.current[index];
    if (!context || !gain || !buffer || !track || !musicEnabledRef.current || !unlockedRef.current) {
      return false;
    }

    let offset = Math.max(0, sourceOffsetRef.current[index]);
    if (track.loop && buffer.duration > 0) offset %= buffer.duration;
    else if (offset >= buffer.duration) offset = 0;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = track.loop;
    source.connect(gain);
    sourcesRef.current[index] = source;
    sourceOffsetRef.current[index] = offset;
    sourceStartedAtRef.current[index] = context.currentTime;
    source.onended = () => {
      if (sourcesRef.current[index] !== source) return;
      sourcesRef.current[index] = null;
      clearNearEndTimer(index);
      source.disconnect();
      if (track.loop) return;
      sourceOffsetRef.current[index] = buffer.duration;
      if (
        transitionRef.current
        || activeIndexRef.current !== index
        || nearEndTriggeredRef.current
        || !musicEnabledRef.current
      ) return;
      nearEndTriggeredRef.current = true;
      setCycle((value) => value + 1);
    };
    try {
      source.start(0, offset);
    } catch {
      sourcesRef.current[index] = null;
      source.onended = null;
      source.disconnect();
      return false;
    }
    scheduleNearEnd(index);
    return true;
  }, [clearNearEndTimer, ensureAudioGraph, scheduleNearEnd]);

  const beginLeadInFade = useCallback((index: 0 | 1) => {
    const pending = pendingFadeInRef.current;
    const context = audioContextRef.current;
    if (
      !pending
      || pending.index !== index
      || !context
      || !buffersRef.current[index]
      || !tracksRef.current[index]
      || transitionRef.current
      || !unlockedRef.current
      || !musicEnabledRef.current
    ) return;

    if (!startSource(index)) return;
    pendingFadeInRef.current = null;
    if (pending.durationMs <= 0) {
      applyVolumes();
      return;
    }

    const fadeIn: MusicFadeIn = {
      index,
      startedAt: context.currentTime,
      durationSeconds: pending.durationMs / 1_000,
    };
    fadeInRef.current = fadeIn;
    applyVolumes();
    fadeInTimerRef.current = window.setTimeout(() => {
      if (fadeInRef.current !== fadeIn) return;
      fadeInRef.current = null;
      fadeInTimerRef.current = null;
      applyVolumes();
    }, pending.durationMs);
  }, [applyVolumes, startSource]);

  const invalidatePrefetch = useCallback(() => {
    const prefetched = prefetchedRef.current;
    prefetchedRef.current = null;
    if (
      prefetched
      && prefetched.index !== activeIndexRef.current
      && !transitionRef.current
    ) {
      releaseSlot(prefetched.index);
    }
  }, [releaseSlot]);

  const prefetchNextForActive = useCallback(() => {
    const currentManifest = manifestRef.current;
    const category = activeCategoryRef.current;
    const activeIndex = activeIndexRef.current;
    const current = tracksRef.current[activeIndex];
    if (
      !currentManifest
      || !category
      || !current
      || current.loop
      || transitionRef.current
      || !musicEnabledRef.current
    ) return;

    const next = weightedMusicTrack(currentManifest.tracks, category, current.id);
    if (!next) return;
    const index = (activeIndex === 0 ? 1 : 0) as 0 | 1;
    const expected: PrefetchedTrack = {
      index,
      category,
      previousId: current.id,
      trackId: next.id,
      revision: next.revision,
    };
    const existing = prefetchedRef.current;
    if (
      existing
      && existing.index === index
      && existing.category === category
      && existing.previousId === current.id
      && existing.trackId === next.id
      && existing.revision === next.revision
      && buffersRef.current[index]
    ) return;

    prefetchedRef.current = null;
    void loadTrackBuffer(index, next).then((loaded) => {
      if (!loaded) return;
      if (
        activeIndexRef.current !== activeIndex
        || activeCategoryRef.current !== category
        || tracksRef.current[activeIndex]?.id !== current.id
        || transitionRef.current
        || !musicEnabledRef.current
      ) {
        if (activeIndexRef.current !== index) releaseSlot(index);
        return;
      }
      prefetchedRef.current = expected;
      applyVolumes();
    });
  }, [applyVolumes, loadTrackBuffer, releaseSlot]);

  const finishTransition = useCallback((transition: MusicTransition) => {
    if (transitionRef.current !== transition) return;
    clearTransitionTimer();
    releaseSlot(transition.fromIndex);
    activeIndexRef.current = transition.toIndex;
    activeCategoryRef.current = transition.toCategory;
    transitionRef.current = null;
    nearEndTriggeredRef.current = false;
    applyVolumes();
    prefetchNextForActive();
  }, [applyVolumes, clearTransitionTimer, prefetchNextForActive, releaseSlot]);

  const cancelTransition = useCallback(() => {
    const transition = transitionRef.current;
    if (!transition) return;
    const context = audioContextRef.current;
    clearTransitionTimer();

    let keepIndex = transition.fromIndex;
    let keepCategory = transition.fromCategory;
    if (context) {
      const progress = transition.fadeDurationSeconds <= 0
        ? 1
        : Math.min(
          1,
          Math.max(0, (context.currentTime - transition.fadeStartedAt) / transition.fadeDurationSeconds),
        );
      if (progress >= .5) {
        keepIndex = transition.toIndex;
        keepCategory = transition.toCategory;
      }
    }

    const dropIndex = (keepIndex === 0 ? 1 : 0) as 0 | 1;
    releaseSlot(dropIndex);
    activeIndexRef.current = keepIndex;
    activeCategoryRef.current = keepCategory;
    transitionRef.current = null;
    prefetchedRef.current = null;
    nearEndTriggeredRef.current = false;
    applyVolumes();
  }, [applyVolumes, clearTransitionTimer, releaseSlot]);

  const startTransition = useCallback(async (
    next: MusicTrack,
    toCategory: MusicCategory,
    leadInMs: number,
    fadeDurationMs: number,
    generation: number,
  ) => {
    cancelTransition();
    clearLeadInFade();

    const fromIndex = activeIndexRef.current;
    const toIndex = (fromIndex === 0 ? 1 : 0) as 0 | 1;
    const prefetched = prefetchedRef.current;
    const prefetchedMatches = Boolean(
      prefetched
      && prefetched.index === toIndex
      && prefetched.trackId === next.id
      && prefetched.revision === next.revision
      && buffersRef.current[toIndex]
      && bufferKeysRef.current[toIndex] === trackBufferKey(next)
    );
    prefetchedRef.current = null;

    if (!prefetchedMatches) {
      const loaded = await loadTrackBuffer(toIndex, next);
      if (!loaded) return;
    } else {
      tracksRef.current[toIndex] = next;
    }
    if (
      selectionGenerationRef.current !== generation
      || !musicEnabledRef.current
      || activeIndexRef.current !== fromIndex
    ) {
      if (activeIndexRef.current !== toIndex) releaseSlot(toIndex);
      return;
    }

    const context = resumeAudioContext();
    const fromTrack = tracksRef.current[fromIndex];
    const fromBuffer = buffersRef.current[fromIndex];
    const toBuffer = buffersRef.current[toIndex];
    if (!context || !fromTrack || !fromBuffer || !toBuffer) {
      releaseSlot(toIndex);
      return;
    }

    const outgoingRemainingMs = fromTrack.loop
      ? Number.POSITIVE_INFINITY
      : Math.max(0, (fromBuffer.duration - currentPositionSeconds(fromIndex)) * 1_000);
    const safeLeadIn = Math.min(
      Math.max(0, leadInMs),
      Math.max(0, toBuffer.duration * 1_000 - 1_000),
      Math.max(0, outgoingRemainingMs - fadeDurationMs),
    );

    sourceOffsetRef.current[toIndex] = 0;
    startSource(fromIndex);
    startSource(toIndex);
    const transition: MusicTransition = {
      fromIndex,
      toIndex,
      fromCategory: activeCategoryRef.current,
      toCategory,
      fadeStartedAt: context.currentTime + safeLeadIn / 1_000,
      fadeDurationSeconds: fadeDurationMs / 1_000,
    };
    transitionRef.current = transition;
    nearEndTriggeredRef.current = false;
    setCycle(0);
    applyVolumes();

    transitionTimerRef.current = window.setTimeout(
      () => finishTransition(transition),
      safeLeadIn + fadeDurationMs,
    );
  }, [
    applyVolumes,
    cancelTransition,
    clearLeadInFade,
    currentPositionSeconds,
    finishTransition,
    loadTrackBuffer,
    releaseSlot,
    resumeAudioContext,
    startSource,
  ]);

  useEffect(() => {
    configureAmbientAudioSession();
    ensureAudioGraph();
    return () => {
      selectionGenerationRef.current += 1;
      if (startTimerRef.current != null) window.clearTimeout(startTimerRef.current);
      clearTransitionTimer();
      clearLeadInFade();
      for (const index of [0, 1] as const) releaseSlot(index);
      for (const gain of gainNodesRef.current) gain?.disconnect();
      gainNodesRef.current = [null, null];
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") void context.close().catch(() => undefined);
    };
  }, [clearLeadInFade, clearTransitionTimer, ensureAudioGraph, releaseSlot]);

  useEffect(() => {
    const unlock = () => {
      unlockedRef.current = true;
      resumeAudioContext();
      if (!musicEnabledRef.current) return;

      const transition = transitionRef.current;
      if (transition) {
        startSource(transition.fromIndex);
        startSource(transition.toIndex);
        applyVolumes();
        return;
      }

      const activeIndex = activeIndexRef.current;
      if (pendingFadeInRef.current?.index === activeIndex) beginLeadInFade(activeIndex);
      else {
        startSource(activeIndex);
        applyVolumes();
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [applyVolumes, beginLeadInFade, resumeAudioContext, startSource]);

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
            if (!replacement) {
              if (index === activeIndexRef.current) activeTrackRemoved = true;
              releaseSlot(index);
              continue;
            }
            tracksRef.current[index] = replacement;
            if (
              index !== activeIndexRef.current
              && bufferKeysRef.current[index] !== trackBufferKey(replacement)
              && !transitionRef.current
            ) {
              releaseSlot(index);
            }
          }
          prefetchedRef.current = null;
          if (
            transitionRef.current
            && (
              !tracksRef.current[transitionRef.current.fromIndex]
              || !tracksRef.current[transitionRef.current.toIndex]
            )
          ) {
            cancelTransition();
          }
          if (activeTrackRemoved) {
            clearLeadInFade();
            activeCategoryRef.current = null;
            nearEndTriggeredRef.current = false;
            setCycle((value) => value + 1);
          }
          setManifest(value);
          applyVolumes();
          prefetchNextForActive();
        })
        .catch(() => undefined);
    };
    window.addEventListener(MUSIC_LIBRARY_UPDATED_EVENT, refreshManifest);
    return () => {
      active = false;
      window.removeEventListener(MUSIC_LIBRARY_UPDATED_EVENT, refreshManifest);
    };
  }, [applyVolumes, cancelTransition, clearLeadInFade, prefetchNextForActive, releaseSlot]);

  useEffect(() => {
    applyVolumes();
    if (!musicEnabled) {
      clearLeadInFade();
      for (const index of [0, 1] as const) stopSource(index);
      return;
    }
    if (!unlockedRef.current) return;

    resumeAudioContext();
    const transition = transitionRef.current;
    if (transition) {
      startSource(transition.fromIndex);
      startSource(transition.toIndex);
      applyVolumes();
      return;
    }

    const activeIndex = activeIndexRef.current;
    if (pendingFadeInRef.current?.index === activeIndex) beginLeadInFade(activeIndex);
    else {
      startSource(activeIndex);
      applyVolumes();
    }
  }, [
    applyVolumes,
    beginLeadInFade,
    clearLeadInFade,
    masterVolume,
    musicEnabled,
    resumeAudioContext,
    startSource,
    stopSource,
    targetVolume,
  ]);

  useEffect(() => {
    const generation = selectionGenerationRef.current + 1;
    selectionGenerationRef.current = generation;

    if (!manifest || !musicEnabled || !category) {
      if (startTimerRef.current != null) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
      cancelTransition();
      clearLeadInFade();
      prefetchedRef.current = null;
      for (const index of [0, 1] as const) releaseSlot(index);
      activeCategoryRef.current = null;
      nearEndTriggeredRef.current = false;
      return;
    }

    if (transitionRef.current?.toCategory === category && cycle === 0) return;
    if (transitionRef.current) cancelTransition();

    const activeIndex = activeIndexRef.current;
    const current = tracksRef.current[activeIndex];
    const currentCategory = activeCategoryRef.current;

    if (
      cycle === 0
      && current
      && buffersRef.current[activeIndex]
      && current.enabled
      && currentCategory === category
      && current.categories.includes(category)
    ) {
      applyVolumes();
      if (unlockedRef.current) {
        resumeAudioContext();
        if (pendingFadeInRef.current?.index === activeIndex) beginLeadInFade(activeIndex);
        else startSource(activeIndex);
      }
      prefetchNextForActive();
      return;
    }

    const prefetched = prefetchedRef.current;
    const next = (
      prefetched
      && prefetched.category === category
      && prefetched.previousId === (current?.id ?? "")
    )
      ? manifest.tracks.find((track) => (
        track.id === prefetched.trackId
        && track.revision === prefetched.revision
        && track.enabled
        && track.categories.includes(category)
      )) ?? weightedMusicTrack(manifest.tracks, category, current?.id ?? "")
      : weightedMusicTrack(manifest.tracks, category, current?.id ?? "");

    if (!next) {
      clearLeadInFade();
      invalidatePrefetch();
      releaseSlot(activeIndex);
      activeCategoryRef.current = null;
      return;
    }

    if (cycle === 0 && current?.id === next.id && currentCategory !== category) {
      activeCategoryRef.current = category;
      applyVolumes();
      invalidatePrefetch();
      prefetchNextForActive();
      return;
    }

    if (startTimerRef.current != null) {
      window.clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }

    if (current && buffersRef.current[activeIndex] && pendingFadeInRef.current?.index !== activeIndex) {
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
      void startTransition(next, category, leadInMs, fadeDurationMs, generation);
      return;
    }

    releaseSlot(activeIndex);
    startTimerRef.current = window.setTimeout(() => {
      startTimerRef.current = null;
      if (selectionGenerationRef.current !== generation || !musicEnabledRef.current) return;

      void loadTrackBuffer(activeIndex, next).then((loaded) => {
        if (!loaded) return;
        if (
          selectionGenerationRef.current !== generation
          || !musicEnabledRef.current
          || activeIndexRef.current !== activeIndex
        ) {
          if (activeIndexRef.current !== activeIndex) releaseSlot(activeIndex);
          return;
        }

        activeCategoryRef.current = category;
        nearEndTriggeredRef.current = false;
        pendingFadeInRef.current = {
          index: activeIndex,
          durationMs: manifest.settings?.leadInFadeMs ?? DEFAULT_MUSIC_LEAD_IN_FADE_MS,
        };
        setCycle(0);
        applyVolumes();
        if (unlockedRef.current) {
          resumeAudioContext();
          beginLeadInFade(activeIndex);
        }
        prefetchNextForActive();
      });
    }, pathname === "/play/match" ? 900 : 1_400);

    return () => {
      if (startTimerRef.current != null) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
    };
  }, [
    applyVolumes,
    beginLeadInFade,
    cancelTransition,
    category,
    clearLeadInFade,
    cycle,
    invalidatePrefetch,
    loadTrackBuffer,
    manifest,
    musicEnabled,
    pathname,
    prefetchNextForActive,
    releaseSlot,
    resumeAudioContext,
    startSource,
    startTransition,
  ]);

  useEffect(() => {
    const recover = () => {
      if (document.visibilityState !== "visible" || !musicEnabledRef.current || !unlockedRef.current) return;
      const context = resumeAudioContext();
      if (!context) return;

      const transition = transitionRef.current;
      if (
        transition
        && context.currentTime >= transition.fadeStartedAt + transition.fadeDurationSeconds
      ) {
        finishTransition(transition);
      }

      const fadeIn = fadeInRef.current;
      if (
        fadeIn
        && context.currentTime >= fadeIn.startedAt + fadeIn.durationSeconds
      ) {
        clearLeadInFade(true);
      }

      const currentTransition = transitionRef.current;
      if (currentTransition) {
        startSource(currentTransition.fromIndex);
        startSource(currentTransition.toIndex);
      } else {
        const activeIndex = activeIndexRef.current;
        if (pendingFadeInRef.current?.index === activeIndex) beginLeadInFade(activeIndex);
        else startSource(activeIndex);
      }
      applyVolumes();
    };
    document.addEventListener("visibilitychange", recover);
    return () => document.removeEventListener("visibilitychange", recover);
  }, [
    applyVolumes,
    beginLeadInFade,
    clearLeadInFade,
    finishTransition,
    resumeAudioContext,
    startSource,
  ]);

  return null;
}
