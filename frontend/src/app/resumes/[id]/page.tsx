// frontend/src/app/resumes/[id]/page.tsx
"use client"

import { useSession } from "next-auth/react"
import { useParams } from "next/navigation"
import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/api"

type WorkExp = {
  company: string | null
  title: string | null
  start_date: string | null
  end_date: string | null
  location: string | null
  bullets: string[]
}

type Education = {
  school: string | null
  degree: string | null
  field: string | null
  start_date: string | null
  end_date: string | null
}

type Parse = {
  id: number
  resume_id: number
  full_name: string | null
  email: string | null
  phone: string | null
  location: string | null
  linkedin_url: string | null
  github_url: string | null
  summary: string | null
  skills: string[] | null
  work_experience: WorkExp[] | null
  education: Education[] | null
  parser_version: string
  created_at: string
  updated_at: string
}

export default function ResumeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: session } = useSession()
  const [parse, setParse] = useState<Parse | null>(null)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState("")
  const [notParsedYet, setNotParsedYet] = useState(false)

  const load = useCallback(async () => {
    if (!session?.backendToken) return
    try {
      const data = await apiFetch(`/api/v1/resumes/${id}/parse`, session.backendToken)
      setParse(data)
      setNotParsedYet(false)
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes("not parsed")) {
        setNotParsedYet(true)
      } else {
        setError(msg)
      }
    }
  }, [session, id])

  useEffect(() => { load() }, [load])

  async function runParse() {
    if (!session?.backendToken) return
    setParsing(true)
    setError("")
    try {
      const data = await apiFetch(`/api/v1/resumes/${id}/parse`, session.backendToken, {
        method: "POST",
      })
      setParse(data)
      setNotParsedYet(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setParsing(false)
    }
  }

  return (
    <main className="max-w-3xl mx-auto p-8">
      <Link href="/resumes" className="text-sm underline">← Back to resumes</Link>
      <h1 className="text-2xl font-bold mt-4 mb-6">Parsed resume</h1>

      <button
        onClick={runParse}
        disabled={parsing}
        className="bg-black text-white px-4 py-2 rounded disabled:opacity-50 mb-6"
      >
        {parsing ? "Parsing with AI..." : parse ? "Re-parse" : "Parse this resume"}
      </button>

      {error && <p className="text-red-600 mb-4">{error}</p>}
      {notParsedYet && !parse && <p className="text-gray-500">Click "Parse this resume" to extract structured data.</p>}

      {parse && (
        <div className="space-y-6">
          <section className="border rounded p-4">
            <h2 className="font-semibold mb-2">Contact</h2>
            <div className="text-sm space-y-1">
              {parse.full_name && <div><strong>Name:</strong> {parse.full_name}</div>}
              {parse.email && <div><strong>Email:</strong> {parse.email}</div>}
              {parse.phone && <div><strong>Phone:</strong> {parse.phone}</div>}
              {parse.location && <div><strong>Location:</strong> {parse.location}</div>}
              {parse.linkedin_url && <div><strong>LinkedIn:</strong> <a href={parse.linkedin_url} className="underline">{parse.linkedin_url}</a></div>}
              {parse.github_url && <div><strong>GitHub:</strong> <a href={parse.github_url} className="underline">{parse.github_url}</a></div>}
            </div>
          </section>

          {parse.summary && (
            <section className="border rounded p-4">
              <h2 className="font-semibold mb-2">Summary</h2>
              <p className="text-sm whitespace-pre-wrap">{parse.summary}</p>
            </section>
          )}

          {parse.skills && parse.skills.length > 0 && (
            <section className="border rounded p-4">
              <h2 className="font-semibold mb-2">Skills</h2>
              <div className="flex flex-wrap gap-2">
                {parse.skills.map((s, i) => (
                  <span key={i} className="text-xs bg-gray-200 px-2 py-1 rounded">{s}</span>
                ))}
              </div>
            </section>
          )}

          {parse.work_experience && parse.work_experience.length > 0 && (
            <section className="border rounded p-4">
              <h2 className="font-semibold mb-3">Experience</h2>
              <ul className="space-y-4">
                {parse.work_experience.map((w, i) => (
                  <li key={i} className="border-b pb-3 last:border-b-0">
                    <div className="font-medium">{w.title} — {w.company}</div>
                    <div className="text-xs text-gray-500">
                      {w.start_date || "?"} – {w.end_date || "Present"}
                      {w.location && ` · ${w.location}`}
                    </div>
                    {w.bullets.length > 0 && (
                      <ul className="list-disc ml-5 mt-2 text-sm space-y-1">
                        {w.bullets.map((b, j) => <li key={j}>{b}</li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {parse.education && parse.education.length > 0 && (
            <section className="border rounded p-4">
              <h2 className="font-semibold mb-2">Education</h2>
              <ul className="space-y-2">
                {parse.education.map((e, i) => (
                  <li key={i} className="text-sm">
                    <div className="font-medium">{e.school}</div>
                    <div className="text-gray-600">{e.degree}{e.field && ` in ${e.field}`}</div>
                    <div className="text-xs text-gray-500">{e.start_date || "?"} – {e.end_date || "?"}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-xs text-gray-400">Parsed by {parse.parser_version} · {new Date(parse.updated_at).toLocaleString()}</p>
        </div>
      )}
    </main>
  )
}