// frontend/src/components/Chat.tsx
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import {
  sendToAgent,
  extractText,
  extractToolCalls,
  type ChatMessage,
} from "@/lib/agent"
import {
  saveChat,
  getChat,
  setCurrentChatId,
  makeChatId,
} from "@/lib/chatStorage"
import { ChatInput } from "./ChatInput"

type Props = {
  /** Optional text to pre-fill (used by suggestion chips). */
  initialInput?: string
  /** Imperatively switch the active chat. null = new chat. */
  activeChatId?: string | null
  onActiveChatChange?: (id: string | null) => void
  /**
   * If true, the initialInput is sent automatically on mount.
   * Used by /chat?q= to make the landing page → workspace transition
   * feel like one continuous action.
   */
  autoSendOnMount?: boolean
}

const TOOL_LABELS: Record<string, string> = {
  add_application: "Adding application",
  list_applications: "Looking up your applications",
  pipeline_summary: "Checking your pipeline",
  update_application: "Updating application",
  delete_application: "Deleting application",
  run_gap_analysis: "Running gap analysis",
  generate_cover_letter: "Drafting cover letter",
  find_similar: "Finding similar roles",
  rewrite_bullet: "Rewriting bullet",
}

/**
 * The conversation surface.
 *
 * This component assumes its parent (WorkspaceShell) provides the
 * sidebar + outer chrome. It paints:
 *   • a scrollable message stream
 *   • the persistent bottom input
 *
 * Empty state is intentionally NOT handled here — by the time this
 * component mounts, /chat has already guaranteed there's either a
 * saved chat to restore or a fresh prompt to send. If you somehow
 * reach an empty state, you'll see a quiet placeholder and the input
 * still works.
 */
