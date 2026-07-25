import type { Metadata } from "next";
import { ProfileScreen } from "../../../components/routes/ProfileScreen";

export const metadata: Metadata = { title: "Brawler Profile" };
export default function ProfilePage() { return <ProfileScreen />; }
