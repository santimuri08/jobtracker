// frontend/src/app/signup/page.tsx
"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    })
    if (!res.ok) {
      const data = await res.json()
      setError(data.error || "Signup failed")
      setLoading(false)
      return
    }
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    })
    setLoading(false)
    if (result?.error) {
      setError("Signed up but login failed; try logging in manually.")
    } else {
      router.push("/")
    }
  }

  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Create your account</h1>
        <p className="text-[color:var(--text-muted)] mt-2">
          Start tracking your job search with AI.
        </p>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-[color:var(--text-dim)] mb-1 block">
              Name <span className="text-[color:var(--text-dim)] normal-case">(optional)</span>
            </label>
            <input
              className="w-full px-3 py-2"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-[color:var(--text-dim)] mb-1 block">
              Email
            </label>
            <input
              className="w-full px-3 py-2"
              type="email"
              placeholder="you@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-[color:var(--text-dim)] mb-1 block">
              Password
            </label>
            <input
              className="w-full px-3 py-2"
              type="password"
              placeholder="At least 8 characters"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-[color:var(--danger)] bg-[#F2495C15] border border-[#F2495C30] px-3 py-2 rounded-md">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-2.5"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>
      </div>

      <p className="mt-6 text-sm text-center text-[color:var(--text-muted)]">
        Already have an account?{" "}
        <a href="/login" className="text-[color:var(--accent)] hover:underline font-medium">
          Log in
        </a>
      </p>
    </main>
  )
}