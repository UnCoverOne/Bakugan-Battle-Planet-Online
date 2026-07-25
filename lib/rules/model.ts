import type { CardChoices, CardType, CoreType, Faction, GameCard } from "../game";

export type RulesCardId = `bb-${number}`;
export type RulesObjectStatus = "pending" | "resolving" | "resolved" | "negated";
export type ChoiceTiming = "announce" | "pay" | "resolve";
export type ChoiceVisibility = "public" | "private" | "secret-until-reveal";
export type RulesDuration = "instant" | "turn" | "while-source-active" | "next-card" | "permanent";
export type RuleCitation = { sourceId: string; locator: string; note?: string };
export type RuleProvenance = { authorityOrder: string[]; citations: RuleCitation[]; reviewed: boolean };
export type ModifierLayer = "base" | "set" | "core" | "continuous" | "temporary" | "protection" | "final";

export type EntitySelector =
  | "active-friendly"
  | "active-enemy"
  | "chosen-bakugan"
  | "all-friendly"
  | "all-enemy"
  | "controller"
  | "opponent"
  | "batch-object"
  | "chosen-card"
  | "self";

export type RuleCondition =
  | { kind: "always" }
  | { kind: "fury" }
  | { kind: "turbo" }
  | { kind: "domination" }
  | { kind: "flow" }
  | { kind: "victor" }
  | { kind: "faction"; faction: Faction }
  | { kind: "cards-played"; comparison: "at-least" | "more-than"; amount: number }
  | { kind: "hero-count"; comparison: "at-least"; amount: number }
  | { kind: "core-count"; relationship: "more-than-opponent" | "at-least"; amount?: number }
  | { kind: "selection-made"; choiceId: keyof CardChoices }
  | { kind: "printed"; text: string };

export type ChoiceSpec = {
  id: keyof CardChoices;
  timing: ChoiceTiming;
  selector: EntitySelector | "number" | "mode" | "hand-card" | "deck-card" | "energy-card" | "bakucore" | "hero" | "evo";
  label: string;
  minimum?: number;
  maximum?: number;
  optional?: boolean;
  chooser: "controller" | "opponent" | "each-player";
  visibility?: ChoiceVisibility;
  cardType?: CardType;
  factions?: Faction[];
};

export type TriggerEventName =
  | "CARD_PLAYED"
  | "BAKUGAN_SELECTED"
  | "BAKUGAN_OPENED"
  | "CARD_DISCARDED"
  | "VICTOR_DECLARED"
  | "ATTACK_CREATED"
  | "DAMAGE_TAKEN"
  | "HAND_EMPTIED"
  | "TURN_ENDED";

export type TriggerDefinition = {
  event: TriggerEventName;
  relationship: "controller" | "opponent" | "any";
  cardType?: CardType;
  optional?: boolean;
  interveningCondition?: RuleCondition;
  limit?: { kind: "once-per-turn" | "first-each-turn"; key: string };
};

export type CostEffect =
  | { kind: "cost-reduce"; amount: number; duration: RulesDuration; cardType?: CardType; condition?: RuleCondition }
  | { kind: "cost-increase"; amount: number; duration: RulesDuration; cardType?: CardType; condition?: RuleCondition }
  | { kind: "cost-free"; duration: RulesDuration; condition?: RuleCondition }
  | { kind: "cost-discard"; amount: number; choiceId: keyof CardChoices }
  | { kind: "cost-alternative"; label: string; components: CostEffect[] };

