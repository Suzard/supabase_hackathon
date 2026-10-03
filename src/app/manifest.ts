import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Token Charity",
    short_name: "Token Charity",
    description: "Donated API credits, routed to agents that ran out.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8efe0",
    theme_color: "#4d1517",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
