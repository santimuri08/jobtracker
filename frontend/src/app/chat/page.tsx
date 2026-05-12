// frontend/src/app/chat/page.tsx
"use client"

import { useEffect, useState, Suspense } from "react"
import { useSession } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { WorkspaceShell } from "@/components/WorkspaceShell"
import { Chat } from "@/components/Chat"
import {
  listChats,
  getChat,
  getChatAsync,
  listChatsAsync,
  setCurrentChatId,
  getCurrentChatId,
} from "@/lib/chatStorage"
import { isNotFound } from "@/lib/chatApi"

/**
 * /chat — the conversational workspace.
 *
 * Resolution order:
 *   1. Unauthenticated → /login
 *   2. ?id=X provided  → open chat X (verified async against server)
 *   3. ?q=... present  → seed a new conversation with that text
 *   4. ?new=1 present  → force a fresh chat
 *   5. Has saved chats → open the most recent one (server-verified)
 *   6. Nothing to show → redirect to / (landing)
 *
 * Cache-first paint: localStorage gives us a workspace to show in
 * <100ms. Server fetch then verifies — if the cache was stale (chat
 * deleted from another device, etc.), we redirect or replace. The
 * user never sees a blank screen during the fetch.
 */
function ChatPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { status, data: session } = useSession()
  const token = session?.backendToken

  // undefined = haven't decided yet
  // null      = explicit "new chat"
  // string    = open this specific chat id
  const [activeChatId, setActiveChatId] = useState<string | null | undefined>(undefined)
  const [initialInput, setInitialInput] = useState<string | undefined>(undefined)
  const [ready, setReady] = useState(false)

  // ── Auth guard ──────────────────────────────────────────────────────
  useEffect(() => {
    if (status === "unauthenticated") {
      const q = params.get("q")
      const from = q ? `/chat?q=${encodeURIComponent(q)}` : "/chat"
      router.replace(`/login?from=${encodeURIComponent(from)}`)
    }
  }, [status, router, params])

  // ── Resolve initial state from URL + cache (synchronous first paint) ─
  // We make a best-effort decision here from the cache so the workspace
  // can mount fast. The async effect below verifies against the server.
  useEffect(() => {
    if (status !== "authenticated") return

    const q = params.get("q")
    const id = params.get("id")
    const isNew = params.get("new") === "1"

    // 1. Explicit ?id= → set it immediately; server verify happens next
    if (id) {
      const cached = getChat(id)
      setCurrentChatId(id)
      setActiveChatId(id)
      // If we have it in cache, we can paint right away
      if (cached) setReady(true)
      // If not cached, we still set ready=false so the server fetch
      // below decides whether to paint or redirect
      return
    }

    // 2. ?q= seeds a new chat (no server interaction needed)
    if (q) {
      setActiveChatId(null)
      setInitialInput(q)
      setReady(true)
      return
    }

    // 3. ?new=1 starts fresh (no server interaction needed)
    if (isNew) {
      setCurrentChatId(null)
      setActiveChatId(null)
      setReady(true)
      return
    }

    // 4. Cache-first restore: paint the most recent cached chat
    const recent = listChats()
    const currentId = getCurrentChatId()
    const target =
      (currentId && recent.find((c) => c.id === currentId)) ||
      recent[0]

    if (target) {
      setCurrentChatId(target.id)
      setActiveChatId(target.id)
      setReady(true)
      return
    }

    // 5. No cache to restore from — wait for the async effect below
    // to consult the server before deciding.
  }, [status, params])

  // ── Async server verification ────────────────────────────────────────
  // Confirms that whatever we painted (or want to paint) actually exists
  // on the server. Three outcomes:
  //   • Server confirms id → workspace stays, fresh data flows in
  //   • Server returns 404 → cache was stale, redirect to /
  //   • Server returns chats list when no id was specified → pick most
  //     recent and open it
  useEffect(() => {
    if (status !== "authenticated" || !token) return

    let cancelled = false

    async function verify() {
      const q = params.get("q")
      const id = params.get("id")
      const isNew = params.get("new") === "1"

      // ?q= and ?new=1 don't need server verification — those start fresh
      if (q || isNew) return

      // ?id= → verify it exists on the server
      if (id) {
        try {
          const fresh = await getChatAsync(token!, id)
          if (cancelled) return
          if (fresh) {
            // Cache is now fresh; workspace already mounted on the cached
            // version (or will mount once ready=true). Mark ready in case
            // the cache miss path landed here.
            setReady(true)
            return
          }
          // 404 already handled inside getChatAsync (returns null and
          // drops cache); fall through to "nothing to show"
        } catch (e) {
          if (isNotFound(e)) {
            // Cache was stale and server confirms no such chat — redirect
            if (!cancelled) router.replace("/")
            return
          }
          // Network error: keep whatever we painted from cache
          console.warn("chat verify failed, keeping cached view:", e)
          if (!cancelled) setReady(true)
          return
        }
        // Server returned null — chat doesn't exist
        if (!cancelled) router.replace("/")
        return
      }

      // No id in URL → ask server for the chat list and open the most recent
      try {
        const serverChats = await listChatsAsync(token!)
        if (cancelled) return
        const currentId = getCurrentChatId()
        const target =
          (currentId && serverChats.find((c) => c.id === currentId)) ||
          serverChats[0]
        if (target) {
          setCurrentChatId(target.id)
          setActiveChatId(target.id)
          setReady(true)
        } else {
          // Server confirms: no chats anywhere → landing
          router.replace("/")
        }
      } catch (e) {
        console.warn("chat list verify failed:", e)
        // Fall back to whatever the cache-first paint decided
        if (!cancelled) setReady(true)
      }
    }

    verify()
    return () => { cancelled = true }
  }, [status, token, params, router])

  // ── Render ───────────────────────────────────────────────────────────
  if (status === "loading" || !ready) {
    return (
      <div className="workspace-boot">
        <div className="workspace-boot-dot" />
      </div>
    )
  }
  if (status === "unauthenticated") return null

  return (
    <WorkspaceShell
      onNewChat={() => {
        setActiveChatId(null)
        setInitialInput(undefined)
      }}
      onSelectChat={(id) => {
        setActiveChatId(id)
        setInitialInput(undefined)
      }}
    >
      <Chat
        activeChatId={activeChatId}
        initialInput={initialInput}
        onActiveChatChange={(id) => setActiveChatId(id)}
        autoSendOnMount={Boolean(initialInput)}
      />
    </WorkspaceShell>
  )
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="workspace-boot">
        <div className="workspace-boot-dot" />
      </div>
    }>
      <ChatPageInner />
    </Suspense>
  )
}