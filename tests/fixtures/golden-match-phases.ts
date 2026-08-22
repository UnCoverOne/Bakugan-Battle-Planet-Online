export const GOLDEN_MATCH_PHASES = Object.freeze([
  { phase: "lobby", area: "lobby", step: "ready", label: "Lobby • Ready" },
  { phase: "startingPlayer", area: "setup", step: "starting-player", label: "Setup • Starting player" },
  { phase: "placement", area: "setup", step: "core-placement", label: "Setup • Core placement" },
  { phase: "draw", area: "setup", step: "draw", label: "Start Phase • Draw Step" },
  { phase: "energize", area: "setup", step: "energize", label: "Start Phase • Energize Step" },
  { phase: "selection", area: "roll", step: "selection", label: "Roll Phase • Selection Step" },
  { phase: "preRoll", area: "roll", step: "pre-roll-priority", label: "Roll Phase • Pre-roll priority" },
  { phase: "target", area: "roll", step: "targeting-and-rolling", label: "Roll Phase • Rolling Step" },
  { phase: "power", area: "brawl", step: "power", label: "Brawl Phase • Power Step" },
  { phase: "victor", area: "brawl", step: "victor", label: "Brawl Phase • Victor Step" },
  { phase: "damage", area: "brawl", step: "damage", label: "Brawl Phase • Damage Step" },
  { phase: "postDamage", area: "brawl", step: "post-damage", label: "Brawl Phase • Post-damage" },
  { phase: "retract", area: "brawl", step: "retract", label: "Brawl Phase • Retracting Step" },
  { phase: "endPlay", area: "end", step: "play", label: "End Phase • Play Step" },
  { phase: "handLimit", area: "end", step: "hand-limit", label: "End Phase • Hand limit" },
  { phase: "result", area: "result", step: "match-result", label: "Match result" }
] as const);
