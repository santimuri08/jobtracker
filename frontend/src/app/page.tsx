// frontend/src/app/page.tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { ImmersiveChat } from "@/components/ImmersiveChat"
import { Reveal, GradientText } from "@/components/Reveal"
import { AICore } from "@/components/AICore"

const SUGGESTIONS_LOGGED_OUT = [
  "I applied to Stripe for senior backend",
  "Show me my pipeline",
  "Write a cover letter for my last application",
]

const SUGGESTIONS_LOGGED_IN = [
  "I just applied to Stripe for senior backend, remote, 180-220k",
  "What's my pipeline look like?",
  "Change my Figma application to interviewing",
]

export default function HomePage() {
  const { data: session, status } = useSession()
  const [chipText, setChipText] = useState<string | undefined>(undefined)

  const isAuthed = status === "authenticated"
  const suggestions = isAuthed ? SUGGESTIONS_LOGGED_IN : SUGGESTIONS_LOGGED_OUT
  const firstName = session?.user?.name?.split(" ")[0] || session?.user?.email?.split("@")[0]

  return (
    <main className="relative min-h-[calc(100vh-6rem)] flex items-center justify-center px-6 pt-2 pb-12">
      {/* Soft halo behind the entire hero — adds spatial cohesion */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% 35%, var(--accent-soft), transparent 70%)",
        }}
      />

      {/*
        Hero composition. Everything stays in one tight column so the user
        reads orb → words → action without their eye traveling far. Spacing
        is intentionally tighter than before: orb has -mb pulling the headline
        into its lower halo, then headline + subtitle + chat sit in compact
        24-32px rhythm.
      */}
      <div className="relative w-full max-w-2xl text-center flex flex-col items-center">
        {/* Orb — sized down (380px → 260px on desktop, 200px on mobile) and
            given a negative bottom margin so its ambient glow visually bleeds
            into the headline. They read as one composition. */}
        <div className="w-[200px] md:w-[260px] -mb-4 md:-mb-6">
          <AICore />
        </div>

        {/* Headline — sits directly under the orb, gathered into its halo */}
        <h1 className="font-display-hero text-5xl md:text-7xl leading-[0.95] hover-glow">
          <Reveal mode="word" eager className="block font-light text-[color:var(--text)]">
            Track. Apply.
          </Reveal>
          <Reveal mode="word" delay={300} eager className="block font-bold mt-1">
            <GradientText glow>Land it.</GradientText>
          </Reveal>
        </h1>

        {/* Subtitle — short, calm, one breath below the headline */}
        <Reveal
          mode="line"
          delay={800}
          eager
          as="p"
          className="mt-6 text-base md:text-lg text-[color:var(--text-muted)] max-w-md leading-relaxed"
        >
          {isAuthed && firstName
            ? `Welcome back, ${firstName}. Tell your agent what happened.`
            : "An AI agent that runs your job search — just by chatting."}
        </Reveal>

        {/* Chat — the primary action, sits right under the message */}
        <div className="mt-8 w-full text-left">
          <ImmersiveChat initialInput={chipText} storageKey="jobagent.chat.page" />
        </div>

        {/* Suggestion chips — secondary, "or try these" */}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => setChipText(s)}
              className="chip text-xs"
            >
              {s}
            </button>
          ))}
        </div>

        {/* Quiet footer link — tour or dashboard depending on auth state */}
        <p className="mt-8 text-xs text-[color:var(--text-dim)]">
          {isAuthed ? (
            <>
              Or jump to the{" "}
              <Link href="/dashboard" className="text-[color:var(--accent)] hover:underline">
                dashboard
              </Link>
              .
            </>
          ) : (
            <>
              See{" "}
              <Link href="/inside" className="text-[color:var(--accent)] hover:underline">
                inside JobAgent
              </Link>
              {" "}— how the agent actually works.
            </>
          )}
        </p>
      </div>
    </main>
  )
}