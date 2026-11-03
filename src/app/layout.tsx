import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Montserrat } from "next/font/google";
import "./globals.css";

const brand = Montserrat({ variable: "--font-brand", subsets: ["latin"], weight: ["500", "600", "700", "800"] });
const ui = Inter({ variable: "--font-ui", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PMCM Operations Command Center — Digital Twin Demo",
  description: "Prototype 3D restaurant digital twin and operations simulation for Pizzaman Chickenman branches in Ghana. Demo data is simulated; floor plans are conceptual.",
};

export const viewport: Viewport = { themeColor: "#07090d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${brand.variable} ${ui.variable} ${mono.variable} h-full antialiased`}>
      <body className="h-full font-sans">{children}</body>
    </html>
  );
}
