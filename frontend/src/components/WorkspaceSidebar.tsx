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
  deleteChat,
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
 * Items: New chat, then a scrollable list of Saved Chats, then a fixed
 * footer with Dashboard, Settings, and the user's email + sign-out icon.
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
  const { data: session } = useSession()

  const [chats, setChats] = useState<SavedChat[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setChats(listChats())
    setActiveId(getCurrentChatId())
  }, [])

  useEffect(() => {
    refresh()
    function onStorage() { refresh() }
    window.addEventListener("storage", onStorage)
    window.addEventListener("jobagent:chats-changed", onStorage)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("jobagent:chats-changed", onStorage)
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

  function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    e.preventDefault()
    deleteChat(id)
    refresh()
    if (activeId === id) onNewChat?.()
    window.dispatchEvent(new Event("jobagent:chats-changed"))
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
            <div className="ws-section-label">Chats</div>
          )}
          {chats.length === 0 && !collapsed && (
            <div className="ws-empty-hint">
              Your chats will appear here.
            </div>
          )}
          <div className="ws-chat-list">
            {chats.map((c) => {
              const active = c.id === activeId && isChatActive
              return (
                <div
                  key={c.id}
                  onClick={() => handleSelect(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      handleSelect(c.id)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className={`ws-item ws-item-chat ${active ? "is-active" : ""}`}
                  title={c.title}
                >
                  <MessageSquare size={15} strokeWidth={1.75} className="ws-item-icon" />
                  {!collapsed && (
                    <>
                      <span className="ws-item-label">{c.title}</span>
                      <button
                        onClick={(e) => handleDelete(e, c.id)}
                        aria-label="Delete chat"
                        className="ws-chat-delete"
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
            <LayoutDashboard size={16} strokeWidth={1.75} className="ws-item-icon" />
            {!collapsed && <span className="ws-item-label">Dashboard</span>}
          </Link>
          <Link
            href="/settings"
            className={`ws-item ${isSettingsActive ? "is-active" : ""}`}
            title="Settings"
          >
            <SettingsIcon size={16} strokeWidth={1.75} className="ws-item-icon" />
            {!collapsed && <span className="ws-item-label">Settings</span>}
          </Link>

          {/* Identity */}
          {!collapsed && session?.user?.email && (
            <div className="ws-user">
              <div className="ws-user-avatar">
                {(session.user.email[0] ?? "?").toUpperCase()}
              </div>
              <div className="ws-user-email">{session.user.email}</div>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                aria-label="Sign out"
                className="ws-icon-btn"
                title="Sign out"
              >
                <LogOut size={13} strokeWidth={1.75} />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}