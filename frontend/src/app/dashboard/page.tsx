// frontend/src/app/dashboard/page.tsx
"use client"

import { useSession } from "next-auth/react"
import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { apiFetch } from "@/lib/api"
import { Reveal, GradientText } from "@/components/Reveal"

type Application = {
  id: number
  company: string
  role: string
  status: string
  location: string | null
  applied_date: string | null
  created_at: string
}

type Summary = {
  saved: number
  applied: number
  interviewing: number
  offer: number
  rejected: number
  withdrawn: number
  total: number
}

type EmailPreference = {
  frequency: string
  last_sent_at: string | null
}

const STATUSES = ["", "saved", "applied", "interviewing", "offer", "rejected", "withdrawn"]

// Desaturated status badges — they communicate state without competing with
// the electric-blue brand identity.
const STATUS_COLORS: Record<string, string> = {
  saved: "bg-[color:var(--bg-hover)] text-[color:var(--text-muted)]",
  applied: "bg-[color:var(--accent-soft)] text-[color:var(--accent)]",
  interviewing: "bg-[rgba(226,178,122,0.10)] text-[color:var(--warning)]",
  offer: "bg-[rgba(91,197,150,0.12)] text-[color:var(--success)]",
  rejected: "bg-[rgba(224,133,137,0.10)] text-[color:var(--danger)]",
  withdrawn: "bg-[color:var(--bg-hover)] text-[color:var(--text-dim)]",
}

