// frontend/src/components/TopNav.tsx
"use client"

import Link from "next/link"
import { useSession, signOut } from "next-auth/react"
import { useEffect, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { Menu, X, ArrowRight, MessageSquare, LayoutDashboard, Sparkles, LogIn, UserPlus, Home as HomeIcon } from "lucide-react"
import { Wordmark } from "./Wordmark"

/**
 * TopNav — minimal floating glass pill.
 *
 * Authenticated:   [logo]                              [email] [sign out] [menu]
 * Unauthenticated: [logo]                                       [sign up] [menu]
 *
 * All section navigation (Chat, Dashboard, How JobAgent Works) lives in the
 * hamburger overlay menu. The bar itself stays lightweight and intentional.
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

  return (
    <>
      {/* Spacer matching the floating nav's reserved height */}
      <div className="h-24" aria-hidden="true" />

      <nav
        className={`
          fixed left-1/2 -translate-x-1/2 z-50
          transition-all duration-500
          ${scrolled
            ? "top-3 w-[calc(100%-2rem)] max-w-3xl"
            : "top-5 w-[calc(100%-2rem)] max-w-5xl"}
        `}
        style={{ transitionTimingFunction: "var(--ease)" }}
      >
        <div
          className={`
            relative flex items-center justify-between
            border border-[color:var(--silver-rim)]
            transition-all duration-500
            ${scrolled
              ? "px-5 py-2 bg-[color:var(--bg)]/65 backdrop-blur-2xl"
              : "px-7 py-3 bg-[color:var(--bg)]/40 backdrop-blur-xl"}
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

          {/* Right side — minimal: email + sign-out (auth) OR sign-up (anon) + menu */}
          <div className="flex items-center gap-3">
            {isAuthed ? (
              <>
                <span className="hidden lg:inline text-xs text-[color:var(--text-dim)] max-w-[180px] truncate">
                  {session.user?.email}
                </span>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="hidden md:inline-flex items-center px-4 py-2 text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text)] border border-[color:var(--border-strong)] hover:border-[color:var(--accent)] transition-colors"
                  style={{ borderRadius: "var(--radius-md)" }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link
                href="/signup"
                className="hidden md:inline-flex items-center px-5 py-2 text-sm font-medium bg-[color:var(--accent)] hover:bg-[color:var(--accent-hover)] text-white transition-colors"
                style={{ borderRadius: "var(--radius-md)" }}
              >
                Sign up
              </Link>
            )}

            <button
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              className="flex items-center justify-center w-10 h-10 text-[color:var(--text-muted)] hover:text-[color:var(--accent)] border border-[color:var(--border-strong)] hover:border-[color:var(--accent)] transition-all"
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
          email={session?.user?.email ?? null}
        />,
        document.body
      )}
    </>
  )
}

/* ============================================================
   FullscreenMenu — primary navigation surface
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
  // Three primary destinations for authed users.
  // The brief specifies these three items exactly.
  const authedItems: MenuItem[] = [
    {
      href: "/",
      label: "Chat",
      description: "Talk to your AI job-search agent",
      Icon: MessageSquare,
    },
    {
      href: "/dashboard",
      label: "Dashboard",
      description: "Track applications and progress",
      Icon: LayoutDashboard,
    },
    {
      href: "/inside",
      label: "How JobAgent Works",
      description: "See how the AI system works",
      Icon: Sparkles,
    },
  ]

  // For unauthed visitors, the menu doubles as the auth surface.
  const anonItems: MenuItem[] = [
    {
      href: "/",
      label: "Home",
      description: "Meet JobAgent",
      Icon: HomeIcon,
    },
    {
      href: "/inside",
      label: "How JobAgent Works",
      description: "See how the AI system works",
      Icon: Sparkles,
    },
    {
      href: "/login",
      label: "Log in",
      description: "Welcome back",
      Icon: LogIn,
    },
    {
      href: "/signup",
      label: "Sign up",
      description: "Start tracking — it's free",
      Icon: UserPlus,
    },
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
      {/* Backdrop with heavy blur — slightly dimming/blurring the page */}
      <div
        onClick={onClose}
        className={`
          absolute inset-0 bg-[color:var(--bg)]/80 backdrop-blur-2xl
          transition-opacity duration-500
          ${open ? "opacity-100" : "opacity-0"}
        `}
      />

      {/* Ambient bloom — sets the lit-panel feel */}
      <div
        aria-hidden
        className={`
          absolute inset-0 pointer-events-none
          transition-opacity duration-700
          ${open ? "opacity-100" : "opacity-0"}
        `}
        style={{
          background:
            "radial-gradient(ellipse 50% 50% at 50% 40%, var(--accent-glow), transparent 70%)",
        }}
      />

      {/* Top + bottom edge accent lines that slide in */}
      <div
        aria-hidden
        className={`
          absolute top-0 left-1/2 -translate-x-1/2 h-px transition-all duration-700
          ${open ? "w-[80vw] opacity-100" : "w-0 opacity-0"}
        `}
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%)",
          transitionDelay: open ? "200ms" : "0ms",
          transitionTimingFunction: "var(--ease)",
        }}
      />
      <div
        aria-hidden
        className={`
          absolute bottom-0 left-1/2 -translate-x-1/2 h-px transition-all duration-700
          ${open ? "w-[80vw] opacity-100" : "w-0 opacity-0"}
        `}
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(221,227,235,0.45) 50%, transparent 100%)",
          transitionDelay: open ? "300ms" : "0ms",
          transitionTimingFunction: "var(--ease)",
        }}
      />

      {/* Content frame */}
      <div
        className={`
          relative h-full flex flex-col
          transition-all duration-700
          ${open ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}
        `}
        style={{ transitionTimingFunction: "var(--ease)" }}
      >
        {/* Top bar of the overlay — brand + close */}
        <div className="flex-shrink-0 px-8 py-6 flex items-center justify-between">
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

        {/* Menu items — staggered reveal */}
        <div className="flex-1 flex items-center justify-center px-6 md:px-8">
          <ul className="w-full max-w-3xl space-y-4">
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

        {/* Footer — identity + sign-out (authed) */}
        <div
          className="flex-shrink-0 px-8 py-6 flex items-center justify-between gap-4 flex-wrap"
          style={{
            transitionDelay: open ? `${300 + items.length * 80 + 100}ms` : "0ms",
            transitionTimingFunction: "var(--ease)",
            opacity: open ? 1 : 0,
            transform: open ? "translateY(0)" : "translateY(6px)",
            transitionProperty: "opacity, transform",
            transitionDuration: "700ms",
          }}
        >
          <div className="text-xs text-[color:var(--text-dim)]">
            {isAuthed && email ? (
              <>Signed in as <span className="text-[color:var(--text-muted)]">{email}</span></>
            ) : (
              "JobAgent — your AI job-search agent"
            )}
          </div>
          {isAuthed && (
            <button
              onClick={() => { onClose(); signOut({ callbackUrl: "/" }) }}
              className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--accent)] underline-offset-4 hover:underline transition-colors"
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   MenuLink — one card per menu item
   • Lucide icon left, label + description center, ArrowRight right
   • Hover: border accent, icon turns accent, accent-soft glow ring,
     arrow nudges right, very faint surface lift
   ============================================================ */

function MenuLink({ item, onClick }: { item: MenuItem; onClick: () => void }) {
  const Icon = item.Icon
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className="
        group block px-6 py-5
        border border-[color:var(--border)]
        bg-[color:var(--bg-elevated)]/40 backdrop-blur-md
        hover:border-[color:var(--accent)]
        hover:bg-[color:var(--bg-elevated)]/70
        transition-all duration-500
      "
      style={{
        borderRadius: "var(--radius-lg)",
        transitionTimingFunction: "var(--ease)",
      }}
    >
      <div className="flex items-center justify-between gap-5">
        {/* Icon tile */}
        <div
          className="
            flex-shrink-0 flex items-center justify-center w-12 h-12
            border border-[color:var(--border)]
            bg-[color:var(--bg-hover)]/60
            text-[color:var(--text-muted)]
            group-hover:text-[color:var(--accent)]
            group-hover:border-[color:var(--accent)]
            transition-all duration-500
          "
          style={{
            borderRadius: "var(--radius-md)",
            transitionTimingFunction: "var(--ease)",
          }}
        >
          <Icon size={20} strokeWidth={1.5} />
        </div>

        {/* Label + description */}
        <div className="flex-1 min-w-0">
          <div className="font-display text-xl md:text-2xl font-semibold tracking-tight text-[color:var(--text)] group-hover:text-[color:var(--accent)] transition-colors duration-500">
            {item.label}
          </div>
          <div className="text-sm text-[color:var(--text-muted)] mt-1">
            {item.description}
          </div>
        </div>

        {/* Trailing arrow */}
        <div
          className="
            flex-shrink-0 flex items-center justify-center w-10 h-10
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
      </div>
    </Link>
  )
}