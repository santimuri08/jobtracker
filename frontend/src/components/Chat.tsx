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
  saveChat,                  // sync cache write — used for optimistic local mirror
  saveChatAsync,             // Phase 4: server PUT + cache mirror
  createChatAsync,           // Phase 4: idempotent server row creation
  getChat,
  getChatAsync,              // Phase 4: server-first hydration
  setCurrentChatId,
  makeChatId,
} from "@/lib/chatStorage"
import { ChatInput } from "./ChatInput"

type Props = {
  initialInput?: string
  activeChatId?: string | null
  onActiveChatChange?: (id: string | null) => void
  autoSendOnMount?: boolean
}

const TOOL_LABELS: Record<string, string> = {
  add_application: "Adding application",
  list_applications: "Looking up your applications",
  pipeline_summary: "Checking your pipeline",
  update_application: "Updating application",
  delete_application: "Deleting application",
  list_resumes: "Listing resumes",
  link_resume_to_application: "Linking resume",
  check_application_readiness: "Checking readiness",
  run_gap_analysis: "Running gap analysis",
  generate_cover_letter: "Drafting cover letter",
  rewrite_bullet: "Rewriting bullet",
  find_similar_applications: "Finding similar roles",
  add_interview_round: "Adding interview round",
  delete_interview_round: "Removing interview round",
  add_contact: "Adding contact",
  add_note: "Adding note",
  create_reminder: "Setting reminder",
  list_reminders: "Looking up reminders",
  complete_reminder: "Marking reminder done",
  search_jobs: "Searching live jobs",
  save_job_as_application: "Saving job to tracker",
}

function openExternal(url: string) {
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer")
  }
}

/**
 * The conversation surface.
 *
 * Phase 4 persistence:
 *   • Hydration is cache-first (instant paint from localStorage) then
 *     server-confirmed via getChatAsync. If the server returns a
 *     different message list, we replace with the server's truth.
 *   • Saves go to the server via createChatAsync + saveChatAsync, and
 *     mirror to localStorage for offline + cache use. Saves are gated
 *     on `!sending` so we save once per completed user turn, never
 *     mid-tool-loop (the agent loop emits 4-6 intermediate states per
 *     turn — we don't want to spam PUTs).
 *   • If the server is unreachable, we still update the cache and
 *     fire the sidebar event. The next successful save retries.
 */
