// frontend/src/lib/chatStorage.ts
//
// Lightweight chat persistence on localStorage.
//
// We keep a list of conversations keyed by an id. Each conversation
// stores its messages (Anthropic-shaped) and a derived title (first
// user message, truncated). The backend is stateless — this is purely
// a frontend "saved chats" surface, like ChatGPT/Claude's history.

import type { ChatMessage } from "./agent"

const STORAGE_KEY = "jobagent.chats.v1"
const CURRENT_KEY = "jobagent.chats.current"

export type SavedChat = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

type ChatIndex = SavedChat[]

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function readAll(): ChatIndex {
  if (typeof window === "undefined") return []
  return safeParse<ChatIndex>(localStorage.getItem(STORAGE_KEY), [])
}

function writeAll(chats: ChatIndex): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats))
  } catch {
    // localStorage full or disabled — silently drop. Worst case the user
    // loses the saved-chat history; the in-memory state still works.
  }
}

export function listChats(): SavedChat[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getChat(id: string): SavedChat | null {
  return readAll().find((c) => c.id === id) ?? null
}

export function getCurrentChatId(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(CURRENT_KEY)
}

export function setCurrentChatId(id: string | null): void {
  if (typeof window === "undefined") return
  if (id) localStorage.setItem(CURRENT_KEY, id)
  else localStorage.removeItem(CURRENT_KEY)
}

export function makeChatId(): string {
  // Crypto-strong if available, otherwise time-based — both are unique
  // enough at this scale.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function deriveTitle(messages: ChatMessage[]): string {
  for (const m of messages) {
    if (m.role !== "user") continue
    const text =
      typeof m.content === "string"
        ? m.content
        : m.content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join(" ")
    const t = text.trim().replace(/\s+/g, " ")
    if (t) return t.length > 60 ? `${t.slice(0, 60)}…` : t
  }
  return "New chat"
}

export function saveChat(
  id: string,
  messages: ChatMessage[],
): SavedChat | null {
  // Don't persist empty chats — keep the saved-chats rail clean.
  if (messages.length === 0) return null

  const now = Date.now()
  const all = readAll()
  const existing = all.find((c) => c.id === id)

  const next: SavedChat = existing
    ? {
        ...existing,
        messages,
        title: existing.title === "New chat" ? deriveTitle(messages) : existing.title,
        updatedAt: now,
      }
    : {
        id,
        title: deriveTitle(messages),
        createdAt: now,
        updatedAt: now,
        messages,
      }

  const others = all.filter((c) => c.id !== id)
  writeAll([next, ...others])
  return next
}

export function deleteChat(id: string): void {
  writeAll(readAll().filter((c) => c.id !== id))
  if (getCurrentChatId() === id) setCurrentChatId(null)
}

export function renameChat(id: string, title: string): void {
  const all = readAll()
  const idx = all.findIndex((c) => c.id === id)
  if (idx < 0) return
  all[idx] = { ...all[idx], title: title.trim() || "Untitled", updatedAt: Date.now() }
  writeAll(all)
}

/** Clear ALL stored chats. Used by Settings → "Clear all chats". */
export function clearAllChats(): void {
  writeAll([])
  setCurrentChatId(null)
}