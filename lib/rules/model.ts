import type { CardChoices, CardType, CoreType, Faction, GameCard, Phase } from "../game";
import type { ChooserOwner, PlayerScope, ZoneOwner } from "./primitives";
import type { BooleanExpression, NumberValue } from "./values";

export type RulesCardId = `${"bb" | "br" | "aa" | "av" | "ff" | "sv" | "ps1" | "cp" | "di" | "ex"}-${number}${string}`;
export type RulesObjectStatus = "pending" | "resolving" | "resolved" | "negated";
export type ChoiceTiming = "announce" | "pay" | "resolve";
export type ChoiceVisibility = "public" | "private" | "secret-until-reveal";
export type RulesDuration = "instant" | "turn" | "while-source-active" | "next-card" | "permanent";
export type BakucoreHolder = "controller-active" | "source-bakugan" | "opponent-active";
export type RuleCitation = { sourceId: string; locator: string; note?: string };
export type RuleProvenance = { authorityOrder: string[]; citations: RuleCitation[]; reviewed: boolean };
export type ModifierLayer = "base" | "set" | "core" | "continuous" | "temporary" | "protection" | "final";

export type EntitySelector =
  | "active-friendly"
  | "active-enemy"
  | "chosen-bakugan"
  | "all-friendly"
  | "all-enemy"
  | "all-bakugan"
  | "controller"
  | "opponent"
  | "batch-object"
  | "discarded-card-this-turn"
  | "player"
  | "chosen-card"
  | "self";

export type RuleCondition =
  | { kind: "always" }
  | { kind: "armor-damage-reduced"; subject: "opponent" }
  | { kind: "fury" }
  | { kind: "turbo" }
  | { kind: "domination" }
  | { kind: "flow" }
  | { kind: "underdog" }
  | { kind: "victor" }
  | { kind: "faction"; faction: Faction; subject: "target" | "team" }
  | { kind: "cards-played"; comparison: "at-least" | "more-than"; amount: NumberValue }
  | { kind: "factions-played"; comparison: "at-least"; amount: NumberValue }
  | { kind: "hero-count"; comparison: "at-least"; amount: NumberValue }
  | { kind: "controls-named-cards"; names: string[] }
  | { kind: "discard-count"; comparison: "at-least"; amount: NumberValue }
  | { kind: "played-card-cost"; comparison: "at-least"; amount: NumberValue }
  | { kind: "card-type-played"; cardType: CardType; owner: "controller" | "opponent" }
  | { kind: "card-count"; catalogId: RulesCardId; comparison: "at-least"; amount: NumberValue }
  | { kind: "core-count"; relationship: "more-than-opponent" | "at-least"; amount?: NumberValue }
  | { kind: "held-core-type"; coreTypes: CoreType[]; subject?: "target" | "controller-team" | "opponent-active" | "attacker" }
  | { kind: "fusion"; subject: "target" | "source" }
  | { kind: "open-bakugan-count"; comparison: "exactly" | "at-least" | "at-most" | "more-than" | "fewer-than"; amount: NumberValue }
  | { kind: "source-only-open-bakugan" }
  | { kind: "selection-made"; choiceId: keyof CardChoices }
  | { kind: "mode-selected"; mode: string }
  | { kind: "empower-selected" }
  | { kind: "reroll-opened" }
  | { kind: "coin-result"; result: "heads" | "tails" }
  | { kind: "expression"; expression: BooleanExpression }
  | { kind: "printed"; text: string };

