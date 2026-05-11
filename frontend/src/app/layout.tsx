// frontend/src/app/layout.tsx
import type { Metadata } from "next"
import "./globals.css"
import AuthSessionProvider from "@/components/SessionProvider"
import { TopNav } from "@/components/TopNav"

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
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AuthSessionProvider>
          <TopNav />
          {children}
        </AuthSessionProvider>
      </body>
    </html>
  )
}