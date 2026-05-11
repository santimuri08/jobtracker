// frontend/src/components/TiltCard.tsx
"use client"

import { ReactNode, useRef, MouseEvent, useEffect } from "react"

type Props = {
  children: ReactNode
  /** Max tilt in degrees. Default 3 (restrained). */
  max?: number
  /** Glare highlight opacity at peak. Default 0.06 (soft). */
  glareOpacity?: number
  className?: string
}

/**
 * TiltCard — soft 3D hover tilt with a cursor-following highlight.
 *
 * Refinement pass: max tilt reduced from 6° to 3° and glare opacity
 * dropped from 0.10 to 0.06. The motion now reads as "subtle response"
 * rather than "interactive surface." Premium restraint.
 */
export function TiltCard({
  children,
  max = 3,
  glareOpacity = 0.06,
  className = "",
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const reducedRef = useRef(false)

  useEffect(() => {
    reducedRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches
  }, [])

  function onMove(e: MouseEvent<HTMLDivElement>) {
    if (reducedRef.current) return
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const rotX = ((y - 0.5) * -2) * max
    const rotY = ((x - 0.5) *  2) * max
    el.style.setProperty("--tilt-x", `${rotX.toFixed(2)}deg`)
    el.style.setProperty("--tilt-y", `${rotY.toFixed(2)}deg`)
    el.style.setProperty("--glare-x", `${(x * 100).toFixed(1)}%`)
    el.style.setProperty("--glare-y", `${(y * 100).toFixed(1)}%`)
    el.style.setProperty("--glare-opacity", String(glareOpacity))
  }

  function onLeave() {
    const el = ref.current
    if (!el) return
    el.style.setProperty("--tilt-x", "0deg")
    el.style.setProperty("--tilt-y", "0deg")
    el.style.setProperty("--glare-opacity", "0")
  }

  return (
    <div className="tilt-wrap">
      <div
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        className={`tilt-surface ${className}`}
      >
        <div className="tilt-content">{children}</div>
        <div className="tilt-glare" aria-hidden="true" />
      </div>
    </div>
  )
}