"use client";

import "../../app/gameplay-ui-fixes.css";
import "../../app/energy-payment.css";
import "../../app/discard-flip-orientation.css";
import "../../app/card-preview-interactions.css";
import "../../app/gameplay-card-presentation.css";
import type { MatchState } from "../../lib/game";
import { AlternateWinPresentationLayer } from "../game-screen-v2/AlternateWinPresentationLayer";
import { BakuCoreLayer } from "../game-screen-v2/BakuCoreLayer";
import { BakuCorePresentationProvider } from "../game-screen-v2/BakuCorePresentation";
import { BrawlExperienceLayer } from "../game-screen-v2/BrawlExperienceLayer";
import { CardHandLayer } from "../game-screen-v2/CardHandLayer";
import { DiscardFlipAnimationLayer } from "../game-screen-v2/DiscardFlipAnimationLayer";
import { DrawAnimationLayer } from "../game-screen-v2/DrawAnimationLayer";
import { EnergyArrivalLayer } from "../game-screen-v2/EnergyArrivalLayer";
import { GameScreen } from "../game-screen-v2/GameScreen";
import { GameplayCardPresentationLayer } from "../game-screen-v2/GameplayCardPresentationLayer";

type ReplayBattlefieldProps = {
  match: MatchState;
  playerId?: string;
  playbackRate: number;
  presentationEpoch: number;
  portalRoot: HTMLElement | null;
};

/**
 * Read-only replay presentation that reuses the live match animation layers.
 * The epoch changes only for non-linear seeking, which deliberately remounts
 * transient presenters so a scrub does not animate every skipped state.
 */
export function ReplayBattlefield({
  match,
  playerId,
  playbackRate,
  presentationEpoch,
  portalRoot,
}: ReplayBattlefieldProps) {
  return (
    <BakuCorePresentationProvider
      key={`${match.id}:replay:${presentationEpoch}`}
      match={match}
      playerId={playerId}
      presentationMode="replay"
      playbackRate={playbackRate}
    >
      <GameScreen
        match={match}
        playerId={playerId}
        presentationMode="replay"
      />
      <BakuCoreLayer
        match={match}
        playerId={playerId}
        readOnly
        allowReadOnlyRollPresentation
        presentationRate={playbackRate}
      />
      <CardHandLayer match={match} playerId={playerId} />
      <EnergyArrivalLayer
        match={match}
        playerId={playerId}
        presentationRate={playbackRate}
      />
      <GameplayCardPresentationLayer
        match={match}
        playerId={playerId}
        presentationMode="replay"
      />
      <DrawAnimationLayer
        match={match}
        playerId={playerId}
        presentationMode="replay"
        playbackRate={playbackRate}
        portalRoot={portalRoot}
      />
      <DiscardFlipAnimationLayer
        match={match}
        playerId={playerId}
        presentationMode="replay"
        playbackRate={playbackRate}
        portalRoot={portalRoot}
      />
      <BrawlExperienceLayer
        match={match}
        playerId={playerId}
        presentationMode="replay"
        playbackRate={playbackRate}
      />
      <AlternateWinPresentationLayer
        match={match}
        presentationMode="replay"
        playbackRate={playbackRate}
      />
    </BakuCorePresentationProvider>
  );
}