export function Chat({
  initialInput,
  activeChatId,
  onActiveChatChange,
  autoSendOnMount = false,
}: Props) {
  const { data: session, status } = useSession()
  const isAuthed = status === "authenticated"
  const token = session?.backendToken

  const [chatId, setChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [hydrated, setHydrated] = useState(false)
  const autoSentRef = useRef(false)
  // Tracks the message-count we last persisted, so re-renders that
  // didn't change `messages` don't trigger redundant PUTs.
  const lastSavedCountRef = useRef<number>(-1)

  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // ── Hydrate from activeChatId ────────────────────────────────────────
  // Cache-first paint, then server fetch to confirm/replace.
  useEffect(() => {
    if (activeChatId === undefined) {
      setHydrated(true)
      return
    }
    if (activeChatId === null) {
      setChatId(null)
      setMessages([])
      autoSentRef.current = false
      lastSavedCountRef.current = -1
      setHydrated(true)
      return
    }

    // 1. Synchronous cache paint
    const saved = getChat(activeChatId)
    if (saved) {
      setChatId(saved.id)
      setMessages(saved.messages)
      autoSentRef.current = true
      lastSavedCountRef.current = saved.messages.length
    } else {
      setChatId(activeChatId)
      setMessages([])
      lastSavedCountRef.current = -1
    }
    setHydrated(true)

    // 2. Server fetch — replaces cache view with truth
    if (token) {
      let cancelled = false
      getChatAsync(token, activeChatId)
        .then((fresh) => {
          if (cancelled) return
          if (fresh) {
            setChatId(fresh.id)
            setMessages(fresh.messages)
            autoSentRef.current = true
            lastSavedCountRef.current = fresh.messages.length
          }
          // If fresh is null (404), chat was deleted server-side.
          // chat/page.tsx already handles the redirect — we just stay quiet.
        })
        .catch((e) => {
          console.warn("hydrate: server fetch failed, using cache:", e)
        })
      return () => { cancelled = true }
    }
  }, [activeChatId, token])

  // ── Pre-fill the input from initialInput ─────────────────────────────
  useEffect(() => {
    if (initialInput !== undefined) setInput(initialInput)
  }, [initialInput])

  // ── Persist on every message change (server + cache) ─────────────────
  // Gated on !sending so we save once per completed turn, not on every
  // intermediate tool-loop state. Server write is idempotent on the id,
  // so re-creating an existing chat is a no-op.
  useEffect(() => {
    if (!hydrated) return
    if (sending) return
    if (messages.length === 0) return
    if (messages.length === lastSavedCountRef.current) return

    const id = chatId ?? makeChatId()
    if (!chatId) {
      setChatId(id)
      setCurrentChatId(id)
      onActiveChatChange?.(id)
    }

    // Cache mirror first — gives the sidebar event up-to-date data
    saveChat(id, messages)
    const savedCount = messages.length
    lastSavedCountRef.current = savedCount

    if (token) {
      ;(async () => {
        try {
          await createChatAsync(token, id)
          await saveChatAsync(token, id, messages)
          window.dispatchEvent(new Event("jobagent:chats-changed"))
        } catch (e) {
          console.warn("save chat to server failed (cache still updated):", e)
          // Fire the event anyway so the sidebar refreshes from cache.
          window.dispatchEvent(new Event("jobagent:chats-changed"))
          // Reset so we retry on the next message
          lastSavedCountRef.current = savedCount - 1
        }
      })()
    } else {
      // Unauthenticated edge case (shouldn't happen here, but be safe)
      window.dispatchEvent(new Event("jobagent:chats-changed"))
    }
  }, [messages, chatId, hydrated, sending, token, onActiveChatChange])

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
          {visibleMessages.length === 0 && sending && <ThinkingRow />}

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
   Rows + sub-components
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

function ApplyButton({ url }: { url: string }) {
  return (
    <button
      type="button"
      onClick={() => openExternal(url)}
      className="job-card-apply"
    >
      View posting
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M7 17L17 7" />
        <path d="M7 7h10v10" />
      </svg>
    </button>
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

  if (name === "search_jobs" && Array.isArray(r.results)) {
    const jobs = r.results as Array<Record<string, unknown>>
    if (jobs.length === 0) {
      return (
        <div className="text-xs text-[color:var(--text-muted)]">
          No jobs matched. Try a broader query or different location.
        </div>
      )
    }
    return (
      <div className="job-results">
        {jobs.map((j, i) => {
          const title = String(j.title || "Untitled role")
          const company = String(j.company || "Unknown")
          const location = j.location ? String(j.location) : null
          const url = j.apply_url ? String(j.apply_url) : null
          const isRemote = j.is_remote === true
          const empType = j.employment_type ? String(j.employment_type) : null
          const desc = j.description ? String(j.description) : ""
          const snippet = desc.length > 180 ? desc.slice(0, 180).trimEnd() + "…" : desc

          return (
            <div key={i} className="job-card">
              <div className="job-card-head">
                <div className="min-w-0 flex-1">
                  {url ? (
                    <button
                      type="button"
                      onClick={() => openExternal(url)}
                      className="job-card-title"
                    >
                      {title}
                    </button>
                  ) : (
                    <div className="job-card-title">{title}</div>
                  )}
                  <div className="job-card-company">{company}</div>
                </div>
                <span className="job-card-index">#{i + 1}</span>
              </div>

              <div className="job-card-meta">
                {location && <span>{location}</span>}
                {isRemote && <span className="job-card-tag">Remote</span>}
                {empType && <span className="job-card-tag">{empType}</span>}
              </div>

              {snippet && <p className="job-card-snippet">{snippet}</p>}

              {url && <ApplyButton url={url} />}
            </div>
          )
        })}
      </div>
    )
  }

  if (name === "save_job_as_application" && r.ok === true) {
    const a = r.application as Record<string, unknown>
    const jobUrl = typeof a.job_url === "string" ? a.job_url : null
    return (
      <div className="tool-card">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-sm">{String(a.company)}</span>
          <span className="tool-status-pill">{String(a.status)}</span>
        </div>
        <div className="text-xs text-[color:var(--text-muted)] mt-1">{String(a.role)}</div>
        {jobUrl && (
          <div className="mt-3">
            <ApplyButton url={jobUrl} />
          </div>
        )}
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