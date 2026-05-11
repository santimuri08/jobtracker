// frontend/src/app/applications/new/page.tsx
"use client"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/api"
import { Reveal, GradientText } from "@/components/Reveal"

type Resume = { id: number; label: string; filename: string }

export default function NewApplicationPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [form, setForm] = useState({
    company: "", role: "", location: "", job_url: "", job_description: "",
    salary_min: "", salary_max: "", status: "saved", applied_date: "", source: "",
    resume_id: "",
  })
  const [resumes, setResumes] = useState<Resume[]>([])
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  // Load the user's resumes for the dropdown
  useEffect(() => {
    if (!session?.backendToken) return
    apiFetch("/api/v1/resumes", session.backendToken)
      .then(setResumes)
      .catch(() => setResumes([]))
  }, [session])

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm({ ...form, [k]: v })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session?.backendToken) return
    setSaving(true); setError("")
    const payload: Record<string, unknown> = {
      company: form.company, role: form.role,
      location: form.location || null, job_url: form.job_url || null,
      job_description: form.job_description || null,
      salary_min: form.salary_min ? Number(form.salary_min) : null,
      salary_max: form.salary_max ? Number(form.salary_max) : null,
      status: form.status,
      applied_date: form.applied_date || null,
      source: form.source || null,
      resume_id: form.resume_id ? Number(form.resume_id) : null,
    }
    try {
      const created = await apiFetch("/api/v1/applications", session.backendToken, {
        method: "POST", body: JSON.stringify(payload),
      })
      router.push(`/applications/${created.id}`)
    } catch (e) {
      setError((e as Error).message); setSaving(false)
    }
  }

  return (
    <main className="relative max-w-3xl mx-auto px-6 py-12 md:py-16">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[400px] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 0%, var(--accent-soft), transparent 70%)",
        }}
      />

      <div className="relative">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-[color:var(--text-muted)] hover:text-[color:var(--accent)] transition-colors mb-10"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to dashboard
        </Link>

        <div className="mb-10">
          <Reveal
            as="h1"
            eager
            className="font-display-hero block text-4xl md:text-5xl font-bold leading-[1.05] hover-glow"
          >
            New <GradientText>application</GradientText>
          </Reveal>
          <Reveal as="p" delay={150} eager className="block text-[color:var(--text-muted)] mt-3 text-base md:text-lg">
            Or, if you'd rather, just{" "}
            <Link href="/" className="text-[color:var(--accent)] hover:underline">
              tell the chat
            </Link>
            {" "}what you applied to and the agent will fill this out for you.
          </Reveal>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-6">
          <Field label="Company *">
            <input
              required
              value={form.company}
              onChange={(e) => update("company", e.target.value)}
              placeholder="Stripe, Figma, Datadog…"
              className="w-full text-sm"
            />
          </Field>

          <Field label="Role *">
            <input
              required
              value={form.role}
              onChange={(e) => update("role", e.target.value)}
              placeholder="Senior Backend Engineer"
              className="w-full text-sm"
            />
          </Field>

          <div className="grid md:grid-cols-2 gap-5">
            <Field label="Location">
              <input
                value={form.location}
                onChange={(e) => update("location", e.target.value)}
                placeholder="Remote · San Francisco · …"
                className="w-full text-sm"
              />
            </Field>
            <Field label="Source">
              <input
                value={form.source}
                onChange={(e) => update("source", e.target.value)}
                placeholder="LinkedIn, referral, …"
                className="w-full text-sm"
              />
            </Field>
          </div>

          <Field label="Job posting URL">
            <input
              type="url"
              value={form.job_url}
              onChange={(e) => update("job_url", e.target.value)}
              placeholder="https://…"
              className="w-full text-sm"
            />
          </Field>

          <Field label="Job description" hint="Pasting this in unlocks gap analysis and similar-role search.">
            <textarea
              value={form.job_description}
              onChange={(e) => update("job_description", e.target.value)}
              rows={6}
              placeholder="Paste the full posting here…"
              className="w-full text-sm"
            />
          </Field>

          <div className="grid md:grid-cols-2 gap-5">
            <Field label="Salary min">
              <input
                type="number"
                value={form.salary_min}
                onChange={(e) => update("salary_min", e.target.value)}
                placeholder="180000"
                className="w-full text-sm"
              />
            </Field>
            <Field label="Salary max">
              <input
                type="number"
                value={form.salary_max}
                onChange={(e) => update("salary_max", e.target.value)}
                placeholder="220000"
                className="w-full text-sm"
              />
            </Field>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => update("status", e.target.value)}
                className="w-full text-sm"
              >
                {["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Applied date">
              <input
                type="date"
                value={form.applied_date}
                onChange={(e) => update("applied_date", e.target.value)}
                className="w-full text-sm"
              />
            </Field>
          </div>

          <Field
            label="Resume (for gap analysis)"
            hint={resumes.length === 0 ? "No resumes yet. Upload one from the resumes page first." : undefined}
          >
            <select
              value={form.resume_id}
              onChange={(e) => update("resume_id", e.target.value)}
              disabled={resumes.length === 0}
              className="w-full text-sm"
            >
              <option value="">— No resume linked —</option>
              {resumes.map(r => (
                <option key={r.id} value={r.id}>{r.label} ({r.filename})</option>
              ))}
            </select>
          </Field>

          {error && (
            <div
              className="text-sm text-[color:var(--danger)] px-4 py-3"
              style={{
                background: "rgba(224, 133, 137, 0.08)",
                border: "1px solid rgba(224, 133, 137, 0.25)",
                borderRadius: "var(--radius-md)",
              }}
            >
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button type="submit" disabled={saving} className="btn-primary text-sm">
              {saving ? "Creating…" : "Create application"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="btn-secondary text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}

/**
 * Field — labeled form field with optional hint text.
 * Establishes a consistent label-above-input rhythm across the form.
 */
function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-[0.15em] text-[color:var(--text-dim)] mb-2">
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-xs text-[color:var(--text-dim)] mt-2">{hint}</p>
      )}
    </div>
  )
}