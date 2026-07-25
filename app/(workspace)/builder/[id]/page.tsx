import type { Metadata } from "next";
import { DeckBuilderScreen } from "../../../../components/routes/DeckRoutes";

export const metadata: Metadata = { title: "Deck Builder", description: "Build and validate a complete Battle Planet deck." };
export default async function BuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DeckBuilderScreen id={decodeURIComponent(id)} />;
}
