// frontend/src/app/inside/page.tsx
"use client"

import { useSession } from "next-auth/react"
import {
  Plus,
  Pencil,
  Trash2,
  LayoutDashboard,
  CalendarDays,
  StickyNote,
  Target,
  Mail,
  Search,
  Sparkles,
  FileText,
  Download,
  Lock,
} from "lucide-react"
import { Reveal, GradientText } from "@/components/Reveal"
import { TiltCard } from "@/components/TiltCard"
import { MagneticButton } from "@/components/MagneticButton"

export default function InsidePage() {
  const { status } = useSession()
  const isAuthed = status === "authenticated"

  return (
    <main className="relative">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[600px] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 20%, var(--accent-soft), transparent 70%)",
        }}
      />

      <div className="relative max-w-5xl mx-auto px-6">
        {/*
          Page intro
          ---------------------------------------------------------- */}
        <Section number="00" connector="below" label="Inside">
          <div className="pt-8 md:pt-12 pb-16 text-center">
            <div
              className="inline-flex items-center gap-2 px-4 py-1.5 border border-[color:var(--border-strong)] bg-[color:var(--bg-elevated)]/60 backdrop-blur-md text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)] mb-10"
              style={{ borderRadius: "var(--radius-pill)" }}
            >
              <span className="logo-dot" />
              Inside JobAgent
            </div>

            <h1 className="font-display-hero text-5xl md:text-7xl text-center leading-[0.98] mb-8 hover-glow">
              <Reveal mode="word" eager className="block font-light">
                Your job search,
              </Reveal>
              <Reveal mode="word" delay={400} eager className="block font-bold mt-2">
                run by an <GradientText glow>agent.</GradientText>
              </Reveal>
            </h1>

            <Reveal
              mode="line"
              delay={1000}
              eager
              as="p"
              className="text-base md:text-lg text-[color:var(--text-muted)] max-w-xl mx-auto leading-relaxed"
            >
              JobAgent is a chat-first tool. You talk to it like you'd text a friend who's helping you job hunt — and it actually does the work.
            </Reveal>
          </div>
        </Section>

        {/*
          02 — The problem
          ---------------------------------------------------------- */}
        <Section number="02" connector="both" label="The problem">
          <div className="py-24">
            <Reveal as="h2" className="font-display-hero block text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] mb-8 max-w-3xl">
              Spreadsheets and tabs <br className="hidden md:block" />
              were never the answer.
            </Reveal>
            <Reveal as="p" delay={150} className="block text-lg md:text-xl text-[color:var(--text-muted)] max-w-2xl leading-relaxed">
              A job search lives across five tools — a doc, a sheet, your inbox, a notes app, your memory. By week three, none of them agree. By week six, you stop updating any of them.
            </Reveal>

            <div className="grid md:grid-cols-3 gap-5 mt-14">
              <PainPoint
                label="Lost context"
                body="You can't remember what you applied to last Tuesday, let alone what role."
              />
              <PainPoint
                label="Manual work"
                body="Every application means filling the same form five times. You stop doing it."
              />
              <PainPoint
                label="No leverage"
                body="Your tracker can't write cover letters, analyze fit, or surface what's pending."
              />
            </div>
          </div>
        </Section>

        {/*
          03 — The shift
          ---------------------------------------------------------- */}
        <Section number="03" connector="both" label="The shift">
          <div className="py-24">
            <Reveal as="h2" className="font-display-hero block text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] mb-8 max-w-3xl">
              Just <GradientText glow>tell</GradientText> your agent <br className="hidden md:block" />
              what happened.
            </Reveal>
            <Reveal as="p" delay={150} className="block text-lg md:text-xl text-[color:var(--text-muted)] max-w-2xl leading-relaxed mb-14">
              No forms. No fields. No "select status from dropdown." Just type a sentence the way you'd text a friend who's helping you job hunt.
            </Reveal>

            <div className="card max-w-3xl">
              <ChatExample
                user="I just applied to Stripe for a senior backend role, remote, 180–220k."
                agent="Got it. I added Stripe — Senior Backend Engineer, Remote, $180k–220k. Want to paste the JD so I can run gap analysis later?"
              />
              <div className="my-5 border-t border-[color:var(--border)]" />
              <ChatExample
                user="Got an interview with Figma next Tuesday at 2pm."
                agent="Updated Figma to interviewing and added a phone screen for next Tuesday at 2pm. Who's the interviewer?"
              />
            </div>
          </div>
        </Section>

        {/*
          04 — The toolkit
          ---------------------------------------------------------- */}
        <Section number="04" connector="both" label="What it does for you">
          <div className="py-24">
            <Reveal as="h2" className="font-display-hero block text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] mb-8 max-w-3xl">
              A whole toolkit, <br className="hidden md:block" />
              one sentence away.
            </Reveal>
            <Reveal as="p" delay={150} className="block text-lg md:text-xl text-[color:var(--text-muted)] max-w-2xl leading-relaxed mb-14">
              Cover letters, gap analysis, similar-role search, bullet rewrites. Ask in plain language; the agent picks the right tool and runs it on the right application.
            </Reveal>

            <div className="grid md:grid-cols-3 gap-5">
              <TiltCard className="card hover:border-[color:var(--accent)] transition-colors h-full">
                <FeatureContent
                  eyebrow="01 — Compose"
                  title="Tailored cover letters"
                  body="Generate a draft for any application, in any tone. Edit, regenerate, keep the version you like."
                />
              </TiltCard>
              <TiltCard className="card hover:border-[color:var(--accent)] transition-colors h-full">
                <FeatureContent
                  eyebrow="02 — Analyze"
                  title="Resume vs. JD gap"
                  body="See your fit score, what matches, what's missing, and what to add — all from a single ask."
                />
              </TiltCard>
              <TiltCard className="card hover:border-[color:var(--accent)] transition-colors h-full">
                <FeatureContent
                  eyebrow="03 — Discover"
                  title="Find similar roles"
                  body="Semantic search across your saved applications. 'Find roles like Stripe' returns the matches."
                />
              </TiltCard>
            </div>
          </div>
        </Section>

        {/*
          05 — In practice
          ---------------------------------------------------------- */}
        <Section number="05" connector="both" label="In practice">
          <div className="py-24">
            <Reveal as="h2" className="font-display-hero block text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] mb-8 max-w-3xl">
              One conversation, <br className="hidden md:block" />
              a fully tracked search.
            </Reveal>
            <Reveal as="p" delay={150} className="block text-lg md:text-xl text-[color:var(--text-muted)] max-w-2xl leading-relaxed mb-14">
              Three minutes of talking on Monday gives you a complete picture by Friday. No catching up, no re-entering, no apologies to your spreadsheet.
            </Reveal>

            <div className="space-y-4 max-w-3xl">
              <TimelineStep
                when="Monday morning"
                what='"I applied to Stripe and Figma last week."'
                result="Two applications added. Status set. Salary ranges captured."
              />
              <TimelineStep
                when="Wednesday"
                what='"Write a cover letter for the Figma role."'
                result="Draft generated in 12 seconds, saved against that application."
              />
              <TimelineStep
                when="Thursday"
                what='"Got a phone screen with Stripe next Tuesday."'
                result="Interview round added. Status moved to interviewing."
              />
              <TimelineStep
                when="Sunday night"
                what='"What am I waiting on?"'
                result="Four pending. Two interviewing. Stripe response overdue by 9 days."
              />
            </div>
          </div>
        </Section>

        {/*
          06 — The full capability surface
          Each capability is a thin-stroke Lucide icon + label inside a TiltCard.
          ---------------------------------------------------------- */}
        <Section number="06" connector="both" label="Everything you can ask">
          <div className="py-24">
            <Reveal as="h2" className="font-display-hero block text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] mb-8 max-w-3xl">
              Every action, <br className="hidden md:block" />
              one message away.
            </Reveal>
            <Reveal as="p" delay={150} className="block text-lg md:text-xl text-[color:var(--text-muted)] max-w-2xl leading-relaxed mb-14">
              The agent has tools for every step. You don't have to know which one — just say what you need.
            </Reveal>

            <div className="grid md:grid-cols-2 gap-4">
              <Capability Icon={Plus} label="Add a new application" />
              <Capability Icon={Pencil} label="Update status, salary, or any field" />
              <Capability Icon={Trash2} label="Delete an application" />
              <Capability Icon={LayoutDashboard} label="Show your pipeline summary" />
              <Capability Icon={CalendarDays} label="Add an interview round" />
              <Capability Icon={StickyNote} label="Add notes or contacts" />
              <Capability Icon={Target} label="Run gap analysis (resume vs JD)" />
              <Capability Icon={Mail} label="Generate a tailored cover letter" />
              <Capability Icon={Search} label="Find similar roles you've saved" />
              <Capability Icon={Sparkles} label="Rewrite a resume bullet 3 ways" />
              <Capability Icon={FileText} label="List or download your resumes" />
              <Capability Icon={Download} label="Export everything as a file" />
            </div>
          </div>
        </Section>

        {/*
          07 — Trust + data control
          ---------------------------------------------------------- */}
        <Section number="07" connector="both" label="Your data, your control">
          <div className="py-24">
            <Reveal as="h2" className="font-display-hero block text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] mb-8 max-w-3xl">
              <GradientText glow>Yours</GradientText>. Always.
            </Reveal>
            <Reveal as="p" delay={150} className="block text-lg md:text-xl text-[color:var(--text-muted)] max-w-2xl leading-relaxed mb-14">
              Your applications, resumes, interview notes — they belong to you. Export everything any time. Delete anything any time. Nothing trains anyone else's model.
            </Reveal>

            <div className="grid md:grid-cols-2 gap-5">
              <TrustPillar
                Icon={Lock}
                title="Encrypted in transit and at rest"
                body="Every request uses TLS. Every credential is hashed. Your job-search data isn't a product."
              />
              <TrustPillar
                Icon={Download}
                title="One click to export it all"
                body="Take your full history with you anytime — apps, notes, rounds, contacts, generated content. JSON or CSV."
              />
            </div>
          </div>
        </Section>

        {/*
          08 — CTA
          ---------------------------------------------------------- */}
        <Section number="08" connector="above" label="Start">
          <div className="py-32 text-center">
            <Reveal as="h2" className="font-display-hero block text-5xl md:text-7xl font-bold tracking-tight leading-[1.02] mb-8 hover-glow">
              Ready to <GradientText glow>land it?</GradientText>
            </Reveal>
            <Reveal as="p" delay={150} className="block text-lg md:text-xl text-[color:var(--text-muted)] max-w-xl mx-auto mb-12 leading-relaxed">
              No credit card. No 14-step onboarding. Just sign up and start talking.
            </Reveal>

            <div className="flex gap-4 justify-center flex-wrap">
              {isAuthed ? (
                <>
                  <MagneticButton href="/" className="btn-primary text-base px-8 py-4">
                    Open the chat
                  </MagneticButton>
                  <MagneticButton href="/dashboard" className="btn-secondary text-base px-8 py-4">
                    Go to dashboard
                  </MagneticButton>
                </>
              ) : (
                <>
                  <MagneticButton href="/signup" className="btn-primary text-base px-8 py-4">
                    Get started — it&apos;s free
                  </MagneticButton>
                  <MagneticButton href="/" className="btn-secondary text-base px-8 py-4">
                    Try the demo
                  </MagneticButton>
                </>
              )}
            </div>
          </div>
        </Section>
      </div>
    </main>
  )
}

