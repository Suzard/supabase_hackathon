import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Instrument_Sans } from "next/font/google";
import "./globals.css";

const display = Big_Shoulders({
  variable: "--font-big-shoulders",
  subsets: ["latin"],
  axes: ["opsz"],
});

const sans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  axes: ["wdth"],
});

const description =
  "Agents that run out of credits keep working on API keys hackathon builders donated. Agents pay 5% of list price.";

export const metadata: Metadata = {
  metadataBase: new URL("https://tokencharity.dev"),
  title: { default: "Token Charity", template: "%s · Token Charity" },
  description,
  applicationName: "Token Charity",
  openGraph: { type: "website", siteName: "Token Charity", url: "/", title: "Token Charity", description },
  twitter: { card: "summary_large_image", title: "Token Charity", description },
  alternates: { types: { "text/markdown": "/agents.md" } },
};

export const viewport: Viewport = {
  themeColor: "#4d1517",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
