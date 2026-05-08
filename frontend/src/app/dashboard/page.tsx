// frontend/src/app/dashboard/page.tsx
"use client"

import { useSession, signOut } from "next-auth/react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

type MeResponse = {
  user_id: string
  email: string | null
}

export default function DashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [me, setMe] = useState<MeResponse | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login")
    }
  }, [status, router])

  useEffect(() => {
    if (!session?.backendToken) return
    fetch("http://localhost:8000/api/v1/me", {
      headers: { Authorization: `Bearer ${session.backendToken}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Backend returned ${r.status}`)
        return r.json() as Promise<MeResponse>
      })
      .then(setMe)
      .catch((e: Error) => setError(e.message))
  }, [session])

  if (status === "loading") return <p className="p-8">Loading...</p>
  if (!session) return null

  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <p className="mb-2">Logged in as: {session.user?.email}</p>
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="border px-3 py-1 rounded mb-6"
      >
        Sign out
      </button>

      <h2 className="text-xl font-semibold mb-2">Backend says:</h2>
      {error && <p className="text-red-600">{error}</p>}
      {me && (
        <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
          {JSON.stringify(me, null, 2)}
        </pre>
      )}
    </main>
  )
}