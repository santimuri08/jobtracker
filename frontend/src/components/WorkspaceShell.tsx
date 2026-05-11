// frontend/src/components/WorkspaceShell.tsx
"use client"

import { useState, useEffect, ReactNode } from "react"
import { Menu } from "lucide-react"
import Link from "next/link"
import { WorkspaceSidebar } from "./WorkspaceSidebar"

type Props = {
  children: ReactNode
  /**
   * Optional title shown only in the MOBILE header. Desktop has no
   * top header — the sidebar carries identity and the page's own H1
   * carries the title, so an extra strip would just duplicate them.
   * Kept in props for backwards-compat; safe to omit.
   */
  title?: string
  /**
   * Optional right-aligned slot in the mobile header. Desktop ignores
   * this — put any per-page actions inside the page itself instead.
   */
  headerRight?: ReactNode
  onNewChat?: () => void
  onSelectChat?: (id: string) => void
}

const SIDEBAR_COLLAPSED_KEY = "jobagent.sidebar.collapsed"

/**
 * Workspace chrome (sidebar + content). No desktop header — that strip
 * was duplicating the page's H1 and the sidebar's identity for no
 * functional reason.
 *
 * Layout:
 *   ┌─────────┬───────────────────────────────────┐
 *   │ Sidebar │ (mobile only) ☰ + brand           │
 *   │         ├───────────────────────────────────┤
 *   │  ...    │ Page content (owns its own title) │
 *   └─────────┴───────────────────────────────────┘
 */
export function WorkspaceShell({
  children,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  title,
  headerRight,
  onNewChat,
  onSelectChat,
}: Props) {
  const [open, setOpen] = useState(false)         // mobile drawer
  const [collapsed, setCollapsed] = useState(false) // desktop collapse
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const v = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
      if (v === "1") setCollapsed(true)
    } catch {}
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0")
    } catch {}
  }, [collapsed, hydrated])

  return (
    <div className="ws-root">
      <WorkspaceSidebar
        open={open}
        onOpenChange={setOpen}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        onNewChat={onNewChat}
        onSelectChat={onSelectChat}
      />

      <div className="ws-main">
        {/* Mobile-only header — desktop has none on purpose */}
        <header className="ws-mobile-header md:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="ws-icon-btn"
          >
            <Menu size={18} strokeWidth={1.75} />
          </button>
          <Link href="/" className="ws-mobile-brand">
            <span className="logo-dot" />
            <span>JobAgent</span>
          </Link>
          {headerRight && (
            <div className="ml-auto flex items-center gap-1">
              {headerRight}
            </div>
          )}
        </header>

        <div className="ws-content">
          {children}
        </div>
      </div>
    </div>
  )
}