/* ============================================================
   Section primitive — unchanged
   ============================================================ */

function Section({
  number,
  label,
  connector,
  children,
}: {
  number: string
  label?: string
  connector: "above" | "below" | "both" | "none"
  children: React.ReactNode
}) {
  return (
    <section className="relative">
      {(connector === "above" || connector === "both") && (
        <div
          aria-hidden
          className="absolute left-6 top-0 w-px h-24 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, rgba(59,130,246,0.35) 100%)",
          }}
        />
      )}
      {(connector === "below" || connector === "both") && (
        <div
          aria-hidden
          className="absolute left-6 bottom-0 w-px h-24 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(59,130,246,0.35) 0%, transparent 100%)",
          }}
        />
      )}

      {(number || label) && connector !== "none" && (
        <div className="absolute left-0 top-24 pointer-events-none hidden md:flex flex-col items-start gap-1">
          <span className="font-mono text-xs text-[color:var(--accent)] tracking-[0.2em]">
            {number}
          </span>
          {label && (
            <span className="font-mono text-[10px] text-[color:var(--text-dim)] uppercase tracking-[0.18em] [writing-mode:vertical-rl] [text-orientation:mixed] mt-2">
              {label}
            </span>
          )}
        </div>
      )}

      <div className="md:pl-16 relative">
        {children}
      </div>
    </section>
  )
}

