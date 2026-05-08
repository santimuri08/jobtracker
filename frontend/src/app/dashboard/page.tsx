// frontend/src/app/dashboard/page.tsx
"use client"

import { useSession, signOut } from "next-auth/react"
import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { apiFetch } from "@/lib/api"

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

  if (status === "loading") return <p className="p-8">Loading...</p>
  if (!session) return null

  return (
    <main className="max-w-5xl mx-auto p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">JobTrackr</h1>
        <div className="flex gap-3 items-center">
          <span className="text-sm text-gray-600">{session.user?.email}</span>
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="border px-3 py-1 rounded text-sm">
            Sign out
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-7 gap-2 mb-6">
          {(["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"] as const).map((k) => (
            <div key={k} className="border rounded p-3 text-center">
              <div className="text-xs uppercase text-gray-500">{k}</div>
              <div className="text-xl font-semibold">{summary[k]}</div>
            </div>
          ))}
          <div className="border rounded p-3 text-center bg-gray-50">
            <div className="text-xs uppercase text-gray-500">total</div>
            <div className="text-xl font-semibold">{summary.total}</div>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        <input
          placeholder="Search company..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border p-2 rounded flex-1 min-w-[200px]"
        />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="border p-2 rounded">
          {STATUSES.map((s) => <option key={s} value={s}>{s || "all statuses"}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="border p-2 rounded">
          <option value="created_at_desc">Newest first</option>
          <option value="created_at_asc">Oldest first</option>
          <option value="company_asc">Company A→Z</option>
          <option value="applied_date_desc">Recently applied</option>
        </select>
        <Link href="/applications/new" className="bg-black text-white px-4 py-2 rounded">+ New</Link>
      </div>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left text-sm text-gray-600">
            <th className="p-2">Company</th>
            <th className="p-2">Role</th>
            <th className="p-2">Status</th>
            <th className="p-2">Location</th>
            <th className="p-2">Applied</th>
          </tr>
        </thead>
        <tbody>
          {apps.map((a) => (
            <tr key={a.id} className="border-b hover:bg-gray-50">
              <td className="p-2"><Link href={`/applications/${a.id}`} className="underline">{a.company}</Link></td>
              <td className="p-2">{a.role}</td>
              <td className="p-2"><span className="text-xs px-2 py-0.5 bg-gray-200 rounded">{a.status}</span></td>
              <td className="p-2">{a.location || "—"}</td>
              <td className="p-2">{a.applied_date || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {apps.length === 0 && <p className="text-gray-500 mt-6 text-center">No applications yet. Click <strong>+ New</strong> to add your first one.</p>}
    </main>
  )
}