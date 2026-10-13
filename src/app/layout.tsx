import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RemotePlay | Navidrome controller",
  description: "A Raspberry Pi music controller for Navidrome.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
