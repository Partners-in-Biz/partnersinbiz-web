/**
 * Utility functions for briefing system:
 * - Deterministic normalization
 * - Safe excerpt generation
 * - Hash computation
 * - Timestamp normalization
 */

import crypto from 'crypto'
import { Timestamp } from 'firebase-admin/firestore'
import type { SafeExcerptOptions } from './types'

// ---------------------------------------------------------------------------
// Hash utilities
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic hash from source document data.
 * This is used for deduplication - the same source document will always
 * produce the same hash, allowing us to avoid duplicate briefing items.
 */
export function hashSourceDocument(doc: Record<string, unknown>, docId: string, relevantFields: string[]): string {
  const normalized: Record<string, unknown> = {}

  // Extract only the relevant fields for hashing
  for (const field of relevantFields) {
    const value = doc[field]
    if (value !== undefined && value !== null) {
      normalized[field] = normalizeForHash(value)
    }
  }

  // Add document ID to the hash
  normalized._id = docId

  const hashInput = JSON.stringify(normalized, Object.keys(normalized).sort())
  return crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 16)
}

/**
 * Normalize a value for hashing - handles Firestore Timestamps, dates, etc.
 */
function normalizeForHash(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  // Handle Firestore Timestamp
  if (value instanceof Timestamp) {
    return value.toDate().toISOString()
  }

  // Handle { toDate: () => Date } pattern
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString()
    } catch {
      return null
    }
  }

  // Handle { seconds, nanoseconds } pattern
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    const timestampLike = value as Record<string, unknown>
    const seconds = timestampLike.seconds ?? timestampLike._seconds
    if (typeof seconds === 'number') {
      return new Date(seconds * 1000).toISOString()
    }
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(normalizeForHash)
  }

  // Handle objects
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = normalizeForHash(val)
    }
    return result
  }

  // Fallback: convert to string
  return String(value)
}

// ---------------------------------------------------------------------------
// Excerpt utilities
// ---------------------------------------------------------------------------

const DEFAULT_EXTRACT_MAX_LENGTH = 300

/**
 * Generate a safe excerpt from source text.
 * Strips HTML, collapses whitespace, truncates to maxLength.
 */
