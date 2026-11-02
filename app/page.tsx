import type { Metadata } from "next";
import { HomePrototype } from "../components/home/HomePrototype";

export const metadata: Metadata = {
  title: "Home",
  description: "Bakugan Battle Planet Online — home page rebuild prototype.",
};

export default function HomePage() {
  return <HomePrototype />;
}
