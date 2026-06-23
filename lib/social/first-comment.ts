/**
 * First-comment automation helper.
 *
 * After a post publishes, an optional follow-up comment can be posted to the
 * same platform post (commonly used to park hashtags or a link in the first
 * comment instead of the caption). This is intentionally distinct from
 * threadParts: it is a single comment on the *published* post, posted by the
 * same account, and a failure here must never roll back a successful publish.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { getProvider } from '@/lib/social/providers'

type Provider = ReturnType<typeof getProvider>

export interface FirstCommentResult {
  attempted: boolean
  posted: boolean
  commentId?: string
  error?: string
}

/** Extract a non-empty first-comment string from a post document, if present. */
export function getFirstComment(post: Record<string, unknown>): string | null {
  const value = typeof post.firstComment === 'string' ? post.firstComment.trim() : ''
  return value.length > 0 ? value : null
}

/**
 * Post the first comment on a freshly-published post. Best-effort: records the
 * outcome on the post document and never throws, so a comment failure cannot
 * fail the publish.
 */
export async function postFirstComment(
  provider: Provider,
  postId: string,
  platformPostId: string,
  firstComment: string,
): Promise<FirstCommentResult> {
  try {
    const result = await provider.postComment(platformPostId, firstComment)
    await adminDb.collection('social_posts').doc(postId).update({
      firstCommentStatus: 'posted',
      firstCommentId: result.platformPostId ?? null,
      firstCommentPostedAt: FieldValue.serverTimestamp(),
      firstCommentError: null,
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {})
    return { attempted: true, posted: true, commentId: result.platformPostId }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    await adminDb.collection('social_posts').doc(postId).update({
      firstCommentStatus: 'failed',
      firstCommentError: error,
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {})
    return { attempted: true, posted: false, error }
  }
}
