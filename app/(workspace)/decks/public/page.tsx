import type { Metadata } from "next";
import { PublicDeckLibraryScreen } from "../../../../components/routes/PublicDeckLibraryScreen";

export const metadata: Metadata = { title: "Public Decks" };
export default function PublicDecksPage() { return <PublicDeckLibraryScreen />; }
