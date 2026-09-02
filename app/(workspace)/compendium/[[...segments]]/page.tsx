import type { Metadata } from "next";
import { CompendiumScreen } from "../../../../components/routes/CompendiumScreen";

export const metadata: Metadata = { title: "Card, BakuCore & Rules Compendium", description: "Browse the supplied card and BakuCore catalogue, advanced glossary, symbol reference, and published rulings." };
export default async function CompendiumPage({ params }: { params: Promise<{ segments?: string[] }> }) {
  const { segments = [] } = await params;
  return <CompendiumScreen segments={segments} />;
}
