import { adminDb } from '@/lib/firebase/admin'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type {
  ChatContextAction,
  ChatContextReadModel,
  ContextAttentionSummary,
  ContextDisplayState,
  ChatContextRelationship,
} from '@/lib/chat-context/types'
import { primaryPlatformOf } from '@/lib/campaign-preview/normalizeSocialPost'

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function postText(value: unknown): string {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ').slice(0, 200)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const text = (value as { text?: unknown }).text
    if (typeof text === 'string') return text.trim().replace(/\s+/g, ' ').slice(0, 200)
  }
  return ''
}

function stateForStatus(status: string): ContextDisplayState {
  switch (status.toLowerCase()) {
    case 'published':
    case 'approved':
    case 'vaulted':
      return 'complete'
    case 'pending_approval':
    case 'qa_review':
      return 'needs_approval'
    case 'client_review':
    case 'review':
      return 'review'
    case 'failed':
    case 'cancelled':
      return 'blocked'
    case 'publishing':
    case 'scheduled':
    case 'regenerating':
      return 'running'
    default:
      return 'ready'
  }
}

function socialHref(id: string, role: string | undefined): string {
  return role === 'client'
    ? `/portal/social/review/${encodeURIComponent(id)}`
    : `/admin/social/history/${encodeURIComponent(id)}`
}

function campaignHref(id: string, role: string | undefined): string {
  return role === 'client' ? `/portal/campaigns/${encodeURIComponent(id)}` : `/admin/campaigns/${encodeURIComponent(id)}`
}

function hasFinalApproval(post: Record<string, unknown>): boolean {
  const approval = post.approval && typeof post.approval === 'object' && !Array.isArray(post.approval)
    ? post.approval as Record<string, unknown>
    : {}
  return Boolean(
    post.approvedAt
    || post.approvedBy
    || approval.clientApprovedAt
    || approval.clientApprovedBy
    || approval.qaApprovedAt
    || approval.qaApprovedBy
  )
}

export function socialPostChatActions(input: {
  id: string
  post: Record<string, unknown>
  role: string | undefined
}): ChatContextAction[] {
  const id = clean(input.id, 200)
  if (!id) return []
  const status = clean(input.post.status, 80).toLowerCase() || 'draft'
  const href = `/api/v1/social/posts/${encodeURIComponent(id)}`
  const canAdminister = input.role === 'admin' || input.role === 'ai'
  const canParticipate = canAdminister || input.role === 'client'

  if (status === 'draft' && canParticipate) {
    return [{
      id: `submit-social:${id}`,
      label: 'Submit for review',
      href: `${href}/submit`,
      method: 'POST',
    }]
  }
  if (status === 'qa_review' && canAdminister) {
    return [{
      id: `qa-approve-social:${id}`,
      label: 'Approve QA review',
      href: `${href}/qa-approve`,
      method: 'POST',
      requiresApproval: true,
    }]
  }
  if ((status === 'client_review' || status === 'pending_approval') && canParticipate) {
    return [{
      id: `client-approve-social:${id}`,
      label: 'Approve post',
      href: `${href}/client-approve`,
      method: 'POST',
      requiresApproval: true,
    }]
  }
  if (
    canAdminister
    && hasFinalApproval(input.post)
    && ['approved', 'vaulted', 'scheduled', 'failed'].includes(status)
  ) {
    return [{
      id: `publish-social:${id}`,
      label: status === 'failed' ? 'Retry publishing' : 'Publish now',
      href: `${href}/publish`,
      method: 'POST',
      requiresApproval: true,
    }]
  }
  return []
}

export const socialChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    const snap = await adminDb.collection('social_posts').doc(input.id).get()
    if (!snap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const data = snap.data() ?? {}
    if (data.deleted === true) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const orgId = clean(data.orgId, 200)
    const expectedOrg = input.user.activeOrgId || input.user.orgId || ''
    if (!orgId || (expectedOrg && orgId !== expectedOrg)) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const platform = primaryPlatformOf(data as Record<string, unknown>)
    const status = clean(data.status, 80) || 'draft'
    const label = postText(data.content) || `${platform} post`
    const href = socialHref(snap.id, input.user.role)
    const campaignId = clean(data.campaignId, 200) || clean(data.campaign, 200)
    const actions = socialPostChatActions({
      id: snap.id,
      post: data,
      role: input.user.role,
    })

    const relationships: ChatContextRelationship[] = []
    if (campaignId) {
      const campaignSnap = await adminDb.collection('campaigns').doc(campaignId).get()
      if (campaignSnap.exists && campaignSnap.data()?.deleted !== true) {
        const campaign = campaignSnap.data() ?? {}
        if (!expectedOrg || clean(campaign.orgId, 200) === expectedOrg || clean(campaign.orgId, 200) === orgId) {
          relationships.push({
            kind: 'campaign',
            id: campaignSnap.id,
            label: clean(campaign.name, 160) || 'Campaign',
            relation: 'Campaign',
            href: campaignHref(campaignSnap.id, input.user.role),
          })
        }
      }
    }

    const displayState = stateForStatus(status)
    const attention: ContextAttentionSummary[] = []
    if (displayState === 'needs_approval' || displayState === 'review') {
      attention.push({
        id: 'social-review',
        label: displayState === 'needs_approval' ? 'Post awaiting approval' : 'Post in review',
        state: displayState,
        detail: 'Preview the platform card below, then open the social workspace to approve or edit.',
        href,
        ...(actions.length > 0 ? { actions } : {}),
      })
    }

    const model: ChatContextReadModel = {
      context: {
        kind: 'social',
        id: snap.id,
        orgId,
        label,
        icon: 'campaign',
        href,
      },
      pulse: {
        label: 'Social post',
        metrics: [
          { id: 'platform', label: 'Platform', value: platform },
          { id: 'status', label: 'Status', value: status },
          ...(clean(data.format, 40) ? [{ id: 'format', label: 'Format', value: clean(data.format, 40) }] : []),
        ],
        headline: label,
      },
      groups: [{
        id: 'overview',
        label: 'Overview',
        items: [{
          id: snap.id,
          label,
          state: displayState,
          detail: `${platform} · ${status.replaceAll('_', ' ')}`,
          href,
          ...(actions.length > 0 ? { actions } : {}),
        }],
      }],
      artifacts: [],
      attention,
      activity: [],
      preview: {
        kind: 'social',
        text: label,
        status,
      },
      ...(relationships.length > 0 ? { relationships } : {}),
      capabilities: ['open', 'preview', ...(actions.length > 0 ? ['inline-actions'] : [])],
      asOf: new Date().toISOString(),
    }

    return { ok: true, model }
  },
}
