import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Source_Serif_4 } from "next/font/google";
import { SiteHeader } from "@/components/shell/site-header";
import { MainNav } from "@/components/shell/main-nav";
import { DemoBand } from "@/components/demo-band";
import { ServiceWorkerRegistrar } from "@/components/shell/sw-registrar";
import "./globals.css";

const display = Source_Serif_4({
  subsets: ["latin", "latin-ext"],
  weight: ["600"],
  variable: "--font-source-serif",
  display: "swap",
});
const ui = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  variable: "--font-atkinson",
  display: "swap",
});
const mono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-atkinson-mono",
  display: "swap",
});

export const metadata: Metadata = {
  // Every record in this build is synthetic; the title says so.
  title: { default: "[DEMO] PollTrace", template: "[DEMO] %s · PollTrace" },
  description:
    "Capture a photo of a posted polling-unit result, keep it safe offline, and trace how records compare. Not affiliated with INEC.",
  applicationName: "PollTrace",
};

export const viewport: Viewport = {
  themeColor: "#086A68",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-NG" className={`${display.variable} ${ui.variable} ${mono.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-3"
        >
          Skip to content
        </a>
        <SiteHeader nav={<MainNav />} />
        <DemoBand />
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
