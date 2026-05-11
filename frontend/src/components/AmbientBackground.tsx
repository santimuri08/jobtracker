// frontend/src/components/AmbientBackground.tsx
"use client"

/**
 * AmbientBackground — site-wide cinematic background system.
 *
 * Refinement pass:
 *  - Particle count: 36 → 24 (less visual noise)
 *  - Drift speed: roughly halved (slower, more contemplative)
 *  - Cursor push radius: 140 → 110 px (more localized, less reactive)
 *  - Push magnitude reduced for restrained interaction
 *
 * Stacked layers (back to front): rays, grid, blooms, particles, vignette.
 */

import { useEffect, useRef } from "react"

const PARTICLE_COUNT = 24

type Particle = {
  baseX: number
  baseY: number
  driftX: number
  driftY: number
  phaseX: number
  phaseY: number
  speedX: number
  speedY: number
  size: number
  opacity: number
  blur: number
}

function makeParticles(): Particle[] {
  const out: Particle[] = []
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    out.push({
      baseX: Math.random() * 100,
      baseY: Math.random() * 100,
      driftX: 0,
      driftY: 0,
      phaseX: Math.random() * Math.PI * 2,
      phaseY: Math.random() * Math.PI * 2,
      // Slower drift speeds — particles feel suspended, not floating fast
      speedX: 0.00012 + Math.random() * 0.00022,
      speedY: 0.00012 + Math.random() * 0.00022,
      size: 1 + Math.random() * 2,
      opacity: 0.12 + Math.random() * 0.25,
      blur: Math.random() * 1.0,
    })
  }
  return out
}

export function AmbientBackground() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const particlesRef = useRef<HTMLDivElement | null>(null)
  const particleEls = useRef<HTMLDivElement[]>([])

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const container = particlesRef.current
    if (!container) return

    const particles = makeParticles()
    container.innerHTML = ""
    particleEls.current = particles.map((p) => {
      const el = document.createElement("div")
      el.className = "amb-particle"
      el.style.left = `${p.baseX}vw`
      el.style.top = `${p.baseY}vh`
      el.style.width = `${p.size}px`
      el.style.height = `${p.size}px`
      el.style.opacity = String(p.opacity)
      el.style.setProperty("--p-opacity", String(p.opacity))
      el.style.filter = p.blur > 0 ? `blur(${p.blur.toFixed(2)}px)` : ""
      container.appendChild(el)
      return el
    })

    if (reduced) return

    let cursorX = -9999
    let cursorY = -9999
    function onMouseMove(e: MouseEvent) {
      cursorX = e.clientX
      cursorY = e.clientY
    }
    function onMouseLeave() {
      cursorX = -9999
      cursorY = -9999
    }
    window.addEventListener("mousemove", onMouseMove, { passive: true })
    document.addEventListener("mouseleave", onMouseLeave)

    let rafId = 0
    let lastVW = window.innerWidth
    let lastVH = window.innerHeight

    function frame(t: number) {
      if (t % 600 < 16) {
        lastVW = window.innerWidth
        lastVH = window.innerHeight
      }

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        const el = particleEls.current[i]
        if (!el) continue

        // Gentler idle drift
        p.driftX = Math.sin(t * p.speedX + p.phaseX) * 14
        p.driftY = Math.cos(t * p.speedY + p.phaseY) * 11

        // Tighter, softer cursor interaction
        let pushX = 0
        let pushY = 0
        if (cursorX > -9000) {
          const px = (p.baseX / 100) * lastVW + p.driftX
          const py = (p.baseY / 100) * lastVH + p.driftY
          const dx = px - cursorX
          const dy = py - cursorY
          const dist = Math.hypot(dx, dy)
          const radius = 110
          if (dist < radius && dist > 0.1) {
            const force = 1 - dist / radius
            // Halved magnitude — read as "current of air" not "active force"
            const magnitude = 12 * force * force
            pushX = (dx / dist) * magnitude
            pushY = (dy / dist) * magnitude
          }
        }

        el.style.transform = `translate3d(${(p.driftX + pushX).toFixed(2)}px, ${(p.driftY + pushY).toFixed(2)}px, 0)`
      }

      rafId = requestAnimationFrame(frame)
    }

    rafId = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseleave", onMouseLeave)
    }
  }, [])

  return (
    <div ref={rootRef} className="amb-root" aria-hidden="true">
      <div className="amb-rays">
        <div className="amb-ray amb-ray-1" />
        <div className="amb-ray amb-ray-2" />
        <div className="amb-ray amb-ray-3" />
        <div className="amb-ray amb-ray-4" />
      </div>

      <div className="amb-grid" />

      <div className="amb-bloom amb-bloom-a" />
      <div className="amb-bloom amb-bloom-b" />

      <div ref={particlesRef} className="amb-particles" />

      <div className="amb-vignette" />
    </div>
  )
}