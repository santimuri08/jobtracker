// frontend/src/app/settings/page.tsx
"use client"

import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect, useState, useCallback } from "react"
import { LogOut, Trash2 } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { WorkspaceShell } from "@/components/WorkspaceShell"
import { clearAllChats, listChats } from "@/lib/chatStorage"

type EmailPreference = {
  frequency: string
  last_sent_at: string | null
}

/**
 * /settings — the consolidated preferences page.
 *
 * Moves the weekly-summary card off the dashboard so the dashboard can stay
 * a pure review surface. Also exposes account info, the saved-chats count,
 * a clear-all action, and sign out.
 */
export default function SettingsPage() {
  const router = useRouter()
  const { status, data: session } = useSession()

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?from=/settings")
  }, [status, router])

  if (status !== "authenticated") return null

  return (
    <WorkspaceShell title="Settings">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-5 md:px-8 py-8 md:py-12 space-y-8">
          <div>
            <h1 className="font-display-hero text-3xl md:text-4xl font-bold leading-tight">
              Settings
            </h1>
            <p className="text-sm md:text-base text-[color:var(--text-muted)] mt-2">
              Preferences, account, and data.
            </p>
          </div>

          {/* Account */}
          <section className="card">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[color:var(--text-dim)] mb-4">
              Account
            </h2>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm text-[color:var(--text-muted)]">Signed in as</div>
                <div className="text-base font-medium truncate">{session?.user?.email}</div>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="btn-secondary text-sm inline-flex items-center gap-2"
              >
                <LogOut size={14} strokeWidth={1.75} />
                Sign out
              </button>
            </div>
          </section>

          {/* Email preferences */}
          {session?.backendToken && (
            <EmailPreferencesCard token={session.backendToken} />
          )}

          {/* Saved chats / local data */}
          <SavedChatsCard />
        </div>
      </div>
    </WorkspaceShell>
  )
}

function EmailPreferencesCard({ token }: { token: string }) {
  const [pref, setPref] = useState<EmailPreference | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState("")
  const [err, setErr] = useState("")

  const load = useCallback(async () => {
    try {
      const data: EmailPreference = await apiFetch("/api/v1/email-preferences", token)
      setPref(data)
    } catch (e) {
      setErr((e as Error).message)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  async function setFrequency(freq: "weekly" | "off") {
    setLoading(true); setErr(""); setMsg("")
    try {
      const data: EmailPreference = await apiFetch("/api/v1/email-preferences", token, {
        method: "PATCH",
        body: JSON.stringify({ frequency: freq }),
      })
      setPref(data)
      setMsg(freq === "off" ? "Weekly emails turned off." : "Weekly emails turned on.")
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function sendTest() {
    setLoading(true); setErr(""); setMsg("")
    try {
      const data = await apiFetch("/api/v1/email-preferences/test", token, { method: "POST" })
      if (data.sent) {
        setMsg(`Sent to ${data.email_to}. Check your inbox in ~30 seconds.`)
      } else {
        setMsg(`Skipped: ${data.skipped_reason}`)
      }
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="card">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[color:var(--text-dim)] mb-4">
        Weekly summary email
      </h2>
      <p className="text-sm text-[color:var(--text-muted)] mb-4">
        {pref?.frequency === "weekly"
          ? "On — you'll get a recap every Monday."
          : "Off — no weekly summary emails."}
        {pref?.last_sent_at && (
          <span className="block text-xs text-[color:var(--text-dim)] mt-1">
            Last sent {new Date(pref.last_sent_at).toLocaleString()}
          </span>
        )}
      </p>

      {msg && <div className="text-xs text-[color:var(--success)] mb-3">{msg}</div>}
      {err && <div className="text-xs text-[color:var(--danger)] mb-3">{err}</div>}

      <div className="flex flex-wrap gap-2">
        <button onClick={sendTest} disabled={loading} className="btn-secondary text-sm">
          Send test now
        </button>
        {pref?.frequency === "weekly" ? (
          <button onClick={() => setFrequency("off")} disabled={loading} className="btn-secondary text-sm">
            Turn off
          </button>
        ) : (
          <button onClick={() => setFrequency("weekly")} disabled={loading} className="btn-primary text-sm">
            Turn on
          </button>
        )}
      </div>
    </section>
  )
}

function SavedChatsCard() {
  const [count, setCount] = useState(0)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    setCount(listChats().length)
  }, [])

  function handleClear() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    clearAllChats()
    setCount(0)
    setConfirming(false)
    window.dispatchEvent(new Event("jobagent:chats-changed"))
  }

  return (
    <section className="card">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[color:var(--text-dim)] mb-4">
        Saved chats
      </h2>
      <p className="text-sm text-[color:var(--text-muted)] mb-4">
        {count} conversation{count === 1 ? "" : "s"} stored on this device. Clearing here only removes
        local history — your applications and resumes are untouched.
      </p>
      <button
        onClick={handleClear}
        disabled={count === 0}
        className="btn-secondary text-sm inline-flex items-center gap-2"
      >
        <Trash2 size={14} strokeWidth={1.75} />
        {confirming ? "Tap again to confirm" : "Clear all chats"}
      </button>
    </section>
  )
}