import type { Metadata } from "next";
import { GuestAccountScreen } from "../../components/routes/GuestAccountScreen";

export const metadata: Metadata = {
  title: "Brawler Account",
  description: "Create a Brawler account to unlock achievements, publish decks, customise a profile, and protect progress.",
};

export default function AccountPage() {
  return <GuestAccountScreen />;
}