export type RuleAction =
  | { kind: "modify-stat"; stat: "power" | "damage" | "frost"; amount: number; scale?: string; duration: RulesDuration; scope?: "target" | "all-enemy" | "all-friendly" }
  | { kind: "grant-keyword"; keyword: "DoubleStrike" | "ShadowStrike" | "FrostStrike" | "Victor" | "Stop"; value?: number; duration: RulesDuration }
  | { kind: "draw"; amount: number; scale?: string }
  | { kind: "discard"; amount: number; minimum: number; maximum: number; repeated?: boolean }
  | { kind: "energize"; amount: number; source: "hand" | "deck" | "hero" | "self" }
  | { kind: "generate-energy"; amount: number; scale?: string }
  | { kind: "set-stat"; stat: "power" | "damage"; value: number }
  | { kind: "set-rule"; rule: "victor-stat"; value: "power" | "damage"; duration: RulesDuration }
  | { kind: "damage-to-hand" }
  | { kind: "end-turn"; recharge: boolean }
  | { kind: "shuffle-deck" }
  | { kind: "move"; object: "card" | "hero" | "evo" | "energy" | "bakucore" | "bakugan"; verb: "destroy" | "return" | "retract" | "attach" | "remove" | "shuffle" | "control"; amount: number }
  | { kind: "reveal"; object: "bakucore" | "deck-top"; amount: number }
  | { kind: "reorder-deck"; amount: number }
  | { kind: "play"; source: "revealed-deck" | "hand" | "self"; free: boolean }
  | { kind: "attack"; amount: number; faction?: Faction }
  | { kind: "negate"; cardType: "Action" | "Hero" | "any"; copy: boolean; targetChoiceId?: keyof CardChoices }
  | { kind: "search"; cardType?: string; amount: number }
  | { kind: "copy"; target: "next-action" | "batch-action"; independentChoices: true }
  | { kind: "cost"; amount: number; operation: "reduce" | "increase" | "free"; duration: RulesDuration }
  | { kind: "trigger"; event: TriggerEventName; definition: TriggerDefinition }
  | { kind: "continuous"; modifier: ContinuousModifier }
  | { kind: "conditional"; condition: RuleCondition; whenTrue: RuleAction[]; whenFalse?: RuleAction[]; replacement?: boolean }
  | { kind: "replacement"; event: ProposedEvent["kind"]; replaceWith: RuleAction[]; condition?: RuleCondition }
  | { kind: "prevention"; event: ProposedEvent["kind"]; amount?: number; condition?: RuleCondition }
  | { kind: "sequence"; effects: RuleAction[] }
  | { kind: "unsupported"; code: string; text: string };

export type RuleInstruction = {
  id: string;
  condition: RuleCondition;
  effects: RuleAction[];
  /** Alias retained for the generic execution loop used by the game kernel. */
  actions: RuleAction[];
  choices: ChoiceSpec[];
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

export type RuleObject = {
  rulesObjectVersion: 3;
  id: string;
  controllerId: string;
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
  independentChoiceSetId: string;
};

export type ContinuousModifier = {
  id: string;
  source: RuleSourceReference;
  controllerId: string;
  target: EntitySelector;
  targetBakuganId?: string;
  stat?: "power" | "damage";
  keyword?: "DoubleStrike" | "ShadowStrike" | "FrostStrike";
  amount: number;
  layer: ModifierLayer;
  duration: RulesDuration;
  condition?: RuleCondition;
  createdTurn: number;
  sourceCategory?: "card" | "bakucore" | "temporary" | "continuous" | "base-rule";
};

export type ProposedEvent = {
  id: string;
  kind: "DAMAGE" | "MOVE_ZONE" | "STAT_CHANGE" | "CARD_RESOLUTION" | "DRAW";
  actorId?: string;
  sourceId?: string;
  targetId?: string;
  amount?: number;
  destination?: string;
  metadata?: Record<string, unknown>;
};

export type RulesPayment = {
  id: string;
  playerId: string;
  cardId: string;
  calculatedCost: number;
  selectedEnergyIds: string[];
  additionalCosts: Array<{ kind: "discard"; cardIds: string[] }>;
  status: "declared" | "paid" | "cancelled";
};

export type RulesState = {
  version: 3;
  modifiers: ContinuousModifier[];
  replacements: Array<{ id: string; source: RuleSourceReference; controllerId: string; effect: Extract<RuleAction, { kind: "replacement" | "prevention" }> }>;
  triggerUsage: Record<string, number>;
  pendingPayment?: RulesPayment;
};
