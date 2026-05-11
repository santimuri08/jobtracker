// frontend/src/components/Chat.tsx
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import Link from "next/link"
import {
  sendToAgent,
  extractText,
  extractToolCalls,
  type ChatMessage,
  type ContentBlock,
} from "@/lib/agent"

type Props = {
  initialInput?: string
  variant?: "page" | "panel"
  /** sessionStorage key — set per location so the bubble + page don't collide */
  storageKey?: string
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

export function Chat({
  initialInput,
  variant = "page",
  storageKey = "jobagent.chat.page",
}: Props) {
  const { data: session, status } = useSession()
  const isAuthed = status === "authenticated"

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState(initialInput || "")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [hydrated, setHydrated] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Hydrate from sessionStorage on mount
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[]
        if (Array.isArray(parsed)) setMessages(parsed)
      }
    } catch {
      // ignore
    }
    setHydrated(true)
  }, [storageKey])

  // Persist on change (only after hydration so we don't immediately overwrite)
  useEffect(() => {
    if (!hydrated) return
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages))
    } catch {
      // ignore quota errors
    }
  }, [messages, hydrated, storageKey])

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, sending])

  // Suggestion chip → fill input
  useEffect(() => {
    if (initialInput !== undefined) setInput(initialInput)
  }, [initialInput])

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

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
        // Keep the user message visible so they can retry; restore input too
        setInput(text)
      } finally {
        setSending(false)
        inputRef.current?.focus()
      }
    },
    [input, sending, isAuthed, session, messages],
  )

  async function handleRetry() {
    // Replay the last user message — it's already in `messages`
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
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleNewChat() {
    setMessages([])
    setInput("")
    setError("")
    try {
      sessionStorage.removeItem(storageKey)
    } catch {
      // ignore
    }
    inputRef.current?.focus()
  }

  const isPanel = variant === "panel"
  const hasMessages = messages.length > 0
  const showEmptyState = !hasMessages && !sending

  // For each assistant message, gather tool_use blocks PAIRED with their
  // tool_result block from the next user turn (if any) so we can render
  // a result card inline below the call.
  const pairedToolResults = useMemo(() => {
    const map = new Map<string, unknown>()  // tool_use_id -> parsed result
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (m.role !== "user" || typeof m.content === "string") continue
      for (const block of m.content) {
        if (block.type === "tool_result") {
          try {
            map.set(block.tool_use_id, JSON.parse(block.content))
          } catch {
            map.set(block.tool_use_id, block.content)
          }
        }
      }
    }
    return map
  }, [messages])

  return (
    <div className={isPanel ? "flex flex-col h-full" : "flex flex-col"}>
      {/* Header bar */}
      {(hasMessages || isPanel) && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-xs text-[color:var(--text-dim)] uppercase tracking-wider">
            <span className="logo-dot" />
            Chat with JobAgent
          </div>
          {hasMessages && (
            <button
              onClick={handleNewChat}
              className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--accent)] transition-colors"
            >
              New chat
            </button>
          )}
        </div>
      )}

      {/* Message stream */}
      {hasMessages && (
        <div
          ref={scrollRef}
          className={`card p-4 mb-3 overflow-y-auto space-y-3 ${
            isPanel ? "flex-1" : "max-h-[480px]"
          }`}
        >
          {messages.map((m, i) => (
            <MessageBubble
              key={i}
              message={m}
              toolResults={pairedToolResults}
            />
          ))}
          {sending && <ThinkingIndicator />}
        </div>
      )}

      {/* Empty state — show inside a card so it doesn't feel barren */}
      {showEmptyState && !isPanel && (
        <div className="card mb-3 px-5 py-8 text-center">
          <div className="logo-dot mx-auto mb-3" />
          <p className="text-sm text-[color:var(--text-muted)]">
            Tell the agent about a job — applied, interviewing, anything.
            <br />
            It&apos;ll handle the tracking, drafting, and analysis.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-3 text-sm text-[color:var(--danger)] bg-[#F2495C15] border border-[#F2495C30] px-3 py-2 rounded-md flex items-center justify-between gap-3">
          <span>{error}</span>
          {hasMessages && messages[messages.length - 1]?.role === "user" && (
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

      {!isAuthed && status !== "loading" && !hasMessages && (
        <div className="mb-3 text-xs text-[color:var(--text-dim)]">
          You&apos;ll need an account to chat with the agent.{" "}
          <Link href="/signup" className="text-[color:var(--accent)] hover:underline">
            Sign up
          </Link>{" "}
          — it&apos;s free.
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); handleSend() }}
        className="relative"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={
            isAuthed
              ? "Tell me what just happened — e.g. 'I applied to Stripe for senior backend'"
              : 'Try "I applied to Stripe for senior backend"'
          }
          disabled={sending}
          className="w-full pl-5 pr-14 py-4 text-base rounded-2xl resize-none disabled:opacity-60"
          style={{ minHeight: "60px", maxHeight: "200px" }}
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          aria-label="Send"
          className="absolute right-2 top-2 w-10 h-10 rounded-xl bg-[color:var(--accent)] hover:bg-[color:var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
        >
          {sending ? (
            <svg width="18" height="18" viewBox="0 0 24 24" className="animate-spin">
              <circle cx="12" cy="12" r="9" stroke="white" strokeOpacity="0.3" strokeWidth="2.5" fill="none" />
              <path d="M21 12a9 9 0 00-9-9" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </form>
    </div>
  )
}


function MessageBubble({
  message,
  toolResults,
}: {
  message: ChatMessage
  toolResults: Map<string, unknown>
}) {
  const isUser = message.role === "user"
  const text = extractText(message.content)
  const toolCalls = isUser ? [] : extractToolCalls(message.content)

  if (!isUser && toolCalls.length > 0) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[88%] space-y-2">
          {toolCalls.map((t) => (
            <div key={t.id}>
              <ToolCallPill name={t.name} />
              <ToolResultCard name={t.name} result={toolResults.get(t.id)} />
            </div>
          ))}
          {text && (
            <div className="bg-[color:var(--bg-hover)] text-[color:var(--text)] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed">
              <AgentLabel />
              <div className="whitespace-pre-wrap">{text}</div>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!text) return null

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-[color:var(--accent)] text-white rounded-br-md"
            : "bg-[color:var(--bg-hover)] text-[color:var(--text)] rounded-bl-md"
        }`}
      >
        {!isUser && <AgentLabel />}
        {text}
      </div>
    </div>
  )
}


function AgentLabel() {
  return (
    <div className="flex items-center gap-1.5 mb-1 text-xs text-[color:var(--accent)] font-semibold">
      <span className="logo-dot" />
      JobAgent
    </div>
  )
}


function ToolCallPill({ name }: { name: string }) {
  const label = TOOL_LABELS[name] || name
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--bg-elevated)] text-xs text-[color:var(--text-muted)]">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[color:var(--accent)]">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      {label}
    </div>
  )
}


/**
 * Lightweight inline cards for a handful of tool results.
 * Anything we don't have a card for just renders nothing — the agent's
 * text reply will explain it.
 */
function ToolResultCard({ name, result }: { name: string; result: unknown }) {
  if (!result || typeof result !== "object") return null
  const r = result as Record<string, unknown>

  if (name === "pipeline_summary") {
    const statuses = ["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"] as const
    return (
      <div className="mt-2 card p-3">
        <div className="grid grid-cols-3 md:grid-cols-7 gap-2 text-center">
          {statuses.map((s) => (
            <div key={s} className="border border-[color:var(--border)] rounded-md px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-[color:var(--text-dim)]">{s}</div>
              <div className="text-base font-bold">{(r[s] as number) ?? 0}</div>
            </div>
          ))}
          <div className="border border-[color:var(--accent)] bg-[color:var(--accent-soft)] rounded-md px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--accent)]">total</div>
            <div className="text-base font-bold">{(r.total as number) ?? 0}</div>
          </div>
        </div>
      </div>
    )
  }

  if (name === "list_applications") {
    const apps = (r.applications as Array<Record<string, unknown>>) || []
    if (apps.length === 0) return null
    return (
      <div className="mt-2 card p-3 space-y-1.5">
        {apps.slice(0, 8).map((a) => (
          <div key={String(a.id)} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium truncate">{String(a.company)}</span>
            <span className="text-[color:var(--text-muted)] truncate flex-1 text-right">
              {String(a.role)}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-md bg-[color:var(--bg-hover)] text-[color:var(--text-muted)]">
              {String(a.status)}
            </span>
          </div>
        ))}
        {apps.length > 8 && (
          <div className="text-xs text-[color:var(--text-dim)] pt-1">
            …and {apps.length - 8} more.
          </div>
        )}
      </div>
    )
  }

  if (name === "add_application" && r.ok === true) {
    const a = r.application as Record<string, unknown>
    return (
      <div className="mt-2 card p-3 text-sm border-[color:var(--accent)]">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">{String(a.company)}</span>
          <span className="text-xs px-2 py-0.5 rounded-md bg-[color:var(--accent-soft)] text-[color:var(--accent)]">
            {String(a.status)}
          </span>
        </div>
        <div className="text-[color:var(--text-muted)] mt-0.5">{String(a.role)}</div>
      </div>
    )
  }

  if (name === "update_application" && r.ok === true) {
    const a = r.application as Record<string, unknown>
    return (
      <div className="mt-2 card p-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">{String(a.company)}</span>
          <span className="text-xs px-2 py-0.5 rounded-md bg-[color:var(--accent-soft)] text-[color:var(--accent)]">
            {String(a.status)}
          </span>
        </div>
        <div className="text-[color:var(--text-muted)] mt-0.5">Updated.</div>
      </div>
    )
  }

  if (name === "delete_application" && r.ok === true) {
    return (
      <div className="mt-2 text-xs text-[color:var(--text-muted)]">
        Deleted <strong>{String(r.deleted_company)}</strong>.
      </div>
    )
  }

  // Generic error display
  if (r.ok === false || r.error) {
    return (
      <div className="mt-2 text-xs text-[color:var(--danger)]">
        {String(r.error || "Something went wrong.")}
      </div>
    )
  }

  return null
}


function ThinkingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-[color:var(--bg-hover)] rounded-2xl rounded-bl-md px-4 py-3">
        <div className="flex items-center gap-1">
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
      className="w-1.5 h-1.5 rounded-full bg-[color:var(--accent)] animate-pulse"
      style={{ animationDelay: `${delay}ms`, animationDuration: "1s" }}
    />
  )
}