// frontend/src/app/applications/layout.tsx
"use client"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { WorkspaceShell } from "@/components/WorkspaceShell"

/**
 * Wraps every page under /applications/* in the workspace chrome (sidebar +
 * mobile drawer). The application form and detail pages keep their own
 * internal layout — this layout just gives them the sidebar.
 */
export default function ApplicationsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login?from=/dashboard")
    }
  }, [status, router])

  if (status === "loading") {
    return (
      <div className="workspace-boot">
        <div className="workspace-boot-dot" />
      </div>
    )
  }
  if (status === "unauthenticated") return null

  return (
    <WorkspaceShell>
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </WorkspaceShell>
  )
}