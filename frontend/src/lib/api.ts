// frontend/src/lib/api.ts
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"

export async function apiFetch(
  path: string,
  token: string,
  init: RequestInit = {}
) {
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${token}`)
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }

  const res = await fetch(`${BACKEND}${path}`, { ...init, headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  if (res.status === 204) return null
  return res.json()
}