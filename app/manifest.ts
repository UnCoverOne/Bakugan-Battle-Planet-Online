import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bakugan Battle Planet Online",
    short_name: "Battle Planet",
    description: "Build decks, browse authoritative references, and play Bakugan Battle Planet online.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#020b11",
    theme_color: "#020b11",
    icons: [
      {
        src: "/assets/logo.png",
        sizes: "134x118",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
