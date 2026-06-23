// lib/client-documents/recipients.ts
//
// Resolve real email recipients for client-document notifications (US-173, US-188).
// Replaces the hardcoded notifications@partnersinbiz.online fallback so comment,
// reply, and first-view emails reach the document creator / comment author.

import { adminAuth } from '@/lib/firebase/admin'
import type { ClientDocument, DocumentComment } from '@/lib/client-documents/types'

const TEAM_INBOX = 'notifications@partnersinbiz.online'

export interface DocumentRecipient {
  email: string
  name: string
}

function looksLikeEmail(value: unknown): value is string {
  return typeof value === 'string' && /.+@.+\..+/.test(value.trim())
}

/**
 * Look up a Firebase Auth user's email + display name by uid.
 * Returns null when the uid is not a resolvable auth user (e.g. agent/system).
 */
export async function resolveUserRecipient(uid: string | undefined | null): Promise<DocumentRecipient | null> {
  if (!uid || typeof uid !== 'string') return null
  // Some actor ids are already emails (legacy / agent identities).
  if (looksLikeEmail(uid)) return { email: uid.trim().toLowerCase(), name: uid.trim() }

  try {
    const record = await adminAuth.getUser(uid)
    if (looksLikeEmail(record.email)) {
      return { email: record.email!.trim().toLowerCase(), name: record.displayName || record.email! }
    }
  } catch {
    // uid is not a real auth user — fall through to null.
  }
  return null
}

/**
 * The person who should be notified about activity on a document: the document
 * creator. Falls back to the PiB team inbox when the creator has no resolvable
 * email (agent/system created documents).
 */
export async function resolveDocumentOwnerRecipient(document: ClientDocument): Promise<DocumentRecipient> {
  const owner = await resolveUserRecipient(document.createdBy)
  if (owner) return owner
  return { email: TEAM_INBOX, name: 'Partners in Biz Team' }
}

/**
 * Recipient for a reply notification: the author of the parent comment. Falls
 * back to the document owner, then the team inbox.
 */
export async function resolveCommentAuthorRecipient(
  document: ClientDocument,
  comment: Pick<DocumentComment, 'userId' | 'userName'>,
): Promise<DocumentRecipient> {
  const author = await resolveUserRecipient(comment.userId)
  if (author) return author
  return resolveDocumentOwnerRecipient(document)
}

export const TEAM_INBOX_EMAIL = TEAM_INBOX
