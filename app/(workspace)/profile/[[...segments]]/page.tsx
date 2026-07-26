import type { Metadata } from "next";
import { ProfileScreen } from "../../../../components/routes/ProfileScreen";

export const metadata: Metadata = { title: "Brawler Profile" };
export default async function ProfilePage({ params }: { params: Promise<{ segments?: string[] }> }) {
  const { segments = [] } = await params;
  return <ProfileScreen segments={segments} />;
}