export type ChoiceSpec = {
  id: keyof CardChoices;
  timing: ChoiceTiming;
  selector: EntitySelector | "number" | "mode" | "hand-card" | "discard-card" | "deck-card" | "energy-card" | "bakucore" | "hero" | "evo" | "card-in-play";
  label: string;
  /** Explicit printed options for semantic mode choices such as Battle Mastery. */
  options?: Array<{ id: string; label: string; description?: string }>;
  minimum?: NumberValue;
  maximum?: NumberValue;
  optional?: boolean;
  chooser: ChooserOwner;
  visibility?: ChoiceVisibility;
  cardType?: CardType;
  cardTypes?: CardType[];
  factions?: Faction[];
  /** Restrict a card choice to cards carrying a printed mechanic. */
  cardMechanic?: string;
  /** Restrict a card choice to cards that do not have these types. */
  excludedCardTypes?: CardType[];
  /** Restrict a deck choice to the card currently revealed from the top. */
  revealedOnly?: boolean;
  /** Exact printed card identity requested by an effect-originated play. */
  cardName?: string;
  /** Preferred ownership primitive for the zone/object pool being selected. */
  owner?: ZoneOwner;
  /** Restrict a hand reveal to the name of the triggering/played card. */
  sameNameAsEvent?: boolean;
  /** @deprecated Compatibility alias. New definitions should use owner. */
  targetOwner?: ZoneOwner;
  maximumCost?: NumberValue;
  minimumCost?: NumberValue;
  objectKinds?: Array<"card" | "trigger" | "copy">;
  openState?: "open" | "closed";
  /** Restrict Bakugan choices to their fused or unfused face. */
  fusionState?: "fused" | "unfused";
  notOpenedThisTurn?: boolean;
  notPlayedThisTurn?: boolean;
  attachmentState?: "attached" | "unattached";
  /** Restrict an attached BakuCore choice to a particular participating Bakugan. */
  attachedToBakugan?: BakucoreHolder;
  /** Restrict BakuCore choices by their printed core type. */
  coreTypes?: CoreType[];
  /** Restrict Energy-card choices by their charged state for Recharge effects. */
  energyState?: "charged" | "uncharged";
  /** Exclude the Bakugan that created the trigger ("another Bakugan"). */
  excludeSourceBakugan?: boolean;
  /** This selector is choosing a card that an effect will play with base Energy cost 0. */
  playForFree?: boolean;
  /** Omit this choice entirely unless its legal pool exceeds the threshold. */
  onlyIfAvailableMoreThan?: number;
  /** Display-only hidden-zone viewer paired with a separately validated selection. */
  viewerOnly?: boolean;
};

export type TriggerEventName =
  | "CARD_PLAYED"
  | "CARD_FLIPPED_FROM_DECK"
  | "BAKUGAN_SELECTED"
  | "BAKUGAN_OPENED"
  | "CARD_DISCARDED"
  | "ENERGY_CARD_ENERGIZED"
  | "BAKU_GEAR_ATTACHED"
  | "VICTOR_DECLARED"
  | "ATTACK_CREATED"
  | "ATTACK_DAMAGE_DEALT"
  | "DAMAGE_TAKEN"
  | "HAND_EMPTIED"
  | "FUSION_COMPLETED"
  | "TURN_ENDED";

export type TriggerDefinition = {
  event: TriggerEventName;
  relationship: "controller" | "opponent" | "any";
  /** Restrict a trigger such as "When you play this" to its own card-play event. */
  source?: "self";
  cardType?: CardType;
  /** Effective faction(s) the played card must have. */
  factions?: Faction[];
  /** Printed Energy cost of the event card, before reductions or alternative costs. */
  minimumPrintedCost?: NumberValue;
  /** Printed mechanic/keyword that the event card must carry. */
  cardMechanic?: string;
  optional?: boolean;
  /** Minimum amount carried by the triggering event. */
  minimumEventAmount?: NumberValue;
  interveningCondition?: RuleCondition;
  limit?: { kind: "once-per-turn" | "first-each-turn"; key: string };
};

export type CostEffect =
  | { kind: "cost-reduce"; amount: NumberValue; duration: RulesDuration; cardType?: CardType; condition?: RuleCondition; appliesTo?: "self" | "controller" }
  | { kind: "cost-increase"; amount: NumberValue; duration: RulesDuration; cardType?: CardType; condition?: RuleCondition }
  | { kind: "cost-free"; duration: RulesDuration; condition?: RuleCondition; cardType?: CardType; cardMechanic?: string; appliesTo?: "self" | "controller" }
  | { kind: "cost-discard"; amount: NumberValue; choiceId: keyof CardChoices }
  | { kind: "cost-alternative"; id: string; label: string; setsBaseFree: boolean; components: CostEffect[]; condition?: RuleCondition };

