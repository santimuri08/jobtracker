// frontend/src/lib/chatApi.ts
//
// REST client for /api/v1/chats — Phase 4 persistence.
//
// The backend is the source of truth. localStorage is only a cache
// (handled in chatStorage.ts after Step 6). This module knows nothing
// about caching; it's a pure fetch wrapper.
//
// Auth: every call needs a JWT — the same token agent.ts uses.

import type { ChatMessage } from "./agent"

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"

// ────────────────────────────────────────────────────────────────────
// Types — match the Pydantic shapes from backend/app/schemas.py
// ────────────────────────────────────────────────────────────────────

export type ChatListItem = {
  id: string
  title: string | null
  created_at: string
  updated_at: string
  message_count: number
}

export type ChatDetail = {
  id: string
  title: string | null
  created_at: string
  updated_at: string
  messages: ChatMessageWithMeta[]
}

/**
 * A message as returned by the server. Includes `position` and
 * `created_at` on top of the agent's wire-format (role + content).
 */
export type ChatMessageWithMeta = ChatMessage & {
  position: number
  created_at: string
}

export type MessagesReplaceResult = {
  message_count: number
  updated_at: string
  title: string | null
}

// ────────────────────────────────────────────────────────────────────
// Error class — gives callers a typed handle on HTTP status codes
// ────────────────────────────────────────────────────────────────────

export class ChatApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = "ChatApiError"
  }
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ChatApiError && err.status === 404
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ChatApiError && err.status === 401
}

// ────────────────────────────────────────────────────────────────────
// Shared fetch wrapper
// ────────────────────────────────────────────────────────────────────

async function request(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json"
  }
  if (init?.headers) {
    Object.assign(headers, init.headers)
  }

  const res = await fetch(`${BACKEND}${path}`, { ...init, headers })

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (typeof data.detail === "string") detail = data.detail
    } catch {
      // Body wasn't JSON — keep generic HTTP n message
    }
    throw new ChatApiError(res.status, detail)
  }

  return res
}

// ────────────────────────────────────────────────────────────────────
// Six endpoints
// ────────────────────────────────────────────────────────────────────

/** GET /api/v1/chats */
export async function listChats(token: string): Promise<ChatListItem[]> {
  const res = await request(token, "/api/v1/chats")
  const data = (await res.json()) as { chats: ChatListItem[] }
  return data.chats
}

/** GET /api/v1/chats/{id} */
export async function getChat(token: string, id: string): Promise<ChatDetail> {
  const res = await request(token, `/api/v1/chats/${encodeURIComponent(id)}`)
  return (await res.json()) as ChatDetail
}

/**
 * POST /api/v1/chats — idempotent on id.
 * If id is supplied and already exists for this user, server returns
 * the existing chat. If absent, server generates one.
 */
export async function createChat(
  token: string,
  id?: string | null,
  title?: string | null,
): Promise<ChatDetail> {
  const body: Record<string, unknown> = {}
  if (id) body.id = id
  if (title) body.title = title
  const res = await request(token, "/api/v1/chats", {
    method: "POST",
    body: JSON.stringify(body),
  })
  return (await res.json()) as ChatDetail
}

/** PATCH /api/v1/chats/{id} — update title */
export async function updateChatTitle(
  token: string,
  id: string,
  title: string,
): Promise<ChatDetail> {
  const res = await request(token, `/api/v1/chats/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  })
  return (await res.json()) as ChatDetail
}

/** DELETE /api/v1/chats/{id} — cascades to chat_messages */
export async function deleteChat(token: string, id: string): Promise<void> {
  await request(token, `/api/v1/chats/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

/**
 * PUT /api/v1/chats/{id}/messages — replace entire message list.
 *
 * The agent loop returns the full conversation every turn. We post
 * that full state, server overwrites. Idempotent on identical payloads.
 */
export async function replaceMessages(
  token: string,
  id: string,
  messages: ChatMessage[],
): Promise<MessagesReplaceResult> {
  const res = await request(token, `/api/v1/chats/${encodeURIComponent(id)}/messages`, {
    method: "PUT",
    body: JSON.stringify({ messages }),
  })
  return (await res.json()) as MessagesReplaceResult
}