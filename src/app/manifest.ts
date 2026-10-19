import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RemotePlay",
    short_name: "RemotePlay",
    description: "A Raspberry Pi music controller for Navidrome.",
    start_url: "/",
    display: "standalone",
    background_color: "#0f1012",
    theme_color: "#0f1012",
    orientation: "any",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}