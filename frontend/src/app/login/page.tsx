// frontend/src/app/login/page.tsx
"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    })
    setLoading(false)
    if (result?.error) {
      setError("Invalid email or password")
    } else {
      router.push("/")
    }
  }

  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-[color:var(--text-muted)] mt-2">
          Log in to keep tracking your job search.
        </p>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit} className="space-y-4">
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
              placeholder="••••••••"
              required
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
            {loading ? "Logging in..." : "Log in"}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <div className="flex-1 h-px bg-[color:var(--border)]" />
          <span className="text-xs text-[color:var(--text-dim)] uppercase tracking-wider">or</span>
          <div className="flex-1 h-px bg-[color:var(--border)]" />
        </div>

        <button
          onClick={() => signIn("github", { callbackUrl: "/" })}
          className="btn-secondary w-full py-2.5"
        >
          Continue with GitHub
        </button>
      </div>

      <p className="mt-6 text-sm text-center text-[color:var(--text-muted)]">
        No account?{" "}
        <a href="/signup" className="text-[color:var(--accent)] hover:underline font-medium">
          Sign up
        </a>
      </p>
    </main>
  )
}