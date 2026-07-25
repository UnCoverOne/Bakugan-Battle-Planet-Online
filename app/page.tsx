import type { Metadata } from "next";
import { EntryScreen } from "../components/routes/EntryScreen";

export const metadata: Metadata = {
  title: "Bakugan Battle Planet Online",
  description: "Build a Battle Planet deck, construct the Hide Matrix, and play a rules-guided online Bakugan TCG match.",
};

export default function HomePage() {
  return <EntryScreen />;
}
