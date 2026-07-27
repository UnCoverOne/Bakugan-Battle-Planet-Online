import type { Metadata } from "next";
import { DeckBuilderScreen } from "../../../../components/routes/DeckRoutes";

export const metadata: Metadata = { title: "Deck Builder", description: "Build and validate a complete Battle Planet deck." };

export default async function BuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const returnTo = typeof query.returnTo === "string" ? query.returnTo : undefined;
  return <DeckBuilderScreen id={decodeURIComponent(id)} returnTo={returnTo} />;
}
