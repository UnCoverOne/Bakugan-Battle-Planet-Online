import type { MatchState } from "./game";

export type ActiveSessionPresentation = {
  kind: "lobby" | "match";
  href: "/play/lobby" | "/play/match";
  eyebrow: "ACTIVE LOBBY" | "ACTIVE MATCH";
  actionLabel: "RETURN TO LOBBY" | "RESUME MATCH";
  navLabel: "Return to lobby" | "Resume match";
  title: string;
  detail: string;
};

export function activeSessionPresentation(match: MatchState | null | undefined): ActiveSessionPresentation | null {
  if (!match || match.phase === "result") return null;

  if (match.phase === "lobby") {
    return {
      kind: "lobby",
      href: "/play/lobby",
      eyebrow: "ACTIVE LOBBY",
      actionLabel: "RETURN TO LOBBY",
      navLabel: "Return to lobby",
      title: match.code ? `Room ${match.code}` : "Lobby open",
      detail: match.stepLabel || "Finish your lobby setup before the Brawl begins.",
    };
  }

  return {
    kind: "match",
    href: "/play/match",
    eyebrow: "ACTIVE MATCH",
    actionLabel: "RESUME MATCH",
    navLabel: "Resume match",
    title: match.code ? `Room ${match.code}` : "Battle in progress",
    detail: match.stepLabel || "Return to your current Brawl.",
  };
}
