import type { Metadata } from "next";
import { ProfileRewardRuntimeProvider } from "../../../../components/routes/ProfileRewardRuntimeProvider";
import { ProfileScreen } from "../../../../components/routes/ProfileScreen";

export const metadata: Metadata = { title: "Brawler Profile" };
export default async function ProfilePage({ params }: { params: Promise<{ segments?: string[] }> }) {
  const { segments = [] } = await params;
  return (
    <ProfileRewardRuntimeProvider>
      <ProfileScreen segments={segments} />
    </ProfileRewardRuntimeProvider>
  );
}
