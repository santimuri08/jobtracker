// frontend/src/app/layout.tsx
import type { Metadata } from "next"
import { Geist, Inter } from "next/font/google"
import "./globals.css"
import AuthSessionProvider from "@/components/SessionProvider"
import { ChromeShell } from "@/components/ChromeShell"

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
  description:
    "An AI-native operating system for job search management. Track, draft, and land — by chatting.",
  viewport:
    "width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=5",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geist.variable} ${inter.variable}`}
    >
      <body suppressHydrationWarning>
        <AuthSessionProvider>
          {/* ChromeShell decides whether to show the marketing TopNav +
              AmbientBackground based on the current route. The workspace
              routes (/chat, /settings, /applications/*, /resumes/*) own
              their own chrome and skip this. */}
          <ChromeShell>{children}</ChromeShell>
        </AuthSessionProvider>
      </body>
    </html>
  )
}