export type SwapBakucoreEffect = {
  kind: "swap-bakucore";
  leftHolder: BakucoreHolder;
  rightHolder: BakucoreHolder;
  leftCoreChoiceId: keyof CardChoices;
  rightCoreChoiceId: keyof CardChoices;
};

export type RuleAction =
  | { kind: "modify-stat"; stat: "power" | "damage" | "frost"; amount: NumberValue; duration: RulesDuration; scope?: "target" | "all-enemy" | "all-friendly" | "all-bakugan"; targetChoiceId?: keyof CardChoices }
  | { kind: "ignore-armor-rating"; duration: RulesDuration }
  | { kind: "grant-keyword"; keyword: "DoubleStrike" | "ShadowStrike" | "FrostStrike" | "Victor" | "Stop"; value?: NumberValue; duration: RulesDuration }
  | { kind: "draw"; amount: NumberValue; playerScope?: PlayerScope }
  | { kind: "discard"; amount: NumberValue; minimum: NumberValue; maximum: NumberValue; repeated?: boolean; playerScope?: PlayerScope }
  | { kind: "energize"; amount: NumberValue; source: "hand" | "deck" | "discard" | "hero" | "self"; enters: "charged" | "uncharged"; playerScope?: PlayerScope; sourceOwner?: ZoneOwner; destinationOwner?: ZoneOwner }
  | { kind: "generate-energy"; amount: NumberValue; playerScope?: PlayerScope }
  | { kind: "pay-energy"; amount: NumberValue }
  | { kind: "uncharge-energy"; amount: NumberValue | "all"; playerScope?: PlayerScope; producesEnergy: boolean; preventChargeStepRecharge?: boolean }
  | { kind: "recharge-energy"; amount: NumberValue | "all" }
  | SwapBakucoreEffect
  | { kind: "set-stat"; stat: "power" | "damage"; value: NumberValue }
  | { kind: "set-rule"; rule: "victor-stat"; value: "power" | "damage"; duration: RulesDuration }
  | { kind: "win-game"; reason: string }
  | { kind: "damage-to-hand" }
  | { kind: "end-turn"; recharge: boolean }
  | { kind: "shuffle-deck" }
  | { kind: "move"; object: "card" | "hero" | "evo" | "energy" | "bakucore" | "baku-gear" | "bakugan"; verb: "destroy" | "return" | "retract" | "attach" | "remove" | "shuffle" | "control"; amount: NumberValue; playerScope?: PlayerScope; subject?: "self" | "chosen"; destination?: "owner-hand" | "owner-deck-bottom"; retainChoiceId?: keyof CardChoices; excludeSource?: boolean }
  | { kind: "reveal"; object: "bakucore" | "deck-top"; amount: NumberValue; sourceOwner?: ZoneOwner }
  | { kind: "reorder-deck"; amount: NumberValue }
  | { kind: "play"; source: "revealed-deck" | "hand" | "discard" | "self"; free: boolean; cardType?: CardType; excludedCardTypes?: CardType[]; factions?: Faction[]; cardName?: string; cardMechanic?: string; maximumCost?: NumberValue; sourceOwner?: ZoneOwner; destinationOwner?: ZoneOwner }
  | { kind: "attack"; amount: NumberValue; faction?: Faction }
  | { kind: "negate"; cardType: "Action" | "Hero" | "Baku-Gear" | "any"; copy: boolean; targetChoiceId?: keyof CardChoices; maximumCost?: NumberValue; targetKinds?: Array<"card" | "trigger" | "copy"> }
  | { kind: "search"; cardType?: string; amount: NumberValue }
  | { kind: "copy"; target: "next-action" | "batch-action" | "chosen-batch-object" | "played-action" | "revealed-action" | "discarded-action-this-turn"; independentChoices: boolean; targetChoiceId?: keyof CardChoices; count?: NumberValue; controller?: PlayerScope; sourceOwner?: ZoneOwner }
  | { kind: "cost"; amount: NumberValue; operation: "reduce" | "increase" | "free"; duration: RulesDuration; cardType?: CardType; playerScope?: PlayerScope; costScope?: "base" | "empower" }
  | { kind: "fusion"; operation?: "fuse" | "unfuse"; targetChoiceId?: keyof CardChoices; requirement?: string }
  | { kind: "reroll"; target: "controller" | "opponent"; mandatory: boolean; requiresDiscard: boolean }
  | { kind: "coin-flip" }
  | { kind: "trigger"; event: TriggerEventName; definition: TriggerDefinition }
  | { kind: "watch-turn-event"; definition: TriggerDefinition; effectText: string }
  | { kind: "schedule"; timing: "after-attack"; effects: RuleAction[] }
  | { kind: "continuous"; modifier: ContinuousModifier }
  | { kind: "conditional"; condition: RuleCondition; whenTrue: RuleAction[]; whenFalse?: RuleAction[]; replacement?: boolean }
  | { kind: "replacement"; event: ProposedEvent["kind"]; replaceWith: RuleAction[]; condition?: RuleCondition; object?: "hero" | "evo"; playerScope?: PlayerScope }
  | { kind: "prevention"; event: ProposedEvent["kind"]; amount?: NumberValue; condition?: RuleCondition; object?: "hero" | "evo"; playerScope?: PlayerScope }
  | { kind: "sequence"; effects: RuleAction[] }
  | { kind: "unsupported"; code: string; text: string };

