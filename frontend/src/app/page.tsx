// frontend/src/app/page.tsx
"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { ArrowUp } from "lucide-react"
import { Reveal, GradientText } from "@/components/Reveal"
import { AICore } from "@/components/AICore"
import { listChats } from "@/lib/chatStorage"

const SUGGESTIONS_LOGGED_OUT = [
  "I applied to Stripe for senior backend",
  "Show me my pipeline",
  "Write a cover letter for my last application",
]

const SUGGESTIONS_LOGGED_IN = [
  "I just applied to Stripe for senior backend, remote, 180–220k",
  "What's my pipeline look like?",
  "Change my Figma application to interviewing",
]

/**
 * Landing page (/).
 *
 * The cinematic hero IS the entry point. The composer launches the
 * conversational workspace by navigating to /chat with the prompt
 * pre-filled. Empty submissions do nothing — we never open an empty
 * workspace.
 *
 * If a signed-in user already has saved chats, we show a quiet
 * "Continue your last chat" affordance below the chips. The workspace
 * itself is not mounted here — that happens at /chat.
 */
export default function HomePage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [text, setText] = useState("")
  const [hasHistory, setHasHistory] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const isAuthed = status === "authenticated"
  const suggestions = isAuthed ? SUGGESTIONS_LOGGED_IN : SUGGESTIONS_LOGGED_OUT
  const firstName =
    session?.user?.name?.split(" ")[0] ||
    session?.user?.email?.split("@")[0]

  // Auto-grow composer
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [text])

  // Detect prior conversations for the "Continue" affordance
  useEffect(() => {
    if (!isAuthed) return
    setHasHistory(listChats().length > 0)
  }, [isAuthed])

  function launchChat(prefill?: string) {
    const q = (prefill ?? text).trim()
    if (!q) {
      // Don't open an empty workspace — just focus the composer.
      inputRef.current?.focus()
      return
    }
    if (!isAuthed) {
      router.push(`/signup?from=/chat&q=${encodeURIComponent(q)}`)
      return
    }
    router.push(`/chat?q=${encodeURIComponent(q)}&new=1`)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    launchChat()
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      launchChat()
    }
  }

  return (
    <main
      className="
        relative flex items-center justify-center
        px-5 sm:px-6
        min-h-[calc(100dvh-6rem)]
        pt-2 pb-12
      "
    >
      {/* Soft halo behind hero */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 38%, var(--accent-soft), transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-xl text-center flex flex-col items-center">
        {/* Orb — sized down so it doesn't compete with the composer */}
        <div className="w-[160px] sm:w-[200px] md:w-[240px] -mb-3 md:-mb-5">
          <AICore />
        </div>

        {/* Headline */}
        <h1 className="font-display-hero text-[2.25rem] sm:text-5xl md:text-6xl leading-[0.98] hover-glow">
          <Reveal mode="word" eager className="block font-light text-[color:var(--text)]">
            Track. Apply.
          </Reveal>
          <Reveal mode="word" delay={300} eager className="block font-bold mt-1">
            <GradientText glow>Land it.</GradientText>
          </Reveal>
        </h1>

        {/* Subtitle */}
        <Reveal
          mode="line"
          delay={800}
          eager
          as="p"
          className="mt-5 text-sm md:text-base text-[color:var(--text-muted)] max-w-md leading-relaxed"
        >
          {isAuthed && firstName
            ? `Welcome back, ${firstName}. Tell your agent what happened.`
            : "An AI-native operating system for your job search — just by chatting."}
        </Reveal>

        {/* Composer — the primary action */}
        <form onSubmit={handleSubmit} className="mt-7 w-full text-left">
          <div className="hero-composer">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKey}
              rows={1}
              placeholder={
                isAuthed
                  ? "Tell me about a job, or ask me to draft something…"
                  : "Try 'I applied to Stripe for senior backend'"
              }
              aria-label="Start a conversation with JobAgent"
              spellCheck
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!text.trim()}
              className="hero-composer-send"
            >
              <ArrowUp size={18} strokeWidth={2.25} />
            </button>
          </div>
          <div className="mt-2 px-1 text-[11px] text-[color:var(--text-dim)] text-center">
            Press Enter to open the workspace.
          </div>
        </form>

        {/* Suggestion chips */}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => launchChat(s)}
              className="chip text-xs"
            >
              {s}
            </button>
          ))}
        </div>

        {/* Continue affordance — only if there's history */}
        {isAuthed && hasHistory && (
          <Link
            href="/chat"
            className="mt-6 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--accent)] transition-colors inline-flex items-center gap-1.5"
          >
            <span className="logo-dot" style={{ width: 6, height: 6 }} />
            Continue your last conversation
          </Link>
        )}

        {/* Footer link */}
        <p className="mt-6 text-xs text-[color:var(--text-dim)]">
          {isAuthed ? (
            <>
              Or jump to your{" "}
              <Link href="/dashboard" className="text-[color:var(--accent)] hover:underline">
                dashboard
              </Link>
              .
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/login" className="text-[color:var(--accent)] hover:underline">
                Log in
              </Link>
              .
            </>
          )}
        </p>
      </div>
    </main>
  )
}