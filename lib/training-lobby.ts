import {
  BAKUGAN,
  CARDS,
  STARTER_DECKS,
  makePlayer,
  validateDeck,
  type DeckRecord,
} from "./data";
import { createMatch, type MatchState } from "./game";
import {
  applyLobbyConfig,
  lobbyConfig,
  requiredDeckFormat,
  tagLobbyPlayerDeck,
  type LobbyDeckFormat,
} from "./lobby-config";
import { replaceLobbyDeck, setLobbyReady } from "./lobby";

function singletonTrainingDeck(): DeckRecord {
  const base = STARTER_DECKS[1];
  const teamFactions = new Set(
    base.bakuganIds
      .map((id) => BAKUGAN.find((bakugan) => bakugan.id === id)?.faction)
      .filter((value): value is NonNullable<typeof value> => Boolean(value)),
  );
  const identities = new Set<string>();
  const cardIds: string[] = [];
  for (const card of CARDS) {
    if (card.type === "Character") continue;
    const factions = card.factions?.length ? card.factions : [card.faction];
    if (!factions.some((faction) => teamFactions.has(faction))) continue;
    const constructionIdentity = (card as typeof card & { constructionIdentity?: string }).constructionIdentity
      ?? `${card.name}|${card.effect}`;
    if (identities.has(constructionIdentity)) continue;
    identities.add(constructionIdentity);
    cardIds.push(card.catalogId);
    if (cardIds.length === 40) break;
  }
  const deck: DeckRecord = {
    ...base,
    id: "training-ai-singleton",
    name: "Mira Nova • Singleton Training",
    cardIds,
    format: "singleton",
    visibility: "Private",
    updatedAt: new Date().toISOString(),
  };
  const report = validateDeck(deck);
  if (!report.isLegal) throw new Error(`Training AI could not build a Singleton deck. ${report.issues.map((issue) => issue.message).join(" ")}`);
  return deck;
}

export function trainingOpponentDeck(format: LobbyDeckFormat) {
  return format === "singleton" ? singletonTrainingDeck() : STARTER_DECKS[1];
}

export function createTrainingLobbyState(
  code: string,
  structure: "bo1" | "bo3",
  playerId: string,
  playerName: string,
  playerDeck: DeckRecord,
): MatchState {
  const initialRulesFormat = playerDeck.format === "singleton" ? "singleton" : "standard";
  const human = tagLobbyPlayerDeck(makePlayer(playerId, playerName, playerDeck), playerDeck);
  const aiDeck = trainingOpponentDeck(initialRulesFormat);
  const bot = tagLobbyPlayerDeck(makePlayer("training-bot", "Mira Nova • Training AI", aiDeck), aiDeck);
  bot.ready = true;
  const state = createMatch(code, structure, [human, bot]);
  applyLobbyConfig(state, {
    mode: "training",
    rulesFormat: initialRulesFormat,
    meta: "battle-brawlers",
  });
  return state;
}

export function syncTrainingBotForLobby(input: MatchState) {
  const config = lobbyConfig(input);
  if (config.mode !== "training" || input.phase !== "lobby") return input;
  const bot = input.players.find((player) => player.id === "training-bot");
  if (!bot) return input;
  const deckFormat = requiredDeckFormat(config.rulesFormat);
  const deck = trainingOpponentDeck(deckFormat);
  const replacement = tagLobbyPlayerDeck(makePlayer(bot.id, bot.name, deck), deck);
  let state = replaceLobbyDeck(input, bot.id, replacement);
  state = setLobbyReady(state, bot.id, true);
  return state;
}
