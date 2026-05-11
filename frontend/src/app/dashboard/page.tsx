// frontend/src/app/dashboard/page.tsx
"use client"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { MessageSquare, Plus, FileText, ArrowRight } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { WorkspaceShell } from "@/components/WorkspaceShell"

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

const STATUSES = ["", "saved", "applied", "interviewing", "offer", "rejected", "withdrawn"]

const STATUS_COLORS: Record<string, string> = {
  saved: "bg-[color:var(--bg-hover)] text-[color:var(--text-muted)]",
  applied: "bg-[color:var(--accent-soft)] text-[color:var(--accent)]",
  interviewing: "bg-[rgba(226,178,122,0.10)] text-[color:var(--warning)]",
  offer: "bg-[rgba(91,197,150,0.12)] text-[color:var(--success)]",
  rejected: "bg-[rgba(224,133,137,0.10)] text-[color:var(--danger)]",
  withdrawn: "bg-[color:var(--bg-hover)] text-[color:var(--text-dim)]",
}

/**
 * Dashboard — the secondary review surface.
 *
 * Per the new product positioning, the chat is the primary experience.
 * This page exists for reviewing saved applications, status tracking, and
 * quick access to resumes. Every action here can also be done in chat.
 */
export default function DashboardPage() {
  const { status, data: session } = useSession()
  const router = useRouter()

  const [apps, setApps] = useState<Application[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [filterStatus, setFilterStatus] = useState("")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState("created_at_desc")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // Auth guard
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?from=/dashboard")
  }, [status, router])

  const load = useCallback(async () => {
    if (!session?.backendToken) return
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.set("status", filterStatus)
      if (search) params.set("company", search)
      if (sort) params.set("sort", sort)

      const [appsData, summaryData] = await Promise.all([
        apiFetch(`/api/v1/applications?${params.toString()}`, session.backendToken),
        apiFetch(`/api/v1/applications/summary`, session.backendToken),
      ])
      setApps(appsData)
      setSummary(summaryData)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [session, filterStatus, search, sort])

  useEffect(() => { load() }, [load])

  if (status !== "authenticated") return null

  return (
    <WorkspaceShell>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-5 md:px-8 py-8 md:py-12">

          {/* Header */}
          <div className="mb-8 md:mb-10">
            <h1 className="font-display-hero text-3xl md:text-5xl font-bold leading-tight mb-2">
              Dashboard
            </h1>
            <p className="text-sm md:text-base text-[color:var(--text-muted)] max-w-xl">
              The structured view. Use chat for any action — adding, updating,
              drafting, analyzing. This page is here when you want to scan.
            </p>
          </div>

          {/* Primary CTA: open chat (especially important on mobile) */}
          <Link
            href="/chat"
            className="card flex items-center justify-between gap-4 group hover:border-[color:var(--accent)] transition-colors mb-8 md:mb-10"
          >
            <div className="flex items-center gap-4 min-w-0">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--accent-soft)" }}
              >
                <MessageSquare size={18} strokeWidth={1.75} className="text-[color:var(--accent)]" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm md:text-base">Talk to JobAgent</div>
                <div className="text-xs md:text-sm text-[color:var(--text-muted)] truncate">
                  Add an application, draft a cover letter, or run gap analysis — just by typing.
                </div>
              </div>
            </div>
            <ArrowRight
              size={18}
              strokeWidth={1.75}
              className="text-[color:var(--text-muted)] group-hover:text-[color:var(--accent)] group-hover:translate-x-0.5 transition-all flex-shrink-0"
            />
          </Link>

          {/* Pipeline tiles — compact on mobile */}
          {summary && (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2 md:gap-3 mb-8">
              {(["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"] as const).map((k) => (
                <div
                  key={k}
                  className="border border-[color:var(--border)] bg-[color:var(--bg-elevated)] text-center py-3 px-2"
                  style={{ borderRadius: "var(--radius-md)" }}
                >
                  <div className="text-[10px] uppercase tracking-wider text-[color:var(--text-dim)]">{k}</div>
                  <div className="text-xl md:text-2xl font-bold mt-1 font-display">{summary[k]}</div>
                </div>
              ))}
              <div
                className="border border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-center py-3 px-2 col-span-3 sm:col-span-4 lg:col-span-1"
                style={{ borderRadius: "var(--radius-md)" }}
              >
                <div className="text-[10px] uppercase tracking-wider text-[color:var(--accent)]">total</div>
                <div className="text-xl md:text-2xl font-bold mt-1 font-display">{summary.total}</div>
              </div>
            </div>
          )}

          {/* Filters row */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-6">
            <input
              placeholder="Search company…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-0 text-sm"
            />
            <div className="flex gap-2 sm:gap-3">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="text-sm flex-1 sm:flex-none"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s || "all statuses"}</option>)}
              </select>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="text-sm flex-1 sm:flex-none"
              >
                <option value="created_at_desc">Newest first</option>
                <option value="created_at_asc">Oldest first</option>
                <option value="company_asc">Company A→Z</option>
                <option value="applied_date_desc">Recently applied</option>
              </select>
            </div>
          </div>

          {/* Secondary action row */}
          <div className="flex flex-wrap gap-2 mb-6">
            <Link href="/resumes" className="btn-secondary text-sm inline-flex items-center gap-2">
              <FileText size={14} strokeWidth={1.75} />
              Resumes
            </Link>
            <Link href="/applications/new" className="btn-primary text-sm inline-flex items-center gap-2">
              <Plus size={14} strokeWidth={2} />
              Add application
            </Link>
          </div>

          {error && (
            <div
              className="mb-4 text-sm text-[color:var(--danger)] px-4 py-3"
              style={{
                background: "rgba(224, 133, 137, 0.08)",
                border: "1px solid rgba(224, 133, 137, 0.25)",
                borderRadius: "var(--radius-md)",
              }}
            >
              {error}
            </div>
          )}

          {/* Applications — table on desktop, cards on mobile */}
          <div className="card p-0 overflow-hidden">
            {/* Desktop table */}
            <table className="hidden md:table w-full">
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

            {/* Mobile cards */}
            <ul className="md:hidden divide-y divide-[color:var(--border)]">
              {apps.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/applications/${a.id}`}
                    className="px-4 py-4 flex items-center justify-between gap-3 active:bg-[color:var(--bg-hover)] transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{a.company}</div>
                      <div className="text-xs text-[color:var(--text-muted)] truncate">{a.role}</div>
                      {a.location && (
                        <div className="text-[11px] text-[color:var(--text-dim)] truncate mt-0.5">{a.location}</div>
                      )}
                    </div>
                    <span
                      className={`text-[11px] px-2.5 py-1 font-medium flex-shrink-0 ${STATUS_COLORS[a.status] || ""}`}
                      style={{ borderRadius: "var(--radius-xs)" }}
                    >
                      {a.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            {!loading && apps.length === 0 && (
              <div className="text-center py-12 px-4">
                <p className="text-[color:var(--text-muted)] mb-6 text-sm">
                  No applications yet. Try saying it instead.
                </p>
                <Link
                  href="/chat?q=I%20just%20applied%20to..."
                  className="btn-primary text-sm inline-flex items-center gap-2"
                >
                  <MessageSquare size={14} strokeWidth={1.75} />
                  Open chat
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  )
}