import {
  cloneMatch,
  uid,
  type CardLogEvent,
  type GameCard,
  type MatchLogEntry,
  type MatchState,
} from "./game";

export const CHAT_MESSAGE_LIMIT = 240;

export type ChatLogEntry = {
  id: string;
  at: number;
  kind: "chat";
  message: string;
  playerId: string;
  author: string;
};

export function normalizeChatMessage(value: string) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHAT_MESSAGE_LIMIT);
}

export function chatEntries(match: MatchState | null | undefined): readonly ChatLogEntry[] {
  return (match?.log ?? [])
    .filter((entry) => String(entry.kind) === "chat")
    .map((entry) => entry as unknown as ChatLogEntry);
}

export function eventLogEntries(match: MatchState | null | undefined) {
  return (match?.log ?? []).filter((entry) => String(entry.kind) !== "chat");
}

export type CardEventLogEntry = MatchLogEntry & {
  card: GameCard;
  cardEvent: CardLogEvent;
};

function cardsInMatch(match: MatchState) {
  const cards = [
    ...match.players.flatMap((player) => [
      ...player.deckCards,
      ...player.hand,
      ...player.discard,
      ...player.energyZone,
      ...player.heroes,
      ...player.bakugan.flatMap((bakugan) => [bakugan.character, ...bakugan.evoStack]),
    ]),
    ...match.batch.map((effect) => effect.card),
  ];
  return [...new Map(cards.map((card) => [card.id, card])).values()];
}

function cardControllerId(match: MatchState, card: GameCard) {
  const pending = match.batch.find((effect) => effect.card.id === card.id);
  if (pending) return pending.controllerId;
  return match.players.find((player) => [
    ...player.deckCards,
    ...player.hand,
    ...player.discard,
    ...player.energyZone,
    ...player.heroes,
    ...player.bakugan.flatMap((bakugan) => [bakugan.character, ...bakugan.evoStack]),
  ].some((candidate) => candidate.id === card.id))?.id;
}

function legacyCardEvent(message: string, cardName: string): CardLogEvent | undefined {
  if (message === `${cardName} finished resolving its typed rule program.`) return "effect";
  if (
    message.includes(` added ${cardName} to the batch for `)
    || message.includes(` played ${cardName} from hand for free.`)
    || message.includes(` played discarded ${cardName} for free.`)
    || message.includes(` played the revealed ${cardName} for free.`)
  ) return "played";
  return undefined;
}

/**
 * Returns only card plays and resolving card effects in their authoritative log
 * order. Structured metadata handles new matches; message matching keeps saved
 * legacy matches useful without mutating their snapshots.
 */
export function cardEventLogEntries(
  match: MatchState | null | undefined,
): readonly CardEventLogEntry[] {
  if (!match) return [];
  const matchCards = cardsInMatch(match);
  const byInstance = new Map(matchCards.map((card) => [card.id, card]));
  const byCatalogue = new Map(matchCards.map((card) => [card.catalogId, card]));
  const legacyCandidates = [...matchCards].sort((left, right) => right.name.length - left.name.length);

  return eventLogEntries(match).flatMap((entry) => {
    if ((entry.cardEvent === "played" || entry.cardEvent === "effect") && (entry.cardInstanceId || entry.cardCatalogId)) {
      const card = (entry.cardInstanceId ? byInstance.get(entry.cardInstanceId) : undefined)
        ?? (entry.cardCatalogId ? byCatalogue.get(entry.cardCatalogId) : undefined);
      return card ? [{
        ...entry,
        card,
        cardEvent: entry.cardEvent,
        playerId: entry.playerId ?? cardControllerId(match, card),
      }] : [];
    }
    for (const card of legacyCandidates) {
      const cardEvent = legacyCardEvent(entry.message, card.name);
      if (cardEvent) return [{
        ...entry,
        card,
        cardEvent,
        playerId: entry.playerId ?? cardControllerId(match, card),
      }];
    }
    return [];
  });
}

export function addChatMessage(
  input: MatchState,
  playerId: string,
  rawMessage: string,
  now = Date.now(),
) {
  const message = normalizeChatMessage(rawMessage);
  if (!message) throw new Error("Enter a chat message before sending.");
  const state = cloneMatch(input);
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Unknown player.");

  const entry: ChatLogEntry = {
    id: `${now}-chat-${uid()}`,
    at: now,
    kind: "chat",
    message,
    playerId: player.id,
    author: player.name,
  };
  state.log.push(entry as unknown as MatchState["log"][number]);
  state.version += 1;
  return state;
}
