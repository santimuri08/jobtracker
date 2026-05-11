// frontend/src/app/how-it-works/page.tsx
"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"
import { Reveal, GradientText } from "@/components/Reveal"
import { TiltCard } from "@/components/TiltCard"
import { MagneticButton } from "@/components/MagneticButton"

export default function HowItWorksPage() {
  const { status } = useSession()
  const isAuthed = status === "authenticated"

  return (
    <main className="relative min-h-[calc(100vh-4rem)]">
      <div
        className="absolute inset-x-0 top-0 h-[600px] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 20%, var(--accent-glow), transparent 70%)",
        }}
      />

      <div className="relative max-w-4xl mx-auto px-6 pt-20 pb-32">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 border border-[color:var(--border-strong)] bg-[color:var(--bg-elevated)] text-xs uppercase tracking-wider text-[color:var(--text-muted)]"
            style={{ borderRadius: "var(--radius-pill)" }}
          >
            <span className="logo-dot" />
            How it works
          </div>
        </div>

        <h1 className="font-display-hero text-5xl md:text-7xl text-center leading-[1.02] mb-8 hover-glow">
          <Reveal mode="word" eager className="block font-light">
            Your job search,
          </Reveal>
          <Reveal mode="word" delay={400} eager className="block font-bold mt-2">
            run by an <GradientText glow>agent.</GradientText>
          </Reveal>
        </h1>

        <Reveal mode="line" delay={1000} eager as="p" className="text-lg md:text-xl text-[color:var(--text-muted)] text-center max-w-2xl mx-auto mb-24 leading-relaxed">
          JobAgent is a chat-first tool. You talk to it like you&apos;d text a friend who&apos;s helping you job hunt — and it actually does the work.
        </Reveal>

        <Step
          number="01"
          title="Tell the agent what just happened"
          body="No forms, no clicking through wizards. Just say what you did. The agent extracts the company, role, location, salary range, status — anything you mentioned — and saves it. If something's missing, it asks."
          examples={[
            { user: "I just applied to Stripe for a senior backend role, remote, 180–220k.", agent: "Got it. I added Stripe — Senior Backend Engineer, Remote, $180k–220k. Want to paste the job description so I can run gap analysis later?" },
            { user: "Got an interview with Figma next Tuesday at 2pm.", agent: "Updated Figma to interviewing and added a phone screen for next Tuesday at 2pm. Who's the interviewer?" },
          ]}
        />

        <Step
          number="02"
          title="Ask for AI help, in plain language"
          body="Cover letters, gap analysis, similar roles, bullet rewrites — every AI feature is one sentence away. The agent picks the right tool and runs it on the right application."
          examples={[
            { user: "Write me a cover letter for the Stripe one. Make it enthusiastic.", agent: "Done — here's Draft 1 of your cover letter for Stripe. Want me to make it shorter or change the tone?" },
            { user: "What am I missing for the Figma role?", agent: "Fit score: 72/100. You have strong React and TypeScript matches. Missing: design-systems experience, accessibility expertise. Recommendations: add your work on the Storybook migration, mention WCAG audits..." },
          ]}
        />

        <Step
          number="03"
          title="Track it all in the dashboard"
          body="The chat is the fast lane. The dashboard is the structured view. Pipeline tiles, status filters, sort by date — everything you'd expect from a tracker, plus a floating chat bubble in the corner so the agent is always one click away."
          examples={[
            { user: "How many apps am I waiting on?", agent: "You have 4 saved, 2 applied, 1 interviewing. The Datadog one has been pending for 12 days — want me to draft a follow-up email?" },
          ]}
        />

        <Step
          number="04"
          title="Get a weekly recap by email"
          body="Every Monday morning, JobAgent emails you a summary: what you applied to, what's pending, suggested next steps. Toggle it on or off from the dashboard."
        />

        <section className="mt-32 mb-20">
          <Reveal as="h2" className="font-display block text-4xl md:text-5xl font-bold tracking-tight text-center mb-4 leading-[1.05]">
            What the agent can do
          </Reveal>
          <Reveal as="p" delay={120} className="block text-[color:var(--text-muted)] text-center mb-14 text-base md:text-lg">
            Every action below is one chat message away.
          </Reveal>

          <div className="grid md:grid-cols-2 gap-4">
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

        <section className="mt-32 text-center">
          <Reveal as="h2" className="font-display-hero block text-4xl md:text-5xl font-bold tracking-tight mb-6 leading-[1.05] hover-glow">
            Ready to chat your way <br className="hidden md:block" />
            through the <GradientText glow>search?</GradientText>
          </Reveal>
          <Reveal as="p" delay={150} className="block text-[color:var(--text-muted)] mb-12 max-w-xl mx-auto text-base md:text-lg">
            No credit card. No 14-step onboarding. Just sign up and start talking.
          </Reveal>

          {isAuthed ? (
            <div className="flex gap-4 justify-center">
              <MagneticButton href="/" className="btn-primary text-sm">
                Open the chat
              </MagneticButton>
              <MagneticButton href="/dashboard" className="btn-secondary text-sm">
                Go to dashboard
              </MagneticButton>
            </div>
          ) : (
            <div className="flex gap-4 justify-center">
              <MagneticButton href="/signup" className="btn-primary text-sm">
                Get started — it&apos;s free
              </MagneticButton>
              <MagneticButton href="/" className="btn-secondary text-sm">
                Try the demo
              </MagneticButton>
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
    <section className="mb-24 scroll-fade">
      <div className="flex items-baseline gap-4 mb-4">
        <span className="text-sm font-mono text-[color:var(--accent)] tracking-wider">
          {number}
        </span>
        <Reveal as="h2" className="font-display block text-2xl md:text-3xl font-bold tracking-tight">
          {title}
        </Reveal>
      </div>
      <Reveal as="p" delay={100} className="block text-[color:var(--text-muted)] mb-8 leading-relaxed text-base md:text-lg">
        {body}
      </Reveal>

      {examples && examples.length > 0 && (
        <div className="space-y-4">
          {examples.map((ex, i) => (
            <div key={i} className="card space-y-3">
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
        className={`max-w-[85%] px-5 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-[color:var(--accent)] text-white"
            : "bg-[color:var(--bg-hover)] text-[color:var(--text)]"
        }`}
        style={{
          borderRadius: "var(--radius-md)",
          ...(isUser
            ? { borderBottomRightRadius: "8px" }
            : { borderBottomLeftRadius: "8px" }),
        }}
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
    <TiltCard
      max={5}
      glareOpacity={0.08}
      className="card hover:border-[color:var(--accent)] transition-colors h-full"
    >
      <div className="flex items-center gap-4">
        <span className="text-xl">{icon}</span>
        <span className="text-sm text-[color:var(--text)]">{label}</span>
      </div>
    </TiltCard>
  )
}