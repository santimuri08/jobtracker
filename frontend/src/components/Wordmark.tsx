// frontend/src/components/Wordmark.tsx
import Link from "next/link"

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 group">
      <span className="logo-dot" />
      <span className="text-lg font-bold tracking-tight">
        Job<span className="text-[color:var(--accent)]">Agent</span>
      </span>
    </Link>
  )
}