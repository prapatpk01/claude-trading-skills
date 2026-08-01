import type { Metadata } from "next";
import "./globals.css";
import "./sentinel-v9.css";

export const metadata: Metadata = {
  title: "Sentinel Investment OS v9.0",
  description: "Institutional AI investment operating system for evidence-based research, portfolio construction, macro intelligence, risk governance and human-supervised decisions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
