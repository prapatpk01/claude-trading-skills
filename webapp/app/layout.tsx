import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sentinel Investment · Institutional AI Investment OS",
  description: "AI-powered institutional investment operating system for research, portfolio construction, risk governance, opportunity discovery and human-supervised decisions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
