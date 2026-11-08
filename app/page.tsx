import type { Metadata } from "next";
import { BlankDashboardScreen } from "../components/routes/BlankDashboardScreen";

export const metadata: Metadata = {
  title: "Home",
  description: "Build a Battle Planet deck, construct the Hide Matrix, and play a rules-guided online Bakugan TCG match.",
};

export default function HomePage() {
  return <BlankDashboardScreen />;
}
