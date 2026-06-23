// lib/governance/firestore.ts
// Shared helpers for the admin governance / settings control plane.
// Serialization (Firestore Timestamp -> ISO string), id helpers, and
// super-admin gating used by every governance API route.
import { Timestamp } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

/** Recursively convert Firestore Timestamps to ISO strings for JSON responses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeGovernance(value: any): any {
  if (value === null || value === undefined) return value
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(serializeGovernance)
  if (typeof value === 'object') {
    // Firestore Timestamp-like (after a network hop / plain object)
    const maybeTs = value as { toDate?: () => Date; _seconds?: number; seconds?: number; _nanoseconds?: number }
    if (typeof maybeTs.toDate === 'function') {
      try { return maybeTs.toDate().toISOString() } catch { /* fall through */ }
    }
    if (typeof maybeTs._seconds === 'number' && typeof maybeTs._nanoseconds === 'number') {
      return new Date(maybeTs._seconds * 1000 + Math.floor(maybeTs._nanoseconds / 1e6)).toISOString()
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) out[k] = serializeGovernance(v)
    return out
  }
  return value
}

/** Convert any Firestore time-ish value to epoch millis (0 when unknown). */
export function toMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Timestamp) return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const row = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof row.toMillis === 'function') return row.toMillis()
    if (typeof row.toDate === 'function') { try { return row.toDate().getTime() } catch { return 0 } }
    const seconds = row.seconds ?? row._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

export function requireSuperAdmin(user: ApiUser): boolean {
  return isSuperAdmin(user)
}

export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function cleanStr(value: unknown, max = 5000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function cleanBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function cleanNum(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** Actor descriptor written onto governance audit records. */
export function actorOf(user: ApiUser): { uid: string; role: string; kind?: string } {
  return { uid: user.uid, role: user.role, kind: user.authKind }
}
