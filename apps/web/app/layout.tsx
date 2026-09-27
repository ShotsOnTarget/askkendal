import type { Metadata, Viewport } from "next";
import { Archivo, Atkinson_Hyperlegible_Next } from "next/font/google";
import "./globals.css";

// Display: Archivo at its widest cut reads like civic signage, sturdy and a little playful.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
// Body: Atkinson Hyperlegible Next, designed for legibility; council text has to work for every reader.
const atkinson = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-atkinson", display: "swap" });

export const metadata: Metadata = {
  title: { default: "AskKendal", template: "%s · AskKendal" },
  description: "What Westmorland and Furness Council and Kendal Town Council are deciding about Kendal, on a voxel model of the town.",
};

export const viewport: Viewport = {
  themeColor: "#f4f1e8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${archivo.variable} ${atkinson.variable}`}>
      <body>{children}</body>
    </html>
  );
}
