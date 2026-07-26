import type { Metadata } from "next";
import { PublicDeckDetailScreen } from "../../../../../components/routes/DeckRoutes";

export const metadata: Metadata = { title: "Public Deck" };
export default async function PublicDeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublicDeckDetailScreen id={decodeURIComponent(id)} />;
}
