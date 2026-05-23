/**
 * Unified comments — types.
 *
 * The `comments` collection is a cross-resource comments system used by all
 * new resources (invoices, quotes, tasks, expenses, etc.). Social posts keep
 * their existing per-post comment subcollection for backward compatibility.
 */

/** Resource types that can carry comments. Keep in sync with the POST validator. */
export type CommentResourceType =
  | 'invoice'
  | 'quote'
  | 'contact'
  | 'deal'
  | 'project'
  | 'task'
  | 'expense'
  | 'time_entry'
  | 'form_submission'
  | 'calendar_event'
  | 'client_org'
  | 'research_item'

export const VALID_COMMENT_RESOURCE_TYPES: readonly CommentResourceType[] = [
  'invoice',
  'quote',
  'contact',
  'deal',
  'project',
  'task',
  'expense',
  'time_entry',
  'form_submission',
  'calendar_event',
  'client_org',
  'research_item',
] as const

/**
 * A single @mention parsed out of a comment body.
 *  - `type` — whether the mention targets a user or an agent
 *  - `id`   — the user uid or agent id/name
 *  - `raw`  — the original match (e.g. `@user:abc123`) for UI highlighting
 */
export interface Mention {
  type: 'user' | 'agent'
  id: string
  raw: string
}

export interface Comment {
  id: string
  orgId: string
  resourceType: CommentResourceType
  resourceId: string
  parentCommentId: string | null
  body: string
  mentions: Mention[]
  /**
   * Flat array of `${type}:${id}` strings, denormalized from `mentions[]`.
   * Firestore cannot index fields inside an array of objects, so this is
   * the array we query against (e.g. `array-contains 'user:abc123'`).
   */
  mentionIds: string[]
  attachments: string[] // file IDs
  anchor?: unknown
  createdBy: string
  createdByType: 'user' | 'agent' | 'system'
  updatedBy: string | null
  updatedByType: 'user' | 'agent' | 'system' | null
  agentPickedUp: boolean
  agentPickedUpAt: unknown | null
  createdAt: unknown
  updatedAt: unknown
  deleted: boolean
}
