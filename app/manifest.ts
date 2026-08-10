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
        src: "/assets/app-icons/bakugan-battle-planet-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/assets/app-icons/bakugan-battle-planet-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/assets/app-icons/bakugan-battle-planet-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
