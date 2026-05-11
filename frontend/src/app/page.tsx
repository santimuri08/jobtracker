// frontend/src/app/page.tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Chat } from "@/components/Chat"

const SUGGESTIONS_LOGGED_OUT = [
  "I applied to Stripe for senior backend",
  "Show me my pipeline",
  "Write a cover letter for my last application",
  "Find similar roles to Figma",
]

const SUGGESTIONS_LOGGED_IN = [
  "I just applied to Stripe for senior backend, remote, 180-220k",
  "What's my pipeline look like?",
  "Change my Figma application to interviewing",
  "Add an interview round for next Tuesday on the Stripe one",
]

export default function HomePage() {
  const { data: session, status } = useSession()
  const [chipText, setChipText] = useState<string | undefined>(undefined)

  const isAuthed = status === "authenticated"
  const suggestions = isAuthed ? SUGGESTIONS_LOGGED_IN : SUGGESTIONS_LOGGED_OUT
  const firstName = session?.user?.name?.split(" ")[0] || session?.user?.email?.split("@")[0]

  return (
    <main className="relative min-h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Radial glow background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 30%, var(--accent-glow), transparent 70%)",
        }}
      />

      <div className="relative max-w-4xl mx-auto px-6 pt-16 pb-24 text-center">
        {/* Pill */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[color:var(--border-strong)] bg-[color:var(--bg-elevated)] text-xs uppercase tracking-wider text-[color:var(--text-muted)] mb-8">
          <span className="logo-dot" />
          AI-powered job search
        </div>

        {/* Hero */}
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[0.95] mb-2">
          Track. Apply.
        </h1>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[0.95] mb-6">
          <span className="bg-gradient-to-r from-[color:var(--accent)] to-[#9DB4FF] bg-clip-text text-transparent">
            Land it.
          </span>
        </h1>

        <p className="text-lg text-[color:var(--text-muted)] max-w-2xl mx-auto mb-12">
          {isAuthed && firstName
            ? `Welcome back, ${firstName}. Tell your agent what happened and it handles the rest — adding apps, writing cover letters, tracking interviews.`
            : "Your AI agent that tracks every application, writes cover letters, and finds similar roles — just by chatting."}
        </p>

        {/* Suggestion chips */}
        <div className="flex flex-wrap justify-center gap-2 mb-6">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => setChipText(s)}
              className="chip"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-[color:var(--accent)]">
                <path
                  d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z"
                  fill="currentColor"
                />
              </svg>
              {s}
            </button>
          ))}
        </div>

        {/* The real chat */}
        <div className="max-w-2xl mx-auto text-left">
          <Chat initialInput={chipText} variant="page" />
        </div>

        {isAuthed && (
          <p className="mt-3 text-xs text-[color:var(--text-dim)]">
            Or jump straight to the{" "}
            <Link href="/dashboard" className="text-[color:var(--accent)] hover:underline">
              dashboard
            </Link>
            .
          </p>
        )}

        {/* Feature blurbs below the fold */}
        <div className="grid md:grid-cols-3 gap-4 mt-24 text-left">
          <FeatureCard
            title="Add jobs by chatting"
            body="Just say what you applied to. The agent fills in the details, asks for what's missing, and saves it."
          />
          <FeatureCard
            title="AI cover letters & gap analysis"
            body="Generate tailored cover letters and see what's missing on your resume — all from chat."
          />
          <FeatureCard
            title="Find similar roles"
            body="Semantic search across your saved applications. Ask 'find roles like Stripe' and get matches."
          />
        </div>
      </div>
    </main>
  )
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card hover:border-[color:var(--accent)] transition-colors">
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-sm text-[color:var(--text-muted)] leading-relaxed">{body}</p>
    </div>
  )
}