export type RuleInstruction = {
  id: string;
  condition: RuleCondition;
  effects: RuleAction[];
  /** Alias retained for the generic execution loop used by the game kernel. */
  actions: RuleAction[];
  choices: ChoiceSpec[];
  /** Re-offer this instruction after a successful optional selection. */
  repeatWhileSelected?: keyof CardChoices;
  sourceText: string;
};

export type AbilityDefinition = {
  id: string;
  kind: "spell" | "triggered" | "activated" | "static" | "character";
  trigger?: TriggerDefinition;
  instructions: RuleInstruction[];
};

export type CardPlayDefinition = {
  choices: ChoiceSpec[];
  costModifiers: CostEffect[];
  evolvesFrom: RulesCardId[];
  sourceZones: Array<"hand" | "damage-reveal" | "deck" | "discard" | "copy">;
};

export type RuleDefinition = {
  cardId: RulesCardId;
  printingId: RulesCardId;
  sourceText: string;
  cardName: string;
  cardType: CardType;
  faction: Faction;
  factions: Faction[];
  implementationStatus: "draft" | "complete";
  rulesVersion: string;
  contentVersion: string;
  sourceTextFingerprint: string;
  provenance: RuleProvenance;
  goldenTestIds: string[];
  play: CardPlayDefinition;
  abilities: AbilityDefinition[];
};

export type RuleProgram = {
  cardId: RulesCardId;
  source: string;
  instructions: RuleInstruction[];
};

export type RuleSourceReference =
  | { kind: "card"; instanceId: string; catalogId: RulesCardId }
  | { kind: "hero"; instanceId: string; catalogId: RulesCardId }
  | { kind: "bakugan"; id: string; characterCatalogId: RulesCardId }
  | { kind: "bakucore"; id: string; coreType: CoreType }
  | { kind: "system"; id: string };

export type RuleActionResult = {
  amount: number;
  /** Per-player counts support text such as “all players ... then draw that many.” */
  amountByPlayer?: Record<string, number>;
  /** Printed Energy cost of a single card successfully moved or revealed. */
  cardCost?: number;
};

export type RuleObject = {
  rulesObjectVersion: 3;
  id: string;
  controllerId: string;
  /** Physical owner of the card. This can differ from controller for effects such as Mind Control. */
  cardOwnerId?: string;
  card: GameCard;
  choices: CardChoices;
  kind: "card" | "trigger" | "copy";
  effect?: string;
  sourceId?: string;
  definitionId: RulesCardId;
  abilityId: string;
  sourceRef: RuleSourceReference;
  status: RulesObjectStatus;
  negated?: boolean;
  cursor: { instructionIndex: number; effectIndex: number };
  resolvedChoices?: Record<string, CardChoices>;
  createdByEventId?: string;
  /** Marks Dragonoid Maximus's unique, unrespondable alternate-win batch object. */
  alternateWin?: boolean;
  independentChoiceSetId: string;
  copiedFromObjectId?: string;
  /** Values captured at announce/pay/resolve boundaries for deterministic evaluation. */
  valueSnapshots?: Record<string, number>;
  /** Actual successful quantities produced by earlier actions in this resolution. */
  actionResults?: Record<string, RuleActionResult>;
};

