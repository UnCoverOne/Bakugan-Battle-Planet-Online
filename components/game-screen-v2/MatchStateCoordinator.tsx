"use client";

import type { MatchState } from "../../lib/game";
import {
  MATCH_UPDATE_EVENT,
  publishMatch,
  publishRoute,
  publishSettings,
  useMatchTransport,
  type MatchClientSettings,
} from "./matchStore";

export { MATCH_UPDATE_EVENT };

export function writeCoordinatedMatch(next: MatchState) {
  return publishMatch(next);
}

export function writeGameRoute(route: string) {
  publishRoute(route);
}

export function writeGameSettings(settings: Record<string, unknown>) {
  publishSettings(settings as MatchClientSettings);
}

export function MatchStateCoordinator() {
  useMatchTransport();
  return null;
}

