"use client";

import "../../app/gameplay-ui-fixes.css";
import "../../app/energy-payment.css";
import "../../app/discard-flip-orientation.css";
import "../../app/card-preview-interactions.css";
import "../../app/gameplay-card-presentation.css";
import { BakuCorePresentationProvider } from "./BakuCorePresentation";
import { AlternateWinPresentationLayer } from "./AlternateWinPresentationLayer";
import { BrawlExperienceLayer } from "./BrawlExperienceLayer";
import { ChoiceQueueLayer } from "./ChoiceQueueLayer";
import { DeckInspectionLayer } from "./DeckInspectionLayer";
import { DrawAnimationLayer } from "./DrawAnimationLayer";
import { GameplayCardPresentationLayer } from "./GameplayCardPresentationLayer";
import { GameplaySoundLayer } from "./GameplaySoundLayer";
import { MatchCommunicationLayer } from "./MatchCommunicationLayer";
import { MatchStateCoordinator } from "./MatchStateCoordinator";
import { GameplayClient } from "./GameplayClient";
import { ViewportStabilityGuard } from "./ViewportStabilityGuard";

/**
 * The heavyweight match presentation and coordinator tree is mounted only on
 * play routes. Public, account, deck, and reference screens do not download or
 * initialize the complete gameplay layer.
 */
export function GameplayRuntime() {
  return (
    <BakuCorePresentationProvider>
      <MatchStateCoordinator />
      <ViewportStabilityGuard />
      <GameplayClient />
      <GameplayCardPresentationLayer />
      <MatchCommunicationLayer />
      <DrawAnimationLayer />
      <BrawlExperienceLayer />
      <AlternateWinPresentationLayer />
      <DeckInspectionLayer />
      <ChoiceQueueLayer />
      <GameplaySoundLayer />
    </BakuCorePresentationProvider>
  );
}
