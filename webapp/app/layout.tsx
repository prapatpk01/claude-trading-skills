import type { Metadata } from "next";
import "./globals.css";
import "./sentinel-v9.css";

export const metadata: Metadata = {
  title: "Sentinel Investment OS v10.0 · Final AI CIO",
  description: "Final AI CIO investment operating system for evidence-first research, macro intelligence, portfolio construction, risk governance, audit trails and mandatory human-supervised decisions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
