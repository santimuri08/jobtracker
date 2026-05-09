// frontend/src/app/applications/new/page.tsx
"use client"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"

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
      .catch(() => setResumes([]))  // non-fatal: form still works without resumes
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
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">New application</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input className="w-full border p-2 rounded" placeholder="Company *" required value={form.company} onChange={(e) => update("company", e.target.value)} />
        <input className="w-full border p-2 rounded" placeholder="Role *" required value={form.role} onChange={(e) => update("role", e.target.value)} />
        <input className="w-full border p-2 rounded" placeholder="Location" value={form.location} onChange={(e) => update("location", e.target.value)} />
        <input className="w-full border p-2 rounded" placeholder="Job posting URL" value={form.job_url} onChange={(e) => update("job_url", e.target.value)} />
        <textarea className="w-full border p-2 rounded" placeholder="Job description" rows={5} value={form.job_description} onChange={(e) => update("job_description", e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input className="border p-2 rounded" type="number" placeholder="Salary min" value={form.salary_min} onChange={(e) => update("salary_min", e.target.value)} />
          <input className="border p-2 rounded" type="number" placeholder="Salary max" value={form.salary_max} onChange={(e) => update("salary_max", e.target.value)} />
        </div>
        <select className="w-full border p-2 rounded" value={form.status} onChange={(e) => update("status", e.target.value)}>
          {["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input className="w-full border p-2 rounded" type="date" value={form.applied_date} onChange={(e) => update("applied_date", e.target.value)} />
        <input className="w-full border p-2 rounded" placeholder="Source (LinkedIn, referral, ...)" value={form.source} onChange={(e) => update("source", e.target.value)} />
        <div>
          <label className="block text-sm text-gray-600 mb-1">Resume (for gap analysis)</label>
          <select className="w-full border p-2 rounded" value={form.resume_id} onChange={(e) => update("resume_id", e.target.value)}>
            <option value="">— No resume linked —</option>
            {resumes.map(r => (
              <option key={r.id} value={r.id}>{r.label} ({r.filename})</option>
            ))}
          </select>
          {resumes.length === 0 && (
            <p className="text-xs text-gray-500 mt-1">No resumes yet. Upload one in the Resumes section to enable gap analysis.</p>
          )}
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="bg-black text-white px-4 py-2 rounded">
            {saving ? "Saving..." : "Create"}
          </button>
          <button type="button" onClick={() => router.push("/dashboard")} className="border px-4 py-2 rounded">Cancel</button>
        </div>
      </form>
    </main>
  )
}