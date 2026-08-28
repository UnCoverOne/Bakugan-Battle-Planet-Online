"use client";

import { useEffect, useRef } from "react";
import type { MatchState } from "../../lib/game";
import { DRAGONOID_MAXIMUS_SKIP_EVENT } from "./alternateWinPresentation";
import { useMatchSelector } from "./matchStore";
import { isLiveMatchTransition } from "./presentationContinuity";

type SoundName = "draw" | "card" | "core" | "roll" | "damage" | "priority" | "victory" | "chat";
type ToneProfile = { frequency: number; end: number; duration: number; wave: OscillatorType };

const SOUND: Record<SoundName, ToneProfile> = {
  draw: { frequency: 420, end: 620, duration: .09, wave: "triangle" },
  card: { frequency: 260, end: 390, duration: .12, wave: "square" },
  core: { frequency: 180, end: 120, duration: .13, wave: "triangle" },
  roll: { frequency: 120, end: 520, duration: .26, wave: "sawtooth" },
  damage: { frequency: 110, end: 65, duration: .18, wave: "square" },
  priority: { frequency: 660, end: 540, duration: .08, wave: "sine" },
  victory: { frequency: 392, end: 784, duration: .42, wave: "triangle" },
  chat: { frequency: 760, end: 880, duration: .06, wave: "sine" },
};

const MAXIMUS_SEQUENCE: ReadonlyArray<{
  at: number;
  profile: ToneProfile;
  gain: number;
}> = [
  { at: 80, profile: { frequency: 294, end: 370, duration: .11, wave: "triangle" }, gain: .72 },
  { at: 210, profile: { frequency: 370, end: 466, duration: .11, wave: "triangle" }, gain: .78 },
  { at: 340, profile: { frequency: 466, end: 587, duration: .12, wave: "triangle" }, gain: .84 },
  { at: 520, profile: { frequency: 118, end: 54, duration: .28, wave: "sawtooth" }, gain: 1.15 },
  { at: 540, profile: { frequency: 392, end: 784, duration: .48, wave: "triangle" }, gain: 1.0 },
];

let audioContext: AudioContext | null = null;

function context() {
  const AudioContextApi = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextApi) return null;
  audioContext ??= new AudioContextApi();
  return audioContext;
}

function playTone(profile: ToneProfile, volume: number, gainScale = 1) {
  const ctx = context();
  if (!ctx) return;
  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = profile.wave;
  oscillator.frequency.setValueAtTime(profile.frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, profile.end), now + profile.duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0001, volume * .12 * gainScale), now + .008);
  gain.gain.exponentialRampToValueAtTime(.0001, now + profile.duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + profile.duration + .02);
}

function play(name: SoundName, volume: number) {
  playTone(SOUND[name], volume);
}

function classify(message: string): SoundName | null {
  if (/wins game|game complete/i.test(message)) return "victory";
  if (/accuracy .*double|ready to roll/i.test(message)) return "roll";
  if (/flipped .*damage|attacks for/i.test(message)) return "damage";
  if (/placed a face-down|picked up|bakucore/i.test(message)) return "core";
  if (/drew one card|pressed draw/i.test(message)) return "draw";
  if (/added .* to the batch|played .* energy/i.test(message)) return "card";
  if (/passed priority|priority/i.test(message)) return "priority";
  return null;
}

function isDragonoidMaximusVictoryLog(kind: string, message: string) {
  return kind === "system"
    && /wins game.*Dragonoid Maximus/i.test(message);
}

function queueDragonoidMaximusSequence(
  volume: number,
  elapsedMs: number,
  baseDelayMs: number,
  timers: number[],
) {
  let scheduled = false;
  for (const cue of MAXIMUS_SEQUENCE) {
    const remaining = cue.at - elapsedMs + baseDelayMs;
    if (remaining < -(cue.profile.duration * 1_000)) continue;
    scheduled = true;
    timers.push(window.setTimeout(
      () => playTone(cue.profile, volume, cue.gain),
      Math.max(0, remaining),
    ));
  }
  if (!scheduled) timers.push(window.setTimeout(() => play("victory", volume), baseDelayMs));
}

export function GameplaySoundLayer() {
  const match = useMatchSelector((state) => state.match);
  const enabled = useMatchSelector((state) => state.settings.soundEnabled == null
    ? state.settings.sound !== false
    : state.settings.soundEnabled !== false);
  const volume = useMatchSelector((state) => Number(state.settings.soundVolume ?? .55));
  const previous = useRef<{ match: MatchState | null; count: number }>({ match: null, count: 0 });
  useEffect(() => {
    if (!match) return;
    const prior = previous.current;
    const additions = match.log.slice(previous.current.count);
    previous.current = { match, count: match.log.length };
    if (!enabled || !isLiveMatchTransition(prior.match, match, document.visibilityState)) return;

    const timers: number[] = [];
    const clearPending = () => {
      timers.splice(0).forEach((timer) => window.clearTimeout(timer));
    };
    window.addEventListener(DRAGONOID_MAXIMUS_SKIP_EVENT, clearPending);

    additions.slice(-3).forEach((entry, index) => {
      const baseDelay = index * 70;
      const clampedVolume = Math.max(0, Math.min(1, volume));
      if (isDragonoidMaximusVictoryLog(String(entry.kind), entry.message)) {
        queueDragonoidMaximusSequence(
          clampedVolume,
          Math.max(0, Date.now() - entry.at),
          baseDelay,
          timers,
        );
        return;
      }
      const name = String(entry.kind) === "chat" ? "chat" : classify(entry.message);
      if (name) timers.push(window.setTimeout(() => play(name, clampedVolume), baseDelay));
    });

    return () => {
      window.removeEventListener(DRAGONOID_MAXIMUS_SKIP_EVENT, clearPending);
      clearPending();
    };
  }, [enabled, match, volume]);
  return null;
}
