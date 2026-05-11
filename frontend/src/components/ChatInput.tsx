// frontend/src/components/ChatInput.tsx
"use client"

import { useEffect, useRef } from "react"
import { ArrowUp, Loader2 } from "lucide-react"

type Props = {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  sending: boolean
  disabled?: boolean
  placeholder?: string
}

/**
 * The persistent chat input. Lives inside `.chat-input-bar` (which paints
 * the gradient fade above and the safe-area padding below). The input
 * surface itself is glass with a focus ring.
 */
export function ChatInput({
  value,
  onChange,
  onSend,
  sending,
  disabled,
  placeholder = "Message JobAgent…",
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Auto-grow up to CSS max-height
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!sending && !disabled && value.trim()) onSend()
    }
  }

  const canSend = !sending && !disabled && value.trim().length > 0

  return (
    <div className="chat-composer">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKey}
        rows={1}
        placeholder={placeholder}
        disabled={disabled}
        aria-label="Message JobAgent"
        spellCheck
      />
      <button
        type="button"
        onClick={onSend}
        disabled={!canSend}
        aria-label={sending ? "Sending" : "Send message"}
        className="chat-composer-send"
      >
        {sending
          ? <Loader2 size={16} className="animate-spin" />
          : <ArrowUp size={17} strokeWidth={2.25} />
        }
      </button>
    </div>
  )
}