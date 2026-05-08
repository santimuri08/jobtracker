// frontend/src/app/layout.tsx
import type { Metadata } from "next"
import "./globals.css"
import AuthSessionProvider from "@/components/SessionProvider"

export const metadata: Metadata = {
  title: "JobTrackr",
  description: "Track your job applications",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </body>
    </html>
  )
}