export default function DashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [apps, setApps] = useState<Application[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [filterStatus, setFilterStatus] = useState("")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState("created_at_desc")
  const [error, setError] = useState("")

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login")
  }, [status, router])

  const load = useCallback(async () => {
    if (!session?.backendToken) return
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.set("status", filterStatus)
      if (search) params.set("company", search)
      if (sort) params.set("sort", sort)

      const [list, sum] = await Promise.all([
        apiFetch(`/api/v1/applications?${params}`, session.backendToken),
        apiFetch(`/api/v1/applications/summary`, session.backendToken),
      ])
      setApps(list)
      setSummary(sum)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [session, filterStatus, search, sort])

  useEffect(() => { load() }, [load])

  if (status === "loading") return <p className="p-8 text-[color:var(--text-muted)]">Loading...</p>
  if (!session) return null

  return (
    <main className="max-w-6xl mx-auto px-6 py-12 md:py-16">
      {/* Page header — generous spacing */}
      <div className="mb-12">
        <Reveal as="h1" eager className="font-display-hero block text-5xl md:text-6xl font-bold leading-[1.02] hover-glow">
          <GradientText>Dashboard</GradientText>
        </Reveal>
        <Reveal as="p" delay={150} eager className="block text-[color:var(--text-muted)] mt-3 text-base md:text-lg">
          Track every application in one place.
        </Reveal>
      </div>

      {/* Weekly email preferences card */}
      {session?.backendToken && (
        <div className="mb-8">
          <EmailPreferencesCard token={session.backendToken} />
        </div>
      )}

      {/* Pipeline tiles — breathing room */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-7 gap-4 mb-10">
          {(["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"] as const).map((k) => (
            <div
              key={k}
              className="card text-center hover:border-[color:var(--accent)] transition-colors cursor-default"
            >
              <div className="text-xs uppercase tracking-wider text-[color:var(--text-dim)]">{k}</div>
              <div className="text-3xl font-bold mt-2 font-display">{summary[k]}</div>
            </div>
          ))}
          <div className="card text-center bg-[color:var(--accent-soft)] border-[color:var(--accent)]">
            <div className="text-xs uppercase tracking-wider text-[color:var(--accent)]">total</div>
            <div className="text-3xl font-bold mt-2 font-display">{summary.total}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-8 flex-wrap">
        <input
          placeholder="Search company..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[220px] text-sm"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="text-sm"
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s || "all statuses"}</option>)}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="text-sm"
        >
          <option value="created_at_desc">Newest first</option>
          <option value="created_at_asc">Oldest first</option>
          <option value="company_asc">Company A→Z</option>
          <option value="applied_date_desc">Recently applied</option>
        </select>
        <Link href="/resumes" className="btn-secondary text-sm">Resumes</Link>
        <Link href="/applications/new" className="btn-primary text-sm">+ New</Link>
      </div>

      {error && <p className="text-[color:var(--danger)] text-sm mb-4">{error}</p>}

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[color:var(--border)] text-left text-xs uppercase tracking-wider text-[color:var(--text-dim)]">
              <th className="px-6 py-4 font-medium">Company</th>
              <th className="px-6 py-4 font-medium">Role</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium">Location</th>
              <th className="px-6 py-4 font-medium">Applied</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <tr
                key={a.id}
                className="border-b border-[color:var(--border)] last:border-b-0 hover:bg-[color:var(--bg-hover)] transition-colors"
              >
                <td className="px-6 py-4">
                  <Link
                    href={`/applications/${a.id}`}
                    className="text-[color:var(--text)] hover:text-[color:var(--accent)] font-medium"
                  >
                    {a.company}
                  </Link>
                </td>
                <td className="px-6 py-4 text-[color:var(--text-muted)]">{a.role}</td>
                <td className="px-6 py-4">
                  <span
                    className={`text-xs px-3 py-1.5 font-medium ${STATUS_COLORS[a.status] || ""}`}
                    style={{ borderRadius: "var(--radius-xs)" }}
                  >
                    {a.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-[color:var(--text-muted)]">{a.location || "—"}</td>
                <td className="px-6 py-4 text-[color:var(--text-muted)]">{a.applied_date || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {apps.length === 0 && (
          <div className="text-center py-16 px-4">
            <p className="text-[color:var(--text-muted)] mb-6">No applications yet.</p>
            <Link href="/applications/new" className="btn-primary text-sm inline-block">
              Add your first application
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}


function EmailPreferencesCard({ token }: { token: string }) {
  const [pref, setPref] = useState<EmailPreference | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState("")
  const [err, setErr] = useState("")

  const load = useCallback(async () => {
    try {
      const data: EmailPreference = await apiFetch("/api/v1/email-preferences", token)
      setPref(data)
    } catch (e) {
      setErr((e as Error).message)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  async function setFrequency(freq: "weekly" | "off") {
    setLoading(true); setErr(""); setMsg("")
    try {
      const data: EmailPreference = await apiFetch(
        "/api/v1/email-preferences",
        token,
        { method: "PATCH", body: JSON.stringify({ frequency: freq }) },
      )
      setPref(data)
      setMsg(freq === "off" ? "Weekly emails turned off." : "Weekly emails turned on.")
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function sendTest() {
    setLoading(true); setErr(""); setMsg("")
    try {
      const data = await apiFetch(
        "/api/v1/email-preferences/test",
        token,
        { method: "POST" },
      )
      if (data.sent) {
        setMsg(`Sent to ${data.email_to}. Check your inbox in ~30 seconds.`)
      } else {
        setMsg(`Skipped: ${data.skipped_reason}`)
      }
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="card">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <h2 className="text-base font-semibold flex items-center gap-2 font-display">
            <span className="logo-dot" />
            Weekly summary email
          </h2>
          <p className="text-sm text-[color:var(--text-muted)] mt-2">
            {pref?.frequency === "weekly"
              ? "On — you'll get a recap every Monday."
              : "Off — you won't get scheduled emails."}
            {pref?.last_sent_at && (
              <> Last sent {new Date(pref.last_sent_at).toLocaleString()}.</>
            )}
          </p>
          {msg && <p className="text-sm text-[color:var(--success)] mt-3">{msg}</p>}
          {err && <p className="text-sm text-[color:var(--danger)] mt-3">{err}</p>}
        </div>
        <div className="flex gap-3">
          <button
            onClick={sendTest}
            disabled={loading}
            className="btn-secondary text-sm"
          >
            {loading ? "Working..." : "Send test now"}
          </button>
          {pref?.frequency === "weekly" ? (
            <button
              onClick={() => setFrequency("off")}
              disabled={loading}
              className="btn-secondary text-sm"
            >
              Turn off
            </button>
          ) : (
            <button
              onClick={() => setFrequency("weekly")}
              disabled={loading}
              className="btn-primary text-sm"
            >
              Turn on
            </button>
          )}
        </div>
      </div>
    </section>
  )
}