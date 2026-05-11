// frontend/src/components/ImmersiveChat.tsx
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Chat } from "./Chat"

type Props = {
  initialInput?: string
  storageKey?: string
}

export function ImmersiveChat({ initialInput, storageKey }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)
  const collapsedHostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!expanded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [expanded])

  useEffect(() => {
    if (!expanded) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setExpanded(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [expanded])

  const open = useCallback(() => setExpanded(true), [])
  const close = useCallback(() => setExpanded(false), [])

  return (
    <>
      <div
        ref={collapsedHostRef}
        className={`transition-all duration-500 ease-out ${
          expanded
            ? "opacity-0 scale-[0.96] pointer-events-none blur-sm"
            : "opacity-100 scale-100"
        }`}
      >
        <CollapsedShell onActivate={open} />
      </div>

      {mounted &&
        createPortal(
          <ExpandedOverlay
            visible={expanded}
            onClose={close}
            initialInput={initialInput}
            storageKey={storageKey}
          />,
          document.body,
        )}
    </>
  )
}

function CollapsedShell({ onActivate }: { onActivate: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onActivate()
        }
      }}
      className="
        group relative cursor-pointer
        border border-[color:var(--border-strong)]
        bg-[color:var(--bg-elevated)]/70
        backdrop-blur-xl
        hover:border-[color:var(--accent)]
        transition-all duration-500 ease-out
        overflow-hidden
      "
      style={{
        borderRadius: "var(--radius-lg)",
        boxShadow:
          "var(--shadow-card), 0 0 0 1px rgba(59, 130, 246, 0.04)",
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-70"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, var(--accent-soft), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute -inset-px pointer-events-none jobagent-shimmer"
        style={{ borderRadius: "inherit" }}
      />

      <div className="relative px-6 py-5 flex items-center gap-4">
        <div className="relative flex-shrink-0">
          <span className="logo-dot block" />
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-[color:var(--accent)] animate-ping opacity-60"
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-dim)] mb-1">
            JobAgent
          </div>
          <div className="text-sm text-[color:var(--text-muted)] truncate">
            Tell me about a job, or ask me to draft something…
          </div>
        </div>

        <div
          className="
            hidden md:flex items-center gap-1.5 px-3 py-1.5
            border border-[color:var(--border)]
            text-[10px] uppercase tracking-wider text-[color:var(--text-dim)]
            group-hover:border-[color:var(--accent)] group-hover:text-[color:var(--accent)]
            transition-colors
          "
          style={{ borderRadius: "var(--radius-sm)" }}
        >
          <span>Open</span>
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 17L17 7" />
            <path d="M7 7h10v10" />
          </svg>
        </div>
      </div>
    </div>
  )
}

function ExpandedOverlay({
  visible,
  onClose,
  initialInput,
  storageKey,
}: {
  visible: boolean
  onClose: () => void
  initialInput?: string
  storageKey?: string
}) {
  return (
    <div
      aria-hidden={!visible}
      className={`
        fixed inset-0 z-[60]
        transition-opacity duration-500 ease-out
        ${visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
      `}
    >
      <div
        onClick={onClose}
        className={`
          absolute inset-0
          bg-[color:var(--bg)]/70 backdrop-blur-2xl
          transition-all duration-500 ease-out
          ${visible ? "opacity-100" : "opacity-0"}
        `}
      />

      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 30%, var(--accent-glow), transparent 60%)",
        }}
      />

      <div
        className={`
          absolute inset-0 flex flex-col
          transition-all duration-500
          ${
            visible
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-[1.02] translate-y-2"
          }
        `}
        style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
      >
        <div className="flex-shrink-0 px-8 py-5 flex items-center justify-between border-b border-[color:var(--border)]/50 bg-[color:var(--bg)]/40 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="logo-dot block" />
              <span
                aria-hidden
                className="absolute inset-0 rounded-full bg-[color:var(--accent)] animate-ping opacity-50"
              />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight font-display">
                JobAgent
              </div>
              <div className="text-[11px] uppercase tracking-wider text-[color:var(--text-dim)]">
                Conversational workspace
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close chat"
            className="
              flex items-center gap-2 px-4 py-2
              text-sm text-[color:var(--text-muted)]
              border border-[color:var(--border-strong)]
              hover:text-[color:var(--text)] hover:border-[color:var(--accent)]
              transition-colors
            "
            style={{ borderRadius: "var(--radius-md)" }}
          >
            <span className="hidden sm:inline">Close</span>
            <kbd
              className="hidden sm:inline-flex items-center text-[10px] px-1.5 py-0.5 border border-[color:var(--border)] text-[color:var(--text-dim)]"
              style={{ borderRadius: "var(--radius-xs)" }}
            >
              Esc
            </kbd>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 max-w-3xl w-full mx-auto px-4 md:px-6 py-6">
          {visible || mountedOnce.current ? (
            <ChatMount
              initialInput={initialInput}
              storageKey={storageKey ?? "jobagent.chat.page"}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

const mountedOnce = { current: false }

function ChatMount({
  initialInput,
  storageKey,
}: {
  initialInput?: string
  storageKey: string
}) {
  useEffect(() => {
    mountedOnce.current = true
  }, [])

  return (
    <div className="h-full chat-mount-fade">
      <Chat
        initialInput={initialInput}
        variant="panel"
        storageKey={storageKey}
      />
    </div>
  )
}