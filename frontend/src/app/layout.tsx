// frontend/src/app/layout.tsx
import type { Metadata } from "next"
import { Geist, Inter } from "next/font/google"
import "./globals.css"
import AuthSessionProvider from "@/components/SessionProvider"
import { TopNav } from "@/components/TopNav"
import { AmbientBackground } from "@/components/AmbientBackground"

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
})

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

export const metadata: Metadata = {
  title: "JobAgent — Your AI job-search agent",
  description: "Track applications, write cover letters, and land your next role — just by chatting.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${inter.variable}`}>
      <body suppressHydrationWarning>
        <AuthSessionProvider>
          {/* Site-wide cinematic background. Fixed, behind everything, never
              intercepts pointer events. Mounted once here so every page picks
              it up automatically without per-page changes. */}
          <AmbientBackground />

          {/* App content sits in its own stacking context above the background.
              `relative` + `z-10` is enough to keep TopNav and pages on top. */}
          <div className="relative z-10">
            <TopNav />
            {children}
          </div>
        </AuthSessionProvider>
      </body>
    </html>
  )
}