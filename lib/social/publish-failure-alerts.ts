import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

type SocialPublishFailureAlertInput = {
  orgId: string
  postId: string
  platform: string
  error: string
  campaignId?: string | null
  orgSlug?: string | null
}

type SocialPublishFailureAlertDoc = {
  orgId: string
  userId: null
  agentId: 'pip'
  type: 'social.publish_failed'
  title: string
  body: string
  link: string
  data: {
    postId: string
    campaignId: string | null
    platform: string
    requiredCapability: 'public-publishing'
    approvalRequired: true
  }
  priority: 'urgent'
  status: 'unread'
  snoozedUntil: null
  readAt: null
  createdAt: FirebaseFirestore.FieldValue
  createdBy: 'system:social-queue'
  createdByType: 'system'
}

function orgSlugForLink(input: Pick<SocialPublishFailureAlertInput, 'orgId' | 'orgSlug'>): string {
  if (input.orgSlug?.trim()) return input.orgSlug.trim()
  if (input.orgId === 'pib-platform-owner') return 'partners-in-biz'
  return input.orgId
}

async function resolveOrgSlug(orgId: string): Promise<string | null> {
  try {
    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
    const slug = orgDoc.data()?.slug
    return typeof slug === 'string' && slug.trim() ? slug.trim() : null
  } catch (err) {
    console.error('[social-queue] Failed to resolve org slug for publish failure notification:', err)
    return null
  }
}

function truncateError(error: string): string {
  return error.length > 500 ? `${error.slice(0, 497)}...` : error
}

export function buildSocialPublishFailureAlert(input: SocialPublishFailureAlertInput): {
  id: string
  doc: SocialPublishFailureAlertDoc
} {
  const campaignId = input.campaignId ?? null
  const orgSlug = orgSlugForLink(input)
  const link = campaignId
    ? `/admin/org/${orgSlug}/social/${campaignId}`
    : `/admin/org/${orgSlug}/social`

  return {
    id: `social-publish-failed-${input.orgId}-${input.postId}`,
    doc: {
      orgId: input.orgId,
      userId: null,
      agentId: 'pip',
      type: 'social.publish_failed',
      title: `Social auto-publish failed: ${input.platform}`,
      body: `Auto-publish failed for social post ${input.postId} on ${input.platform}. Error: ${truncateError(input.error)}. Do not retry/publish publicly until an operator reviews the account/media issue.`,
      link,
      data: {
        postId: input.postId,
        campaignId,
        platform: input.platform,
        requiredCapability: 'public-publishing',
        approvalRequired: true,
      },
      priority: 'urgent',
      status: 'unread',
      snoozedUntil: null,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'system:social-queue',
      createdByType: 'system',
    },
  }
}

export async function notifySocialPublishFailure(input: SocialPublishFailureAlertInput): Promise<void> {
  try {
    const alert = buildSocialPublishFailureAlert({
      ...input,
      orgSlug: input.orgSlug ?? await resolveOrgSlug(input.orgId),
    })
    await adminDb.collection('notifications').doc(alert.id).set(alert.doc, { merge: true })
  } catch (err) {
    console.error('[social-queue] Failed to create publish failure notification:', err)
  }
}
