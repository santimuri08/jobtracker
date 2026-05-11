// frontend/src/app/applications/[id]/page.tsx
"use client"
import { useSession } from "next-auth/react"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/api"
import { Reveal, GradientText } from "@/components/Reveal"

/* ============================================================
   Types — unchanged
   ============================================================ */

type Round = { id: number; round_number: number; type: string; scheduled_at: string | null; interviewer: string | null; outcome: string; notes: string | null }
type Contact = { id: number; name: string; role: string | null; email: string | null; phone: string | null }
type Note = { id: number; content: string; created_at: string }
type ExperienceGap = { requirement: string; your_experience: string | null; gap: string }
type GapAnalysis = {
  id: number
  application_id: number
  fit_score: number | null
  matched_skills: string[] | null
  missing_skills: string[] | null
  experience_gaps: ExperienceGap[] | null
  recommendations: string[] | null
  summary: string | null
  created_at: string
  updated_at: string
}
type CoverLetter = {
  id: number
  application_id: number
  content: string
  version_label: string | null
  is_active: boolean
  generator_version: string
  created_at: string
  updated_at: string
}
type BulletVariant = { style: string; text: string; rationale: string | null }
type BulletRewriteResult = { original: string; variants: BulletVariant[] }
type SimilarApp = {
  id: number
  company: string
  role: string
  location: string | null
  status: string
  similarity: number
}
type AppDetail = {
  id: number
  company: string
  role: string
  status: string
  location: string | null
  job_url: string | null
  job_description: string | null
  salary_min: number | null
  salary_max: number | null
  applied_date: string | null
  source: string | null
  resume_id: number | null
  interview_rounds: Round[]
  contacts: Contact[]
  notes: Note[]
}

