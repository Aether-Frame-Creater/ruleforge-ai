import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RuleForge AI",
  description:
    "Multi-agent regulatory compliance: read circulars, draft rule changes, backtest them, approve them.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/*
          Applies the stored theme before first paint. Inline and synchronous on
          purpose: a React effect would run after the first frame, which is long
          enough to flash a white screen at someone using dark mode.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("ruleforge-theme");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;if(t==="dark"||(!t&&d))document.documentElement.classList.add("dark");}catch(e){}})();`,
          }}
        />
      </head>
      <body className="bg-background text-foreground min-h-full">
        {children}
        <Toaster richColors closeButton position="top-right" />
      </body>
    </html>
  );
}
