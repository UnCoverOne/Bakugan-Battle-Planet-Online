import type { Metadata } from "next";
import { DeckDetailScreen } from "../../../../components/routes/DeckRoutes";

export const metadata: Metadata = { title: "Deck Details" };
export default async function DeckDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DeckDetailScreen id={decodeURIComponent(id)} />;
}
