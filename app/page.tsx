import type { Metadata } from "next";
import HomeDashboard from "../components/home/HomeDashboard";

export const metadata: Metadata = {
  title: "Home",
  description: "Bakugan Battle Planet Online player dashboard.",
};

export default function HomePage() {
  return <HomeDashboard />;
}