export function Chat({
  initialInput,
  activeChatId,
  onActiveChatChange,
  autoSendOnMount = false,
}: Props) {
  const { data: session, status } = useSession()
  const isAuthed = status === "authenticated"

  const [chatId, setChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [hydrated, setHydrated] = useState(false)
  const autoSentRef = useRef(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // ── Hydrate from activeChatId ────────────────────────────────────────
  useEffect(() => {
    if (activeChatId === undefined) {
      setHydrated(true)
      return
    }
    if (activeChatId === null) {
      setChatId(null)
      setMessages([])
      autoSentRef.current = false
      setHydrated(true)
      return
    }
    const saved = getChat(activeChatId)
    if (saved) {
      setChatId(saved.id)
      setMessages(saved.messages)
      autoSentRef.current = true // existing chat — don't auto-send
    } else {
      setChatId(null)
      setMessages([])
    }
    setHydrated(true)
  }, [activeChatId])

  // ── Pre-fill the input from initialInput ─────────────────────────────
  useEffect(() => {
    if (initialInput !== undefined) setInput(initialInput)
  }, [initialInput])

  // ── Persist on every message change ──────────────────────────────────
  useEffect(() => {
    if (!hydrated) return
    if (messages.length === 0) return
    const id = chatId ?? makeChatId()
    if (!chatId) {
      setChatId(id)
      setCurrentChatId(id)
      onActiveChatChange?.(id)
    }
    saveChat(id, messages)
    window.dispatchEvent(new Event("jobagent:chats-changed"))
  }, [messages, chatId, hydrated, onActiveChatChange])

  // ── Auto-scroll to bottom on new messages ────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, sending])

  // ── Send ─────────────────────────────────────────────────────────────
  const handleSend = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? input).trim()
      if (!text || sending) return
      if (!isAuthed || !session?.backendToken) {
        window.location.href = "/signup"
        return
      }

      setError("")
      setInput("")
      const userTurn: ChatMessage = { role: "user", content: text }
      const next = [...messages, userTurn]
      setMessages(next)
      setSending(true)

      try {
        const result = await sendToAgent(next, session.backendToken)
        setMessages(result.messages)
      } catch (e) {
        setError((e as Error).message)
        setInput(text)
      } finally {
        setSending(false)
      }
    },
    [input, sending, isAuthed, session, messages],
  )

  // ── Auto-send on mount when ?q= was passed ───────────────────────────
  useEffect(() => {
    if (!hydrated) return
    if (!autoSendOnMount) return
    if (autoSentRef.current) return
    if (!isAuthed || !session?.backendToken) return
    if (!initialInput || !initialInput.trim()) return
    if (messages.length > 0) return
    autoSentRef.current = true
    // Fire and forget — handleSend reads from input state which we just set
    handleSend(initialInput)
  }, [hydrated, autoSendOnMount, isAuthed, session, initialInput, messages.length, handleSend])

  const handleRetry = useCallback(async () => {
    if (!session?.backendToken) return
    setError("")
    setSending(true)
    try {
      const result = await sendToAgent(messages, session.backendToken)
      setMessages(result.messages)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }, [messages, session])

  // ── Pair tool results back to their tool_use ids ─────────────────────
  const pairedToolResults = useMemo(() => {
    const map = new Map<string, unknown>()
    for (const m of messages) {
      if (m.role !== "user" || typeof m.content === "string") continue
      for (const block of m.content) {
        if (block.type === "tool_result") {
          try { map.set(block.tool_use_id, JSON.parse(block.content)) }
          catch { map.set(block.tool_use_id, block.content) }
        }
      }
    }
    return map
  }, [messages])

  // Filter out user turns that consist ENTIRELY of tool_result blocks
  const visibleMessages = useMemo(() => {
    return messages.filter((m) => {
      if (typeof m.content === "string") return true
      if (m.role !== "user") return true
      return m.content.some((b) => b.type !== "tool_result")
    })
  }, [messages])

  return (
    <>
      <div ref={scrollRef} className="chat-stream">
        <div className="chat-stream-inner">
          {visibleMessages.length === 0 && sending && (
            <ThinkingRow />
          )}

          {visibleMessages.map((m, i) => (
            <MessageRow
              key={i}
              message={m}
              toolResults={pairedToolResults}
            />
          ))}

          {sending && visibleMessages.length > 0 && <ThinkingRow />}

          {error && (
            <div className="chat-error">
              <span>{error}</span>
              {messages.length > 0 && messages[messages.length - 1]?.role === "user" && (
                <button
                  onClick={handleRetry}
                  disabled={sending}
                  className="text-xs underline hover:text-[color:var(--text)] flex-shrink-0"
                >
                  Retry
                </button>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="chat-input-bar">
        <div className="chat-input-wrap">
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={() => handleSend()}
            sending={sending}
            placeholder="Message JobAgent…"
          />
        </div>
      </div>
    </>
  )
}

/* ============================================================
   Rows
   ============================================================ */

function MessageRow({
  message,
  toolResults,
}: {
  message: ChatMessage
  toolResults: Map<string, unknown>
}) {
  const isUser = message.role === "user"
  const text = extractText(message.content)
  const toolCalls = isUser ? [] : extractToolCalls(message.content)

  return (
    <div className={`msg ${isUser ? "msg-user" : "msg-assistant"}`}>
      <div className="msg-avatar">
        {isUser ? "You" : <span className="logo-dot" />}
      </div>
      <div className="msg-body">
        <div className="msg-name">{isUser ? "You" : "JobAgent"}</div>
        {text && <div className="msg-text">{text}</div>}

        {toolCalls.length > 0 && (
          <div className="msg-tools">
            {toolCalls.map((tc) => {
              const result = toolResults.get(tc.id)
              return (
                <div key={tc.id} className="msg-tool">
                  <ToolCallPill name={tc.name} />
                  {result !== undefined && (
                    <ToolResultCard name={tc.name} result={result} />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ThinkingRow() {
  return (
    <div className="msg msg-assistant">
      <div className="msg-avatar">
        <span className="logo-dot" />
      </div>
      <div className="msg-body">
        <div className="msg-name">JobAgent</div>
        <div className="msg-dots">
          <Dot delay={0} />
          <Dot delay={150} />
          <Dot delay={300} />
        </div>
      </div>
    </div>
  )
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="msg-dot"
      style={{ animationDelay: `${delay}ms` }}
    />
  )
}

function ToolCallPill({ name }: { name: string }) {
  const label = TOOL_LABELS[name] || name
  return (
    <div className="tool-pill">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[color:var(--accent)]">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      {label}
    </div>
  )
}

function ToolResultCard({ name, result }: { name: string; result: unknown }) {
  if (!result || typeof result !== "object") return null
  const r = result as Record<string, unknown>

  if (name === "pipeline_summary") {
    const statuses = ["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"] as const
    return (
      <div className="tool-card">
        <div className="grid grid-cols-3 md:grid-cols-7 gap-2 text-center">
          {statuses.map((s) => (
            <div key={s} className="tool-stat">
              <div className="tool-stat-label">{s}</div>
              <div className="tool-stat-value">{(r[s] as number) ?? 0}</div>
            </div>
          ))}
          <div className="tool-stat tool-stat-accent">
            <div className="tool-stat-label">total</div>
            <div className="tool-stat-value">{(r.total as number) ?? 0}</div>
          </div>
        </div>
      </div>
    )
  }

  if (name === "list_applications" && Array.isArray(r.applications)) {
    const apps = r.applications as Array<Record<string, unknown>>
    if (apps.length === 0) return null
    return (
      <div className="tool-card tool-list">
        {apps.slice(0, 8).map((a, i) => (
          <div key={i} className="tool-list-row">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{String(a.company)}</div>
              <div className="text-xs text-[color:var(--text-muted)] truncate">{String(a.role)}</div>
            </div>
            <span className="tool-status-pill">{String(a.status)}</span>
          </div>
        ))}
      </div>
    )
  }

  if ((name === "add_application" || name === "update_application") && r.ok === true) {
    const a = r.application as Record<string, unknown>
    return (
      <div className="tool-card">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-sm">{String(a.company)}</span>
          <span className="tool-status-pill">{String(a.status)}</span>
        </div>
        <div className="text-xs text-[color:var(--text-muted)] mt-1">{String(a.role)}</div>
      </div>
    )
  }

  if (name === "delete_application" && r.ok === true) {
    return (
      <div className="text-xs text-[color:var(--text-muted)]">
        Deleted <strong className="text-[color:var(--text)]">{String(r.deleted_company)}</strong>.
      </div>
    )
  }

  if (r.ok === false || r.error) {
    return (
      <div className="text-xs text-[color:var(--danger)]">
        {String(r.error || "Something went wrong.")}
      </div>
    )
  }

  return null
}