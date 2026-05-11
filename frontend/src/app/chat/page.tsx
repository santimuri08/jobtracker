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
  setCurrentChatId,
  getCurrentChatId,
} from "@/lib/chatStorage"

/**
 * /chat — the conversational workspace.
 *
 * GUARDS (in order):
 *   1. Unauthenticated → /login
 *   2. ?id=X provided  → open chat X (or fall through if missing)
 *   3. ?q=...   present → seed a new conversation
 *   4. ?new=1   present → force a fresh chat
 *   5. Has saved chats  → open the most recent one
 *   6. Nothing to show  → redirect to / (landing)
 *
 * Rule 6 is the key fix: we never mount an empty workspace. If the user
 * arrives at /chat with no history and no prompt, the landing page is the
 * correct surface.
 */
function ChatPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { status } = useSession()

  // undefined = haven't decided yet, null = explicit "new chat",
  // string = open this specific chat id
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

  // ── Resolve initial state from URL + storage ────────────────────────
  useEffect(() => {
    if (status !== "authenticated") return

    const q = params.get("q")
    const id = params.get("id")
    const isNew = params.get("new") === "1"

    // 1. Explicit ?id= takes priority
    if (id) {
      const saved = getChat(id)
      if (saved) {
        setCurrentChatId(id)
        setActiveChatId(id)
        setReady(true)
        return
      }
      // Stale id — fall through to other rules
    }

    // 2. ?q= seeds a new chat
    if (q) {
      setActiveChatId(null)
      setInitialInput(q)
      setReady(true)
      return
    }

    // 3. ?new=1 starts fresh
    if (isNew) {
      setCurrentChatId(null)
      setActiveChatId(null)
      setReady(true)
      return
    }

    // 4. Otherwise restore the most recent chat
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

    // 5. Nothing to show — bounce to landing.
    router.replace("/")
  }, [status, params, router])

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