import { adminDb } from '@/lib/firebase/admin'
import {
  resolvePortalSeoUser,
  scopeFromSearchParams,
  type PortalSeoScope,
  type PortalSeoSearchParams,
} from './portalSeoScope'

export type ActiveSprint = {
  id: string
  siteUrl: string
  siteName: string
  orgId: string
  currentDay: number
  gscConnected: boolean
  gscPropertyUrl?: string
}

export type SeoToolContext =
  | { ok: true; orgId: string; uid: string; scope: PortalSeoScope; sprints: ActiveSprint[]; activeSprint: ActiveSprint | null }
  | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'no-org' }

type SprintDoc = {
  orgId?: string
  siteUrl?: string
  siteName?: string
  currentDay?: number | string
  createdAt?: { toMillis?: () => number }
  integrations?: { gsc?: { connected?: boolean; propertyUrl?: string } }
}

function toSprint(id: string, data: SprintDoc): ActiveSprint {
  return {
    id,
    siteUrl: typeof data.siteUrl === 'string' ? data.siteUrl : '',
    siteName: typeof data.siteName === 'string' ? data.siteName : (typeof data.siteUrl === 'string' ? data.siteUrl : 'Sprint'),
    orgId: typeof data.orgId === 'string' ? data.orgId : '',
    currentDay: Number(data.currentDay ?? 0) || 0,
    gscConnected: Boolean(data.integrations?.gsc?.connected),
    gscPropertyUrl: data.integrations?.gsc?.propertyUrl,
  }
}

/**
 * Resolve the org + the user's SEO sprints for a top-level SEO tool page.
 *
 * Most SEO tools render org-wide but need a sprint to read/write sprint-scoped
 * data (keywords, backlinks, audits). We surface every sprint so the client can
 * switch context, and pick a default active sprint (the most recently created).
 */
export async function resolveSeoToolContext(params?: PortalSeoSearchParams): Promise<SeoToolContext> {
  const scope = scopeFromSearchParams(params)
  const user = await resolvePortalSeoUser(scope.orgId)
  if (!user) return { ok: false, reason: 'unauthenticated' }
  if (user.forbidden) return { ok: false, reason: 'forbidden' }
  if (!user.orgId) return { ok: false, reason: 'no-org' }

  const snap = await adminDb
    .collection('seo_sprints')
    .where('orgId', '==', user.orgId)
    .where('deleted', '==', false)
    .get()

  const sprints = snap.docs
    .map((doc) => toSprint(doc.id, doc.data() as SprintDoc))
    .sort((a, b) => b.currentDay - a.currentDay)

  const requestedSprintId = typeof params?.sprintId === 'string' ? params.sprintId : undefined
  const activeSprint =
    (requestedSprintId && sprints.find((s) => s.id === requestedSprintId)) || sprints[0] || null

  return { ok: true, orgId: user.orgId, uid: user.uid, scope, sprints, activeSprint }
}
