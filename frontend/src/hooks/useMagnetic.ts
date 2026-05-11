// frontend/src/hooks/useMagnetic.ts
"use client"

import { useEffect, useRef, RefObject } from "react"

type Options = {
  /** Max translation in pixels at full strength. Default 4 (restrained). */
  strength?: number
  /** Distance in px beyond the element bounds where magnetism starts. Default 80. */
  range?: number
}

/**
 * useMagnetic — cursor-following translate with proximity falloff.
 *
 * Refinement pass: default strength reduced from 8px to 4px. The pull
 * is now perceptible but not theatrical. Critical-damping factor on
 * the lerp adjusted (0.18 → 0.14) so the motion feels heavier, more
 * physically believable.
 *
 * No-op when prefers-reduced-motion is set.
 */
export function useMagnetic<T extends HTMLElement = HTMLElement>(
  options: Options = {},
): RefObject<T | null> {
  const { strength = 4, range = 80 } = options
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduce) return

    let rafId: number | null = null
    let currentX = 0
    let currentY = 0
    let targetX = 0
    let targetY = 0

    function step() {
      // Heavier lerp factor — motion settles slower, reads as "weighted"
      currentX += (targetX - currentX) * 0.14
      currentY += (targetY - currentY) * 0.14
      if (el) {
        el.style.transform = `translate3d(${currentX.toFixed(2)}px, ${currentY.toFixed(2)}px, 0)`
      }
      if (Math.abs(targetX - currentX) > 0.05 || Math.abs(targetY - currentY) > 0.05) {
        rafId = requestAnimationFrame(step)
      } else {
        rafId = null
      }
    }

    function onMove(e: MouseEvent) {
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      const dist = Math.hypot(dx, dy)
      const radius = Math.max(rect.width, rect.height) / 2 + range

      if (dist < radius) {
        const t = 1 - dist / radius
        targetX = (dx / radius) * strength * t
        targetY = (dy / radius) * strength * t
      } else {
        targetX = 0
        targetY = 0
      }

      if (rafId === null) {
        rafId = requestAnimationFrame(step)
      }
    }

    function onLeave() {
      targetX = 0
      targetY = 0
      if (rafId === null) {
        rafId = requestAnimationFrame(step)
      }
    }

    window.addEventListener("mousemove", onMove, { passive: true })
    window.addEventListener("mouseleave", onLeave)
    document.addEventListener("mouseleave", onLeave)

    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseleave", onLeave)
      document.removeEventListener("mouseleave", onLeave)
      if (rafId !== null) cancelAnimationFrame(rafId)
      if (el) el.style.transform = ""
    }
  }, [strength, range])

  return ref
}