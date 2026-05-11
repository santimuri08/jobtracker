// frontend/src/components/TopNav.tsx
"use client"

import Link from "next/link"
import { useSession, signOut } from "next-auth/react"
import { useEffect, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import {
  Menu,
  X,
  ArrowRight,
  MessageSquare,
  LayoutDashboard,
  Sparkles,
  LogIn,
  LogOut,
  Home as HomeIcon,
  Settings as SettingsIcon,
} from "lucide-react"
import { Wordmark } from "./Wordmark"

/**
 * TopNav — marketing-only floating glass pill.
 *
 *   AUTHENTICATED:
 *     [• JobAgent]  …  [• email] [Sign out]  [☰]
 *
 *   ANONYMOUS:
 *     [• JobAgent]  …  [Sign in]             [☰]
 *
 * The hamburger always opens a fullscreen menu with the page links
 * (Chat / Dashboard / Settings / How JobAgent Works).
 *
 * Rendered ONLY on marketing routes (/, /inside, /how-it-works,
 * /login, /signup). Workspace routes own their own chrome via
 * WorkspaceShell — see ChromeShell.tsx for routing logic.
 */
export function TopNav() {
  const { data: session, status } = useSession()
  const isAuthed = status === "authenticated"

  const [scrolled, setScrolled] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    setMounted(true)
    let ticking = false
    function onScroll() {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        setScrolled(window.scrollY > 24)
        ticking = false
      })
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [menuOpen])

  const closeMenu = useCallback(() => setMenuOpen(false), [])

  const email = session?.user?.email ?? null
  const emailInitial = email ? email[0]!.toUpperCase() : "?"

  return (
    <>
      {/* Spacer matching the floating nav's reserved height */}
      <div className="h-24" aria-hidden="true" />

      <nav
        className={`
          fixed left-1/2 -translate-x-1/2 z-50
          transition-all duration-500
          ${scrolled
            ? "top-3 w-[calc(100%-1.5rem)] max-w-3xl"
            : "top-5 w-[calc(100%-1.5rem)] max-w-5xl"}
        `}
        style={{ transitionTimingFunction: "var(--ease)" }}
      >
        <div
          className={`
            relative flex items-center justify-between gap-3
            border border-[color:var(--silver-rim)]
            transition-all duration-500
            ${scrolled
              ? "px-3 md:px-4 py-2 bg-[color:var(--bg)]/65 backdrop-blur-2xl"
              : "px-4 md:px-5 py-2.5 md:py-3 bg-[color:var(--bg)]/40 backdrop-blur-xl"}
          `}
          style={{
            borderRadius: "var(--radius-lg)",
            boxShadow: scrolled
              ? "0 1px 0 0 rgba(255,255,255,0.10) inset, 0 12px 36px -16px rgba(0,0,0,0.6), 0 0 0 1px rgba(59,130,246,0.04)"
              : "0 1px 0 0 rgba(255,255,255,0.06) inset, 0 8px 24px -16px rgba(0,0,0,0.4)",
            transitionTimingFunction: "var(--ease)",
          }}
        >
          {/* Subtle top-edge highlight strip */}
          <div
            aria-hidden
            className="absolute inset-x-6 top-0 h-px pointer-events-none"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.18) 50%, transparent 100%)",
            }}
          />

          <Wordmark />

          {/* Right side */}
          <div className="flex items-center gap-1.5 md:gap-2">
            {isAuthed ? (
              <>
                {/* Email pill (desktop only — mobile just shows avatar dot) */}
                <div
                  className="
                    hidden md:inline-flex items-center gap-2 px-2.5 py-1.5
                    border border-[color:var(--border-strong)]
                  "
                  style={{ borderRadius: "var(--radius-md)" }}
                  title={email ?? undefined}
                >
                  <span
                    className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold"
                    style={{
                      background: "var(--accent-soft)",
                      color: "var(--accent)",
                      border: "1px solid var(--accent-rim)",
                    }}
                  >
                    {emailInitial}
                  </span>
                  <span className="text-xs text-[color:var(--text-muted)] max-w-[180px] truncate">
                    {email}
                  </span>
                </div>

                {/* Sign out (desktop) */}
                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="
                    hidden md:inline-flex items-center gap-1.5 px-3 py-1.5
                    text-xs font-medium
                    text-[color:var(--text-muted)]
                    border border-[color:var(--border-strong)]
                    hover:text-[color:var(--text)] hover:border-[color:var(--accent)]
                    transition-colors
                  "
                  style={{ borderRadius: "var(--radius-md)" }}
                >
                  <LogOut size={13} strokeWidth={1.75} />
                  Sign out
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="
                  hidden md:inline-flex items-center gap-2 px-4 md:px-5 py-2
                  text-sm font-medium
                  bg-[color:var(--accent)] hover:bg-[color:var(--accent-hover)]
                  text-white transition-colors
                "
                style={{ borderRadius: "var(--radius-md)" }}
              >
                <LogIn size={14} strokeWidth={2} />
                Sign in
              </Link>
            )}

            {/* Hamburger — always present. Opens the fullscreen menu with
                Chat / Dashboard / Settings / How JobAgent Works. */}
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              className="
                flex items-center justify-center w-10 h-10
                text-[color:var(--text-muted)]
                hover:text-[color:var(--accent)]
                border border-[color:var(--border-strong)]
                hover:border-[color:var(--accent)]
                transition-all
              "
              style={{ borderRadius: "var(--radius-md)" }}
            >
              <Menu size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </nav>

      {mounted && createPortal(
        <FullscreenMenu
          open={menuOpen}
          onClose={closeMenu}
          isAuthed={isAuthed}
          email={email}
        />,
        document.body
      )}
    </>
  )
}

