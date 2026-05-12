// frontend/src/components/WorkspaceSidebar.tsx
"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import {
  Plus,
  MessageSquare,
  LayoutDashboard,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeft,
  X,
  Trash2,
  LogOut,
} from "lucide-react"
import {
  listChats,
  listChatsAsync,
  deleteChatAsync,
  setCurrentChatId,
  getCurrentChatId,
  type SavedChat,
} from "@/lib/chatStorage"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  collapsed: boolean
  onCollapsedChange: (c: boolean) => void
  onSelectChat?: (id: string) => void
  onNewChat?: () => void
}

/**
 * Workspace sidebar — compact, ChatGPT-style.
 *
 * Desktop: 260px column. Can collapse to a 56px icon rail.
 * Mobile:  slide-over drawer (320px max) with scrim.
 *
 * Phase 4:
 *   • Chat list now comes from the server via listChatsAsync.
 *   • Initial paint uses the localStorage cache (instant) and gets
 *     replaced by server data when the fetch resolves.
 *   • Deletes go through the server, then update local state.
 *   • Refetches when other tabs update via the storage event, or
 *     when this tab dispatches `jobagent:chats-changed` (Chat.tsx
 *     fires that event after every save).
 */
export function WorkspaceSidebar({
  open,
  onOpenChange,
  collapsed,
  onCollapsedChange,
  onSelectChat,
  onNewChat,
}: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const { data: session, status } = useSession()
  const token = session?.backendToken

  const [chats, setChats] = useState<SavedChat[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  // ── Cache-first paint ─────────────────────────────────────────────
  // Paint whatever's in localStorage immediately so the sidebar isn't
  // blank during the first server fetch.
  useEffect(() => {
    setChats(listChats())
    setActiveId(getCurrentChatId())
  }, [])

  // ── Server fetch (the authoritative read) ─────────────────────────
  const refresh = useCallback(async () => {
    if (status !== "authenticated" || !token) return
    setLoading(true)
    try {
      const fresh = await listChatsAsync(token)
      setChats(fresh)
    } catch (e) {
      // listChatsAsync internally falls back to cache, so this
      // catch-block is only hit on truly unexpected errors. Cached
      // state is whatever was painted in the previous effect.
      console.warn("sidebar: chat list refresh failed", e)
    } finally {
      setLoading(false)
      setActiveId(getCurrentChatId())
    }
  }, [status, token])

  // Refresh on mount + whenever auth changes
  useEffect(() => { refresh() }, [refresh])

  // Refetch when something else in the app says chats changed
  useEffect(() => {
    function onChange() { refresh() }
    window.addEventListener("storage", onChange)
    window.addEventListener("jobagent:chats-changed", onChange)
    return () => {
      window.removeEventListener("storage", onChange)
      window.removeEventListener("jobagent:chats-changed", onChange)
    }
  }, [refresh])

  // Close mobile drawer on route change
  useEffect(() => { onOpenChange(false) }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes mobile drawer
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onOpenChange(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  function handleNew() {
    setCurrentChatId(null)
    onNewChat?.()
    if (pathname !== "/chat") router.push("/chat?new=1")
    onOpenChange(false)
  }

  function handleSelect(id: string) {
    setCurrentChatId(id)
    onSelectChat?.(id)
    setActiveId(id)
    if (pathname !== "/chat") router.push(`/chat?id=${id}`)
    onOpenChange(false)
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    e.preventDefault()
    if (!token) return

    // Optimistic UI: remove from list immediately, mark as deleting
    setDeletingIds((s) => new Set(s).add(id))
    setChats((cs) => cs.filter((c) => c.id !== id))
    if (activeId === id) onNewChat?.()

    try {
      await deleteChatAsync(token, id)
      window.dispatchEvent(new Event("jobagent:chats-changed"))
    } catch (err) {
      // Rollback on failure: re-fetch authoritative state
      console.warn("delete failed, re-syncing:", err)
      await refresh()
    } finally {
      setDeletingIds((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
    }
  }

  const isChatActive = pathname === "/chat"
  const isDashboardActive = pathname?.startsWith("/dashboard")
  const isSettingsActive = pathname?.startsWith("/settings")

  return (
    <>
      <div
        className={`ws-scrim md:hidden ${open ? "show" : ""}`}
        onClick={() => onOpenChange(false)}
        aria-hidden={!open}
      />

      <aside
        className={[
          "ws-sidebar",
          collapsed ? "is-collapsed" : "",
          open ? "is-open" : "",
        ].filter(Boolean).join(" ")}
        aria-label="Workspace navigation"
      >
        {/* ── Top bar ─────────────────────────────────────────── */}
        <div className="ws-sidebar-top">
          {!collapsed && (
            <Link
              href="/"
              className="ws-brand"
              aria-label="JobAgent home"
            >
              <span className="logo-dot" />
              <span className="ws-brand-text">JobAgent</span>
            </Link>
          )}
          {collapsed && (
            <Link href="/" className="ws-brand-collapsed" aria-label="JobAgent home">
              <span className="logo-dot" />
            </Link>
          )}

          {/* Desktop collapse toggle */}
          <button
            onClick={() => onCollapsedChange(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="ws-icon-btn hidden md:inline-flex"
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <PanelLeft size={15} strokeWidth={1.75} /> : <PanelLeftClose size={15} strokeWidth={1.75} />}
          </button>

          {/* Mobile close */}
          <button
            onClick={() => onOpenChange(false)}
            aria-label="Close menu"
            className="ws-icon-btn md:hidden"
          >
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>

        {/* ── New chat ─────────────────────────────────────────── */}
        <div className="ws-sidebar-section">
          <button
            type="button"
            onClick={handleNew}
            className="ws-item ws-item-primary"
            title="New chat"
          >
            <Plus size={16} strokeWidth={2} />
            {!collapsed && <span>New chat</span>}
          </button>
        </div>

        {/* ── Saved chats ──────────────────────────────────────── */}
        <div className="ws-sidebar-chats">
          {!collapsed && chats.length > 0 && (
            <div className="ws-section-label">
              Chats
              {loading && <span className="ws-section-loading"> · syncing…</span>}
            </div>
          )}
          {chats.length === 0 && !collapsed && !loading && (
            <div className="ws-empty-hint">
              Your chats will appear here.
            </div>
          )}
          {chats.length === 0 && !collapsed && loading && (
            <div className="ws-empty-hint">
              Loading…
            </div>
          )}
          <div className="ws-chat-list">
            {chats.map((c) => {
              const active = c.id === activeId && isChatActive
              const isDeleting = deletingIds.has(c.id)
              return (
                <div
                  key={c.id}
                  onClick={() => !isDeleting && handleSelect(c.id)}
                  onKeyDown={(e) => {
                    if (isDeleting) return
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      handleSelect(c.id)
                    }
                  }}
                  role="button"
                  tabIndex={isDeleting ? -1 : 0}
                  className={`ws-item ws-item-chat ${active ? "is-active" : ""} ${isDeleting ? "is-deleting" : ""}`}
                  title={c.title}
                  aria-busy={isDeleting}
                >
                  <MessageSquare size={15} strokeWidth={1.75} className="ws-item-icon" />
                  {!collapsed && (
                    <>
                      <span className="ws-item-label">{c.title}</span>
                      <button
                        onClick={(e) => handleDelete(e, c.id)}
                        aria-label="Delete chat"
                        className="ws-chat-delete"
                        disabled={isDeleting}
                      >
                        <Trash2 size={12} strokeWidth={1.75} />
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Footer nav ───────────────────────────────────────── */}
        <div className="ws-sidebar-footer">
          <Link
            href="/dashboard"
            className={`ws-item ${isDashboardActive ? "is-active" : ""}`}
            title="Dashboard"
          >
            <LayoutDashboard size={15} strokeWidth={1.75} className="ws-item-icon" />
            {!collapsed && <span className="ws-item-label">Dashboard</span>}
          </Link>
          <Link
            href="/settings"
            className={`ws-item ${isSettingsActive ? "is-active" : ""}`}
            title="Settings"
          >
            <SettingsIcon size={15} strokeWidth={1.75} className="ws-item-icon" />
            {!collapsed && <span className="ws-item-label">Settings</span>}
          </Link>

          {!collapsed && session?.user?.email && (
            <div className="ws-user">
              <span className="ws-user-avatar">
                {(session.user.email[0] || "?").toUpperCase()}
              </span>
              <span className="ws-user-email">{session.user.email}</span>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                aria-label="Sign out"
                className="ws-icon-btn"
                title="Sign out"
              >
                <LogOut size={14} strokeWidth={1.75} />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}