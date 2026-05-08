// frontend/src/app/applications/[id]/page.tsx
"use client"

import { useSession } from "next-auth/react"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/api"

type Round = { id: number; round_number: number; type: string; scheduled_at: string | null; interviewer: string | null; outcome: string; notes: string | null }
type Contact = { id: number; name: string; role: string | null; email: string | null; phone: string | null }
type Note = { id: number; content: string; created_at: string }
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
  interview_rounds: Round[]
  contacts: Contact[]
  notes: Note[]
}

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: session } = useSession()
  const router = useRouter()
  const [appData, setAppData] = useState<AppDetail | null>(null)
  const [error, setError] = useState("")

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

  if (error) return <p className="p-8 text-red-600">{error}</p>
  if (!appData) return <p className="p-8">Loading...</p>

  return (
    <main className="max-w-3xl mx-auto p-8">
      <Link href="/dashboard" className="text-sm underline">← Back to dashboard</Link>

      <div className="flex justify-between items-start mt-4">
        <div>
          <h1 className="text-2xl font-bold">{appData.company}</h1>
          <p className="text-gray-600">{appData.role}</p>
          {appData.location && <p className="text-sm text-gray-500">{appData.location}</p>}
        </div>
        <button onClick={deleteApp} className="text-sm text-red-600 underline">Delete</button>
      </div>

      <div className="mt-4 flex gap-2 items-center">
        <span className="text-sm">Status:</span>
        <select value={appData.status} onChange={(e) => updateStatus(e.target.value)} className="border p-1 rounded">
          {["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {appData.job_url && <p className="mt-2 text-sm"><a href={appData.job_url} target="_blank" className="underline">View posting →</a></p>}
      {(appData.salary_min || appData.salary_max) && (
        <p className="mt-2 text-sm">Salary: {appData.salary_min ?? "?"} – {appData.salary_max ?? "?"}</p>
      )}
      {appData.job_description && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm">Job description</summary>
          <pre className="mt-2 text-sm whitespace-pre-wrap bg-gray-50 p-3 rounded">{appData.job_description}</pre>
        </details>
      )}

      {/* INTERVIEW ROUNDS */}
      <section className="mt-8">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-semibold">Interview rounds</h2>
          <button onClick={addRound} className="text-sm border px-2 py-1 rounded">+ Add round</button>
        </div>
        {appData.interview_rounds.length === 0 ? (
          <p className="text-sm text-gray-500">No rounds yet.</p>
        ) : (
          <ul className="space-y-2">
            {appData.interview_rounds.map(r => (
              <li key={r.id} className="border p-3 rounded flex justify-between">
                <div>
                  <div className="font-medium">Round {r.round_number} — {r.type}</div>
                  <div className="text-sm text-gray-600">{r.outcome}{r.interviewer && ` · ${r.interviewer}`}</div>
                </div>
                <button onClick={() => deleteRound(r.id)} className="text-xs text-red-600">remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* CONTACTS */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-2">Contacts</h2>
        <ContactAdder onAdd={addContact} />
        <ul className="mt-3 space-y-1">
          {appData.contacts.map(c => (
            <li key={c.id} className="text-sm border-b pb-1">{c.name}{c.role && <span className="text-gray-500"> — {c.role}</span>}</li>
          ))}
        </ul>
      </section>

      {/* NOTES */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-2">Notes</h2>
        <NoteAdder onAdd={addNote} />
        <ul className="mt-3 space-y-2">
          {appData.notes.map(n => (
            <li key={n.id} className="border p-3 rounded text-sm">
              <div className="text-xs text-gray-500 mb-1">{new Date(n.created_at).toLocaleString()}</div>
              <div className="whitespace-pre-wrap">{n.content}</div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

function ContactAdder({ onAdd }: { onAdd: (name: string, role: string) => void }) {
  const [name, setName] = useState("")
  const [role, setRole] = useState("")
  return (
    <div className="flex gap-2">
      <input className="border p-1 rounded flex-1" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="border p-1 rounded flex-1" placeholder="Role (optional)" value={role} onChange={(e) => setRole(e.target.value)} />
      <button
        onClick={() => { if (name) { onAdd(name, role); setName(""); setRole("") } }}
        className="border px-3 rounded"
      >Add</button>
    </div>
  )
}

function NoteAdder({ onAdd }: { onAdd: (content: string) => void }) {
  const [content, setContent] = useState("")
  return (
    <div className="space-y-2">
      <textarea className="w-full border p-2 rounded" rows={3} placeholder="Write a note..." value={content} onChange={(e) => setContent(e.target.value)} />
      <button onClick={() => { onAdd(content); setContent("") }} className="border px-3 py-1 rounded">Add note</button>
    </div>
  )
}