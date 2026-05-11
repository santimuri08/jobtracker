// frontend/src/components/TopNav.tsx
"use client"

import Link from "next/link"
import { useSession, signOut } from "next-auth/react"
import { Wordmark } from "./Wordmark"

export function TopNav() {
  const { data: session, status } = useSession()
  const isAuthed = status === "authenticated"

  return (
    <nav className="w-full border-b border-[color:var(--border)] bg-[color:var(--bg)]/80 backdrop-blur-sm sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Wordmark />

        <div className="flex items-center gap-1">
          <Link
            href="/how-it-works"
            className="px-3 py-1.5 text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text)] transition-colors"
          >
            How it works
          </Link>

          {isAuthed ? (
            <>
              <Link
                href="/dashboard"
                className="px-3 py-1.5 text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text)] transition-colors"
              >
                Dashboard
              </Link>
              <span className="px-3 py-1.5 text-sm text-[color:var(--text-dim)] hidden md:inline">
                {session.user?.email}
              </span>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="ml-2 px-3 py-1.5 text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text)] border border-[color:var(--border-strong)] rounded-md hover:border-[color:var(--accent)] transition-colors"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="px-3 py-1.5 text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text)] transition-colors"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="ml-2 px-4 py-1.5 text-sm font-medium bg-[color:var(--accent)] hover:bg-[color:var(--accent-hover)] text-white rounded-md transition-colors"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}