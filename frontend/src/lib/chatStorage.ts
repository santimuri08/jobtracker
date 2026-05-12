// frontend/src/lib/chatStorage.ts
//
// CACHE-FIRST chat persistence.
//
// History:
//   Phase 1-3: this file was the source of truth (localStorage only).
//   Phase 4:   server is source of truth; this file caches the server's
//              state for fast first-paint and (degraded) offline reads.
//
// Public API:
//   - The original sync functions still exist and operate on the
//     localStorage cache only. Components that haven't been
//     refactored yet keep working — they just see slightly stale
//     data until the API call resolves and writes through.
//   - New async functions (suffix `Async`) hit the API as the source
//     of truth and write the result to the cache. Components that
//     have been refactored use these.
//
// All cache writes are best-effort. localStorage being full or
// disabled never blocks a server-confirmed action.

import type { ChatMessage } from "./agent"
import {
  listChats as apiListChats,
  getChat as apiGetChat,
  createChat as apiCreateChat,
  updateChatTitle as apiUpdateChatTitle,
  deleteChat as apiDeleteChat,
  replaceMessages as apiReplaceMessages,
  type ChatListItem,
  type ChatDetail,
} from "./chatApi"

const STORAGE_KEY = "jobagent.chats.v1"
const CURRENT_KEY = "jobagent.chats.current"
const MIGRATION_FLAG = "jobagent.chats.migrated.v1"

export type SavedChat = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

type ChatIndex = SavedChat[]

// ────────────────────────────────────────────────────────────────────
// Internal storage helpers (unchanged from Phase 1-3)
// ────────────────────────────────────────────────────────────────────

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
    // loses cached reads; server data is still authoritative.
  }
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

/** Convert the server's ChatDetail shape to the local SavedChat shape. */
function toSavedFromDetail(d: ChatDetail): SavedChat {
  return {
    id: d.id,
    title: d.title || deriveTitle(d.messages),
    createdAt: new Date(d.created_at).getTime(),
    updatedAt: new Date(d.updated_at).getTime(),
    messages: d.messages.map((m) => ({ role: m.role, content: m.content })),
  }
}

/** Convert a list item (no messages) to SavedChat shape (with empty messages). */
function toSavedFromListItem(item: ChatListItem): SavedChat {
  return {
    id: item.id,
    title: item.title || "New chat",
    createdAt: new Date(item.created_at).getTime(),
    updatedAt: new Date(item.updated_at).getTime(),
    messages: [], // intentionally empty — list view doesn't ship messages
  }
}

