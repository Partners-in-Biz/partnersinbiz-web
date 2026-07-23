import { adminDb } from '@/lib/firebase/admin'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type {
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
      capabilities: ['open', 'preview'],
      asOf: new Date().toISOString(),
    }

    return { ok: true, model }
  },
}
