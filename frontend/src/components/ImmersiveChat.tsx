// frontend/src/components/ImmersiveChat.tsx
//
// LEGACY SHIM.
//
// Pre-redesign, this component opened a fullscreen overlay over whatever
// page it lived on. In the redesign the workspace is its own route
// (/chat), so this component now just renders a CTA card that navigates
// there. We keep it exported under the same name + props so older
// callers (notably the marketing landing page) don't need to change
// imports, but the recommended path is to use a plain `<Link>` to /chat.
//
// Removing this file is safe once any remaining imports are cleaned up.

"use client"

import { useRouter } from "next/navigation"
import { ArrowUpRight } from "lucide-react"

type Props = {
  initialInput?: string
  storageKey?: string
}

export function ImmersiveChat({ initialInput }: Props) {
  const router = useRouter()

  function go() {
    const q = (initialInput ?? "").trim()
    router.push(q ? `/chat?q=${encodeURIComponent(q)}&new=1` : `/chat`)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          go()
        }
      }}
      className="
        group relative cursor-pointer
        border border-[color:var(--border-strong)]
        bg-[color:var(--bg-elevated)]/70
        backdrop-blur-xl
        hover:border-[color:var(--accent)]
        transition-all duration-500 ease-out
        overflow-hidden
      "
      style={{
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-card), 0 0 0 1px rgba(59, 130, 246, 0.04)",
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-70"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, var(--accent-soft), transparent 70%)",
        }}
      />

      <div className="relative px-5 md:px-6 py-4 md:py-5 flex items-center gap-4">
        <div className="relative flex-shrink-0">
          <span className="logo-dot block" />
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-[color:var(--accent)] animate-ping opacity-60"
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--text-dim)] mb-1">
            JobAgent
          </div>
          <div className="text-sm text-[color:var(--text-muted)] truncate">
            Open the conversational workspace
          </div>
        </div>

        <div
          className="
            hidden sm:flex items-center gap-1.5 px-3 py-1.5
            border border-[color:var(--border)]
            text-[10px] uppercase tracking-wider text-[color:var(--text-dim)]
            group-hover:border-[color:var(--accent)] group-hover:text-[color:var(--accent)]
            transition-colors
          "
          style={{ borderRadius: "var(--radius-sm)" }}
        >
          <span>Open</span>
          <ArrowUpRight size={12} strokeWidth={2} />
        </div>
      </div>
    </div>
  )
}