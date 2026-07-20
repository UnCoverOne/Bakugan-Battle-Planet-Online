"use client";

import { useEffect, useRef } from "react";
import { useMatchSelector } from "./matchStore";

type SoundName = "draw" | "card" | "core" | "roll" | "damage" | "priority" | "victory" | "chat";

const SOUND: Record<SoundName, { frequency: number; end: number; duration: number; wave: OscillatorType }> = {
  draw: { frequency: 420, end: 620, duration: .09, wave: "triangle" },
  card: { frequency: 260, end: 390, duration: .12, wave: "square" },
  core: { frequency: 180, end: 120, duration: .13, wave: "triangle" },
  roll: { frequency: 120, end: 520, duration: .26, wave: "sawtooth" },
  damage: { frequency: 110, end: 65, duration: .18, wave: "square" },
  priority: { frequency: 660, end: 540, duration: .08, wave: "sine" },
  victory: { frequency: 392, end: 784, duration: .42, wave: "triangle" },
  chat: { frequency: 760, end: 880, duration: .06, wave: "sine" },
};

let audioContext: AudioContext | null = null;

function play(name: SoundName, volume: number) {
  const AudioContextApi = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextApi) return;
  audioContext ??= new AudioContextApi();
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const profile = SOUND[name];
  oscillator.type = profile.wave;
  oscillator.frequency.setValueAtTime(profile.frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, profile.end), now + profile.duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0001, volume * .12), now + .008);
  gain.gain.exponentialRampToValueAtTime(.0001, now + profile.duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + profile.duration + .02);
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

export function GameplaySoundLayer() {
  const match = useMatchSelector((state) => state.match);
  const enabled = useMatchSelector((state) => state.settings.soundEnabled == null
    ? state.settings.sound !== false
    : state.settings.soundEnabled !== false);
  const volume = useMatchSelector((state) => Number(state.settings.soundVolume ?? .55));
  const previous = useRef<{ matchId?: string; count: number }>({ count: 0 });
  useEffect(() => {
    if (!match) return;
    if (previous.current.matchId !== match.id) {
      previous.current = { matchId: match.id, count: match.log.length };
      return;
    }
    const additions = match.log.slice(previous.current.count);
    previous.current.count = match.log.length;
    if (!enabled || document.visibilityState !== "visible") return;
    additions.slice(-3).forEach((entry, index) => {
      const name = String(entry.kind) === "chat" ? "chat" : classify(entry.message);
      if (name) window.setTimeout(() => play(name, Math.max(0, Math.min(1, volume))), index * 70);
    });
  }, [match?.id, match?.version, enabled, volume]);
  return null;
}
