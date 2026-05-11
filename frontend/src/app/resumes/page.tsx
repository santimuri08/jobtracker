// frontend/src/app/resumes/page.tsx
"use client"

import { useSession } from "next-auth/react"
import { useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/api"
import { Reveal, GradientText } from "@/components/Reveal"

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
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
      if (fileInputRef.current) fileInputRef.current.value = ""
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

  // Drag-and-drop wiring for the file zone
  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragging(true)
  }
  function onDragLeave() { setDragging(false) }
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f && f.type === "application/pdf") setFile(f)
  }

  return (
    <main className="relative max-w-3xl mx-auto px-6 py-12 md:py-16">
      {/* Subtle halo behind page header */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[400px] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 0%, var(--accent-soft), transparent 70%)",
        }}
      />

      <div className="relative">
        {/* Back link */}
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

        {/* Header */}
        <div className="mb-10">
          <Reveal
            as="h1"
            eager
            className="font-display-hero block text-4xl md:text-5xl font-bold leading-[1.05] hover-glow"
          >
            <GradientText>Resumes</GradientText>
          </Reveal>
          <Reveal as="p" delay={150} eager className="block text-[color:var(--text-muted)] mt-3 text-base md:text-lg">
            Upload as many versions as you need. Link them to applications for gap analysis and cover letters.
          </Reveal>
        </div>

        {/* Upload card */}
        <section className="card mb-10">
          <h2 className="font-display font-semibold text-lg mb-6 flex items-center gap-2">
            <span className="logo-dot" />
            Upload a resume
          </h2>

          <div className="space-y-4">
            {/* Label input */}
            <div>
              <label className="block text-xs uppercase tracking-[0.15em] text-[color:var(--text-dim)] mb-2">
                Label
              </label>
              <input
                type="text"
                placeholder="e.g. 'SWE — Senior'"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full text-sm"
              />
            </div>

            {/* Custom file drop zone */}
            <div>
              <label className="block text-xs uppercase tracking-[0.15em] text-[color:var(--text-dim)] mb-2">
                PDF file
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    fileInputRef.current?.click()
                  }
                }}
                className={`
                  cursor-pointer text-center px-6 py-10
                  border border-dashed transition-all
                  ${dragging
                    ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]"
                    : file
                      ? "border-[color:var(--accent)] bg-[color:var(--bg-elevated)]"
                      : "border-[color:var(--border-strong)] bg-[color:var(--bg-elevated)]/40 hover:border-[color:var(--accent)] hover:bg-[color:var(--bg-elevated)]"}
                `}
                style={{ borderRadius: "var(--radius-md)" }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="hidden"
                />

                {file ? (
                  <>
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mx-auto mb-3 text-[color:var(--accent)]"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <div className="text-sm font-medium text-[color:var(--text)]">
                      {file.name}
                    </div>
                    <div className="text-xs text-[color:var(--text-dim)] mt-1">
                      {(file.size / 1024).toFixed(1)} KB · Click to change
                    </div>
                  </>
                ) : (
                  <>
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mx-auto mb-3 text-[color:var(--text-dim)]"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <div className="text-sm text-[color:var(--text)]">
                      Drop a PDF here, or click to browse
                    </div>
                    <div className="text-xs text-[color:var(--text-dim)] mt-1">
                      PDF only · max ~5 MB
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={upload}
                disabled={!file || !label || uploading}
                className="btn-primary text-sm"
              >
                {uploading ? "Uploading…" : "Upload resume"}
              </button>
              {(file || label) && !uploading && (
                <button
                  onClick={() => { setFile(null); setLabel(""); if (fileInputRef.current) fileInputRef.current.value = "" }}
                  className="text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text)] transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {error && (
            <p className="mt-4 text-sm text-[color:var(--danger)]">{error}</p>
          )}
        </section>

        {/* Resume list */}
        <section>
          <h2 className="font-display font-semibold text-sm uppercase tracking-[0.18em] text-[color:var(--text-dim)] mb-5">
            Your resumes
          </h2>

          {resumes.length === 0 ? (
            <div className="card text-center py-10">
              <p className="text-sm text-[color:var(--text-muted)]">
                No resumes uploaded yet.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {resumes.map((r) => (
                <li
                  key={r.id}
                  className="card flex items-center justify-between gap-4 hover:border-[color:var(--border-strong)] transition-colors"
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div
                      className="flex-shrink-0 flex items-center justify-center w-10 h-10 bg-[color:var(--bg-hover)]"
                      style={{ borderRadius: "var(--radius-sm)" }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className="text-[color:var(--accent)]"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/resumes/${r.id}`}
                        className="font-medium text-[color:var(--text)] hover:text-[color:var(--accent)] transition-colors block truncate"
                      >
                        {r.label}
                      </Link>
                      <div className="text-xs text-[color:var(--text-dim)] mt-0.5 truncate">
                        {r.filename} · {new Date(r.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteResume(r.id)}
                    className="flex-shrink-0 text-xs text-[color:var(--text-dim)] hover:text-[color:var(--danger)] px-3 py-1.5 border border-[color:var(--border)] hover:border-[color:var(--danger)] transition-colors"
                    style={{ borderRadius: "var(--radius-sm)" }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}