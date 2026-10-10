import { readFileSync } from "node:fs";
const deckModules = ["DeckRoutes", "DeckRouteShared", "DeckLibraryPresentation", "PublicDeckCatalogue", "DeckInspectorReferences", "DeckDetailPresentation", "DeckLibraryScreen", "PublicDeckLibraryScreen", "PublicDeckDetailScreen", "DeckDetailScreen", "DeckBuilderScreen"];
export function deckRouteSource() {
  return deckModules.map(name => readFileSync(new URL(`../components/routes/${name}.tsx`, import.meta.url), "utf8")).join("\n");
}
