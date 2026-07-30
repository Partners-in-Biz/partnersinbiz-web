import { adminDb } from '@/lib/firebase/admin'
import { buildCampaignAssets } from '@/lib/campaigns/assets'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type {
  ChatContextReadModel,
  ContextAttentionSummary,
  ContextDisplayState,
  ContextItemSummary,
} from '@/lib/chat-context/types'
import { primaryPlatformOf } from '@/lib/campaign-preview/normalizeSocialPost'
import { socialPostChatActions } from '@/lib/chat-context/adapters/social'

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function postText(value: unknown): string {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ').slice(0, 160)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const text = (value as { text?: unknown }).text
    if (typeof text === 'string') return text.trim().replace(/\s+/g, ' ').slice(0, 160)
  }
  return ''
}

function stateForStatus(status: string): ContextDisplayState {
  switch (status.toLowerCase()) {
    case 'published':
    case 'live':
    case 'approved':
    case 'complete':
    case 'completed':
      return 'complete'
    case 'pending_approval':
    case 'qa_review':
      return 'needs_approval'
    case 'client_review':
    case 'in_review':
    case 'review':
      return 'review'
    case 'failed':
    case 'blocked':
    case 'cancelled':
      return 'blocked'
    case 'publishing':
    case 'shipping':
    case 'scheduled':
    case 'in_progress':
      return 'running'
    default:
      return 'ready'
  }
}

function campaignHref(id: string, role: string | undefined): string {
  return role === 'client' ? `/portal/campaigns/${encodeURIComponent(id)}` : `/admin/campaigns/${encodeURIComponent(id)}`
}

function itemFromPost(post: Record<string, unknown>, role: string | undefined): ContextItemSummary {
  const postId = clean(post.id, 200)
  const id = postId || 'post'
  const platform = primaryPlatformOf(post)
  const status = clean(post.status, 80) || 'draft'
  const label = postText(post.content) || clean(post.title, 120) || `${platform} post`
  const actions = postId ? socialPostChatActions({ id: postId, post, role }) : []
  return {
    id,
    label,
    state: stateForStatus(status),
    detail: `${platform} · ${status.replaceAll('_', ' ')}`,
    ...(actions.length > 0 ? { actions } : {}),
  }
}

function itemFromBlog(blog: Record<string, unknown>): ContextItemSummary {
  const id = clean(blog.id, 200) || 'blog'
  const status = clean(blog.status, 80) || 'draft'
  return {
    id,
    label: clean(blog.title, 160) || 'Untitled blog',
    state: stateForStatus(status),
    detail: `blog · ${status.replaceAll('_', ' ')}`,
  }
}

export const campaignChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    const snap = await adminDb.collection('campaigns').doc(input.id).get()
    if (!snap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const data = snap.data() ?? {}
    if (data.deleted === true) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }

    const orgId = clean(data.orgId, 200) || input.user.activeOrgId || input.user.orgId || ''
    const expectedOrg = input.user.activeOrgId || input.user.orgId || ''
    if (!orgId || (expectedOrg && orgId !== expectedOrg && input.user.role === 'client')) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const assets = await buildCampaignAssets(snap.id)
    const social = (assets.social ?? []) as Array<Record<string, unknown>>
    const blogs = (assets.blogs ?? []) as Array<Record<string, unknown>>
    const videos = (assets.videos ?? []) as Array<Record<string, unknown>>
    const status = clean(data.status, 80) || 'draft'
    const pendingCount = Number(assets.meta?.byStatus?.pending_approval ?? 0)
    const href = campaignHref(snap.id, input.user.role)

    const attention: ContextAttentionSummary[] = []
    if (pendingCount > 0 || status === 'in_review') {
      attention.push({
        id: 'campaign-review',
        label: pendingCount > 0
          ? `${pendingCount} asset${pendingCount === 1 ? '' : 's'} awaiting approval`
          : 'Campaign is in review',
        state: pendingCount > 0 ? 'needs_approval' : 'review',
        detail: 'Open the preview below or the full campaign cockpit to review platform cards.',
        href,
      })
    }

    const groups = [
      { id: 'social', label: 'Social posts', items: social.slice(0, 12).map((post) => itemFromPost(post, input.user.role)) },
      { id: 'blogs', label: 'Blog posts', items: blogs.slice(0, 8).map(itemFromBlog) },
      { id: 'videos', label: 'Videos', items: videos.slice(0, 8).map((post) => itemFromPost(post, input.user.role)) },
    ].filter((group) => group.items.length > 0)
    const hasInlineActions = groups.some((group) => group.items.some((item) => (item.actions?.length ?? 0) > 0))

    const model: ChatContextReadModel = {
      context: {
        kind: 'campaign',
        id: snap.id,
        orgId,
        label: clean(data.name, 160) || 'Campaign',
        icon: 'ads_click',
        href,
      },
      pulse: {
        label: 'Campaign',
        metrics: [
          { id: 'social', label: 'Social', value: Number(assets.meta?.totals?.social ?? social.length) },
          { id: 'blogs', label: 'Blogs', value: Number(assets.meta?.totals?.blogs ?? blogs.length) },
          { id: 'videos', label: 'Videos', value: Number(assets.meta?.totals?.videos ?? videos.length) },
          { id: 'status', label: 'Status', value: status.replaceAll('_', ' ') },
        ],
        headline: clean(data.description, 280) || `${social.length + blogs.length + videos.length} assets ready for review`,
        ...(pendingCount > 0 ? {
          next: {
            id: 'review-assets',
            label: 'Review pending assets',
            state: 'needs_approval' as const,
            detail: `${pendingCount} awaiting approval`,
            href,
          },
        } : {}),
      },
      groups,
      artifacts: [],
      attention,
      activity: [],
      preview: {
        kind: 'campaign',
        text: clean(data.description, 280) || undefined,
        status,
      },
      capabilities: ['open', 'preview', ...(hasInlineActions ? ['inline-actions'] : [])],
      asOf: new Date().toISOString(),
    }

    return { ok: true, model }
  },
}
