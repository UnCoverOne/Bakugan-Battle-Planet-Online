import type { Metadata } from "next";
import { PublicProfileScreen } from "../../../../components/routes/PublicProfileScreen";

export const metadata: Metadata = { title: "Brawler Profile" };
export default async function BrawlerProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <PublicProfileScreen userId={userId} />;
}

