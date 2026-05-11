// frontend/src/app/resumes/layout.tsx
"use client"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { WorkspaceShell } from "@/components/WorkspaceShell"

/**
 * Wraps every page under /resumes/* in the workspace chrome.
 * The resume list and detail pages keep their own internal layout.
 */
export default function ResumesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login?from=/resumes")
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