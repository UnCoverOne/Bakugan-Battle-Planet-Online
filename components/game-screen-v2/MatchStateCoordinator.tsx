"use client";

import { captureCoreReturns } from "../../lib/coreReturns";
import type { MatchState } from "../../lib/game";
import { CoreReturnPlacementLayer } from "./CoreReturnPlacementLayer";
import {
  MATCH_UPDATE_EVENT,
  publishMatch,
  publishRoute,
  publishSettings,
  readMatchStore,
  useMatchSelector,
  useMatchTransport,
  type MatchClientSettings,
} from "./matchStore";

export { MATCH_UPDATE_EVENT };

export function writeCoordinatedMatch(next: MatchState) {
  return publishMatch(captureCoreReturns(readMatchStore().match, next));
}

export function writeGameRoute(route: string) {
  publishRoute(route);
}

export function writeGameSettings(settings: Record<string, unknown>) {
  publishSettings(settings as MatchClientSettings);
}

export function MatchStateCoordinator() {
  useMatchTransport();
  const returnState = useMatchSelector((state) => ({
    match: state.match,
    playerId: state.playerId,
    route: state.route,
  }));
  return returnState.route === "match" && returnState.match?.phase === "retract"
    ? <CoreReturnPlacementLayer match={returnState.match} playerId={returnState.playerId} />
    : null;
}