export type ContinuousModifier = {
  id: string;
  source: RuleSourceReference;
  controllerId: string;
  target: EntitySelector;
  targetBakuganId?: string;
  targetFaction?: Faction;
  excludedTargetFaction?: Faction;
  stat?: "power" | "damage";
  keyword?: "DoubleStrike" | "ShadowStrike" | "FrostStrike";
  amount: NumberValue;
  layer: ModifierLayer;
  duration: RulesDuration;
  condition?: RuleCondition;
  createdTurn: number;
  sourceCategory?: "card" | "bakucore" | "temporary" | "continuous" | "base-rule";
  choices?: CardChoices;
  valueSnapshots?: Record<string, number>;
};

export type ProposedEvent = {
  id: string;
  kind: "DAMAGE" | "DESTROY" | "MOVE_ZONE" | "STAT_CHANGE" | "CARD_RESOLUTION" | "DRAW";
  actorId?: string;
  sourceId?: string;
  targetId?: string;
  amount?: number;
  destination?: string;
  metadata?: Record<string, unknown>;
};

export type CardPlaySourceZone = "hand" | "damage-reveal" | "deck" | "discard";

export type PendingCardPlay = {
  controllerId: string;
  cardId: string;
  sourceZone: CardPlaySourceZone;
  sourceOwnerId: string;
  /** Physical owner/destination owner after an Action or Flip resolves. */
  cardOwnerId: string;
  /** External effects that say “play ... for free” set only the base Energy cost to 0. */
  forcedFreeBase?: boolean;
  /** The card is being played through its InstaBrawl alternate payment route. */
  instabrawl?: boolean;
  origin: "priority" | "effect" | "damage";
  parentEffectId?: string;
  parentNextInstructionIndex?: number;
  resumePriority?: string;
  resumeDeadline?: number;
  resumeStepLabel?: string;
  resumePhase?: Phase;
  optional?: boolean;
  choices: CardChoices;
  beforeState?: string;
  irreversibleInformation?: boolean;
  valueSnapshots?: Record<string, number>;
};

export type StoredCostModifier = {
  id: string;
  sourceId: string;
  controllerId: string;
  kind: "free" | "reduce" | "increase";
  amount: NumberValue;
  duration: "turn" | "next-card";
  cardType?: CardType;
  playerScope: PlayerScope;
  choices?: CardChoices;
  valueSnapshots?: Record<string, number>;
  createdTurn: number;
};

export type RulesPayment = {
  id: string;
  playerId: string;
  cardId: string;
  calculatedCost: number;
  selectedEnergyIds: string[];
  additionalCosts: Array<{ kind: "discard"; amount: number; cardIds: string[] }>;
  status: "declared" | "paid" | "cancelled";
};

export type RulesState = {
  version: 3;
  modifiers: ContinuousModifier[];
  replacements: Array<{ id: string; source: RuleSourceReference; controllerId: string; effect: Extract<RuleAction, { kind: "replacement" | "prevention" }> }>;
  triggerUsage: Record<string, number>;
  costModifiers: StoredCostModifier[];
  delayedCardTriggers: Array<{
    id: string;
    controllerId: string;
    cardOwnerId: string;
    card: GameCard;
    definition: TriggerDefinition;
    effectText: string;
    createdTurn: number;
  }>;
  scheduledActions: Array<{
    id: string;
    timing: "after-attack";
    controllerId: string;
    cardOwnerId: string;
    card: GameCard;
    sourceId: string;
    effects: RuleAction[];
    createdTurn: number;
  }>;
  /** Attacker-scoped turn effects such as Shieldbreaker and Titan Eenoch. */
  ignoreArmorRating?: Record<string, boolean>;
  /** Bonus damage absorbed by Baku-Gear Armor, keyed by the damaged player. */
  armorDamageReducedThisTurn?: Record<string, number>;
  pendingPayment?: RulesPayment;
};
