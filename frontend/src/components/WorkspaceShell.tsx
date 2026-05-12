// frontend/src/components/WorkspaceShell.tsx
"use client"

import { useState, useEffect, ReactNode } from "react"
import { useSession } from "next-auth/react"
import { WorkspaceSidebar } from "./WorkspaceSidebar"
import { migrateLocalStorageIfNeeded } from "@/lib/chatStorage"

type Props = {
  children: ReactNode
  /**
   * Kept in props for backwards-compat with existing call sites that
   * still pass `title` / `headerRight` — both are now ignored. The
   * workspace has no header strip; pages own their own H1.
   */
  title?: string
  headerRight?: ReactNode
  onNewChat?: () => void
  onSelectChat?: (id: string) => void
}

const SIDEBAR_COLLAPSED_KEY = "jobagent.sidebar.collapsed"

/**
 * Workspace chrome — sidebar + content. No header strip on any viewport.
 *
 * Layout:
 *   ┌─────────┬────────────────────────────────────┐
 *   │ Sidebar │                                    │
 *   │         │   Page content (owns its own H1)   │
 *   │  ...    │                                    │
 *   └─────────┴────────────────────────────────────┘
 *
 * Phase 4: also hosts the one-time localStorage → server migration.
 * Internally idempotent — short-circuits if already done.
 */
export function WorkspaceShell({
  children,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  title,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  headerRight,
  onNewChat,
  onSelectChat,
}: Props) {
  const { data: session, status } = useSession()
  const [open, setOpen] = useState(false)         // sidebar drawer state (mobile only)
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

  // Phase 4: one-shot localStorage → server migration.
  useEffect(() => {
    if (status !== "authenticated") return
    const token = session?.backendToken
    if (!token) return
    migrateLocalStorageIfNeeded(token).catch((e) => {
      console.debug("chat migration deferred:", e)
    })
  }, [status, session])

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
        <div className="ws-content">
          {children}
        </div>
      </div>
    </div>
  )
}