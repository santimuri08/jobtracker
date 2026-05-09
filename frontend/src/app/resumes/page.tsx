// frontend/src/app/resumes/page.tsx
"use client"

import { useSession } from "next-auth/react"
import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/api"

type Resume = {
  id: number
  label: string
  filename: string
  created_at: string
}

export default function ResumesPage() {
  const { data: session } = useSession()
  const [resumes, setResumes] = useState<Resume[]>([])
  const [label, setLabel] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    if (!session?.backendToken) return
    try {
      const data = await apiFetch("/api/v1/resumes", session.backendToken)
      setResumes(data)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [session])

  useEffect(() => { load() }, [load])

  async function upload() {
    if (!session?.backendToken || !file || !label) return
    setUploading(true)
    setError("")
    try {
      const fd = new FormData()
      fd.append("label", label)
      fd.append("file", file)
      await apiFetch("/api/v1/resumes", session.backendToken, {
        method: "POST",
        body: fd,
      })
      setLabel("")
      setFile(null)
      // reset file input visually
      const input = document.getElementById("file-input") as HTMLInputElement
      if (input) input.value = ""
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  async function deleteResume(id: number) {
    if (!session?.backendToken) return
    if (!confirm("Delete this resume?")) return
    await apiFetch(`/api/v1/resumes/${id}`, session.backendToken, { method: "DELETE" })
    load()
  }

  return (
    <main className="max-w-3xl mx-auto p-8">
      <Link href="/dashboard" className="text-sm underline">← Back to dashboard</Link>
      <h1 className="text-2xl font-bold mt-4 mb-6">Resumes</h1>

      <section className="border rounded p-4 mb-8">
        <h2 className="font-semibold mb-3">Upload a resume</h2>
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Label (e.g. 'SWE - Senior')"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full border p-2 rounded"
          />
          <input
            id="file-input"
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full"
          />
          <button
            onClick={upload}
            disabled={!file || !label || uploading}
            className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
      </section>

      <section>
        <h2 className="font-semibold mb-3">Your resumes</h2>
        {resumes.length === 0 ? (
          <p className="text-gray-500 text-sm">No resumes uploaded yet.</p>
        ) : (
          <ul className="space-y-2">
            {resumes.map(r => (
              <li key={r.id} className="border p-3 rounded flex justify-between items-center">
                <div>
                  <Link href={`/resumes/${r.id}`} className="font-medium underline">{r.label}</Link>
                  <div className="text-xs text-gray-500">{r.filename} · {new Date(r.created_at).toLocaleDateString()}</div>
                </div>
                <button onClick={() => deleteResume(r.id)} className="text-xs text-red-600">delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}