export function extractSafeExcerpt(text: unknown, options: SafeExcerptOptions = {}): string | null {
  const {
    maxLength = DEFAULT_EXTRACT_MAX_LENGTH,
    stripHtml = true,
    stripMarkdown = true,
    collapseWhitespace = true,
  } = options

  // Convert to string if needed
  let result = typeof text === 'string' ? text : text !== null && text !== undefined ? String(text) : null
  if (!result) return null

  // Strip HTML tags
  if (stripHtml) {
    result = result.replace(/<[^>]*>/g, ' ')
  }

  // Strip basic Markdown
  if (stripMarkdown) {
    result = result
      .replace(/#{1,6}\s+/g, '')           // Headers
      .replace(/\*\*([^*]+)\*\*/g, '$1')    // Bold
      .replace(/\*([^*]+)\*/g, '$1')        // Italic
      .replace(/`([^`]+)`/g, '$1')          // Inline code
      .replace(/```[\s\S]*?```/g, '')       // Code blocks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // Images
  }

  // Collapse whitespace
  if (collapseWhitespace) {
    result = result.replace(/\s+/g, ' ').trim()
  }

  // Truncate to max length
  if (result.length > maxLength) {
    result = result.substring(0, maxLength).trim()
    // Try to end on a word boundary
    const lastSpace = result.lastIndexOf(' ')
    if (lastSpace > maxLength * 0.8) {
      result = result.substring(0, lastSpace)
    }
    result += '...'
  }

  return result || null
}

/**
 * Extract excerpt from multiple fields, preferring the first non-empty one.
 */
export function extractMultiFieldExcerpt(
  doc: Record<string, unknown>,
  fields: string[],
  options?: SafeExcerptOptions,
): string | null {
  for (const field of fields) {
    const value = doc[field]
    if (value !== undefined && value !== null) {
      const excerpt = extractSafeExcerpt(value, options)
      if (excerpt) return excerpt
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Timestamp utilities
// ---------------------------------------------------------------------------

/**
 * Normalize a timestamp to a Date object.
 * Handles Firestore Timestamp, Date objects, ISO strings, and { toDate: () => Date } objects.
 */
export function normalizeTimestamp(value: unknown): Date | null {
  if (!value) return null

  // Already a Date
  if (value instanceof Date) {
    return value
  }

  // Firestore Timestamp
  if (value instanceof Timestamp) {
    return value.toDate()
  }

  // { toDate: () => Date } pattern
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    try {
      const dateMethod = (value as { toDate: () => Date }).toDate
      if (typeof dateMethod === 'function') {
        return dateMethod()
      }
    } catch {
      return null
    }
  }

  // { seconds, nanoseconds } pattern
  if (typeof value === 'object' && value !== null) {
    const timestampLike = value as Record<string, unknown>
    const seconds = timestampLike.seconds ?? timestampLike._seconds
    if (typeof seconds === 'number') {
      return new Date(seconds * 1000)
    }
  }

  // ISO string or number (milliseconds since epoch)
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(parsed)
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value)
  }

  return null
}

/**
 * Generate a time-ago string for display (e.g., "5 minutes ago").
 */
export function formatTimeAgo(timestamp: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - timestamp.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)

  if (diffSecs < 60) return 'just now'
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
  if (diffWeeks < 4) return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`
  if (diffMonths < 12) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`

  const diffYears = Math.floor(diffDays / 365)
  return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`
}

// ---------------------------------------------------------------------------
// Priority utilities
// ---------------------------------------------------------------------------

/**
 * Priority values for sorting (lower = higher priority).
 */
export const PRIORITY_VALUES: Record<string, number> = {
  critical: 0,
  'needs-peet': 1,
  'client-risk': 2,
  review: 3,
  progress: 4,
  fyi: 5,
}

/**
 * Compare two priorities for sorting.
 */
export function comparePriority(a: string, b: string): number {
  const aVal = PRIORITY_VALUES[a] ?? 999
  const bVal = PRIORITY_VALUES[b] ?? 999
  return aVal - bVal
}

/**
 * Determine if a priority level requires action.
 */
export function priorityRequiresAction(priority: string): boolean {
  return ['critical', 'needs-peet', 'client-risk', 'review'].includes(priority)
}

// ---------------------------------------------------------------------------
// Context utilities
// ---------------------------------------------------------------------------

/**
 * Extract org ID from various source document shapes.
 */
export function extractOrgId(doc: Record<string, unknown>): string | null {
  return typeof doc.orgId === 'string' ? doc.orgId : null
}

/**
 * Extract project ID from various source document shapes.
 */
export function extractProjectId(doc: Record<string, unknown>): string | null {
  return typeof doc.projectId === 'string' ? doc.projectId : null
}

/**
 * Extract task ID from various source document shapes.
 */
export function extractTaskId(doc: Record<string, unknown>, docId?: string): string | null {
  return typeof doc.taskId === 'string' ? doc.taskId : docId ?? null
}

// ---------------------------------------------------------------------------
// Actor utilities
// ---------------------------------------------------------------------------

/**
 * Normalize actor information from a source document.
 */
export function normalizeActor(doc: Record<string, unknown>): {
  id: string
  name?: string | null
  role?: 'admin' | 'client' | 'ai' | 'system'
  type?: 'user' | 'agent' | 'system'
} {
  // Try various actor fields
  const userId = typeof doc.userId === 'string' ? doc.userId : null
  const createdBy = typeof doc.createdBy === 'string' ? doc.createdBy : null
  const updatedBy = typeof doc.updatedBy === 'string' ? doc.updatedBy : null
  const assigneeAgentId = typeof doc.assigneeAgentId === 'string' ? doc.assigneeAgentId : null
  const reviewerAgentId = typeof doc.reviewerAgentId === 'string' ? doc.reviewerAgentId : null

  const actorId = userId ?? createdBy ?? updatedBy ?? assigneeAgentId ?? reviewerAgentId ?? 'system'

  const userName = typeof doc.userName === 'string' ? doc.userName : null
  const userRole = typeof doc.userRole === 'string' ? doc.userRole : null

  // Determine actor type
  let actorType: 'user' | 'agent' | 'system' = 'user'
  if (actorId.startsWith('agent:')) {
    actorType = 'agent'
  } else if (actorId === 'system' || userRole === 'system') {
    actorType = 'system'
  }

  // Normalize role
  let role: 'admin' | 'client' | 'ai' | 'system' = 'admin'
  if (userRole === 'client' || userRole === 'ai' || userRole === 'system') {
    role = userRole
  } else if (actorType === 'agent') {
    role = 'ai'
  } else if (actorType === 'system') {
    role = 'system'
  }

  return {
    id: actorId,
    name: userName,
    role,
    type: actorType,
  }
}

// ---------------------------------------------------------------------------
// URL generation utilities
// ---------------------------------------------------------------------------

/**
 * Generate a web UI URL for a source document.
 */
export function generateSourceUrl(
  sourceType: string,
  docId: string,
  context?: { orgSlug?: string | null; projectId?: string | null; clientId?: string | null },
): string {
  const baseUrl = 'https://partnersinbiz.online'

  switch (sourceType) {
    case 'project':
      return `${baseUrl}/admin/projects/${docId}`

    case 'task':
      if (context?.projectId) {
        return `${baseUrl}/admin/projects/${context.projectId}?taskId=${docId}`
      }
      return `${baseUrl}/admin/projects?taskId=${docId}`

    case 'client-document':
      return `${baseUrl}/admin/documents/${docId}`

    case 'company':
      if (context?.clientId) {
        return `${baseUrl}/portal/companies/${context.clientId}`
      }
      return `${baseUrl}/admin/companies/${docId}`

    case 'contact':
      return `${baseUrl}/portal/contacts/${docId}`

    case 'notification':
      return `${baseUrl}/admin/inbox?notification=${docId}`

    default:
      return `${baseUrl}/admin`
  }
}
