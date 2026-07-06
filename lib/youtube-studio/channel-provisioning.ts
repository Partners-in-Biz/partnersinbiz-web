/**
 * YouTube channel workspace auto-provisioning.
 *
 * Called from the social OAuth callback (every YouTube OAuth) and from the
 * adopt endpoint. Keyed on (orgId, youtubeChannelId): existing non-deleted
 * workspaces are healed (reconnect / needs_reauth -> connected), missing ones
 * are created with the same policy defaults as the manual POST /channels
 * route (both go through sanitizeYouTubeChannelWorkspaceInput).
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import {
  sanitizeYouTubeChannelWorkspaceInput,
  sanitizeYouTubePublishingReadinessInput,
} from '@/lib/youtube-studio/sanitize'

export interface YouTubeChannelProfileInput {
  /** The YouTube channel id (social_accounts.platformAccountId). */
  platformAccountId: string
  displayName: string
  /** YouTube customUrl handle when it starts with '@', else the channel id. */
  username?: string
  avatarUrl?: string
  profileUrl?: string
  meta?: Record<string, unknown>
}

export interface ProvisionYouTubeChannelResult {
  channelWorkspaceId: string
  created: boolean
}

export type SafeProvisionOutcome =
  | { ok: true; result: ProvisionYouTubeChannelResult }
  | { ok: false; error: string }

const SYSTEM_ACTOR_ID = 'system-oauth'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function handleFrom(profile: YouTubeChannelProfileInput): string | undefined {
  const candidate = cleanString(profile.username)
  return candidate?.startsWith('@') ? candidate : undefined
}

export async function provisionYouTubeChannelWorkspace(
  orgId: string,
  accountId: string,
  profile: YouTubeChannelProfileInput,
): Promise<ProvisionYouTubeChannelResult> {
  if (!cleanString(orgId)) throw new Error('orgId is required')
  if (!cleanString(accountId)) throw new Error('accountId is required')
  const youtubeChannelId = cleanString(profile?.platformAccountId)
  if (!youtubeChannelId || youtubeChannelId === 'unknown') {
    throw new Error('A YouTube channel id is required to provision a channel workspace')
  }

  // Equality-only filters: no composite index needed.
  const snap = await adminDb
    .collection(YOUTUBE_COLLECTIONS.channels)
    .where('orgId', '==', orgId)
    .where('youtubeChannelId', '==', youtubeChannelId)
    .get()
  const existing = snap.docs.find((doc) => doc.data()?.deleted !== true)

  const nowIso = new Date().toISOString()
  const readinessPatch = {
    accountStatus: 'connected',
    lastCheckedAt: nowIso,
    checkedBy: SYSTEM_ACTOR_ID,
    checkedByType: 'system',
  }

  if (existing) {
    const existingData = existing.data() as Record<string, unknown>
    const existingReadiness =
      existingData.publishingReadiness && typeof existingData.publishingReadiness === 'object'
        ? existingData.publishingReadiness as Record<string, unknown>
        : {}
    const publishingReadiness = sanitizeYouTubePublishingReadinessInput({
      ...existingReadiness,
      ...readinessPatch,
    })
    const handle = handleFrom(profile)

    await existing.ref.update({
      connectedAccountId: accountId,
      title: cleanString(profile.displayName) ?? cleanString(existingData.title) ?? 'YouTube channel',
      ...(handle ? { youtubeHandle: handle } : {}),
      publishingReadiness,
      updatedBy: SYSTEM_ACTOR_ID,
      updatedByType: 'system',
      updatedAt: FieldValue.serverTimestamp(),
    })

    return { channelWorkspaceId: existing.id, created: false }
  }

  const data = sanitizeYouTubeChannelWorkspaceInput({
    orgId,
    title: cleanString(profile.displayName) ?? 'YouTube channel',
    youtubeChannelId,
    youtubeHandle: handleFrom(profile),
    status: 'setup',
    connectedAccountId: accountId,
    publishingReadiness: readinessPatch,
  })

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.channels).add({
    ...data,
    deleted: false,
    createdBy: SYSTEM_ACTOR_ID,
    createdByType: 'system',
    updatedBy: SYSTEM_ACTOR_ID,
    updatedByType: 'system',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { channelWorkspaceId: ref.id, created: true }
}

/**
 * Never throws. Used by the OAuth callback: a provisioning failure must not
 * fail the OAuth itself because the social account is already saved.
 */
export async function safeProvisionYouTubeChannelWorkspace(
  orgId: string,
  accountId: string,
  profile: YouTubeChannelProfileInput,
): Promise<SafeProvisionOutcome> {
  try {
    const result = await provisionYouTubeChannelWorkspace(orgId, accountId, profile)
    return { ok: true, result }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown provisioning error'
    console.error('[youtube-studio] channel provisioning failed:', error)
    return { ok: false, error }
  }
}
