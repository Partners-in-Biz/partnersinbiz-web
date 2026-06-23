/**
 * Shared shaping for the onboarding admin queue (US-269).
 *
 * Submissions live in the existing `onboarding_submissions` collection. That
 * collection already holds Athleet-shaped intake docs (clubName/adminEmail/…)
 * AND can hold generic submissions created via the admin POST endpoint. This
 * normaliser maps either shape onto one consistent admin view model.
 */

export const ONBOARDING_COLLECTION = 'onboarding_submissions'

export type OnboardingStatus = 'new' | 'in_progress' | 'blocked' | 'complete'

export const ONBOARDING_STATUSES: OnboardingStatus[] = ['new', 'in_progress', 'blocked', 'complete']

export interface InternalNote {
  id: string
  authorUid: string
  authorEmail: string
  body: string
  createdAt: string | null
}

export interface OnboardingView {
  id: string
  orgId: string | null
  businessName: string
  contactName: string
  contactEmail: string
  progress: number
  assignedAdminUid: string | null
  status: OnboardingStatus
  internalNotes: InternalNote[]
  product: string | null
  createdAt: string | null
  updatedAt: string | null
}

export function tsToIso(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
  }
  if (typeof value !== 'object') return null
  const v = value as { _seconds?: number; seconds?: number; toDate?: () => Date }
  if (typeof v.toDate === 'function') { try { return v.toDate().toISOString() } catch { return null } }
  const seconds = v._seconds ?? v.seconds
  if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString()
  return null
}

/** Map a legacy/Athleet status onto the admin queue status vocabulary. */
function normalizeStatus(raw: unknown): OnboardingStatus {
  const s = typeof raw === 'string' ? raw.toLowerCase() : ''
  if (ONBOARDING_STATUSES.includes(s as OnboardingStatus)) return s as OnboardingStatus
  if (s === 'pending') return 'new'
  if (s === 'provisioning' || s === 'active') return 'in_progress'
  if (s === 'done' || s === 'completed' || s === 'live') return 'complete'
  return 'new'
}

function clampProgress(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, Math.round(n)))
}

function normalizeNotes(raw: unknown): InternalNote[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((n, i) => {
      if (!n || typeof n !== 'object') return null
      const note = n as Record<string, unknown>
      return {
        id: typeof note.id === 'string' ? note.id : String(i),
        authorUid: typeof note.authorUid === 'string' ? note.authorUid : '',
        authorEmail: typeof note.authorEmail === 'string' ? note.authorEmail : '',
        body: typeof note.body === 'string' ? note.body : '',
        createdAt: tsToIso(note.createdAt),
      } satisfies InternalNote
    })
    .filter((n): n is InternalNote => n !== null)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

/** Normalise a raw Firestore doc onto the admin view model (handles both shapes). */
export function toOnboardingView(id: string, d: Record<string, unknown>): OnboardingView {
  const str = (...keys: string[]): string => {
    for (const k of keys) {
      const v = d[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }
  return {
    id,
    orgId: typeof d.orgId === 'string' ? d.orgId : null,
    businessName: str('businessName', 'clubName', 'companyName', 'name'),
    contactName: str('contactName', 'adminName'),
    contactEmail: str('contactEmail', 'adminEmail', 'email'),
    progress: clampProgress(d.progress),
    assignedAdminUid: typeof d.assignedAdminUid === 'string' && d.assignedAdminUid ? d.assignedAdminUid : null,
    status: normalizeStatus(d.status),
    internalNotes: normalizeNotes(d.internalNotes),
    product: typeof d.product === 'string' ? d.product : null,
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  }
}
