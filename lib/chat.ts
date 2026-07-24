import { cloneMatch, uid, type MatchState } from "./game";

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

