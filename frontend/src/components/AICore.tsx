// frontend/src/components/AICore.tsx
"use client"

/**
 * AICore — cinematic SVG centerpiece for the hero.
 *
 * Refinement pass: reduced from three orbital particles to two, removed the
 * "spec-shift" highlight wobble (the light source now stays fixed, like a
 * real lit object), and slowed the remaining orbits. The result reads as
 * "object at rest in lit space" rather than "object in active motion."
 *
 * Pure SVG + CSS. No props, no state.
 */

export function AICore() {
  return (
    <div className="ai-core-wrap" aria-hidden="true">
      <div className="ai-core-ambient" />

      <div className="ai-core-float">
        <svg
          viewBox="0 0 400 400"
          className="ai-core-svg"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <radialGradient id="ai-core-sphere" cx="42%" cy="38%" r="60%">
              <stop offset="0%" stopColor="#9DB4FF" stopOpacity="0.92" />
              <stop offset="22%" stopColor="#3B82F6" stopOpacity="0.72" />
              <stop offset="55%" stopColor="#2D3B7A" stopOpacity="0.52" />
              <stop offset="85%" stopColor="#13151B" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#0A0B0F" stopOpacity="1" />
            </radialGradient>

            <radialGradient id="ai-core-highlight" cx="32%" cy="28%" r="35%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.6" />
              <stop offset="30%" stopColor="#C9D6FF" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
            </radialGradient>

            <radialGradient id="ai-core-rim" cx="68%" cy="72%" r="42%">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0" />
              <stop offset="78%" stopColor="#3B82F6" stopOpacity="0" />
              <stop offset="92%" stopColor="#93C5FD" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.5" />
            </radialGradient>

            <linearGradient id="ai-core-ring-stroke" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.0" />
              <stop offset="35%" stopColor="#93C5FD" stopOpacity="0.6" />
              <stop offset="65%" stopColor="#3B82F6" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.0" />
            </linearGradient>

            <linearGradient id="ai-core-ring-stroke-2" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0" />
              <stop offset="50%" stopColor="#C9D6FF" stopOpacity="0.42" />
              <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
            </linearGradient>

            <filter id="ai-core-blur" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="8" />
            </filter>

            <filter id="ai-core-particle-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="2" />
            </filter>
          </defs>

          {/* Outer ring */}
          <g className="ai-core-ring-outer">
            <circle
              cx="200"
              cy="200"
              r="178"
              fill="none"
              stroke="url(#ai-core-ring-stroke)"
              strokeWidth="1"
            />
            <circle cx="378" cy="200" r="2.5" fill="#93C5FD" opacity="0.85" />
          </g>

          {/* Mid ring */}
          <g className="ai-core-ring-mid">
            <circle
              cx="200"
              cy="200"
              r="158"
              fill="none"
              stroke="url(#ai-core-ring-stroke-2)"
              strokeWidth="1"
              strokeDasharray="2 6"
            />
          </g>

          {/* Inner glow */}
          <circle
            cx="200"
            cy="200"
            r="135"
            fill="#3B82F6"
            opacity="0.16"
            filter="url(#ai-core-blur)"
            className="ai-core-inner-glow"
          />

          {/* Sphere body */}
          <circle cx="200" cy="200" r="120" fill="url(#ai-core-sphere)" />

          {/* Rim light */}
          <circle cx="200" cy="200" r="120" fill="url(#ai-core-rim)" />

          {/* Specular highlight — STATIC now, no spec-shift animation */}
          <circle
            cx="200"
            cy="200"
            r="120"
            fill="url(#ai-core-highlight)"
            className="ai-core-spec"
          />

          {/* Inner arcs */}
          <g className="ai-core-arcs" opacity="0.35">
            <circle
              cx="200"
              cy="200"
              r="92"
              fill="none"
              stroke="#93C5FD"
              strokeWidth="0.6"
              strokeDasharray="1 4"
              opacity="0.5"
            />
            <circle
              cx="200"
              cy="200"
              r="72"
              fill="none"
              stroke="#C9D6FF"
              strokeWidth="0.5"
              strokeDasharray="0.5 3"
              opacity="0.3"
            />
          </g>

          {/* Center pulse — kept; this is the "heartbeat" */}
          <g className="ai-core-pulse-group">
            <circle cx="200" cy="200" r="6" fill="#FFFFFF" opacity="0.95" />
            <circle
              cx="200"
              cy="200"
              r="14"
              fill="#3B82F6"
              opacity="0.4"
              className="ai-core-pulse-ring"
            />
          </g>

          {/* Two orbital particles — third removed for restraint */}
          <g className="ai-core-particle-orbit-1">
            <circle
              cx="200"
              cy="32"
              r="2.5"
              fill="#93C5FD"
              filter="url(#ai-core-particle-glow)"
            />
          </g>
          <g className="ai-core-particle-orbit-2">
            <circle
              cx="58"
              cy="200"
              r="2"
              fill="#C9D6FF"
              filter="url(#ai-core-particle-glow)"
            />
          </g>
        </svg>
      </div>

      <div className="ai-core-reflection" />
    </div>
  )
}