/* ============================================================
   Content primitives
   ============================================================ */

function PainPoint({ label, body }: { label: string; body: string }) {
  return (
    <Reveal as="div" className="card block">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--text-dim)] mb-3">
        {label}
      </div>
      <p className="text-base text-[color:var(--text)] leading-relaxed">
        {body}
      </p>
    </Reveal>
  )
}

function FeatureContent({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string
  title: string
  body: string
}) {
  return (
    <>
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--accent)] mb-3">
        {eyebrow}
      </div>
      <h3 className="font-display font-semibold text-lg mb-3">{title}</h3>
      <p className="text-sm text-[color:var(--text-muted)] leading-relaxed">{body}</p>
    </>
  )
}

function ChatExample({ user, agent }: { user: string; agent: string }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div
          className="max-w-[85%] px-5 py-3 text-sm leading-relaxed bg-[color:var(--accent)] text-white"
          style={{ borderRadius: "var(--radius-md)", borderBottomRightRadius: "8px" }}
        >
          {user}
        </div>
      </div>
      <div className="flex justify-start">
        <div
          className="max-w-[85%] px-5 py-3 text-sm leading-relaxed bg-[color:var(--bg-hover)] text-[color:var(--text)]"
          style={{ borderRadius: "var(--radius-md)", borderBottomLeftRadius: "8px" }}
        >
          <div className="flex items-center gap-1.5 mb-1 text-xs text-[color:var(--accent)] font-semibold">
            <span className="logo-dot" />
            JobAgent
          </div>
          {agent}
        </div>
      </div>
    </div>
  )
}

