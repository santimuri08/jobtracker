// frontend/src/app/how-it-works/page.tsx
"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"

export default function HowItWorksPage() {
  const { status } = useSession()
  const isAuthed = status === "authenticated"

  return (
    <main className="relative min-h-[calc(100vh-3.5rem)]">
      {/* Subtle radial glow */}
      <div
        className="absolute inset-x-0 top-0 h-[600px] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 20%, var(--accent-glow), transparent 70%)",
        }}
      />

      <div className="relative max-w-4xl mx-auto px-6 pt-16 pb-24">
        {/* Pill */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[color:var(--border-strong)] bg-[color:var(--bg-elevated)] text-xs uppercase tracking-wider text-[color:var(--text-muted)]">
            <span className="logo-dot" />
            How it works
          </div>
        </div>

        {/* Hero */}
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-center leading-[1.05] mb-6">
          Your job search,
          <br />
          <span className="bg-gradient-to-r from-[color:var(--accent)] to-[#9DB4FF] bg-clip-text text-transparent">
            run by an agent.
          </span>
        </h1>

        <p className="text-lg text-[color:var(--text-muted)] text-center max-w-2xl mx-auto mb-20">
          JobAgent is a chat-first tool. You talk to it like you'd text a friend who's helping you job hunt — and it actually does the work.
        </p>

        {/* Step 1 */}
        <Step
          number="01"
          title="Tell the agent what just happened"
          body="No forms, no clicking through wizards. Just say what you did. The agent extracts the company, role, location, salary range, status — anything you mentioned — and saves it. If something's missing, it asks."
          examples={[
            { user: "I just applied to Stripe for a senior backend role, remote, 180–220k.", agent: "Got it. I added Stripe — Senior Backend Engineer, Remote, $180k–220k. Want to paste the job description so I can run gap analysis later?" },
            { user: "Got an interview with Figma next Tuesday at 2pm.", agent: "Updated Figma to interviewing and added a phone screen for next Tuesday at 2pm. Who's the interviewer?" },
          ]}
        />

        {/* Step 2 */}
        <Step
          number="02"
          title="Ask for AI help, in plain language"
          body="Cover letters, gap analysis, similar roles, bullet rewrites — every AI feature is one sentence away. The agent picks the right tool and runs it on the right application."
          examples={[
            { user: "Write me a cover letter for the Stripe one. Make it enthusiastic.", agent: "Done — here's Draft 1 of your cover letter for Stripe. Want me to make it shorter or change the tone?" },
            { user: "What am I missing for the Figma role?", agent: "Fit score: 72/100. You have strong React and TypeScript matches. Missing: design-systems experience, accessibility expertise. Recommendations: add your work on the Storybook migration, mention WCAG audits..." },
          ]}
        />

        {/* Step 3 */}
        <Step
          number="03"
          title="Track it all in the dashboard"
          body="The chat is the fast lane. The dashboard is the structured view. Pipeline tiles, status filters, sort by date — everything you'd expect from a tracker, plus a floating chat bubble in the corner so the agent is always one click away."
          examples={[
            { user: "How many apps am I waiting on?", agent: "You have 4 saved, 2 applied, 1 interviewing. The Datadog one has been pending for 12 days — want me to draft a follow-up email?" },
          ]}
        />

        {/* Step 4 */}
        <Step
          number="04"
          title="Get a weekly recap by email"
          body="Every Monday morning, JobAgent emails you a summary: what you applied to, what's pending, suggested next steps. Toggle it on or off from the dashboard."
        />

        {/* What the agent can do */}
        <section className="mt-24 mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-center mb-2">
            What the agent can do
          </h2>
          <p className="text-[color:var(--text-muted)] text-center mb-10">
            Every action below is one chat message away.
          </p>

          <div className="grid md:grid-cols-2 gap-3">
            <Capability icon="➕" label="Add a new application" />
            <Capability icon="✏️" label="Update status, salary, or any field" />
            <Capability icon="🗑️" label="Delete an application" />
            <Capability icon="📋" label="Show your pipeline summary" />
            <Capability icon="📅" label="Add an interview round" />
            <Capability icon="📝" label="Add notes or contacts" />
            <Capability icon="🎯" label="Run gap analysis (resume vs JD)" />
            <Capability icon="✉️" label="Generate a tailored cover letter" />
            <Capability icon="🔍" label="Find similar roles you've saved" />
            <Capability icon="✨" label="Rewrite a resume bullet 3 ways" />
            <Capability icon="📄" label="List or download your resumes" />
            <Capability icon="📦" label="Export everything as a file" />
          </div>
        </section>

        {/* CTA */}
        <section className="mt-24 text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Ready to chat your way through the search?
          </h2>
          <p className="text-[color:var(--text-muted)] mb-8 max-w-xl mx-auto">
            No credit card. No 14-step onboarding. Just sign up and start talking.
          </p>
          {isAuthed ? (
            <div className="flex gap-3 justify-center">
              <Link href="/" className="btn-primary text-sm px-6 py-3 inline-block">
                Open the chat
              </Link>
              <Link href="/dashboard" className="btn-secondary text-sm px-6 py-3 inline-block">
                Go to dashboard
              </Link>
            </div>
          ) : (
            <div className="flex gap-3 justify-center">
              <Link href="/signup" className="btn-primary text-sm px-6 py-3 inline-block">
                Get started — it's free
              </Link>
              <Link href="/" className="btn-secondary text-sm px-6 py-3 inline-block">
                Try the demo
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}


function Step({
  number,
  title,
  body,
  examples,
}: {
  number: string
  title: string
  body: string
  examples?: { user: string; agent: string }[]
}) {
  return (
    <section className="mb-20">
      <div className="flex items-baseline gap-4 mb-3">
        <span className="text-sm font-mono text-[color:var(--accent)] tracking-wider">
          {number}
        </span>
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">{title}</h2>
      </div>
      <p className="text-[color:var(--text-muted)] mb-6 leading-relaxed">
        {body}
      </p>

      {examples && examples.length > 0 && (
        <div className="space-y-3">
          {examples.map((ex, i) => (
            <div key={i} className="card space-y-2 p-4">
              <ChatBubble role="user" text={ex.user} />
              <ChatBubble role="agent" text={ex.agent} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}


function ChatBubble({ role, text }: { role: "user" | "agent"; text: string }) {
  const isUser = role === "user"
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? "bg-[color:var(--accent)] text-white rounded-br-md"
            : "bg-[color:var(--bg-hover)] text-[color:var(--text)] rounded-bl-md"
        }`}
      >
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-1 text-xs text-[color:var(--accent)] font-semibold">
            <span className="logo-dot" />
            JobAgent
          </div>
        )}
        {text}
      </div>
    </div>
  )
}


function Capability({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="card flex items-center gap-3 hover:border-[color:var(--accent)] transition-colors">
      <span className="text-xl">{icon}</span>
      <span className="text-sm text-[color:var(--text)]">{label}</span>
    </div>
  )
}