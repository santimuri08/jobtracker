// frontend/src/components/Reveal.tsx
"use client"

/**
 * Reveal — Apple-style entrance animation primitive.
 *
 * Three modes:
 *   • mode="word"   → each word fades up with a small stagger
 *   • mode="letter" → each character fades in with a tiny stagger (use sparingly)
 *   • mode="line"   → the whole element fades up as one (cheapest, for body text)
 *
 * Animation kicks off when the element scrolls into view (IntersectionObserver),
 * or immediately if `eager` is set. Honors prefers-reduced-motion.
 *
 * Pure presentation. No state, no fetch, no side effects beyond the observer.
 */

import { useEffect, useRef, useState, ReactNode } from "react"

type RevealProps = {
  children: ReactNode
  mode?: "word" | "letter" | "line"
  /** Delay in ms before the first child animates. */
  delay?: number
  /** Stagger between children in ms. Default 40 for word, 25 for letter. */
  stagger?: number
  /** Animate immediately on mount instead of waiting for scroll. */
  eager?: boolean
  /** Pass-through className for the wrapper. */
  className?: string
  /** Wrapper element. Defaults to span. */
  as?: "span" | "div" | "p" | "h1" | "h2" | "h3"
}

export function Reveal({
  children,
  mode = "line",
  delay = 0,
  stagger,
  eager = false,
  className = "",
  as: Tag = "span",
}: RevealProps) {
  const ref = useRef<HTMLElement>(null)
  const [shown, setShown] = useState(eager)

  // Detect reduced-motion preference up front; if so, skip the animation.
  const [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReducedMotion(m.matches)
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    m.addEventListener("change", handler)
    return () => m.removeEventListener("change", handler)
  }, [])

  // Trigger on scroll-into-view (only if not eager and not reduced-motion).
  useEffect(() => {
    if (eager || reducedMotion) {
      setShown(true)
      return
    }
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true)
            obs.disconnect()
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [eager, reducedMotion])

  // For word/letter mode we need a string to split. Only works if children is a string.
  const text = typeof children === "string" ? children : null

  if (mode === "line" || !text || reducedMotion) {
    return (
      <Tag
        ref={ref as React.Ref<HTMLElement> & React.Ref<HTMLDivElement>}
        className={`reveal-line ${shown ? "reveal-on" : ""} ${className}`}
        style={{ transitionDelay: `${delay}ms` }}
      >
        {children}
      </Tag>
    )
  }

  const step = stagger ?? (mode === "word" ? 40 : 25)
  const tokens =
    mode === "word"
      ? text.split(/(\s+)/) // keep whitespace as its own tokens so spaces are preserved
      : text.split("")

  return (
    <Tag
      ref={ref as React.Ref<HTMLElement> & React.Ref<HTMLDivElement>}
      className={`reveal-stagger ${shown ? "reveal-on" : ""} ${className}`}
      aria-label={text}
    >
      {tokens.map((tok, i) => {
        // Whitespace tokens shouldn't get the float-up animation — keep them as a plain space.
        if (/^\s+$/.test(tok)) {
          return <span key={i} aria-hidden="true">{tok}</span>
        }
        return (
          <span
            key={i}
            aria-hidden="true"
            className="reveal-token"
            style={{ transitionDelay: `${delay + i * step}ms` }}
          >
            {tok}
          </span>
        )
      })}
    </Tag>
  )
}


/**
 * GradientText — one-shot wrapper to apply the brand gradient to a key word.
 * Use sparingly (one word per headline, per the typography direction).
 *
 * <GradientText>AI</GradientText>
 *
 * Or with a hover-glow variant:
 *
 * <GradientText glow>Automation</GradientText>
 */
export function GradientText({
  children,
  glow = false,
  className = "",
}: {
  children: ReactNode
  glow?: boolean
  className?: string
}) {
  return (
    <span className={`gradient-text ${glow ? "gradient-text-glow" : ""} ${className}`}>
      {children}
    </span>
  )
}