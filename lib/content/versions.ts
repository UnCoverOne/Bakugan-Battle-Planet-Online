export const APPLICATION_VERSION = "0.3.0" as const;
export const GAME_ENGINE_VERSION = "4.2.0" as const;
export const RULES_PROFILE_VERSION = "battle-planet-rules-v5" as const;
export const CARD_CATALOGUE_VERSION = "battle-planet-cards-v3-bb-br-aa-ex" as const;
export const PHYSICAL_SIMULATION_VERSION = "physical-simulation-v2" as const;
export const DIGITAL_ADAPTATION_VERSION = PHYSICAL_SIMULATION_VERSION;
export const CONTENT_SCHEMA_VERSION = 2 as const;

export type GameVersionProfile = {
  applicationVersion: typeof APPLICATION_VERSION;
  engineVersion: typeof GAME_ENGINE_VERSION;
  rulesVersion: typeof RULES_PROFILE_VERSION;
  cardCatalogueVersion: typeof CARD_CATALOGUE_VERSION;
  digitalAdaptationVersion: typeof DIGITAL_ADAPTATION_VERSION;
  contentSchemaVersion: typeof CONTENT_SCHEMA_VERSION;
};

export const CURRENT_GAME_VERSION_PROFILE: GameVersionProfile = Object.freeze({
  applicationVersion: APPLICATION_VERSION,
  engineVersion: GAME_ENGINE_VERSION,
  rulesVersion: RULES_PROFILE_VERSION,
  cardCatalogueVersion: CARD_CATALOGUE_VERSION,
  digitalAdaptationVersion: DIGITAL_ADAPTATION_VERSION,
  contentSchemaVersion: CONTENT_SCHEMA_VERSION,
});
