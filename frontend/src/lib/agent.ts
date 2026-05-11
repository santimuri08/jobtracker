// frontend/src/lib/agent.ts
//
// Tiny client for POST /api/v1/agent/chat.
//
// The protocol is the standard Anthropic message shape:
//   - role: "user" | "assistant"
//   - content: string  OR  array of content blocks
//
// We send the FULL conversation every turn (the backend is stateless),
// and we get back the full updated history with the assistant's latest
// turn(s) appended.

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string }

export type ChatMessage = {
  role: "user" | "assistant"
  content: string | ContentBlock[]
}

export type ChatResponse = {
  messages: ChatMessage[]
}

/**
 * Send a conversation to the agent and get the updated history back.
 *
 * Throws on non-2xx so the caller can render the error.
 */
export async function sendToAgent(
  messages: ChatMessage[],
  token: string,
): Promise<ChatResponse> {
  const res = await fetch(`${BACKEND}/api/v1/agent/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages }),
  })

  if (!res.ok) {
    let detail: string
    try {
      const data = await res.json()
      detail = data.detail || `HTTP ${res.status}`
    } catch {
      detail = `HTTP ${res.status}`
    }
    throw new Error(detail)
  }

  return res.json() as Promise<ChatResponse>
}

/**
 * Extract the human-visible text from a message's content.
 * (Tool-use / tool-result blocks are skipped here — those get rendered
 * separately as small inline cards.)
 */
export function extractText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content
  return content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
}

/**
 * Extract tool calls from a message's content (assistant turns only).
 * Returned in order of appearance.
 */
export function extractToolCalls(
  content: ChatMessage["content"],
): Array<{ id: string; name: string; input: unknown }> {
  if (typeof content === "string") return []
  return content
    .filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }))
}