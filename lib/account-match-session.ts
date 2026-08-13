export type AccountMatchSessionSummary = {
  code: string;
  playerId: string;
  phase: "lobby" | "match" | "intermission";
  format: "bo1" | "bo3";
  opponentName: string;
  stepLabel: string;
  updatedAt: number;
  capabilityVersion: number;
  controllerActive: boolean;
};

export function accountMatchSessionHref(session: AccountMatchSessionSummary) {
  if (session.phase === "lobby") return "/play/lobby" as const;
  if (session.phase === "intermission") return "/play/result" as const;
  return "/play/match" as const;
}

export function accountMatchSessionPresentation(session: AccountMatchSessionSummary) {
  const lobby = session.phase === "lobby";
  const intermission = session.phase === "intermission";
  return {
    eyebrow: lobby ? "ACTIVE LOBBY" as const : intermission ? "BETWEEN GAMES" as const : "ACTIVE MATCH" as const,
    actionLabel: lobby ? "RESUME LOBBY" as const : intermission ? "VIEW RESULT" as const : "RESUME MATCH" as const,
    navLabel: lobby ? "Resume lobby" as const : intermission ? "View result" as const : "Resume match" as const,
    title: `Room ${session.code}`,
    detail: session.stepLabel || (lobby
      ? "Restore this account lobby on this device."
      : `Continue the Brawl against ${session.opponentName || "your opponent"}.`),
  };
}
