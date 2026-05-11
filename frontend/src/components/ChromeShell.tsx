// frontend/src/components/ChromeShell.tsx
"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"
import { TopNav } from "@/components/TopNav"
import { AmbientBackground } from "@/components/AmbientBackground"

/**
 * Routes that own their own chrome — sidebar, header, layout.
 * The marketing TopNav and ambient background are SUPPRESSED here so
 * the workspace surface is truly fullscreen and not competing with
 * a second floating bar.
 */
const WORKSPACE_PREFIXES = [
  "/chat",
  "/settings",
  "/dashboard",
  "/applications",
  "/resumes",
]

function isWorkspaceRoute(pathname: string | null): boolean {
  if (!pathname) return false
  return WORKSPACE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

/**
 * Pages where we want the workspace's *fullscreen* mode (overflow:hidden
 * on <html>). The dashboard / applications / resumes pages are workspace-
 * adjacent but still scroll, so they don't get this treatment.
 */
const FULLSCREEN_PREFIXES = ["/chat"]

function isFullscreenRoute(pathname: string | null): boolean {
  if (!pathname) return false
  return FULLSCREEN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

export function ChromeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const workspace = isWorkspaceRoute(pathname)
  const fullscreen = isFullscreenRoute(pathname)

  // Toggle the .workspace-root class on <html> for fullscreen routes.
  // globals.css uses that class to lock body scroll + remove safe-area
  // padding so the chat surface paints edge-to-edge.
  useEffect(() => {
    const root = document.documentElement
    if (fullscreen) {
      root.classList.add("workspace-root")
    } else {
      root.classList.remove("workspace-root")
    }
    return () => {
      root.classList.remove("workspace-root")
    }
  }, [fullscreen])

  if (workspace) {
    // No marketing TopNav, no ambient background — every workspace surface
    // (chat, dashboard, applications, resumes, settings) gets a calm canvas
    // and renders its own header.
    return <div className="relative min-h-[100dvh]">{children}</div>
  }

  return (
    <>
      <AmbientBackground />
      <div className="relative z-10">
        <TopNav />
        {children}
      </div>
    </>
  )
}