const STATUS_COLORS: Record<string, string> = {
  saved: "bg-[color:var(--bg-hover)] text-[color:var(--text-muted)]",
  applied: "bg-[color:var(--accent-soft)] text-[color:var(--accent)]",
  interviewing: "bg-[rgba(226,178,122,0.10)] text-[color:var(--warning)]",
  offer: "bg-[rgba(91,197,150,0.12)] text-[color:var(--success)]",
  rejected: "bg-[rgba(224,133,137,0.10)] text-[color:var(--danger)]",
  withdrawn: "bg-[color:var(--bg-hover)] text-[color:var(--text-dim)]",
}

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: session } = useSession()
  const router = useRouter()
  const [appData, setAppData] = useState<AppDetail | null>(null)
  const [error, setError] = useState("")
  const [showJD, setShowJD] = useState(false)

  const load = useCallback(async () => {
    if (!session?.backendToken) return
    try {
      const data = await apiFetch(`/api/v1/applications/${id}`, session.backendToken)
      setAppData(data)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [session, id])
  useEffect(() => { load() }, [load])

  async function updateStatus(newStatus: string) {
    if (!session?.backendToken) return
    await apiFetch(`/api/v1/applications/${id}`, session.backendToken, {
      method: "PATCH", body: JSON.stringify({ status: newStatus }),
    })
    load()
  }
  async function deleteApp() {
    if (!session?.backendToken) return
    if (!confirm("Delete this application and all its data?")) return
    await apiFetch(`/api/v1/applications/${id}`, session.backendToken, { method: "DELETE" })
    router.push("/dashboard")
  }
  async function addRound() {
    if (!session?.backendToken || !appData) return
    await apiFetch(`/api/v1/applications/${id}/rounds`, session.backendToken, {
      method: "POST",
      body: JSON.stringify({ round_number: appData.interview_rounds.length + 1, type: "phone_screen" }),
    })
    load()
  }
  async function deleteRound(roundId: number) {
    if (!session?.backendToken) return
    await apiFetch(`/api/v1/applications/${id}/rounds/${roundId}`, session.backendToken, { method: "DELETE" })
    load()
  }
  async function addContact(name: string, role: string) {
    if (!session?.backendToken) return
    await apiFetch(`/api/v1/applications/${id}/contacts`, session.backendToken, {
      method: "POST", body: JSON.stringify({ name, role: role || null }),
    })
    load()
  }
  async function addNote(content: string) {
    if (!session?.backendToken || !content.trim()) return
    await apiFetch(`/api/v1/applications/${id}/notes`, session.backendToken, {
      method: "POST", body: JSON.stringify({ content }),
    })
    load()
  }

  if (error) return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <p className="text-[color:var(--danger)]">{error}</p>
    </main>
  )
  if (!appData) return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <p className="text-[color:var(--text-muted)]">Loading…</p>
    </main>
  )

  return (
    <main className="relative max-w-3xl mx-auto px-6 py-12 md:py-16">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[500px] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 0%, var(--accent-soft), transparent 70%)",
        }}
      />

      <div className="relative">
        {/* Back link */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-[color:var(--text-muted)] hover:text-[color:var(--accent)] transition-colors mb-8"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to dashboard
        </Link>

        {/* Header card — company + role + status + meta */}
        <section className="card mb-8">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-[0.18em] text-[color:var(--accent)] mb-2">
                Application
              </div>
              <Reveal
                as="h1"
                eager
                className="font-display-hero block text-4xl md:text-5xl font-bold leading-[1.02] hover-glow break-words"
              >
                <GradientText>{appData.company}</GradientText>
              </Reveal>
              <Reveal as="p" delay={100} eager className="block text-lg md:text-xl text-[color:var(--text)] mt-3">
                {appData.role}
              </Reveal>
              {appData.location && (
                <Reveal as="p" delay={150} eager className="block text-sm text-[color:var(--text-muted)] mt-1">
                  {appData.location}
                </Reveal>
              )}
            </div>

            <button
              onClick={deleteApp}
              className="flex-shrink-0 text-xs text-[color:var(--text-dim)] hover:text-[color:var(--danger)] px-3 py-1.5 border border-[color:var(--border)] hover:border-[color:var(--danger)] transition-colors"
              style={{ borderRadius: "var(--radius-sm)" }}
            >
              Delete application
            </button>
          </div>

          {/* Status + meta row */}
          <div className="mt-6 pt-6 border-t border-[color:var(--border)] flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs uppercase tracking-[0.15em] text-[color:var(--text-dim)]">Status</span>
              <select
                value={appData.status}
                onChange={(e) => updateStatus(e.target.value)}
                className="text-sm px-3 py-1.5"
                style={{ borderRadius: "var(--radius-sm)" }}
              >
                {["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <span
                className={`text-xs px-3 py-1.5 font-medium ${STATUS_COLORS[appData.status] || ""}`}
                style={{ borderRadius: "var(--radius-xs)" }}
              >
                {appData.status}
              </span>
            </div>

            {(appData.salary_min || appData.salary_max) && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-xs uppercase tracking-[0.15em] text-[color:var(--text-dim)]">Salary</span>
                <span className="text-[color:var(--text)]">
                  ${appData.salary_min ?? "?"} – ${appData.salary_max ?? "?"}
                </span>
              </div>
            )}

            {appData.job_url && (
              <a
                href={appData.job_url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1.5 text-sm text-[color:var(--accent)] hover:underline"
              >
                View posting
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            )}
          </div>

          {/* Job description toggle */}
          {appData.job_description && (
            <div className="mt-4">
              <button
                onClick={() => setShowJD(v => !v)}
                className="flex items-center gap-2 text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text)] transition-colors"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    transform: showJD ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform var(--duration-base) var(--ease)",
                  }}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                Job description
              </button>
              {showJD && (
                <pre
                  className="mt-4 text-sm whitespace-pre-wrap p-4 text-[color:var(--text-muted)] font-body leading-relaxed bg-[color:var(--bg)] border border-[color:var(--border)]"
                  style={{ borderRadius: "var(--radius-md)" }}
                >
                  {appData.job_description}
                </pre>
              )}
            </div>
          )}
        </section>

        {/* AI tools */}
        {session?.backendToken && (
          <GapAnalysisCard
            applicationId={appData.id}
            token={session.backendToken}
            hasResume={!!appData.resume_id}
            hasJobDescription={!!appData.job_description}
          />
        )}

        {session?.backendToken && (
          <CoverLetterCard
            applicationId={String(appData.id)}
            token={session.backendToken}
            hasJobDescription={!!appData.job_description}
            hasResume={!!appData.resume_id}
          />
        )}

        {session?.backendToken && (
          <SimilarApplicationsCard
            applicationId={appData.id}
            token={session.backendToken}
            hasJobDescription={!!appData.job_description}
          />
        )}

        {session?.backendToken && (
          <BulletRewriterCard
            jobDescription={appData.job_description}
            token={session.backendToken}
          />
        )}

        {/* Interview rounds */}
        <section className="mt-8 card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display font-semibold text-lg flex items-center gap-2">
              <span className="logo-dot" />
              Interview rounds
            </h2>
            <button
              onClick={addRound}
              className="text-sm text-[color:var(--text-muted)] hover:text-[color:var(--accent)] px-3 py-1.5 border border-[color:var(--border)] hover:border-[color:var(--accent)] transition-colors"
              style={{ borderRadius: "var(--radius-sm)" }}
            >
              + Add round
            </button>
          </div>
          {appData.interview_rounds.length === 0 ? (
            <p className="text-sm text-[color:var(--text-dim)]">No rounds yet.</p>
          ) : (
            <ul className="space-y-3">
              {appData.interview_rounds.map(r => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-4 p-4 border border-[color:var(--border)]"
                  style={{ borderRadius: "var(--radius-md)" }}
                >
                  <div className="min-w-0">
                    <div className="font-medium text-[color:var(--text)]">
                      Round {r.round_number} — {r.type}
                    </div>
                    <div className="text-sm text-[color:var(--text-muted)] mt-0.5">
                      {r.outcome}{r.interviewer && ` · ${r.interviewer}`}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteRound(r.id)}
                    className="text-xs text-[color:var(--text-dim)] hover:text-[color:var(--danger)] transition-colors"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Contacts */}
        <section className="mt-8 card">
          <h2 className="font-display font-semibold text-lg mb-6 flex items-center gap-2">
            <span className="logo-dot" />
            Contacts
          </h2>
          <ContactAdder onAdd={addContact} />
          {appData.contacts.length > 0 && (
            <ul className="mt-5 space-y-2">
              {appData.contacts.map(c => (
                <li
                  key={c.id}
                  className="text-sm text-[color:var(--text)] py-2 border-b border-[color:var(--border)] last:border-b-0"
                >
                  {c.name}
                  {c.role && (
                    <span className="text-[color:var(--text-muted)]"> — {c.role}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Notes */}
        <section className="mt-8 card">
          <h2 className="font-display font-semibold text-lg mb-6 flex items-center gap-2">
            <span className="logo-dot" />
            Notes
          </h2>
          <NoteAdder onAdd={addNote} />
          {appData.notes.length > 0 && (
            <ul className="mt-5 space-y-3">
              {appData.notes.map(n => (
                <li
                  key={n.id}
                  className="text-sm p-4 border border-[color:var(--border)]"
                  style={{ borderRadius: "var(--radius-md)" }}
                >
                  <div className="text-xs text-[color:var(--text-dim)] mb-2">
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                  <div className="whitespace-pre-wrap text-[color:var(--text)]">
                    {n.content}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}

/* ============================================================
   GapAnalysisCard — state machine unchanged
   ============================================================ */

function GapAnalysisCard({
  applicationId,
  token,
  hasResume,
  hasJobDescription,
}: {
  applicationId: number
  token: string
  hasResume: boolean
  hasJobDescription: boolean
}) {
  const [analysis, setAnalysis] = useState<GapAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await apiFetch(
        `/api/v1/applications/${applicationId}/gap-analysis`,
        token
      )
      setAnalysis(data)
    } catch (e) {
      const msg = (e as Error).message
      if (!msg.toLowerCase().includes("404")) setErr(msg)
      setAnalysis(null)
    }
  }, [applicationId, token])

  useEffect(() => { load() }, [load])

  async function run() {
    setLoading(true); setErr(null)
    try {
      const data = await apiFetch(
        `/api/v1/applications/${applicationId}/gap-analysis`,
        token,
        { method: "POST" }
      )
      setAnalysis(data)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const disabled = loading || !hasResume || !hasJobDescription
  const buttonLabel = analysis ? "Run again" : "Run gap analysis"

  return (
    <section className="mt-8 card">
      <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
        <div>
          <h2 className="font-display font-semibold text-lg flex items-center gap-2">
            <span className="logo-dot" />
            Gap analysis
          </h2>
          <p className="text-sm text-[color:var(--text-muted)] mt-1">
            How your resume stacks up against this job description.
          </p>
        </div>
        {hasResume && hasJobDescription && (
          <button
            onClick={run}
            disabled={disabled}
            className="btn-primary text-sm"
          >
            {loading ? "Analyzing…" : buttonLabel}
          </button>
        )}
      </div>

      {!hasJobDescription && (
        <p className="text-sm text-[color:var(--text-dim)] mt-4">
          Add a job description to this application to enable gap analysis.
        </p>
      )}
      {hasJobDescription && !hasResume && (
        <p className="text-sm text-[color:var(--text-dim)] mt-4">
          Link a parsed resume to this application to enable gap analysis.
        </p>
      )}
      {err && <p className="text-sm text-[color:var(--danger)] mt-4">{err}</p>}

      {analysis && (
        <div className="mt-6 space-y-5">
          {/* Fit score */}
          <div className="flex items-baseline gap-3">
            <span className="text-xs uppercase tracking-[0.15em] text-[color:var(--text-dim)]">Fit score</span>
            <span className="font-display text-4xl font-bold text-[color:var(--text)]">
              {analysis.fit_score ?? "—"}
            </span>
            <span className="text-sm text-[color:var(--text-dim)]">/ 100</span>
          </div>

          {analysis.summary && (
            <p className="text-sm text-[color:var(--text)] leading-relaxed">
              {analysis.summary}
            </p>
          )}

          {analysis.matched_skills && analysis.matched_skills.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-[0.15em] text-[color:var(--text-dim)] mb-3">
                Matched skills
              </h3>
              <div className="flex flex-wrap gap-2">
                {analysis.matched_skills.map((s) => (
                  <span
                    key={s}
                    className="text-xs px-3 py-1.5 bg-[rgba(91,197,150,0.10)] text-[color:var(--success)]"
                    style={{ borderRadius: "var(--radius-xs)" }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {analysis.missing_skills && analysis.missing_skills.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-[0.15em] text-[color:var(--text-dim)] mb-3">
                Missing skills
              </h3>
              <div className="flex flex-wrap gap-2">
                {analysis.missing_skills.map((s) => (
                  <span
                    key={s}
                    className="text-xs px-3 py-1.5 bg-[rgba(224,133,137,0.10)] text-[color:var(--danger)]"
                    style={{ borderRadius: "var(--radius-xs)" }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {analysis.experience_gaps && analysis.experience_gaps.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-[0.15em] text-[color:var(--text-dim)] mb-3">
                Experience gaps
              </h3>
              <ul className="text-sm space-y-2">
                {analysis.experience_gaps.map((g, i) => (
                  <li key={i} className="text-[color:var(--text)]">
                    <strong className="text-[color:var(--text)]">{g.requirement}:</strong>{" "}
                    <span className="text-[color:var(--text-muted)]">{g.gap}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.recommendations && analysis.recommendations.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-[0.15em] text-[color:var(--text-dim)] mb-3">
                Recommendations
              </h3>
              <ul className="text-sm space-y-2 text-[color:var(--text)] leading-relaxed">
                {analysis.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-[color:var(--accent)] flex-shrink-0">→</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/* ============================================================
   CoverLetterCard — state machine unchanged
   ============================================================ */

function CoverLetterCard({
  applicationId,
  hasJobDescription,
  hasResume,
  token,
}: {
  applicationId: string
  hasJobDescription: boolean
  hasResume: boolean
  token: string
}) {
  const [letters, setLetters] = useState<CoverLetter[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [tone, setTone] = useState("")
  const [extra, setExtra] = useState("")

  const load = useCallback(async () => {
    try {
      const data: CoverLetter[] = await apiFetch(
        `/api/v1/applications/${applicationId}/cover-letters`,
        token,
      )
      setLetters(data)
      const active = data.find(l => l.is_active) ?? data[0] ?? null
      setActiveId(active?.id ?? null)
      setDraft(active?.content ?? "")
    } catch (e) {
      setError((e as Error).message)
    }
  }, [applicationId, token])

  useEffect(() => { load() }, [load])

  const active = letters.find(l => l.id === activeId) ?? null

  async function generate() {
    setLoading(true); setError("")
    try {
      const created: CoverLetter = await apiFetch(
        `/api/v1/applications/${applicationId}/cover-letters`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            tone: tone || null,
            extra_instructions: extra || null,
          }),
        },
      )
      await load()
      setActiveId(created.id)
      setDraft(created.content)
      setEditing(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function saveEdit() {
    if (!active) return
    setLoading(true); setError("")
    try {
      await apiFetch(
        `/api/v1/applications/${applicationId}/cover-letters/${active.id}`,
        token,
        { method: "PATCH", body: JSON.stringify({ content: draft }) },
      )
      await load()
      setEditing(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function setActive(letterId: number) {
    setLoading(true); setError("")
    try {
      await apiFetch(
        `/api/v1/applications/${applicationId}/cover-letters/${letterId}`,
        token,
        { method: "PATCH", body: JSON.stringify({ is_active: true }) },
      )
      await load()
      setActiveId(letterId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function deleteLetter(letterId: number) {
    if (!confirm("Delete this version?")) return
    setLoading(true); setError("")
    try {
      await apiFetch(
        `/api/v1/applications/${applicationId}/cover-letters/${letterId}`,
        token,
        { method: "DELETE" },
      )
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function copyToClipboard() {
    if (!active) return
    navigator.clipboard.writeText(active.content)
  }

  const canGenerate = hasJobDescription && hasResume

  return (
    <section className="mt-8 card">
      <div className="mb-6">
        <h2 className="font-display font-semibold text-lg flex items-center gap-2">
          <span className="logo-dot" />
          Cover letter
        </h2>
        <p className="text-sm text-[color:var(--text-muted)] mt-1">
          Generate a tailored draft. Keep multiple versions, edit and copy any of them.
        </p>
      </div>

      {!canGenerate && (
        <p className="text-sm text-[color:var(--text-dim)] mb-4">
          {!hasJobDescription && "Add a job description to this application. "}
          {!hasResume && "Link a resume (with a parsed version) to this application."}
        </p>
      )}

      {/* Generate controls */}
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs uppercase tracking-[0.15em] text-[color:var(--text-dim)] mb-2">
            Tone (optional)
          </label>
          <input
            value={tone}
            onChange={e => setTone(e.target.value)}
            placeholder="e.g. friendly, formal, enthusiastic"
            className="w-full text-sm"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-[0.15em] text-[color:var(--text-dim)] mb-2">
            Extra instructions (optional)
          </label>
          <input
            value={extra}
            onChange={e => setExtra(e.target.value)}
            placeholder="e.g. mention my open-source contributions"
            className="w-full text-sm"
          />
        </div>
      </div>
      <div className="mt-4">
        <button
          onClick={generate}
          disabled={!canGenerate || loading}
          className="btn-primary text-sm"
        >
          {loading ? "Working…" : letters.length === 0 ? "Generate" : "Generate new draft"}
        </button>
      </div>

      {error && <p className="text-[color:var(--danger)] text-sm mt-4">{error}</p>}

      {/* Version picker */}
      {letters.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-6">
          {letters.map(l => (
            <button
              key={l.id}
              onClick={() => { setActiveId(l.id); setDraft(l.content); setEditing(false) }}
              className={`text-xs px-3 py-1.5 border transition-colors ${
                l.id === activeId
                  ? "bg-[color:var(--accent)] text-white border-[color:var(--accent)]"
                  : "bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)] border-[color:var(--border)] hover:border-[color:var(--accent)] hover:text-[color:var(--text)]"
              }`}
              style={{ borderRadius: "var(--radius-sm)" }}
            >
              {l.version_label ?? `#${l.id}`}{l.is_active ? " ★" : ""}
            </button>
          ))}
        </div>
      )}

      {/* Active letter */}
      {active && (
        <div className="mt-6 pt-6 border-t border-[color:var(--border)]">
          <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
            <span className="text-xs text-[color:var(--text-dim)]">
              {active.version_label ?? `#${active.id}`} · updated {new Date(active.updated_at).toLocaleString()}
              {active.is_active && " · active"}
            </span>
            <div className="flex gap-3 text-xs">
              {!active.is_active && (
                <button onClick={() => setActive(active.id)} className="text-[color:var(--text-muted)] hover:text-[color:var(--accent)] transition-colors">
                  Make active
                </button>
              )}
              <button onClick={copyToClipboard} className="text-[color:var(--text-muted)] hover:text-[color:var(--accent)] transition-colors">
                Copy
              </button>
              <button onClick={() => setEditing(e => !e)} className="text-[color:var(--text-muted)] hover:text-[color:var(--accent)] transition-colors">
                {editing ? "Cancel" : "Edit"}
              </button>
              <button onClick={() => deleteLetter(active.id)} className="text-[color:var(--text-muted)] hover:text-[color:var(--danger)] transition-colors">
                Delete
              </button>
            </div>
          </div>

          {editing ? (
            <>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={14}
                className="w-full text-sm font-mono"
              />
              <div className="mt-3">
                <button onClick={saveEdit} disabled={loading} className="btn-primary text-sm">
                  {loading ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          ) : (
            <pre
              className="whitespace-pre-wrap text-sm p-4 text-[color:var(--text)] leading-relaxed font-body bg-[color:var(--bg)] border border-[color:var(--border)]"
              style={{ borderRadius: "var(--radius-md)" }}
            >
              {active.content}
            </pre>
          )}
        </div>
      )}
    </section>
  )
}

/* ============================================================
   SimilarApplicationsCard — state machine unchanged
   ============================================================ */

function SimilarApplicationsCard({
  applicationId,
  token,
  hasJobDescription,
}: {
  applicationId: number
  token: string
  hasJobDescription: boolean
}) {
  const [results, setResults] = useState<SimilarApp[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function search() {
    setLoading(true)
    setError("")
    try {
      const data: SimilarApp[] = await apiFetch(
        `/api/v1/applications/${applicationId}/similar?limit=5`,
        token,
      )
      setResults(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="mt-8 card">
      <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
        <div>
          <h2 className="font-display font-semibold text-lg flex items-center gap-2">
            <span className="logo-dot" />
            Similar applications
          </h2>
          <p className="text-sm text-[color:var(--text-muted)] mt-1">
            Find other roles you've saved that look like this one — by job description, not just company name.
          </p>
        </div>
        {hasJobDescription && (
          <button
            onClick={search}
            disabled={loading}
            className="btn-primary text-sm"
          >
            {loading ? "Searching…" : results ? "Search again" : "Find similar roles"}
          </button>
        )}
      </div>

      {!hasJobDescription && (
        <p className="text-sm text-[color:var(--text-dim)] mt-4">
          Add a job description to this application to enable similarity search.
        </p>
      )}

      {error && <p className="text-sm text-[color:var(--danger)] mt-4">{error}</p>}

      {results && results.length === 0 && (
        <p className="text-sm text-[color:var(--text-dim)] mt-4">
          No other applications with embeddings found yet. Save a few more applications with job descriptions to compare.
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="mt-6 space-y-3">
          {results.map((r) => (
            <li
              key={r.id}
              className="p-4 border border-[color:var(--border)] hover:border-[color:var(--accent)] transition-colors flex items-center justify-between gap-4"
              style={{ borderRadius: "var(--radius-md)" }}
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/applications/${r.id}`}
                  className="font-medium text-[color:var(--text)] hover:text-[color:var(--accent)] transition-colors block truncate"
                >
                  {r.role} — {r.company}
                </Link>
                <div className="text-xs text-[color:var(--text-dim)] mt-1">
                  {r.location || "—"} · {r.status}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-display text-2xl font-bold text-[color:var(--accent)]">
                  {(r.similarity * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-[color:var(--text-dim)]">match</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ============================================================
   BulletRewriterCard — state machine unchanged
   ============================================================ */

function BulletRewriterCard({
  jobDescription,
  token,
}: {
  jobDescription: string | null
  token: string
}) {
  const [bullet, setBullet] = useState("")
  const [result, setResult] = useState<BulletRewriteResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function rewrite() {
    if (!bullet.trim()) return
    setLoading(true); setError(""); setResult(null)
    try {
      const data: BulletRewriteResult = await apiFetch(
        `/api/v1/bullet-rewrites`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            bullet,
            job_description: jobDescription,
          }),
        },
      )
      setResult(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text)
  }

  return (
    <section className="mt-8 card">
      <div className="mb-6">
        <h2 className="font-display font-semibold text-lg flex items-center gap-2">
          <span className="logo-dot" />
          Bullet rewriter
        </h2>
        <p className="text-sm text-[color:var(--text-muted)] mt-1">
          Paste one resume bullet. Get three rewrites tailored to this application's JD.
        </p>
      </div>

      <textarea
        value={bullet}
        onChange={e => setBullet(e.target.value)}
        rows={3}
        placeholder="e.g. Built the analytics dashboard used by the sales team."
        className="w-full text-sm"
      />

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button
          onClick={rewrite}
          disabled={loading || !bullet.trim()}
          className="btn-primary text-sm"
        >
          {loading ? "Rewriting…" : "Rewrite"}
        </button>
        {!jobDescription && (
          <span className="text-xs text-[color:var(--text-dim)]">
            No JD on this app — rewrites will be generic.
          </span>
        )}
      </div>

      {error && <p className="text-[color:var(--danger)] text-sm mt-4">{error}</p>}

      {result && (
        <div className="mt-6 space-y-3">
          {result.variants.map((v, i) => (
            <div
              key={i}
              className="p-4 border border-[color:var(--border)]"
              style={{ borderRadius: "var(--radius-md)" }}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">{v.style}</span>
                <button
                  onClick={() => copy(v.text)}
                  className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--accent)] transition-colors"
                >
                  Copy
                </button>
              </div>
              <p className="text-sm text-[color:var(--text)] leading-relaxed">{v.text}</p>
              {v.rationale && (
                <p className="text-xs text-[color:var(--text-dim)] mt-2 italic leading-relaxed">
                  {v.rationale}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/* ============================================================
   ContactAdder & NoteAdder — state unchanged, restyled
   ============================================================ */

function ContactAdder({ onAdd }: { onAdd: (name: string, role: string) => void }) {
  const [name, setName] = useState("")
  const [role, setRole] = useState("")
  return (
    <div className="flex gap-3 flex-wrap">
      <input
        className="flex-1 min-w-[180px] text-sm"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="flex-1 min-w-[180px] text-sm"
        placeholder="Role (optional)"
        value={role}
        onChange={(e) => setRole(e.target.value)}
      />
      <button
        onClick={() => { if (name) { onAdd(name, role); setName(""); setRole("") } }}
        disabled={!name}
        className="btn-secondary text-sm"
      >
        Add
      </button>
    </div>
  )
}

function NoteAdder({ onAdd }: { onAdd: (content: string) => void }) {
  const [content, setContent] = useState("")
  return (
    <div className="space-y-3">
      <textarea
        className="w-full text-sm"
        rows={3}
        placeholder="Write a note…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <button
        onClick={() => { onAdd(content); setContent("") }}
        disabled={!content.trim()}
        className="btn-secondary text-sm"
      >
        Add note
      </button>
    </div>
  )
}