// frontend/src/components/MagneticButton.tsx
"use client"

import { ReactNode, useRef, MouseEvent, ButtonHTMLAttributes, AnchorHTMLAttributes } from "react"
import Link from "next/link"
import { useMagnetic } from "@/hooks/useMagnetic"

type CommonProps = {
  children: ReactNode
  /** Optional className for the visual wrapper. */
  className?: string
  /** Magnetic pull strength in px. Default 6. */
  strength?: number
  /** Spotlight color override. Default the brand accent. */
  spotlight?: string
}

type ButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "ref" | "className" | "children"> & {
    href?: undefined
  }

type LinkProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "ref" | "className" | "children" | "href"> & {
    href: string
  }

type Props = ButtonProps | LinkProps

/**
 * MagneticButton — a button/link with two micro-interactions:
 *   1. Magnetic pull: the whole element drifts toward the cursor when nearby.
 *   2. Spotlight: a soft radial gradient inside the button tracks the cursor.
 *
 * The pull is handled by the useMagnetic hook (applied to an outer wrapper
 * so the inner button's own transforms aren't fought).
 *
 * The spotlight is a CSS variable set on the inner element; the actual
 * gradient is defined in globals.css via the .btn-spotlight class.
 *
 * Pass-through props go to the underlying <button> or <a>. Use href to
 * render an <a> via next/link instead of a button.
 */
export function MagneticButton(props: Props) {
  const { children, className = "", strength = 6, spotlight, ...rest } = props
  const wrapperRef = useMagnetic<HTMLSpanElement>({ strength })
  const innerRef = useRef<HTMLDivElement | null>(null)

  function onMove(e: MouseEvent<HTMLDivElement>) {
    const el = innerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    el.style.setProperty("--spot-x", `${x}%`)
    el.style.setProperty("--spot-y", `${y}%`)
  }

  function onLeave() {
    const el = innerRef.current
    if (!el) return
    el.style.setProperty("--spot-x", `50%`)
    el.style.setProperty("--spot-y", `120%`)
  }

  const spotlightStyle = spotlight
    ? ({ "--spot-color": spotlight } as React.CSSProperties)
    : undefined

  const inner = (
    <div
      ref={innerRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={`btn-spotlight ${className}`}
      style={spotlightStyle}
    >
      <span className="btn-spotlight-content">{children}</span>
    </div>
  )

  if ("href" in props && props.href) {
    const { href, ...anchorRest } = rest as AnchorHTMLAttributes<HTMLAnchorElement> & {
      href: string
    }
    return (
      <span ref={wrapperRef} className="magnetic-wrapper inline-block">
        <Link href={href} {...anchorRest}>
          {inner}
        </Link>
      </span>
    )
  }

  const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>
  return (
    <span ref={wrapperRef} className="magnetic-wrapper inline-block">
      <button {...buttonRest}>{inner}</button>
    </span>
  )
}