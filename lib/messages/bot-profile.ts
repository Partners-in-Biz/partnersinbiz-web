import type { BotAvatarStyle, BotMailboxRecord } from '@/lib/agents/types'

export type { BotAvatarStyle, BotMailboxRecord }

export const BOT_AVATAR_STYLES: readonly BotAvatarStyle[] = ['blob', 'geometric', 'image']

/** Built-in animated looks a user can pick without uploading anything. */
export const BOT_AVATAR_PICKABLE_STYLES: ReadonlyArray<{ id: Exclude<BotAvatarStyle, 'image'>; label: string }> = [
  { id: 'blob', label: 'Blob' },
  { id: 'geometric', label: 'Geometric' },
]

export const BOT_AVATAR_MAX_BYTES = 2 * 1024 * 1024

/** GIF rides along because <img> already loops it; no video pipeline is introduced. */
export const BOT_AVATAR_MIME_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export const PINNED_BOT_ID_RE = /^[A-Za-z0-9._-]{1,128}$/

export function isBotAvatarStyle(value: unknown): value is BotAvatarStyle {
  return typeof value === 'string' && (BOT_AVATAR_STYLES as readonly string[]).includes(value)
}

/** Resolve the effective style: an uploaded image wins, otherwise the picked/ default built-in. */
export function resolveBotAvatarStyle(input: { avatarUrl?: string | null; avatarStyle?: string | null }): BotAvatarStyle {
  if (input.avatarStyle === 'image' && input.avatarUrl) return 'image'
  if (input.avatarStyle === 'geometric') return 'geometric'
  if (input.avatarStyle === 'blob') return 'blob'
  return input.avatarUrl ? 'image' : 'blob'
}

export function normalizePinnedBotId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return PINNED_BOT_ID_RE.test(trimmed) ? trimmed : null
}

export function isBotAvatarMimeAllowed(mime: string | null | undefined): boolean {
  return Boolean(mime) && BOT_AVATAR_MIME_TYPES.includes(String(mime).toLowerCase())
}

export type BotMailboxView =
  | { state: 'active'; address: string; inboxId: string | null }
  | { state: 'pending'; address: string | null }
  | { state: 'error'; address: string | null; error: string }
  | { state: 'none' }

/** Shape the stored record into what the profile shows; never invents an address. */
export function botMailboxView(record: BotMailboxRecord | null | undefined): BotMailboxView {
  if (!record || !record.status) return { state: 'none' }
  const address = record.address?.trim() || null
  if (record.status === 'active' && address) return { state: 'active', address, inboxId: record.inboxId ?? null }
  if (record.status === 'error') return { state: 'error', address, error: record.error?.trim() || 'Mailbox provisioning failed' }
  if (record.status === 'pending') return { state: 'pending', address }
  return { state: 'none' }
}
