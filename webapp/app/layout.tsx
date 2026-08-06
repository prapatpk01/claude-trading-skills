import type { Metadata } from "next";
import "./globals.css";
import "./sentinel-v9.css";

export const metadata: Metadata = {
  title: "Sentinel Investment OS v20 · CIO Command Center",
  description: "Decision and execution operating system for automatic opportunity discovery, portfolio review, funded investment resolutions, risk governance and mandatory human approval.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
