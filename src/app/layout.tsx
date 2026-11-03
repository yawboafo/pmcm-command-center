import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Montserrat } from "next/font/google";
import { PLATFORM, TENANT } from "@/config/platform";
import "./globals.css";

const brand = Montserrat({ variable: "--font-brand", subsets: ["latin"], weight: ["500", "600", "700", "800"] });
const ui = Inter({ variable: "--font-ui", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: `${PLATFORM.name} · ${TENANT.name}`,
  description: `${PLATFORM.name} — ${PLATFORM.tagline}. Prototype workspace for ${TENANT.name} (${TENANT.country}): 3D digital twin and operations simulation. Demo data is simulated; floor plans are conceptual.`,
};

/** Reads the saved theme (ops.theme: dark | light | auto) and applies it before the page paints. */
const THEME_BOOT = `try{var t=localStorage.getItem("ops.theme")||"dark";if(t==="auto")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){}`;

export const viewport: Viewport = { themeColor: "#07090d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set before first paint by the inline script (no flash); React does not own it.
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${brand.variable} ${ui.variable} ${mono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="h-full font-sans">{children}</body>
    </html>
  );
}