// ────────────────────────────────────────────────────────────────────
// Sync cache API — same shapes as Phase 1-3, now reads/writes only cache
// ────────────────────────────────────────────────────────────────────

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
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `ch_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`
  }
  return `ch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Cache-only write. Existing callers (Phase 1-3) keep using this.
 * After Step 7-10 refactor, they'll switch to saveChatAsync.
 */
export function saveChat(
  id: string,
  messages: ChatMessage[],
): SavedChat | null {
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

// ────────────────────────────────────────────────────────────────────
// Async API — server is source of truth, cache mirrors
// ────────────────────────────────────────────────────────────────────

/**
 * Fetch the user's chat list from the server, mirror to cache, return.
 * On network error, falls back to whatever's in the cache.
 */
export async function listChatsAsync(token: string): Promise<SavedChat[]> {
  try {
    const serverList = await apiListChats(token)
    const saved = serverList.map(toSavedFromListItem)

    // Merge: keep any cached messages for chats we already had locally.
    // (Server list doesn't include messages — they come from getChatAsync.)
    const cache = readAll()
    const merged = saved.map((s) => {
      const cached = cache.find((c) => c.id === s.id)
      return cached ? { ...s, messages: cached.messages } : s
    })

    writeAll(merged)
    return merged.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (e) {
    // Offline / server down — return cache as last resort
    console.warn("listChatsAsync falling back to cache:", e)
    return listChats()
  }
}

/**
 * Fetch one chat's full content (with messages) from the server, mirror
 * to cache, return. Caller should handle "not found" by listening for
 * the error's status — 404 means the chat doesn't exist on the server.
 */
export async function getChatAsync(
  token: string,
  id: string,
): Promise<SavedChat | null> {
  try {
    const detail = await apiGetChat(token, id)
    const saved = toSavedFromDetail(detail)
    // Update cache for this single chat
    const all = readAll().filter((c) => c.id !== id)
    writeAll([saved, ...all])
    return saved
  } catch (e) {
    // 404 → chat doesn't exist on server. Drop from cache too.
    if ((e as { status?: number }).status === 404) {
      writeAll(readAll().filter((c) => c.id !== id))
      return null
    }
    throw e
  }
}

/**
 * Create an empty chat on the server (idempotent on id). Caches result.
 * Used when a new chat transitions from "empty in-memory state" to
 * "user just sent a first message and needs a server row to PUT against."
 */
export async function createChatAsync(
  token: string,
  id: string,
): Promise<SavedChat> {
  const detail = await apiCreateChat(token, id)
  const saved = toSavedFromDetail(detail)
  const all = readAll().filter((c) => c.id !== id)
  writeAll([saved, ...all])
  return saved
}

/**
 * Save messages to the server (PUT replaces entire list), then mirror
 * the cache. This is the load-bearing write path.
 *
 * Returns the updated SavedChat (with server-derived title and timestamps).
 */
export async function saveChatAsync(
  token: string,
  id: string,
  messages: ChatMessage[],
): Promise<SavedChat> {
  const result = await apiReplaceMessages(token, id, messages)

  // Build the new cache entry. Use server's title + updated_at; fall
  // back to derived title if server didn't set one (shouldn't happen
  // after first message, but safe).
  const existing = readAll().find((c) => c.id === id)
  const next: SavedChat = {
    id,
    title: result.title || existing?.title || deriveTitle(messages),
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: new Date(result.updated_at).getTime(),
    messages,
  }

  const others = readAll().filter((c) => c.id !== id)
  writeAll([next, ...others])
  return next
}

/** Rename a chat on the server, mirror cache. */
export async function renameChatAsync(
  token: string,
  id: string,
  title: string,
): Promise<SavedChat | null> {
  const detail = await apiUpdateChatTitle(token, id, title)
  const saved = toSavedFromDetail(detail)
  const all = readAll().filter((c) => c.id !== id)
  writeAll([saved, ...all])
  return saved
}

/** Delete a chat on the server, mirror cache. */
export async function deleteChatAsync(token: string, id: string): Promise<void> {
  await apiDeleteChat(token, id)
  writeAll(readAll().filter((c) => c.id !== id))
  if (getCurrentChatId() === id) setCurrentChatId(null)
}

// ────────────────────────────────────────────────────────────────────
// One-time migration: localStorage → server
// ────────────────────────────────────────────────────────────────────

/**
 * Runs on every authenticated mount until it completes successfully
 * once. After that, the flag prevents re-runs.
 *
 * Logic:
 *   1. If flag is set, no-op.
 *   2. If no local chats, set flag and exit.
 *   3. Fetch server list. For each local chat NOT already on the server,
 *      POST to create + PUT its messages.
 *   4. Set flag.
 *
 * Idempotent on retry: already-uploaded chats skip via the serverIds
 * set; partial migrations re-attempt on next mount.
 */
export async function migrateLocalStorageIfNeeded(token: string): Promise<void> {
  if (typeof window === "undefined") return
  if (localStorage.getItem(MIGRATION_FLAG) === "true") return

  const local = readAll()
  if (local.length === 0) {
    localStorage.setItem(MIGRATION_FLAG, "true")
    return
  }

  try {
    const serverList = await apiListChats(token)
    const serverIds = new Set(serverList.map((c) => c.id))

    let migrated = 0
    for (const chat of local) {
      if (serverIds.has(chat.id)) continue
      if (chat.messages.length === 0) continue // empty chats don't need server rows

      try {
        await apiCreateChat(token, chat.id)
        await apiReplaceMessages(token, chat.id, chat.messages)
        migrated++
      } catch (e) {
        console.warn(`migrate: chat ${chat.id} failed, will retry next mount:`, e)
        // Don't set the flag — we'll try again next time
        return
      }
    }

    console.log(`migrate: uploaded ${migrated} chat(s) from localStorage to server`)
    localStorage.setItem(MIGRATION_FLAG, "true")
  } catch (e) {
    console.warn("migrate: server unreachable, will retry next mount:", e)
    // Don't set the flag — try again next mount
  }
}

/** Test helper: reset the migration flag so the next mount migrates again. */
export function _resetMigrationFlag(): void {
  if (typeof window === "undefined") return
  localStorage.removeItem(MIGRATION_FLAG)
}