/* ============================================================
   FullscreenMenu — items shown when the hamburger is tapped
   ============================================================ */

type MenuItem = {
  href: string
  label: string
  description: string
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
}

function FullscreenMenu({
  open,
  onClose,
  isAuthed,
  email,
}: {
  open: boolean
  onClose: () => void
  isAuthed: boolean
  email: string | null
}) {
  const authedItems: MenuItem[] = [
    { href: "/chat",      label: "Chat",      description: "Your AI workspace",       Icon: MessageSquare },
    { href: "/dashboard", label: "Dashboard", description: "Track applications",      Icon: LayoutDashboard },
    { href: "/settings",  label: "Settings",  description: "Account and preferences", Icon: SettingsIcon },
    { href: "/inside",    label: "How JobAgent Works", description: "See how the AI system works", Icon: Sparkles },
  ]

  const anonItems: MenuItem[] = [
    { href: "/",       label: "Home",                description: "Meet JobAgent",                Icon: HomeIcon },
    { href: "/inside", label: "How JobAgent Works",  description: "See how the AI system works",  Icon: Sparkles },
    { href: "/login",  label: "Sign in",             description: "Welcome back",                 Icon: LogIn },
  ]

  const items = isAuthed ? authedItems : anonItems

  return (
    <div
      aria-hidden={!open}
      role="dialog"
      aria-modal="true"
      aria-label="Main navigation"
      className={`
        fixed inset-0 z-[70]
        transition-opacity duration-500
        ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
      `}
      style={{ transitionTimingFunction: "var(--ease)" }}
    >
      <div
        onClick={onClose}
        className={`
          absolute inset-0 bg-[color:var(--bg)]/80 backdrop-blur-2xl
          transition-opacity duration-500
          ${open ? "opacity-100" : "opacity-0"}
        `}
      />

      <div
        aria-hidden
        className={`
          absolute inset-0 pointer-events-none
          transition-opacity duration-700
          ${open ? "opacity-100" : "opacity-0"}
        `}
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 30%, var(--accent-glow), transparent 60%)",
        }}
      />

      <div
        className={`
          relative h-full flex flex-col
          transition-all duration-700
          ${open ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}
        `}
        style={{ transitionTimingFunction: "var(--ease)" }}
      >
        <div className="flex-shrink-0 px-6 md:px-8 py-5 md:py-6 flex items-center justify-between">
          <Wordmark />
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="flex items-center gap-2 px-4 py-2 text-sm text-[color:var(--text-muted)] border border-[color:var(--border-strong)] hover:border-[color:var(--accent)] hover:text-[color:var(--text)] transition-colors"
            style={{ borderRadius: "var(--radius-md)" }}
          >
            <span className="hidden sm:inline">Close</span>
            <kbd
              className="hidden sm:inline-flex items-center text-[10px] px-1.5 py-0.5 border border-[color:var(--border)] text-[color:var(--text-dim)]"
              style={{ borderRadius: "var(--radius-xs)" }}
            >
              Esc
            </kbd>
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center px-5 md:px-8">
          <ul className="w-full max-w-3xl space-y-3 md:space-y-4">
            {items.map((item, i) => (
              <li
                key={item.href}
                className={`
                  transition-all duration-700
                  ${open ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}
                `}
                style={{
                  transitionDelay: open ? `${300 + i * 80}ms` : "0ms",
                  transitionTimingFunction: "var(--ease)",
                }}
              >
                <MenuLink item={item} onClick={onClose} />
              </li>
            ))}
          </ul>
        </div>

        <div
          className="flex-shrink-0 px-6 md:px-8 py-5 md:py-6 flex items-center justify-between gap-4 flex-wrap"
          style={{
            transitionDelay: open ? `${300 + items.length * 80 + 100}ms` : "0ms",
            transitionTimingFunction: "var(--ease)",
            opacity: open ? 1 : 0,
            transform: open ? "translateY(0)" : "translateY(6px)",
            transitionProperty: "opacity, transform",
            transitionDuration: "700ms",
          }}
        >
          <div className="text-xs text-[color:var(--text-dim)] truncate min-w-0">
            {isAuthed && email ? email : "Welcome to JobAgent"}
          </div>
          {isAuthed && (
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text)] transition-colors inline-flex items-center gap-1.5 flex-shrink-0"
            >
              <LogOut size={12} strokeWidth={1.75} />
              Sign out
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function MenuLink({ item, onClick }: { item: MenuItem; onClick: () => void }) {
  const { Icon } = item
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className="
        group flex items-center gap-4 md:gap-6 px-4 md:px-6 py-4 md:py-5
        border border-transparent
        hover:border-[color:var(--accent)]
        hover:bg-[color:var(--bg-elevated)]/50
        backdrop-blur-md
        transition-all duration-500
      "
      style={{ borderRadius: "var(--radius-md)", transitionTimingFunction: "var(--ease)" }}
    >
      <div
        className="
          flex-shrink-0 flex items-center justify-center w-10 h-10 md:w-12 md:h-12
          border border-[color:var(--border-strong)]
          text-[color:var(--text-muted)]
          group-hover:text-[color:var(--accent)]
          group-hover:border-[color:var(--accent)]
          transition-all duration-500
        "
        style={{ borderRadius: "var(--radius-sm)" }}
      >
        <Icon size={18} strokeWidth={1.75} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-display text-lg md:text-2xl font-semibold tracking-tight text-[color:var(--text)] group-hover:text-[color:var(--accent)] transition-colors duration-500">
          {item.label}
        </div>
        <div className="text-xs md:text-sm text-[color:var(--text-muted)] mt-1">
          {item.description}
        </div>
      </div>

      <div
        className="
          flex-shrink-0 flex items-center justify-center w-9 h-9 md:w-10 md:h-10
          text-[color:var(--text-dim)]
          group-hover:text-[color:var(--accent)]
          border border-[color:var(--border-strong)]
          group-hover:border-[color:var(--accent)]
          transition-all duration-500
          group-hover:translate-x-1
        "
        style={{
          borderRadius: "var(--radius-sm)",
          transitionTimingFunction: "var(--ease)",
        }}
      >
        <ArrowRight size={14} strokeWidth={1.75} />
      </div>
    </Link>
  )
}