import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@visual/tokens.css";
import "./globals.css";
import { ToastProvider } from "@/components/advanced/toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cyber Sleuth",
  description: "Cyber Sleuth: a consent-based, fictional practice simulator for spotting customer scams.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
