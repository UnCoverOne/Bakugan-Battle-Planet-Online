import type { Metadata } from "next";
import { DeckLibraryScreen } from "../../../components/routes/DeckRoutes";

export const metadata: Metadata = { title: "Deck Library", description: "Organize, validate, import, export, and publish Battle Planet decks." };
export default function DecksPage() { return <DeckLibraryScreen />; }