function TimelineStep({
  when,
  what,
  result,
}: {
  when: string
  what: string
  result: string
}) {
  return (
    <Reveal as="div" className="card flex flex-col md:flex-row md:items-start gap-4">
      <div className="md:w-40 flex-shrink-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--accent)]">
          {when}
        </div>
      </div>
      <div className="flex-1 space-y-2">
        <div className="text-[color:var(--text)] italic">{what}</div>
        <div className="text-sm text-[color:var(--text-muted)]">→ {result}</div>
      </div>
    </Reveal>
  )
}

/* ============================================================
   Icon-bearing primitives — receive a Lucide component as a prop.
   Same hover language as the menu items: icon tile turns accent on
   parent hover, container border turns accent.
   ============================================================ */

type LucideIcon = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

function TrustPillar({
  Icon,
  title,
  body,
}: {
  Icon: LucideIcon
  title: string
  body: string
}) {
  return (
    <TiltCard className="card hover:border-[color:var(--accent)] transition-colors h-full group">
      <div className="flex items-start gap-4">
        <div
          className="
            flex-shrink-0 flex items-center justify-center w-11 h-11
            border border-[color:var(--border)]
            bg-[color:var(--bg-hover)]/60
            text-[color:var(--text-muted)]
            group-hover:text-[color:var(--accent)]
            group-hover:border-[color:var(--accent)]
            transition-all duration-500
          "
          style={{
            borderRadius: "var(--radius-md)",
            transitionTimingFunction: "var(--ease)",
          }}
        >
          <Icon size={18} strokeWidth={1.5} />
        </div>
        <div>
          <h3 className="font-display font-semibold text-lg mb-2">{title}</h3>
          <p className="text-sm text-[color:var(--text-muted)] leading-relaxed">{body}</p>
        </div>
      </div>
    </TiltCard>
  )
}

function Capability({ Icon, label }: { Icon: LucideIcon; label: string }) {
  return (
    <TiltCard
      max={3}
      glareOpacity={0.06}
      className="card hover:border-[color:var(--accent)] transition-colors h-full group"
    >
      <div className="flex items-center gap-4">
        <div
          className="
            flex-shrink-0 flex items-center justify-center w-10 h-10
            border border-[color:var(--border)]
            bg-[color:var(--bg-hover)]/60
            text-[color:var(--text-muted)]
            group-hover:text-[color:var(--accent)]
            group-hover:border-[color:var(--accent)]
            transition-all duration-500
          "
          style={{
            borderRadius: "var(--radius-sm)",
            transitionTimingFunction: "var(--ease)",
          }}
        >
          <Icon size={16} strokeWidth={1.5} />
        </div>
        <span className="text-sm text-[color:var(--text)]">{label}</span>
      </div>
    </TiltCard>
  )
}