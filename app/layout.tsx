import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Collective — Agent Evals",
  description:
    "Submit an agent, get it scored across cultural, ideological, and demographic perspectives.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-100 font-sans">
        <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="font-mono text-sm text-zinc-500">
                collective://
              </span>
              <span className="text-lg font-semibold">agent-evals</span>
            </Link>
            <nav className="flex items-center gap-6 text-sm">
              <Link href="/" className="hover:underline">
                Leaderboard
              </Link>
              <Link href="/submit" className="hover:underline">
                Submit
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
          {children}
        </main>
        <footer className="border-t border-zinc-200 dark:border-zinc-800 py-6 text-center text-xs text-zinc-500">
          AI Collective 2026 — evaluating agents across cultural, ideological,
          and demographic perspectives.
        </footer>
      </body>
    </html>
  );
}
