import type { Metadata } from "next";
import { CollectionScreen } from "../../../components/routes/CollectionScreen";

export const metadata: Metadata = { title: "Collection", description: "Track owned, foil, and wishlist copies of every supported Bakugan card and BakuCore." };

export default function CollectionPage() {
  return <CollectionScreen />;
}
